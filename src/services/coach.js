import { chatJson } from "./ai.js";
import { providerBook, providerStats } from "./providers.js";
import { loadMemory, updateMemoryFromCoach } from "./memory.js";
import { buildCoachMessages, coachSchema } from "../prompts/coachPrompt.js";

export async function runCoach(ctx, provider, options = {}) {
  const memory = await loadMemory(ctx, provider);
  const stats = providerStats(ctx, provider.id);
  const trades = selectTrades(providerBook(ctx.state, provider.id).closedTrades || [], options);
  const decisions = await recentDecisions(ctx, provider.id, Number(options.decisions || 80));
  const snapshot = {
    modelId: provider.model,
    providerId: provider.id,
    closedTradeCount: stats.closed.length,
    reviewedTradeCount: trades.length,
    realizedPnlUsd: stats.realizedPnlUsd,
    floatingPnlUsd: stats.floatingPnlUsd,
    equityUsd: stats.equityUsd,
    winrate: stats.winrate,
    maxDrawdownUsd: stats.maxDrawdownUsd
  };
  const coach = normalizeCoach(await chatJson(ctx.config, buildCoachMessages({
    provider,
    memory,
    trades,
    decisions,
    stats: snapshot,
    windowLabel: options.windowLabel || "recent"
  }), coachSchema, provider));
  const updatedMemory = await updateMemoryFromCoach(ctx, provider, coach, snapshot);
  await ctx.log.write("coach.completed", { providerId: provider.id, modelId: provider.model, trades: trades.length });
  return { coach, memory: updatedMemory, performance: snapshot };
}

export function normalizeCoach(input) {
  return {
    mistakes: stringList(input?.mistakes),
    successes: stringList(input?.successes),
    strong_conditions: stringList(input?.strong_conditions),
    weak_conditions: stringList(input?.weak_conditions),
    new_rules: stringList(input?.new_rules),
    confidence_adjustments: stringList(input?.confidence_adjustments),
    risk_improvements: stringList(input?.risk_improvements),
    summary: String(input?.summary || "").slice(0, 600)
  };
}

export function selectTrades(trades, options = {}) {
  let rows = [...(trades || [])];
  if (options.sinceMs) rows = rows.filter((trade) => new Date(trade.closedAt || 0).getTime() >= options.sinceMs);
  const limit = Number(options.trades || 0);
  if (limit > 0) rows = rows.slice(0, limit);
  return rows.map((trade) => ({
    id: trade.id,
    symbol: trade.symbol,
    pnlPct: trade.pnlPct,
    pnlUsd: trade.pnlUsd,
    sizeSol: trade.sizeSol,
    openedAt: trade.openedAt,
    closedAt: trade.closedAt,
    reason: trade.reason || null,
    confidence: trade.aiConfidence ?? null,
    providerId: trade.providerId,
    modelId: trade.modelId
  }));
}

async function recentDecisions(ctx, providerId, limit) {
  const lines = await ctx.log.tail(limit);
  return lines
    .map(parseLine)
    .filter((row) => row && ["ai.decision", "battle.decision", "auto.wait", "auto.opened", "auto.closed"].includes(row.type))
    .filter((row) => !row.providerId || row.providerId === providerId)
    .slice(-limit)
    .map((row) => ({
      ts: row.ts,
      type: row.type,
      action: row.action,
      symbol: row.symbol,
      providerId: row.providerId,
      modelId: row.modelId,
      confidence: row.confidence,
      reason: row.reason,
      result: row.result
    }));
}

function parseLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function stringList(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => typeof item === "string" ? item : item?.rule || item?.text || item?.summary || "")
    .map((item) => String(item).replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 20);
}
