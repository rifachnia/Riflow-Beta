import { estimateDlmmFees, updateRangeStatus } from "./dlmm-strategy.js";

const DEFAULT_METEORA_API_URL = "https://pool-discovery-api.datapi.meteora.ag";

export async function fetchMeteoraPools(config, options = {}) {
  const scanner = config.scanner || {};
  const baseUrl = String(scanner.meteoraApiUrl || DEFAULT_METEORA_API_URL).replace(/\/+$/, "");
  const limit = Number(options.limit || scanner.limit || 12);
  const pageSize = Math.max(limit * 4, 40);
  const timeframe = options.timeframe || scanner.meteoraTimeframe || "24h";
  const category = options.category || scanner.meteoraCategory || "trending";
  const filters = options.filters || "pool_type=dlmm";
  const url = `${baseUrl}/pools?page_size=${pageSize}&filter_by=${encodeURIComponent(filters)}&timeframe=${encodeURIComponent(timeframe)}&category=${encodeURIComponent(category)}`;
  const response = await fetch(url, { headers: { "Accept": "application/json" }, signal: timeoutSignal(scanner.requestTimeoutMs ?? 20000) });
  if (!response.ok) throw new Error(`Meteora pool API ${response.status}: ${response.statusText}`);
  const data = await response.json();
  const rows = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
  return rows.map(normalizeMeteoraPool).filter(Boolean).slice(0, pageSize);
}

export async function fetchMeteoraPoolByAddress(config, poolAddress) {
  if (!poolAddress) return null;
  const scanner = config.scanner || {};
  const baseUrl = String(scanner.meteoraApiUrl || DEFAULT_METEORA_API_URL).replace(/\/+$/, "");
  const timeframe = scanner.meteoraTimeframe || "24h";
  const url = `${baseUrl}/pools?page_size=1&filter_by=${encodeURIComponent(`pool_address=${poolAddress}`)}&timeframe=${encodeURIComponent(timeframe)}`;
  const response = await fetch(url, { headers: { "Accept": "application/json" }, signal: timeoutSignal(scanner.requestTimeoutMs ?? 20000) });
  if (!response.ok) throw new Error(`Meteora pool detail API ${response.status}: ${response.statusText}`);
  const data = await response.json();
  const pool = (Array.isArray(data?.data) ? data.data : [])[0];
  return pool ? normalizeMeteoraPool(pool) : null;
}

export function normalizeMeteoraPool(raw) {
  if (!raw) return null;
  const base = raw.token_x || raw.base || {};
  const quote = raw.token_y || raw.quote || {};
  const symbol = String(base.symbol || raw.symbol || raw.name || "UNKNOWN").toUpperCase();
  const quoteSymbol = String(quote.symbol || "SOL").toUpperCase();
  const warnings = [
    ...stringList(base.warnings),
    ...stringList(quote.warnings),
    raw.base_token_has_critical_warnings ? "base critical warnings" : "",
    raw.quote_token_has_critical_warnings ? "quote critical warnings" : "",
    raw.base_token_has_high_supply_concentration ? "high supply concentration" : "",
    raw.base_token_has_high_single_ownership ? "high single ownership" : ""
  ].filter(Boolean);
  const currentPrice = numeric(raw.pool_price ?? raw.price ?? base.price);
  const tvlUsd = numeric(raw.tvl ?? raw.active_tvl);
  const activeTvlUsd = numeric(raw.active_tvl);
  const volume24hUsd = numeric(raw.volume ?? raw.volume_24h ?? raw.volume_window);
  const fees24hUsd = numeric(raw.fee ?? raw.fees_24h ?? raw.fee_window);
  const organicScore = numeric(base.organic_score ?? raw.base_token_organic_score);
  const topHolderPct = numeric(base.top_holders_pct ?? raw.top_holders_pct);
  const binStep = numeric(raw.dlmm_params?.bin_step ?? raw.bin_step ?? raw.pool_config?.bin_step);
  const ageHours = base.created_at ? Math.floor((Date.now() - Number(base.created_at)) / 3_600_000) : null;

  return {
    poolAddress: raw.pool_address || raw.pool || raw.address || null,
    tokenAddress: base.address || raw.base_mint || null,
    symbol,
    name: raw.name || `${symbol}-${quoteSymbol}`,
    pair: `${symbol}/${quoteSymbol}`,
    liquidityUsd: tvlUsd,
    tvlUsd,
    activeTvlUsd,
    volume24hUsd,
    fees24hUsd,
    feeTvlRatio: numeric(raw.fee_tvl_ratio),
    feeActiveTvlRatio: numeric(raw.fee_active_tvl_ratio),
    volumeTvlRatio: numeric(raw.volume_tvl_ratio),
    volumeActiveTvlRatio: numeric(raw.volume_active_tvl_ratio),
    swapCount: numeric(raw.swap_count),
    uniqueTraders: numeric(raw.unique_traders),
    uniqueLps: numeric(raw.unique_lps),
    totalLps: numeric(raw.total_lps),
    openPositions: numeric(raw.open_positions),
    activePositions: numeric(raw.active_positions),
    activePositionsPct: numeric(raw.active_positions_pct),
    netDeposits: numeric(raw.net_deposits),
    totalDeposits: numeric(raw.total_deposits),
    totalWithdraws: numeric(raw.total_withdraws),
    tvlChangePct: numeric(raw.tvl_change_pct),
    activeTvlChangePct: numeric(raw.active_tvl_change_pct),
    volumeChangePct: numeric(raw.volume_change_pct),
    feeChangePct: numeric(raw.fee_change_pct),
    swapCountChangePct: numeric(raw.swap_count_change_pct),
    uniqueTradersChangePct: numeric(raw.unique_traders_change_pct),
    uniqueLpsChangePct: numeric(raw.unique_lps_change_pct),
    apr: numeric(raw.apr ?? raw.apy ?? raw.fee_apr),
    baseMint: base.address || raw.base_mint || null,
    quoteMint: quote.address || raw.quote_mint || null,
    binStep,
    activeBin: numeric(raw.active_bin_id ?? raw.active_bin ?? raw.bin_id),
    currentPrice,
    ageHours,
    poolAgeHours: raw.pool_created_at ? Math.floor((Date.now() - Number(raw.pool_created_at)) / 3_600_000) : null,
    holders: numeric(raw.base_token_holders ?? base.holders),
    holdersChangePct: numeric(raw.base_token_holders_change_pct),
    organicScore,
    topHolderPct,
    devBalancePct: numeric(base.dev_balance_pct),
    marketCap: numeric(base.market_cap ?? raw.base_token_market_cap),
    marketCapChangePct: numeric(raw.base_token_market_cap_change_pct),
    dynamicFeePct: numeric(raw.dynamic_fee_pct),
    volatility: numeric(raw.volatility),
    priceTrend: Array.isArray(raw.price_trend) ? raw.price_trend.map(numeric).filter((item) => item != null) : [],
    freezeAuthority: Boolean(base.has_freeze_authority),
    mintAuthority: Boolean(base.has_mint_authority),
    isBlacklisted: Boolean(raw.is_blacklisted),
    warnings: missingWarnings({ holders: raw.base_token_holders ?? base.holders, organicScore, topHolderPct, currentPrice, tvlUsd, volume24hUsd, binStep }, warnings),
    metadataUnsafe: Boolean(raw.metadataUnsafe || raw.base_token_has_critical_warnings || raw.quote_token_has_critical_warnings || base.has_freeze_authority || base.has_mint_authority),
    scamRisk: Boolean(raw.scamRisk || raw.is_rugpull || raw.is_wash),
    source: "meteora-dlmm",
    raw
  };
}

export async function markMeteoraPosition(config, position, currentPool = null) {
  const current = currentPool || await fetchMeteoraPoolByAddress(config, position.poolAddress).catch(() => null);
  if (!current) {
    return {
      ...position,
      calculationMode: "approximate-dlmm",
      marketDataAvailable: false,
      pnlPct: 0,
      pnlUsd: 0,
      estimatedFeesUsd: 0,
      warnings: ["current Meteora pool data unavailable"]
    };
  }
  return estimatePaperPnl(position, current, config);
}

export function estimatePaperPnl(position, currentPool, config = {}) {
  const entryPrice = numeric(position.entryPrice) || numeric(position.initialMetrics?.currentPrice) || 1;
  const currentPrice = numeric(currentPool.currentPrice) || entryPrice;
  const sizeUsd = Number(position.sizeSol || 0) * 150;
  const pricePnlUsd = entryPrice > 0 ? sizeUsd * ((currentPrice - entryPrice) / entryPrice) : 0;
  const range = updateRangeStatus(position, currentPool);
  const rangePosition = { ...position, ...range };
  const feeState = estimateDlmmFees(rangePosition, currentPool, config);
  const tvl = numeric(currentPool.activeTvlUsd) || numeric(currentPool.tvlUsd) || numeric(position.entryActiveTvlUsd) || numeric(position.entryTvlUsd) || 0;
  const positionShare = tvl > 0 ? sizeUsd / tvl : 0;
  const estimatedFeesUsd = feeState.estimatedFeesUsd;
  const pnlUsd = pricePnlUsd + estimatedFeesUsd;
  const pnlPct = sizeUsd > 0 ? (pnlUsd / sizeUsd) * 100 : 0;
  const activeBinMove = currentPool.activeBin != null && position.entryActiveBin != null
    ? Number(currentPool.activeBin) - Number(position.entryActiveBin)
    : null;
  return {
    ...position,
    calculationMode: "approximate-dlmm",
    marketDataAvailable: true,
    currentPrice,
    currentActiveBin: currentPool.activeBin ?? null,
    currentTvlUsd: currentPool.tvlUsd ?? null,
    currentActiveTvlUsd: currentPool.activeTvlUsd ?? null,
    currentVolume24hUsd: currentPool.volume24hUsd ?? null,
    currentFees24hUsd: currentPool.fees24hUsd ?? null,
    outOfRange: range.outOfRange,
    outOfRangeSince: range.outOfRangeSince,
    totalOutOfRangeMinutes: range.totalOutOfRangeMinutes,
    activeBinMove: range.activeBinMove ?? activeBinMove,
    estimatedFeesUsd: Number(estimatedFeesUsd.toFixed(4)),
    claimableFeesUsd: feeState.claimableFeesUsd,
    lastFeeUpdateAt: feeState.lastFeeUpdateAt,
    feeAprEstimate: feeState.feeAprEstimate,
    feeModelWarnings: feeState.feeModelWarnings,
    positionShare: feeState.positionShare ?? Number(positionShare.toPrecision(6)),
    pnlUsd: Number(pnlUsd.toFixed(4)),
    pnlPct: Number(pnlPct.toFixed(4)),
    markPrice: currentPrice,
    warnings: currentPool.warnings || []
  };
}

function missingWarnings(fields, existing) {
  const warnings = [...existing];
  for (const [key, value] of Object.entries(fields)) {
    if (value == null || value === "") warnings.push(`missing ${key}`);
  }
  return [...new Set(warnings)];
}

function numeric(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function stringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => typeof item === "string" ? item : item?.message || item?.type || "").filter(Boolean);
}

function timeoutSignal(ms) {
  const timeout = Math.max(1000, Number(ms || 20000));
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(timeout);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeout).unref?.();
  return controller.signal;
}
