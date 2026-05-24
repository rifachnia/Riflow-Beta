import { summarizeRisk } from "../core/risk.js";
import { portfolioStats } from "../services/portfolio.js";

export const traderDecisionSchema = [
  "Return strict JSON only. No markdown. No commentary.",
  "Schema:",
  "{\"action\":\"OPEN|CLOSE|WAIT\",\"symbol\":\"string|null\",\"confidence\":0-100,\"reason\":\"concise explanation\",\"risk_level\":\"LOW|MEDIUM|HIGH\"}",
  "Optional backward-compatible fields are allowed only when needed: positionId, sizeSol.",
  "Rules:",
  "- Paper trading only.",
  "- Preserve capital first.",
  "- Prefer WAIT when uncertain.",
  "- Avoid overtrading.",
  "- Never assume missing data.",
  "- Use only provided data."
].join("\n");

export function buildTraderMessages(ctx, provider, memory, recentDecisions = []) {
  const stats = portfolioStats(ctx.state);
  const risk = summarizeRisk(ctx.config, ctx.state);
  const open = stats.open.map((position) => ({
    id: position.id,
    symbol: position.symbol,
    sizeSol: position.sizeSol,
    pnlPct: position.pnlPct,
    pnlUsd: position.pnlUsd,
    openedAt: position.openedAt,
    providerId: position.providerId,
    modelId: position.modelId
  }));
  const closed = stats.closed.slice(0, 12).map((trade) => ({
    symbol: trade.symbol,
    pnlPct: trade.pnlPct,
    pnlUsd: trade.pnlUsd,
    closedAt: trade.closedAt,
    providerId: trade.providerId,
    modelId: trade.modelId,
    reason: trade.reason || null
  }));
  const candidates = (ctx.state.lastScan || []).slice(0, 10).map((item) => ({
    symbol: item.symbol,
    score: item.score,
    liquidityUsd: item.liquidityUsd,
    volume24hUsd: item.volume24hUsd,
    ageHours: item.ageHours,
    holders: item.holders,
    momentum: item.momentum,
    flags: item.flags || []
  }));

  return [{
    role: "user",
    content: JSON.stringify({
      task: "Choose the next paper-trading action for Riflow.",
      instruction: "Return an actual decision, not schema placeholder text. If no trade has enough evidence, return WAIT with symbol null.",
      paperOnly: true,
      provider: provider ? { id: provider.id, model: provider.model, name: provider.name || provider.id } : null,
      portfolio_summary: {
        paperBalanceSol: ctx.state.paperBalanceSol,
        realizedPnlUsd: stats.realizedPnlUsd,
        floatingPnlUsd: stats.floatingPnlUsd,
        equityUsd: stats.equityUsd,
        wins: stats.wins,
        losses: stats.losses,
        winrate: stats.winrate,
        deployedSol: stats.deployedSol
      },
      open_positions: open,
      scanner_candidates: candidates,
      market_snapshot: {
        source: ctx.config.scanner?.source || "unknown",
        limit: ctx.config.scanner?.limit,
        candidateCount: candidates.length,
        leader: candidates[0]?.symbol || null
      },
      performance_summary: {
        recentClosedTrades: closed,
        closedTradeCount: stats.closed.length
      },
      lessons_learned: memory.lessons || [],
      avoid_patterns: memory.avoid_patterns || [],
      preferred_patterns: memory.preferred_patterns || [],
      confidence_adjustments: memory.confidence_adjustments || [],
      risk_improvements: memory.risk_improvements || [],
      recent_decisions: recentDecisions,
      model_specific_memory: memory,
      risk_config: ctx.config.risk,
      risk_state: risk,
      auto_trade_config: ctx.config.auto
    })
  }];
}
