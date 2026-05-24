import { portfolioStats } from "./portfolio.js";

export function listProviders(config) {
  return (config.llm?.providers || []).map((provider) => ({
    ...provider,
    active: provider.id === config.llm.activeProviderId
  }));
}

export function getProvider(config, providerId = null) {
  const id = providerId || config.llm?.activeProviderId;
  const provider = (config.llm?.providers || []).find((item) => item.id === id);
  if (!provider) throw new Error(`provider not found: ${id}`);
  return provider;
}

export function useProvider(config, providerId) {
  getProvider(config, providerId);
  config.llm.activeProviderId = providerId;
}

export function providerBook(state, providerId) {
  state.providerBooks ||= {};
  state.providerBooks[providerId] ||= { paperBalanceSol: state.paperBalanceSol ?? 5, positions: [], closedTrades: [] };
  return state.providerBooks[providerId];
}

export function providerContext(ctx, providerId, scan = null) {
  const provider = getProvider(ctx.config, providerId);
  const book = providerBook(ctx.state, provider.id);
  return {
    ...ctx,
    provider,
    state: {
      ...book,
      lastScan: scan || ctx.state.lastScan || []
    }
  };
}

export function providerStats(ctx, providerId) {
  const provider = getProvider(ctx.config, providerId);
  const book = providerBook(ctx.state, provider.id);
  const stats = portfolioStats(book);
  return {
    providerId: provider.id,
    providerName: provider.name || provider.id,
    modelId: provider.model,
    ...stats,
    maxDrawdownUsd: maxDrawdown(book.closedTrades || []),
    paperBalanceSol: book.paperBalanceSol
  };
}

export function leaderboard(ctx) {
  return listProviders(ctx.config)
    .map((provider) => providerStats(ctx, provider.id))
    .sort((a, b) => b.equityUsd - a.equityUsd || b.winrate - a.winrate);
}

function maxDrawdown(trades) {
  let equity = 0;
  let peak = 0;
  let drawdown = 0;
  for (const trade of [...trades].reverse()) {
    equity += Number(trade.pnlUsd || 0);
    peak = Math.max(peak, equity);
    drawdown = Math.min(drawdown, equity - peak);
  }
  return Number(drawdown.toFixed(2));
}
