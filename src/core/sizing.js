import { openPositions } from "../services/portfolio.js";

export function computeDeploySize(config, state, symbol = null) {
  const sizing = config.sizing || {};
  const balance = Number(state.paperBalanceSol || 0);
  const gasReserve = Number(sizing.gasReserveSol ?? 0.2);
  const deployable = Math.max(0, balance - gasReserve);
  const riskPct = Number(sizing.defaultRiskPct ?? 0.12);
  const min = Number(sizing.minDeploySol ?? config.risk?.deployMinSol ?? 0.15);
  const max = Number(sizing.maxDeploySol ?? config.risk?.deployMaxSol ?? 0.5);
  const raw = deployable * riskPct;
  let size = Math.min(max, Math.max(min, raw));

  if (symbol) {
    const usedForSymbol = openPositions(state)
      .filter((position) => position.symbol === String(symbol).toUpperCase() || position.poolAddress === symbol)
      .reduce((sum, position) => sum + Number(position.sizeSol || 0), 0);
    const tokenCap = Number(sizing.maxExposurePerTokenSol ?? max);
    size = Math.min(size, Math.max(0, tokenCap - usedForSymbol));
  }

  if (deployable < min || size < min) return 0;
  return Number(size.toFixed(6));
}
