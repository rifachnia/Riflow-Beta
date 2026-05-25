import { summarizeRisk } from "../core/risk.js";
import { saveState } from "../core/context.js";
import { closePaperPosition, createPaperPosition, openPositions } from "./portfolio.js";
import { computeDeploySize } from "../core/sizing.js";
import { addLessonFromTrade } from "./lessons.js";
import { updatePoolMemoryFromTrade } from "./pool-memory.js";

export async function applyDecision(ctx, decision, provider = null) {
  if (decision.action === "WAIT") {
    await ctx.log.write("auto.wait", decisionLog(decision, provider));
    return `AI WAIT: ${decision.reason}`;
  }

  if (decision.action === "OPEN") {
    const risk = summarizeRisk(ctx.config, ctx.state);
    const candidate = (ctx.state.lastScan || []).find((item) => item.symbol === decision.symbol);
    const minScore = Number(ctx.config.auto?.minOpenScore ?? 78);
    if (!risk.canOpen) return "AI wanted OPEN, but risk blocked it.";
    if (!candidate) return `AI wanted OPEN ${decision.symbol}, but candidate is missing.`;
    if (candidate.score < minScore) return `AI wanted OPEN ${candidate.symbol}, but score ${candidate.score} < ${minScore}.`;
    if (ctx.config.safety?.paused || ctx.config.safety?.emergencyPause) return "AI wanted OPEN, but bot is paused.";

    const requested = decision.sizeSol || computeDeploySize(ctx.config, ctx.state, candidate.symbol) || ctx.config.risk.deployMinSol;
    const sizeSol = Math.min(ctx.config.risk.deployMaxSol, Math.max(ctx.config.risk.deployMinSol, requested));
    const position = createPaperPosition(candidate.symbol, sizeSol, providerFromDecision(decision, provider));
    position.poolAddress = candidate.poolAddress || candidate.symbol;
    position.initialMetrics = candidate;
    position.scoreAtOpen = candidate.score;
    position.reason = decision.reason;
    position.aiConfidence = decision.confidence;
    if (ctx.config.safety?.dryRun !== false) {
      await ctx.decisions?.write({
        dry_run: true,
        agent_name: "Executor",
        action_type: "DEPLOY",
        pool_address: candidate.poolAddress,
        symbol: candidate.symbol,
        input_metrics: candidate,
        reasoning_summary: decision.reason,
        confidence_score: decision.confidence,
        risk_notes: ["dry-run simulation only"],
        final_decision: decision,
        execution_result: { simulated: true, position }
      });
      return `DRY-RUN AI OPEN ${position.symbol}: ${decision.reason}`;
    }
    ctx.state.positions.push(position);
    ctx.state.paperBalanceSol = Number((ctx.state.paperBalanceSol - sizeSol).toFixed(6));
    await saveState(ctx);
    await ctx.log.write("auto.opened", { ...decisionLog(decision, provider), id: position.id, symbol: position.symbol, sizeSol, score: candidate.score });
    return `AI OPEN ${position.symbol}: ${decision.reason}`;
  }

  if (decision.action === "CLOSE") {
    const position = openPositions(ctx.state).find((item) => item.id === decision.positionId)
      || openPositions(ctx.state).find((item) => item.symbol === decision.symbol);
    if (!position) return "AI wanted CLOSE, but no matching open position exists.";

    position.status = "closed";
    position.closedAt = new Date().toISOString();
    const trade = closePaperPosition(position, null, providerFromDecision(decision, provider));
    trade.reason = decision.reason;
    trade.aiConfidence = decision.confidence;
    trade.poolAddress = position.poolAddress || position.symbol;
    if (ctx.config.safety?.dryRun !== false) {
      await ctx.decisions?.write({
        dry_run: true,
        agent_name: "Executor",
        action_type: "CLOSE",
        pool_address: trade.poolAddress,
        symbol: trade.symbol,
        reasoning_summary: decision.reason,
        confidence_score: decision.confidence,
        risk_notes: ["dry-run simulation only"],
        final_decision: decision,
        execution_result: { simulated: true, trade },
        pnl_result: { pnlPct: trade.pnlPct, pnlUsd: trade.pnlUsd }
      });
      return `DRY-RUN AI CLOSE ${position.symbol}: ${decision.reason}`;
    }
    ctx.state.closedTrades.unshift(trade);
    ctx.state.paperBalanceSol = Number((ctx.state.paperBalanceSol + Number(position.sizeSol || 0)).toFixed(6));
    await saveState(ctx);
    await ctx.log.write("auto.closed", { ...decisionLog(decision, provider), id: position.id, symbol: position.symbol, pnlPct: trade.pnlPct });
    const lesson = await addLessonFromTrade(ctx, trade, position);
    trade.lessonSummary = lesson.future_bias;
    await updatePoolMemoryFromTrade(ctx, trade);
    return `AI CLOSE ${position.symbol}: ${decision.reason}`;
  }

  return "AI returned an unknown action.";
}

function providerFromDecision(decision, provider) {
  return provider || { id: decision.providerId, model: decision.modelId };
}

function decisionLog(decision, provider) {
  return {
    action: decision.action,
    symbol: decision.symbol,
    positionId: decision.positionId,
    providerId: provider?.id || decision.providerId,
    modelId: provider?.model || decision.modelId,
    confidence: decision.confidence,
    risk_level: decision.risk_level,
    reason: decision.reason
  };
}
