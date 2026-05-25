import { summarizeRisk } from "../core/risk.js";
import { computeDeploySize } from "../core/sizing.js";

export function reviewDecision(ctx, decision, candidates = []) {
  const riskNotes = [];
  const final = { ...decision };
  const risk = summarizeRisk(ctx.config, ctx.state);
  const action = String(final.action || "WAIT").toUpperCase();

  if (ctx.config.safety?.paused || ctx.config.safety?.emergencyPause) {
    return block(final, "SKIP", ["bot is paused or emergency pause is active"]);
  }
  if (ctx.config.auto?.paperOnly === false) {
    return block(final, "SKIP", ["live trading is disabled in Riflow"]);
  }

  if (action === "OPEN" || action === "DEPLOY") {
    const candidate = candidates.find((item) => item.symbol === final.symbol || item.poolAddress === final.poolAddress);
    if (!candidate) riskNotes.push("candidate missing or failed hard filters");
    if (candidate?.entryGate && !candidate.entryGate.passed) riskNotes.push(...candidate.entryGate.reasons);
    if (candidate?.qualityLabel === "reject") riskNotes.push(...(candidate.rejectReasons || ["candidate quality rejected"]));
    if (!risk.canOpen) riskNotes.push("risk state has no room to open");
    const sizeSol = computeDeploySize(ctx.config, ctx.state, final.symbol);
    if (sizeSol <= 0) riskNotes.push("dynamic sizing returned zero deployable size");
    if (riskNotes.length) return block(final, "SKIP", riskNotes);
    final.action = "OPEN";
    final.symbol = candidate.symbol;
    final.poolAddress = candidate.poolAddress;
    final.sizeSol = sizeSol;
    return allow(final, riskNotes);
  }

  if (action === "SKIP") {
    final.action = "SKIP";
    return block(final, "SKIP", [final.reason || "decision skipped"]);
  }

  if (action === "CLOSE" || action === "CLAIM" || action === "HOLD" || action === "WAIT") {
    final.action = action === "WAIT" ? "HOLD" : action;
    return allow(final, riskNotes);
  }

  return block(final, "SKIP", [`unknown action ${action}`]);
}

function allow(decision, riskNotes) {
  return {
    approved: true,
    finalDecision: decision,
    riskNotes,
    reasoning_summary: "Critic/Risk Agent approved after deterministic paper-mode checks."
  };
}

function block(decision, action, riskNotes) {
  return {
    approved: false,
    finalDecision: { ...decision, action, confidence: 0 },
    riskNotes,
    reasoning_summary: `Critic/Risk Agent blocked decision: ${riskNotes.join("; ")}`
  };
}
