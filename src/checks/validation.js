import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { parseJson } from "../services/ai.js";
import { consolidateMemory, loadMemory, saveMemory } from "../services/memory.js";
import { normalizeCoach } from "../services/coach.js";
import { buildTraderMessages, traderDecisionSchema } from "../prompts/traderPrompt.js";
import { JsonStore } from "../io/json-store.js";
import { normalizeMeteoraPool, estimatePaperPnl } from "../services/meteora.js";
import { scanMarketDetailed } from "../services/scanner.js";
import { applyEntryGates, buildRange, scoreDlmmCandidate } from "../services/dlmm-strategy.js";
import { evaluateManagerRules } from "../agents/manager-agent.js";

assert.deepEqual(parseJson("```json\n{\"action\":\"WAIT\"}\n```"), { action: "WAIT" });

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "riflow-check-"));
const ctx = { store: new JsonStore(tmp) };
await saveMemory(ctx, "mimo", { lessons: ["Only open high score setups", "Only open high score setups"] });
const memory = await loadMemory(ctx, "mimo");
assert.equal(memory.id, "mimo");
assert.equal(memory.lessons.length, 1);

const consolidated = consolidateMemory({
  id: "mimo",
  lessons: Array.from({ length: 30 }, (_, index) => `Rule ${index}: wait when risk is unclear`),
  avoid_patterns: ["", "Avoid low liquidity", "Avoid low liquidity"],
  preferred_patterns: [],
  confidence_adjustments: [],
  risk_improvements: []
}, { winrate: 50, maxDrawdownUsd: -2, closedTradeCount: 3 });
assert.equal(consolidated.lessons.length, 20);
assert.deepEqual(consolidated.avoid_patterns, ["Avoid low liquidity"]);

const coach = normalizeCoach({ mistakes: ["overtraded"], successes: [{ rule: "waited well" }], summary: "ok" });
assert.deepEqual(coach.mistakes, ["overtraded"]);
assert.deepEqual(coach.successes, ["waited well"]);

const promptCtx = {
  config: {
    mode: "paper",
    scanner: { source: "test", limit: 1 },
    risk: { maxOpenPositions: 1, deployMinSol: 0.1, deployMaxSol: 0.2 },
    auto: { paperOnly: true, minOpenScore: 80 }
  },
  state: { paperBalanceSol: 1, positions: [], closedTrades: [], lastScan: [] }
};
const messages = buildTraderMessages(promptCtx, { id: "mimo", model: "mimo" }, memory, []);
assert.equal(messages.length, 1);
assert.match(traderDecisionSchema, /OPEN\|CLOSE\|WAIT/);

const normalized = normalizeMeteoraPool({
  pool_address: "pool1",
  name: "ABC-SOL",
  token_x: { address: "base1", symbol: "ABC", holders: 1000, organic_score: 80, top_holders_pct: 20, created_at: Date.now() - 3_600_000, warnings: [] },
  token_y: { address: "quote1", symbol: "SOL" },
  tvl: 50000,
  volume: 30000,
  fee: 120,
  dlmm_params: { bin_step: 80 },
  active_bin_id: 123,
  pool_price: 2
});
assert.equal(normalized.poolAddress, "pool1");
assert.equal(normalized.source, "meteora-dlmm");
assert.equal(normalized.symbol, "ABC");

const marked = estimatePaperPnl({
  source: "meteora-dlmm",
  sizeSol: 1,
  entryPrice: 1,
  entryTimestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString()
}, { currentPrice: 1.1, tvlUsd: 10000, fees24hUsd: 240, activeBin: 1 });
assert.equal(marked.calculationMode, "approximate-dlmm");
assert.ok(marked.pnlUsd > 0);

const scored = scoreDlmmCandidate(normalized, {
  screening: { minTvlUsd: 10000, minVolumeUsd: 10000, minHolders: 100, minOrganicScore: 50, minBinStep: 20, maxBinStep: 125, maxTopHolderPct: 35 },
  strategy: { minCandidateScore: 60 }
});
assert.ok(scored.candidateScore >= 60);
assert.equal(scored.qualityLabel !== "reject", true);

const range = buildRange({ currentPrice: 10, activeBin: 100, binStep: 100 }, { dlmm: { rangeMode: "balanced", defaultRangeWidthPct: 7 } });
assert.equal(range.lowerPrice, 9.3);
assert.equal(range.upperPrice, 10.7);

const gate = applyEntryGates({ ...normalized, hardFilter: { passed: true }, candidateScoreAdjusted: 90 }, {
  strategy: { minCandidateScore: 70, maxOpenPositions: 1, maxExposurePerTokenUsd: 150, maxExposurePerPoolUsd: 150, entryCooldownMinutes: 30, allowYoungPools: true, requireCompleteData: false },
  sizing: { minDeploySol: 0.1, maxDeploySol: 0.5 },
  paperTrading: { solUsd: 150 }
}, { paperBalanceSol: 1, positions: [] }, {});
assert.equal(gate.passed, true);

const managerRows = await evaluateManagerRules({
  config: {
    management: { minimumHoldMinutes: 5, emergencyStopLossPct: -20, stopLossPct: -2, takeProfitPct: 1, claimFeeThresholdUsd: 2, maxOutOfRangeMinutes: 30 },
    paperTrading: { solUsd: 150 },
    dlmm: {}
  },
  state: { positions: [{ id: "p1", status: "open", source: "local-sim", symbol: "ABC", sizeSol: 1, openedAt: new Date().toISOString() }] }
});
assert.equal(managerRows[0].action, "HOLD");

const oldFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("mock meteora down"); };
const fallback = await scanMarketDetailed({
  scanner: { source: "meteora-dlmm", limit: 2 },
  risk: { minLiquidityUsd: 1, minVolume24hUsd: 1, maxTokenAgeHours: 999 },
  screening: { minTvlUsd: 1, minVolumeUsd: 1, minHolders: 1, minOrganicScore: 1, minBinStep: 1, maxBinStep: 999, maxTopHolderPct: 100, requireCompleteData: false, blockedWarnings: [], blacklist: [] }
});
globalThis.fetch = oldFetch;
assert.equal(fallback.source, "local-sim");
assert.ok(fallback.fallbackReason);

await fs.rm(tmp, { recursive: true, force: true });
