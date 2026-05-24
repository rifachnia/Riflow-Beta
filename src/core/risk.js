export function summarizeRisk(config, state) {
  const open = state.positions.filter((position) => position.status === "open");
  const usedSol = open.reduce((sum, position) => sum + Number(position.sizeSol || 0), 0);
  const maxSol = Number(config.risk.deployMaxSol || 0) * Number(config.risk.maxOpenPositions || 0);
  const room = Math.max(0, Number(config.risk.maxOpenPositions || 0) - open.length);

  return {
    openCount: open.length,
    room,
    usedSol,
    maxSol,
    canOpen: room > 0 && state.paperBalanceSol >= Number(config.risk.deployMinSol || 0)
  };
}

export function scoreCandidate(token, config) {
  const liquidity = Number(token.liquidityUsd || 0);
  const volume = Number(token.volume24hUsd || 0);
  const ageHours = Number(token.ageHours || 0);
  const risk = config.risk;

  let score = 40;
  if (liquidity >= risk.minLiquidityUsd) score += 18;
  if (volume >= risk.minVolume24hUsd) score += 18;
  if (ageHours <= risk.maxTokenAgeHours) score += 14;
  if (token.momentum === "rising") score += 10;
  if (token.holders > 500) score += 8;
  if (token.flags?.length) score -= token.flags.length * 12;

  return Math.max(0, Math.min(100, score));
}
