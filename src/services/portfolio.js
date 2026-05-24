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
