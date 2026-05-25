import { markMeteoraPosition } from "./meteora.js";
import { buildRange } from "./dlmm-strategy.js";

export function openPositions(state) {
  return state.positions.filter((position) => position.status === "open");
}

export function portfolioStats(state) {
  const open = openPositions(state).map(markPosition);
  const closed = state.closedTrades || [];
  const realizedPnlUsd = closed.reduce((sum, trade) => sum + Number(trade.pnlUsd || 0), 0);
  const wins = closed.filter((trade) => Number(trade.pnlUsd || 0) > 0).length;
  const losses = closed.length - wins;
  const floatingPnlUsd = open.reduce((sum, position) => sum + Number(position.pnlUsd || 0), 0);

  return {
    open,
    closed,
    realizedPnlUsd,
    floatingPnlUsd,
    equityUsd: realizedPnlUsd + floatingPnlUsd,
    wins,
    losses,
    winrate: closed.length ? (wins / closed.length) * 100 : null,
    deployedSol: open.reduce((sum, position) => sum + Number(position.sizeSol || 0), 0)
  };
}

export function markPosition(position) {
  const opened = position.openedAt ? new Date(position.openedAt).getTime() : Date.now();
  const minutes = Math.max(1, Math.floor((Date.now() - opened) / 60000));
  const seed = `${position.id}:${position.symbol}:${Math.floor(minutes / 3)}`;
  let hash = 0;
  for (const char of seed) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  const wave = (hash % 2400) / 100 - 12;
  const pnlPct = Number(wave.toFixed(2));
  const pnlUsd = Number((Number(position.sizeSol || 0) * 150 * (pnlPct / 100)).toFixed(2));
  return { ...position, pnlPct, pnlUsd, markPrice: Number((1 + pnlPct / 100).toFixed(4)) };
}

export function createPaperPosition(symbol, sizeSol, provider = null) {
  const now = new Date().toISOString();
  return {
    id: `pos_${Date.now().toString(36)}`,
    symbol: symbol.toUpperCase(),
    pair: `${symbol.toUpperCase()}/SOL`,
    sizeSol: Number(sizeSol),
    entryPrice: 1,
    providerId: provider?.id || "manual",
    modelId: provider?.model || "manual",
    status: "open",
    openedAt: now,
    notes: []
  };
}

export function createPaperPositionFromCandidate(candidate, sizeSol, provider = null, config = {}) {
  const position = createPaperPosition(candidate.symbol, sizeSol, provider);
  position.source = candidate.source || "local-sim";
  position.poolAddress = candidate.poolAddress || candidate.symbol;
  position.baseMint = candidate.baseMint || candidate.tokenAddress || null;
  position.quoteMint = candidate.quoteMint || null;
  position.tokenAddress = candidate.tokenAddress || candidate.baseMint || null;
  position.entryPrice = candidate.currentPrice ?? candidate.price ?? position.entryPrice;
  position.entryActiveBin = candidate.activeBin ?? null;
  position.entryTvlUsd = candidate.tvlUsd ?? null;
  position.entryActiveTvlUsd = candidate.activeTvlUsd ?? candidate.raw?.active_tvl ?? null;
  position.entryVolume24hUsd = candidate.volume24hUsd ?? null;
  position.entryFees24hUsd = candidate.fees24hUsd ?? null;
  position.entryFeeTvlRatio = candidate.feeTvlRatio ?? candidate.raw?.fee_tvl_ratio ?? null;
  position.entryVolatility = candidate.volatility ?? candidate.raw?.volatility ?? null;
  position.binStep = candidate.binStep ?? null;
  Object.assign(position, buildRange(candidate, config));
  position.entryTimestamp = new Date().toISOString();
  position.initialMetrics = candidate;
  position.calculationMode = candidate.source === "meteora-dlmm" ? "approximate-dlmm" : "local-sim";
  position.estimatedFeesUsd = 0;
  position.claimableFeesUsd = 0;
  position.lastFeeUpdateAt = position.entryTimestamp;
  position.totalOutOfRangeMinutes = 0;
  position.redeployCount = 0;
  position.peakPnlPct = 0;
  return position;
}

export async function markPositionWithMarketData(position, config, currentPool = null) {
  if (position.source === "meteora-dlmm" || position.poolAddress) {
    return markMeteoraPosition(config, position, currentPool);
  }
  return markPosition(position);
}

export async function closePaperPositionWithMarketData(position, config, provider = null, currentPool = null) {
  const marked = await markPositionWithMarketData(position, config, currentPool);
  const trade = closePaperPosition(marked, marked.pnlPct, provider);
  trade.poolAddress = position.poolAddress || position.symbol;
  trade.baseMint = position.baseMint || null;
  trade.quoteMint = position.quoteMint || null;
  trade.entryPrice = position.entryPrice ?? null;
  trade.currentPrice = marked.currentPrice ?? marked.markPrice ?? null;
  trade.entryActiveBin = position.entryActiveBin ?? null;
  trade.currentActiveBin = marked.currentActiveBin ?? null;
  trade.estimatedFeesUsd = marked.estimatedFeesUsd ?? 0;
  trade.feeUsd = marked.estimatedFeesUsd ?? marked.claimableFeesUsd ?? 0;
  trade.claimableFeesUsd = marked.claimableFeesUsd ?? 0;
  trade.calculationMode = marked.calculationMode || "approximate-dlmm";
  trade.warnings = marked.warnings || [];
  trade.durationMinutes = durationMinutes(position.openedAt, trade.closedAt);
  trade.outOfRangeMinutes = marked.totalOutOfRangeMinutes || 0;
  trade.entryScore = position.scoreAtOpen ?? position.initialMetrics?.candidateScore ?? position.initialMetrics?.score ?? null;
  trade.maxDrawdownPct = position.maxDrawdownPct ?? Math.min(0, marked.pnlPct ?? 0);
  return trade;
}

export function closePaperPosition(position, pnlPct = 0, provider = null) {
  const marked = markPosition(position);
  const finalPct = pnlPct === null ? marked.pnlPct : Number(pnlPct);
  const pnlUsd = Number((Number(position.sizeSol || 0) * 150 * (finalPct / 100)).toFixed(2));
  return {
    id: `trd_${Date.now().toString(36)}`,
    positionId: position.id,
    symbol: position.symbol,
    pair: position.pair,
    sizeSol: position.sizeSol,
    providerId: provider?.id || position.providerId || "manual",
    modelId: provider?.model || position.modelId || "manual",
    pnlPct: finalPct,
    pnlUsd,
    openedAt: position.openedAt,
    closedAt: new Date().toISOString()
  };
}

function durationMinutes(start, end) {
  return Math.max(0, Math.round((new Date(end || Date.now()).getTime() - new Date(start || Date.now()).getTime()) / 60000));
}
