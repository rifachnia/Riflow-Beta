import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { parseJson } from "../services/ai.js";
import { consolidateMemory, loadMemory, saveMemory } from "../services/memory.js";
import { normalizeCoach } from "../services/coach.js";
import { buildTraderMessages, traderDecisionSchema } from "../prompts/traderPrompt.js";
import { JsonStore } from "../io/json-store.js";

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

await fs.rm(tmp, { recursive: true, force: true });
