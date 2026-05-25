export function applyHardFilters(candidates, config, poolMemoryByAddress = {}) {
  const passed = [];
  const rejected = [];
  for (const candidate of candidates || []) {
    const reasons = hardFilterReasons(candidate, config, poolMemoryByAddress[candidate.poolAddress] || poolMemoryByAddress[String(candidate.poolAddress || "").toLowerCase()]);
    const row = { ...candidate, hardFilter: { passed: reasons.length === 0, reasons } };
    if (reasons.length) rejected.push(row);
    else passed.push(row);
  }
  return { passed, rejected };
}

export function hardFilterReasons(candidate, config, poolMemory = null) {
  const s = config.screening || {};
  const reasons = [];
  const requireComplete = s.requireCompleteData === true;
  const tvl = numberOrNull(candidate.tvlUsd ?? candidate.liquidityUsd);
  const volume = numberOrNull(candidate.volume24hUsd ?? candidate.volumeUsd);
  const holders = numberOrNull(candidate.holders);
  const organic = numberOrNull(candidate.organicScore ?? candidate.score);
  const binStep = numberOrNull(candidate.binStep);
  const topHolder = numberOrNull(candidate.topHolderPct);
  const warnings = (candidate.warnings || candidate.flags || []).map((item) => String(item).toLowerCase());
  const blacklist = new Set((s.blacklist || []).map((item) => String(item).toUpperCase()));
  const symbol = String(candidate.symbol || "").toUpperCase();
  const tokenAddress = String(candidate.tokenAddress || "").toUpperCase();
  const poolAddress = String(candidate.poolAddress || "").toUpperCase();

  checkMin("TVL", tvl, s.minTvlUsd, "minTvlUsd");
  checkMax("TVL", tvl, s.maxTvlUsd, "maxTvlUsd");
  checkMin("volume", volume, s.minVolumeUsd, "minVolumeUsd");
  checkMin("holders", holders, s.minHolders, "minHolders");
  checkMin("organic", organic, s.minOrganicScore, "minOrganicScore");
  checkMin("binStep", binStep, s.minBinStep, "minBinStep");
  checkMax("binStep", binStep, s.maxBinStep, "maxBinStep");
  checkMax("topHolderPct", topHolder, s.maxTopHolderPct, "maxTopHolderPct");
  if (blacklist.has(symbol) || blacklist.has(tokenAddress) || blacklist.has(poolAddress)) reasons.push("blacklisted token/pool");
  if (poolMemory?.risk_flags?.length) reasons.push(`pool memory risk flags: ${poolMemory.risk_flags.join(", ")}`);
  if (poolMemory?.blacklist) reasons.push("pool memory blacklist");
  if (candidate.isBlacklisted || candidate.raw?.is_blacklisted) reasons.push("blacklisted pool");
  if (candidate.freezeAuthority || candidate.raw?.token_x?.has_freeze_authority) reasons.push("freeze authority enabled");
  if (candidate.mintAuthority || candidate.raw?.token_x?.has_mint_authority) reasons.push("mint authority enabled");
  for (const blocked of s.blockedWarnings || []) {
    if (warnings.some((warning) => warning.includes(String(blocked).toLowerCase()))) reasons.push(`blocked warning: ${blocked}`);
  }
  if (candidate.metadataUnsafe || candidate.scamRisk) reasons.push("unsafe/scam metadata flag");
  return reasons;

  function checkMin(label, value, threshold, key) {
    if (threshold == null) return;
    if (value == null) {
      if (requireComplete) reasons.push(`missing ${label}`);
      return;
    }
    if (value < number(threshold)) reasons.push(`${label} ${value} below ${key} ${threshold}`);
  }

  function checkMax(label, value, threshold, key) {
    if (threshold == null) return;
    if (value == null) {
      if (requireComplete) reasons.push(`missing ${label}`);
      return;
    }
    if (value > number(threshold)) reasons.push(`${label} ${value} above ${key} ${threshold}`);
  }
}

export function sanitizeCandidateForAi(candidate) {
  const untrusted = {
    name: candidate.name || null,
    description: candidate.description || null,
    website: candidate.website || null,
    socials: candidate.socials || null
  };
  return {
    poolAddress: candidate.poolAddress,
    tokenAddress: candidate.tokenAddress,
    symbol: candidate.symbol,
    pair: candidate.pair,
    score: candidate.score,
    candidateScore: candidate.candidateScore,
    qualityLabel: candidate.qualityLabel,
    positiveSignals: candidate.positiveSignals,
    riskSignals: candidate.riskSignals,
    rejectReasons: candidate.rejectReasons,
    tvlUsd: candidate.tvlUsd,
    activeTvlUsd: candidate.activeTvlUsd,
    volume24hUsd: candidate.volume24hUsd,
    fees24hUsd: candidate.fees24hUsd,
    feeTvlRatio: candidate.feeTvlRatio,
    feeActiveTvlRatio: candidate.feeActiveTvlRatio,
    holders: candidate.holders,
    organicScore: candidate.organicScore,
    binStep: candidate.binStep,
    topHolderPct: candidate.topHolderPct,
    ageHours: candidate.ageHours,
    momentum: candidate.momentum,
    warnings: candidate.warnings || candidate.flags || [],
    untrusted_metadata: untrusted
  };
}

function number(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function numberOrNull(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
