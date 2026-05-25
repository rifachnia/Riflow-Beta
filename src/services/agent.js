import { chatJson } from "./ai.js";
import { buildTraderMessages, traderDecisionSchema } from "../prompts/traderPrompt.js";
import { loadMemory } from "./memory.js";
import { getProvider } from "./providers.js";
import { getLessonsForPrompt } from "./lessons.js";

export async function decideNextAction(ctx, providerOverride = null) {
  const provider = providerOverride || ctx.provider || getProvider(ctx.config);
  const memory = await loadMemory(ctx, provider);
  const recentDecisions = await loadRecentDecisions(ctx, provider.id);
  const lessons = await getLessonsForPrompt(ctx);
  const decision = await chatJson(ctx.config, buildTraderMessages(ctx, provider, memory, recentDecisions, lessons), traderDecisionSchema, provider);

  return {
    ...normalizeDecision(decision),
    providerId: provider?.id || ctx.config.llm?.activeProviderId || "default",
    modelId: provider?.model || ctx.config.llm?.model || "unknown"
  };
}

function normalizeDecision(input) {
  const action = String(input?.action || "WAIT").toUpperCase();
  const rawConfidence = Number(input?.confidence || 0);
  const safeConfidence = Number.isFinite(rawConfidence) ? rawConfidence : 0;
  const confidence = safeConfidence <= 1 ? safeConfidence * 100 : safeConfidence;
  const riskLevel = String(input?.risk_level || input?.riskLevel || "MEDIUM").toUpperCase();
  return {
    action: ["OPEN", "CLOSE", "WAIT"].includes(action) ? action : "WAIT",
    symbol: input?.symbol ? String(input.symbol).toUpperCase() : null,
    positionId: input?.positionId ? String(input.positionId) : null,
    sizeSol: Number(input?.sizeSol || 0),
    confidence: Math.round(Math.max(0, Math.min(100, confidence))),
    reason: String(input?.reason || "No reason provided").slice(0, 240),
    risk_level: ["LOW", "MEDIUM", "HIGH"].includes(riskLevel) ? riskLevel : "MEDIUM"
  };
}

async function loadRecentDecisions(ctx, providerId) {
  const lines = await ctx.log.tail(40);
  return lines
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter((row) => row && ["ai.decision", "auto.wait", "auto.opened", "auto.closed", "battle.decision"].includes(row.type))
    .filter((row) => !providerId || !row.providerId || row.providerId === providerId)
    .slice(-12)
    .map((row) => ({
      ts: row.ts,
      type: row.type,
      action: row.action,
      symbol: row.symbol,
      confidence: row.confidence,
      risk_level: row.risk_level,
      reason: row.reason,
      result: row.result
    }));
}
