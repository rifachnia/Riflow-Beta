export function scoreDlmmCandidate(candidate, config = {}, poolMemory = null, state = null) {
  const strategy = config.strategy || {};
  const screening = config.screening || {};
  const positives = [];
  const risks = [];
  const rejects = [];
  let score = 35;

  const tvl = num(candidate.tvlUsd ?? candidate.liquidityUsd);
  const activeTvl = num(candidate.activeTvlUsd ?? candidate.raw?.active_tvl);
  const volume = num(candidate.volume24hUsd);
  const fees = num(candidate.fees24hUsd);
  const feeTvl = num(candidate.feeTvlRatio ?? candidate.raw?.fee_tvl_ratio);
  const feeActiveTvl = num(candidate.feeActiveTvlRatio ?? candidate.raw?.fee_active_tvl_ratio);
  const volumeTvl = num(candidate.volumeTvlRatio ?? candidate.raw?.volume_tvl_ratio);
  const volumeActiveTvl = num(candidate.volumeActiveTvlRatio ?? candidate.raw?.volume_active_tvl_ratio);
  const holders = num(candidate.holders);
  const organic = num(candidate.organicScore);
  const topHolder = num(candidate.topHolderPct);
  const devBalance = num(candidate.devBalancePct ?? candidate.raw?.token_x?.dev_balance_pct);
  const binStep = num(candidate.binStep);
  const volatility = num(candidate.volatility ?? candidate.raw?.volatility);
  const activePct = num(candidate.activePositionsPct ?? candidate.raw?.active_positions_pct);
  const uniqueTraders = num(candidate.uniqueTraders ?? candidate.raw?.unique_traders);
  const uniqueLps = num(candidate.uniqueLps ?? candidate.raw?.unique_lps);
  const tvlChange = num(candidate.tvlChangePct ?? candidate.raw?.tvl_change_pct);
  const feeChange = num(candidate.feeChangePct ?? candidate.raw?.fee_change_pct);
  const volumeChange = num(candidate.volumeChangePct ?? candidate.raw?.volume_change_pct);
  const netDeposits = num(candidate.netDeposits ?? candidate.raw?.net_deposits);

  if (candidate.isBlacklisted || candidate.raw?.is_blacklisted) rejects.push("blacklisted pool");
  if (candidate.freezeAuthority || candidate.raw?.token_x?.has_freeze_authority) rejects.push("freeze authority enabled");
  if (candidate.mintAuthority || candidate.raw?.token_x?.has_mint_authority) rejects.push("mint authority enabled");
  for (const warning of candidate.warnings || []) {
    if (/scam|blacklist|critical|rug|unsafe|freeze|mint/i.test(String(warning))) rejects.push(`severe warning: ${warning}`);
  }

  addThreshold({ value: tvl, min: screening.minTvlUsd ?? 15000, max: screening.maxTvlUsd, label: "TVL", score, positives, risks, rejects });
  if (tvl != null && tvl >= 50000) { score += 8; positives.push("healthy TVL"); }
  else if (tvl != null && tvl >= 15000) { score += 4; positives.push("acceptable TVL"); }
  else if (tvl != null) { score -= 12; risks.push("thin TVL"); }

  if (activeTvl != null && activeTvl >= Math.max(10000, tvl * 0.25)) { score += 8; positives.push("healthy active TVL"); }
  else if (activeTvl != null) { score -= 6; risks.push("low active TVL"); }

  if (volume != null && volume >= (screening.minVolumeUsd ?? 25000) * 2) { score += 10; positives.push("strong 24h volume"); }
  else if (volume != null && volume >= (screening.minVolumeUsd ?? 25000)) { score += 5; positives.push("acceptable 24h volume"); }
  else if (volume != null) { score -= 10; risks.push("low 24h volume"); }

  if (fees != null && fees >= 1000) { score += 10; positives.push("strong fee generation"); }
  else if (fees != null && fees >= 150) { score += 5; positives.push("some fee generation"); }
  else if (fees != null) { score -= 6; risks.push("weak fee generation"); }

  if (feeActiveTvl != null && feeActiveTvl >= 0.35) { score += 9; positives.push("strong fee/active-TVL"); }
  else if (feeTvl != null && feeTvl >= 0.1) { score += 5; positives.push("healthy fee/TVL"); }
  else if (feeActiveTvl != null || feeTvl != null) { score -= 4; risks.push("low fee yield ratio"); }

  if (volumeActiveTvl != null && volumeActiveTvl >= 20) { score += 7; positives.push("strong volume/active-TVL"); }
  else if (volumeTvl != null && volumeTvl >= 10) { score += 4; positives.push("healthy volume/TVL"); }

  if (organic != null && organic >= 80) { score += 8; positives.push("high organic score"); }
  else if (organic != null && organic >= (screening.minOrganicScore ?? 60)) { score += 4; positives.push("acceptable organic score"); }
  else if (organic != null) { score -= 12; risks.push("low organic score"); }

  if (holders != null && holders >= 1000) { score += 6; positives.push("strong holder base"); }
  else if (holders != null && holders >= (screening.minHolders ?? 160)) { score += 3; positives.push("acceptable holder base"); }
  else if (holders != null) { score -= 8; risks.push("thin holder base"); }

  if (topHolder != null && topHolder <= 15) { score += 6; positives.push("low top-holder concentration"); }
  else if (topHolder != null && topHolder <= (screening.maxTopHolderPct ?? 35)) { score += 2; positives.push("acceptable top-holder concentration"); }
  else if (topHolder != null) { score -= 16; rejects.push("top holder concentration too high"); }

  if (devBalance != null && devBalance <= 2) score += 3;
  else if (devBalance != null && devBalance > 8) { score -= 8; risks.push("large dev balance"); }

  if (binStep != null && binStep >= (screening.minBinStep ?? 20) && binStep <= (screening.maxBinStep ?? 125)) {
    score += 5; positives.push("bin step in configured range");
  } else if (binStep != null) {
    score -= 10; rejects.push("bin step outside configured range");
  }

  if (uniqueTraders != null && uniqueTraders >= 100) { score += 4; positives.push("healthy trader activity"); }
  if (uniqueLps != null && uniqueLps >= 20) { score += 4; positives.push("healthy LP activity"); }
  if (activePct != null && activePct >= 25) { score += 3; positives.push("many active positions"); }

  if (volatility != null && volatility <= 0.2) { score -= 3; risks.push("low volatility may produce weak fees"); }
  else if (volatility != null && volatility <= 3) { score += 4; positives.push("reasonable volatility"); }
  else if (volatility != null && volatility > 8) { score -= 16; rejects.push("abnormal volatility"); }

  for (const [label, value] of [["TVL growth", tvlChange], ["fee growth", feeChange], ["volume growth", volumeChange]]) {
    if (value != null && value > 0 && value <= 500) { score += 2; positives.push(`${label} positive`); }
    if (value != null && value > 1000) { score -= 8; risks.push(`${label} unusually high`); }
    if (value != null && value < -50) { score -= 8; risks.push(`${label} collapsing`); }
  }
  if (netDeposits != null && tvl != null && netDeposits < -tvl * 0.25) {
    score -= 12; risks.push("suspicious net withdrawals");
  }

  const memory = summarizePoolMemory(poolMemory);
  let memoryModifier = 0;
  if (memory.totalTrades >= 2 && memory.winrate < 40) { memoryModifier -= 12; risks.push("pool memory: repeated weak outcomes"); }
  if (memory.totalTrades >= 2 && memory.winrate >= 70 && memory.averagePnlPct > 0) { memoryModifier += 6; positives.push("pool memory: historically profitable"); }
  if (memory.outOfRangeFrequency >= 2) { memoryModifier -= 6; risks.push("pool memory: frequent out-of-range"); }
  if (poolMemory?.avoidScore) memoryModifier -= Number(poolMemory.avoidScore || 0);
  if (poolMemory?.preferScore) memoryModifier += Math.min(8, Number(poolMemory.preferScore || 0));
  if (isCooldownActive(poolMemory, strategy.entryCooldownMinutes ?? 30)) {
    rejects.push("entry cooldown active");
  }

  score = clamp(score + memoryModifier, 0, 100);
  if (score < (strategy.minCandidateScore ?? 70)) risks.push(`score below strategy minimum ${strategy.minCandidateScore ?? 70}`);
  const qualityLabel = rejects.length ? "reject"
    : score >= 85 ? "excellent"
      : score >= 75 ? "good"
        : score >= 60 ? "neutral"
          : "risky";

  return {
    candidateScore: Math.round(score),
    score: Math.round(score),
    candidateScoreAdjusted: Math.round(score),
    qualityLabel,
    rejectReasons: [...new Set(rejects)],
    positiveSignals: [...new Set(positives)],
    riskSignals: [...new Set(risks)],
    memoryModifier: Number(memoryModifier.toFixed(2)),
    memorySummary: memory
  };
}

export function applyEntryGates(candidate, config, state = {}, poolMemory = null) {
  const strategy = config.strategy || {};
  const sizing = config.sizing || {};
  const reasons = [];
  const open = (state.positions || []).filter((position) => position.status === "open");
  const sizeUsd = Number(sizing.maxDeploySol ?? config.risk?.deployMaxSol ?? 0.5) * Number(config.paperTrading?.solUsd ?? 150);

  if (!candidate?.hardFilter?.passed) reasons.push("hard filter failed");
  if (Number(candidate?.candidateScoreAdjusted ?? candidate?.candidateScore ?? candidate?.score ?? 0) < Number(strategy.minCandidateScore ?? 70)) reasons.push("candidate score below minimum");
  if (candidate?.isBlacklisted || candidate?.raw?.is_blacklisted || poolMemory?.blacklist) reasons.push("blacklisted");
  if (isCooldownActive(poolMemory, strategy.entryCooldownMinutes ?? 30)) reasons.push("cooldown active");
  if (open.some((position) => position.poolAddress && position.poolAddress === candidate.poolAddress)) reasons.push("already open in pool");
  if (open.some((position) => position.tokenAddress && position.tokenAddress === candidate.tokenAddress)) reasons.push("already open in token");
  if (open.length >= Number(strategy.maxOpenPositions ?? config.risk?.maxOpenPositions ?? 2)) reasons.push("max open positions reached");
  if (Number(state.paperBalanceSol || 0) < Number(sizing.minDeploySol ?? config.risk?.deployMinSol ?? 0.15)) reasons.push("insufficient free paper balance");
  if (candidate.marketDataAvailable === false) reasons.push("market data unavailable");
  if (strategy.requireCompleteData && hasMissingRequiredFields(candidate)) reasons.push("missing required market fields");
  if (!strategy.allowYoungPools && Number(candidate.poolAgeHours ?? candidate.ageHours ?? Infinity) < Number(strategy.minPoolAgeHours ?? 1)) reasons.push("pool/token too young");
  if (exposureUsd(open, "tokenAddress", candidate.tokenAddress) + sizeUsd > Number(strategy.maxExposurePerTokenUsd ?? Infinity)) reasons.push("max token exposure reached");
  if (exposureUsd(open, "poolAddress", candidate.poolAddress) + sizeUsd > Number(strategy.maxExposurePerPoolUsd ?? Infinity)) reasons.push("max pool exposure reached");
  return { passed: reasons.length === 0, reasons };
}

export function buildRange(candidate, config = {}) {
  const dlmm = config.dlmm || {};
  const mode = dlmm.rangeMode || "balanced";
  const width = Number(
    mode === "tight" ? dlmm.tightRangeWidthPct ?? 3
      : mode === "wide" ? dlmm.wideRangeWidthPct ?? 15
        : dlmm.defaultRangeWidthPct ?? 7
  );
  const price = num(candidate.currentPrice ?? candidate.entryPrice) || 1;
  const activeBin = num(candidate.activeBin);
  const binStep = num(candidate.binStep);
  const binMove = binStep ? Math.max(1, Math.round(width / (binStep / 100))) : null;
  return {
    rangeMode: mode,
    rangeWidthPct: width,
    lowerPrice: Number((price * (1 - width / 100)).toPrecision(12)),
    upperPrice: Number((price * (1 + width / 100)).toPrecision(12)),
    lowerBin: activeBin != null && binMove != null ? activeBin - binMove : null,
    upperBin: activeBin != null && binMove != null ? activeBin + binMove : null
  };
}

export function updateRangeStatus(position, currentPool) {
  const price = num(currentPool.currentPrice ?? position.currentPrice ?? position.markPrice);
  const activeBin = num(currentPool.activeBin ?? position.currentActiveBin);
  const priceOut = price != null && position.lowerPrice != null && position.upperPrice != null
    ? price < Number(position.lowerPrice) || price > Number(position.upperPrice)
    : false;
  const binOut = activeBin != null && position.lowerBin != null && position.upperBin != null
    ? activeBin < Number(position.lowerBin) || activeBin > Number(position.upperBin)
    : false;
  const outOfRange = Boolean(priceOut || binOut);
  const now = new Date().toISOString();
  const previousOutSince = position.outOfRangeSince || null;
  const since = outOfRange ? (previousOutSince || now) : null;
  const addedMinutes = previousOutSince && !outOfRange
    ? Math.max(0, Math.round((Date.now() - new Date(previousOutSince).getTime()) / 60000))
    : 0;
  return {
    outOfRange,
    outOfRangeSince: since,
    totalOutOfRangeMinutes: Number(position.totalOutOfRangeMinutes || 0) + addedMinutes,
    activeBinMove: activeBin != null && position.entryActiveBin != null ? activeBin - Number(position.entryActiveBin) : null
  };
}

export function estimateDlmmFees(position, currentPool, config = {}) {
  const solUsd = Number(config.paperTrading?.solUsd ?? 150);
  const sizeUsd = Number(position.sizeSol || 0) * solUsd;
  const activeTvl = num(currentPool.activeTvlUsd ?? currentPool.raw?.active_tvl);
  const tvl = num(currentPool.tvlUsd ?? currentPool.liquidityUsd);
  const denominator = activeTvl || tvl || num(position.entryActiveTvlUsd) || num(position.entryTvlUsd) || 0;
  const share = denominator > 0 ? sizeUsd / denominator : 0;
  const now = Date.now();
  const last = new Date(position.lastFeeUpdateAt || position.entryTimestamp || position.openedAt || now).getTime();
  const elapsedHours = Math.max(0, (now - last) / 3_600_000);
  const fees24h = Math.max(0, num(currentPool.fees24hUsd) || 0);
  const hourly = (fees24h / 24) * share;
  const mode = position.rangeMode || config.dlmm?.rangeMode || "balanced";
  const rangeMultiplier = mode === "tight" ? 1.12 : mode === "wide" ? 0.78 : 1;
  const outMultiplier = position.outOfRange ? 0.05 : 1;
  const cap = sizeUsd * Number(config.dlmm?.maxFeeAccrualPctPerDay ?? 0.08) * (elapsedHours / 24);
  const increment = Math.min(cap || Infinity, hourly * elapsedHours * rangeMultiplier * outMultiplier);
  const estimatedFeesUsd = Number((Number(position.estimatedFeesUsd || 0) + increment).toFixed(4));
  const feeAprEstimate = sizeUsd > 0 ? Number((((hourly * 24 * 365) / sizeUsd) * 100).toFixed(2)) : null;
  const warnings = [];
  if (!activeTvl) warnings.push("active TVL unavailable, using total TVL for fee share");
  if (position.outOfRange) warnings.push("out of range, fee accrual heavily reduced");
  if (increment >= cap && Number.isFinite(cap)) warnings.push("fee accrual capped");
  return {
    estimatedFeesUsd,
    claimableFeesUsd: Number((Number(position.claimableFeesUsd || 0) + increment).toFixed(4)),
    lastFeeUpdateAt: new Date(now).toISOString(),
    feeAprEstimate,
    feeModelWarnings: warnings,
    positionShare: Number(share.toPrecision(6))
  };
}

export function summarizePoolMemory(memory = {}) {
  memory ||= {};
  const past = memory.past_pnl || [];
  const totalTrades = Number(memory.totalTrades ?? past.length ?? 0);
  const wins = Number(memory.wins ?? past.filter((item) => Number(item.pnlPct || 0) > 0).length);
  const losses = Number(memory.losses ?? Math.max(0, totalTrades - wins));
  const averagePnlPct = memory.averagePnlPct ?? avg(past.map((item) => Number(item.pnlPct || 0)));
  const averageFeesUsd = memory.averageFeesUsd ?? avg(memory.fee_performance?.map((item) => Number(item.feeUsd || 0)) || []);
  const winrate = totalTrades ? (wins / totalTrades) * 100 : null;
  return {
    totalTrades,
    wins,
    losses,
    winrate: winrate == null ? null : Number(winrate.toFixed(2)),
    averagePnlPct: Number((averagePnlPct || 0).toFixed(3)),
    averageFeesUsd: Number((averageFeesUsd || 0).toFixed(4)),
    outOfRangeFrequency: Number(memory.out_of_range_frequency || memory.outOfRangeFrequency || 0),
    lastClosedAt: memory.lastClosedAt || memory.last_closed_at || null,
    lastCloseReason: memory.lastCloseReason || memory.last_close_reason || null
  };
}

function addThreshold({ value, min, max, label, positives, risks, rejects }) {
  if (value == null) return;
  if (min != null && value < Number(min)) rejects.push(`${label} below minimum`);
  if (max != null && Number(max) > 0 && value > Number(max)) risks.push(`${label} above configured max`);
}

function hasMissingRequiredFields(candidate) {
  return ["tvlUsd", "volume24hUsd", "fees24hUsd", "currentPrice", "binStep"].some((key) => candidate[key] == null);
}

function isCooldownActive(memory, minutes) {
  const last = memory?.lastClosedAt || memory?.last_closed_at;
  if (!last) return false;
  return Date.now() - new Date(last).getTime() < Number(minutes || 0) * 60000;
}

function exposureUsd(open, key, value) {
  if (!value) return 0;
  return open
    .filter((position) => position[key] === value)
    .reduce((sum, position) => sum + Number(position.sizeSol || 0) * 150, 0);
}

function avg(values) {
  const rows = values.filter((value) => Number.isFinite(value));
  return rows.length ? rows.reduce((sum, value) => sum + value, 0) / rows.length : 0;
}

function num(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}
