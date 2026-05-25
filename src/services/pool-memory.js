import path from "node:path";

export async function loadPoolMemory(ctx, poolAddress) {
  const all = await loadAllPoolMemory(ctx);
  return all[pKey(poolAddress)] || emptyPoolMemory(poolAddress);
}

export async function loadAllPoolMemory(ctx) {
  return ctx.store.read(path.join("memory", "pools.json"), {});
}

export async function savePoolMemory(ctx, poolAddress, memory) {
  const all = await loadAllPoolMemory(ctx);
  all[pKey(poolAddress)] = {
    ...emptyPoolMemory(poolAddress),
    ...memory,
    pool_address: poolAddress,
    last_updated: new Date().toISOString()
  };
  await ctx.store.write(path.join("memory", "pools.json"), all);
  return all[pKey(poolAddress)];
}

export async function updatePoolMemoryFromDecision(ctx, candidateOrPosition, entry) {
  const poolAddress = candidateOrPosition?.poolAddress || candidateOrPosition?.pool_address || candidateOrPosition?.pool || candidateOrPosition?.symbol;
  if (!poolAddress) return null;
  const memory = await loadPoolMemory(ctx, poolAddress);
  const decisions = memory.past_decisions || [];
  decisions.unshift({
    ts: entry.timestamp || new Date().toISOString(),
    action: entry.action_type || entry.action || "SKIP",
    symbol: candidateOrPosition.symbol || entry.symbol || null,
    decision: entry.final_decision || null,
    reasoning: entry.reasoning_summary || entry.reason || "",
    confidence: entry.confidence_score ?? entry.confidence ?? 0,
    result: entry.execution_result || null
  });
  return savePoolMemory(ctx, poolAddress, {
    ...memory,
    token_symbol: candidateOrPosition.symbol || memory.token_symbol,
    token_name: candidateOrPosition.name || memory.token_name,
    past_decisions: decisions.slice(0, 50),
    risk_flags: memory.risk_flags || [],
    notes_from_ai: unique([...(memory.notes_from_ai || []), entry.reasoning_summary || entry.reason || ""]).slice(0, 20)
  });
}

export async function updatePoolMemoryFromTrade(ctx, trade) {
  const poolAddress = trade.poolAddress || trade.pool_address || trade.symbol;
  const memory = await loadPoolMemory(ctx, poolAddress);
  const pnl = [...(memory.past_pnl || []), { ts: trade.closedAt || new Date().toISOString(), pnlPct: trade.pnlPct, pnlUsd: trade.pnlUsd }];
  const totalTrades = Number(memory.totalTrades || 0) + 1;
  const won = Number(trade.pnlUsd || 0) > 0;
  const wins = Number(memory.wins || 0) + (won ? 1 : 0);
  const losses = Number(memory.losses || 0) + (won ? 0 : 1);
  const avgPnl = average(pnl.map((item) => Number(item.pnlPct || 0)));
  const fees = [...(memory.fee_performance || []), { ts: new Date().toISOString(), feeUsd: trade.feeUsd || trade.estimatedFeesUsd || 0 }].slice(-50);
  const outOfRangeFrequency = Number(memory.out_of_range_frequency || 0) + (Number(trade.outOfRangeMinutes || 0) > 0 ? 1 : 0);
  return savePoolMemory(ctx, poolAddress, {
    ...memory,
    token_symbol: trade.symbol || memory.token_symbol,
    totalTrades,
    wins,
    losses,
    winrate: totalTrades ? Number(((wins / totalTrades) * 100).toFixed(2)) : null,
    averagePnlPct: Number(avgPnl.toFixed(3)),
    averageFeesUsd: Number(average(fees.map((item) => Number(item.feeUsd || 0))).toFixed(4)),
    averageHoldMinutes: rollingAverage(memory.averageHoldMinutes, trade.durationMinutes, totalTrades),
    maxDrawdownPct: Math.min(Number(memory.maxDrawdownPct || 0), Number(trade.maxDrawdownPct || trade.pnlPct || 0)),
    lastClosedAt: trade.closedAt || new Date().toISOString(),
    lastCloseReason: trade.reason || null,
    blacklistUntil: trade.blacklistUntil || memory.blacklistUntil || null,
    avoidScore: Number(trade.pnlPct || 0) < 0 ? Math.min(20, Number(memory.avoidScore || 0) + 4) : Math.max(0, Number(memory.avoidScore || 0) - 1),
    preferScore: Number(trade.pnlPct || 0) > 0 ? Math.min(8, Number(memory.preferScore || 0) + 2) : Math.max(0, Number(memory.preferScore || 0) - 1),
    past_pnl: pnl.slice(-50),
    fee_performance: fees,
    out_of_range_frequency: outOfRangeFrequency,
    lessons_learned: unique([...(memory.lessons_learned || []), trade.lessonSummary || ""]).slice(0, 20)
  });
}

export function emptyPoolMemory(poolAddress) {
  return {
    pool_address: poolAddress,
    token_symbol: null,
    token_name: null,
    past_decisions: [],
    past_pnl: [],
    fee_performance: [],
    out_of_range_frequency: 0,
    blacklist: false,
    risk_flags: [],
    notes_from_ai: [],
    lessons_learned: [],
    totalTrades: 0,
    wins: 0,
    losses: 0,
    winrate: null,
    averagePnlPct: 0,
    averageFeesUsd: 0,
    averageHoldMinutes: 0,
    maxDrawdownPct: 0,
    lastClosedAt: null,
    lastCloseReason: null,
    blacklistUntil: null,
    avoidScore: 0,
    preferScore: 0,
    last_updated: null
  };
}

function pKey(value) {
  return String(value || "unknown").toLowerCase();
}

function average(values) {
  const rows = values.filter((value) => Number.isFinite(value));
  return rows.length ? rows.reduce((sum, value) => sum + value, 0) / rows.length : 0;
}

function rollingAverage(previous, value, count) {
  const n = Number(value);
  if (!Number.isFinite(n)) return Number(previous || 0);
  if (count <= 1) return n;
  return Number((((Number(previous || 0) * (count - 1)) + n) / count).toFixed(2));
}

function unique(items) {
  const seen = new Set();
  return (items || []).map((item) => String(item || "").trim()).filter((item) => {
    if (!item || seen.has(item.toLowerCase())) return false;
    seen.add(item.toLowerCase());
    return true;
  });
}
