import { scoreCandidate } from "../core/risk.js";
import { applyHardFilters } from "./hard-filters.js";
import { fetchMeteoraPools } from "./meteora.js";
import { applyEntryGates, scoreDlmmCandidate } from "./dlmm-strategy.js";

const symbols = ["RIFT", "NUSA", "FLOW", "KAI", "EMBER", "LUMA", "VAULT", "ORBIT", "PULSE", "KITE", "NOVA", "SORA"];

function seededNumber(seed, mod) {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % mod;
}

export async function scanMarket(config) {
  const { passed } = await scanMarketDetailed(config);
  return passed.slice(0, config.scanner.limit || 12);
}

export async function scanMarketDetailed(config, poolMemoryByAddress = {}) {
  if (config.scanner?.source === "meteora-dlmm") {
    try {
      const raw = await fetchMeteoraPools(config);
      const scored = raw.map((candidate) => enrichCandidate(candidate, config, poolMemoryByAddress)).sort((a, b) => b.score - a.score);
      const filtered = applyHardFilters(scored, config, poolMemoryByAddress);
      const gated = {
        passed: filtered.passed.map((candidate) => {
          const gate = applyEntryGates(candidate, config, config.__state || {}, memoryFor(candidate, poolMemoryByAddress));
          return { ...candidate, entryGate: gate };
        }).filter((candidate) => candidate.entryGate.passed),
        rejected: [
          ...filtered.rejected,
          ...filtered.passed.map((candidate) => {
            const gate = applyEntryGates(candidate, config, config.__state || {}, memoryFor(candidate, poolMemoryByAddress));
            return gate.passed ? null : { ...candidate, hardFilter: { passed: false, reasons: gate.reasons }, entryGate: gate };
          }).filter(Boolean)
        ]
      };
      return {
        raw: scored,
        passed: gated.passed.slice(0, config.scanner.limit || 12),
        rejected: gated.rejected,
        source: "meteora-dlmm"
      };
    } catch (error) {
      const fallback = localSimScan(config, poolMemoryByAddress);
      fallback.source = "local-sim";
      fallback.fallbackReason = error.message;
      fallback.rejected.unshift({
        symbol: "METEORA",
        poolAddress: null,
        hardFilter: { passed: false, reasons: [`meteora-dlmm unavailable, fallback to local-sim: ${error.message}`] }
      });
      return fallback;
    }
  }
  return localSimScan(config, poolMemoryByAddress);
}

function localSimScan(config, poolMemoryByAddress = {}) {
  const nowBucket = Math.floor(Date.now() / 60000);
  const rows = symbols.map((symbol, index) => {
    const seed = `${symbol}:${nowBucket}:${index}`;
    const liquidityUsd = 9000 + seededNumber(seed, 90000);
    const volume24hUsd = 8000 + seededNumber(`${seed}:v`, 160000);
    const ageHours = 1 + seededNumber(`${seed}:a`, 96);
    const holders = 80 + seededNumber(`${seed}:h`, 2400);
    const organicScore = 50 + seededNumber(`${seed}:o`, 51);
    const binStep = 20 + seededNumber(`${seed}:b`, 106);
    const topHolderPct = 5 + seededNumber(`${seed}:th`, 26);
    const flags = [];
    if (holders < 160) flags.push("thin holders");
    if (ageHours < 2) flags.push("fresh launch");
    if (liquidityUsd < config.risk.minLiquidityUsd) flags.push("low liquidity");
    if (organicScore < (config.screening?.minOrganicScore ?? 60)) flags.push("low organic");
    if (topHolderPct > (config.screening?.maxTopHolderPct ?? 35)) flags.push("top-holder concentration");

    const token = {
      poolAddress: `pool_${symbol.toLowerCase()}_${index}`,
      tokenAddress: `token_${symbol.toLowerCase()}`,
      symbol,
      name: `${symbol} Sim Pool`,
      pair: `${symbol}/SOL`,
      liquidityUsd,
      tvlUsd: liquidityUsd,
      volume24hUsd,
      ageHours,
      holders,
      organicScore,
      binStep,
      topHolderPct,
      momentum: seededNumber(`${seed}:m`, 3) === 0 ? "flat" : "rising",
      flags,
      warnings: flags,
      metadataUnsafe: false,
      scamRisk: false
    };

    return enrichCandidate(token, config, poolMemoryByAddress);
  });

  const raw = rows.sort((a, b) => b.score - a.score);
  const filtered = applyHardFilters(raw, config, poolMemoryByAddress);
  return {
    raw,
    passed: filtered.passed.slice(0, config.scanner.limit || 12),
    rejected: filtered.rejected,
    source: "local-sim"
  };
}

function enrichCandidate(candidate, config, poolMemoryByAddress = {}) {
  const poolMemory = memoryFor(candidate, poolMemoryByAddress);
  const dlmm = scoreDlmmCandidate(candidate, config, poolMemory, config.__state || {});
  return {
    ...candidate,
    ...dlmm,
    score: dlmm.candidateScoreAdjusted ?? dlmm.candidateScore ?? scoreCandidate(candidate, config),
    warnings: candidate.warnings || []
  };
}

function memoryFor(candidate, poolMemoryByAddress) {
  return poolMemoryByAddress[candidate.poolAddress] || poolMemoryByAddress[String(candidate.poolAddress || "").toLowerCase()] || null;
}
