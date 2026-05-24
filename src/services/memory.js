import path from "node:path";
import fs from "node:fs/promises";
import { buildMemoryUpdate } from "../prompts/memoryPrompt.js";

export function memoryId(providerOrId) {
  const raw = typeof providerOrId === "string"
    ? providerOrId
    : providerOrId?.id || providerOrId?.model || "default";
  const id = String(raw).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!id) throw new Error("memory id is required");
  return id;
}

export function emptyMemory(id) {
  return {
    id,
    lessons: [],
    avoid_patterns: [],
    preferred_patterns: [],
    confidence_adjustments: [],
    risk_improvements: [],
    last_updated: null,
    performance_snapshot: null
  };
}

export async function loadMemory(ctx, providerOrId) {
  const id = memoryId(providerOrId);
  const file = memoryFile(id);
  const existed = await fileExists(ctx.store.resolve(file));
  const memory = consolidateMemory(await ctx.store.read(file, emptyMemory(id)));
  if (!existed) await ctx.store.write(file, memory);
  return memory;
}

export async function saveMemory(ctx, providerOrId, memory) {
  const id = memoryId(providerOrId);
  const next = consolidateMemory({ ...emptyMemory(id), ...memory, id });
  await ctx.store.write(memoryFile(id), { ...next, last_updated: new Date().toISOString() });
}

export async function resetMemory(ctx, providerOrId) {
  const id = memoryId(providerOrId);
  await saveMemory(ctx, id, emptyMemory(id));
  return emptyMemory(id);
}

export async function updateMemoryFromCoach(ctx, providerOrId, coach, performance) {
  const existing = await loadMemory(ctx, providerOrId);
  const merged = buildMemoryUpdate({ existing, coach, performance });
  const next = consolidateMemory({ ...existing, ...merged }, performance);
  await saveMemory(ctx, providerOrId, next);
  return next;
}

export function consolidateMemory(memory, performance = memory.performance_snapshot) {
  const prioritize = (items, max = 20) => uniqueActionable(items)
    .sort((a, b) => scoreRule(b, performance) - scoreRule(a, performance))
    .slice(0, max);

  return {
    ...emptyMemory(memory.id || "default"),
    ...memory,
    lessons: prioritize(memory.lessons || [], 20),
    avoid_patterns: prioritize(memory.avoid_patterns || [], 20),
    preferred_patterns: prioritize(memory.preferred_patterns || [], 20),
    confidence_adjustments: prioritize(memory.confidence_adjustments || [], 20),
    risk_improvements: prioritize(memory.risk_improvements || [], 20),
    performance_snapshot: performance || memory.performance_snapshot || null
  };
}

export function memoryFile(id) {
  return path.join("memory", `${memoryId(id)}.json`);
}

function uniqueActionable(items) {
  const seen = new Set();
  const out = [];
  for (const item of items || []) {
    const text = normalizeRule(item);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function normalizeRule(item) {
  const text = typeof item === "string" ? item : item?.rule || item?.text || item?.summary || "";
  const clean = String(text).replace(/\s+/g, " ").trim();
  if (clean.length < 6) return "";
  if (/^(maybe|consider|be careful|watch out)$/i.test(clean)) return "";
  return clean.slice(0, 220);
}

function scoreRule(rule, performance) {
  const text = String(rule).toLowerCase();
  let score = 0;
  if (/(pnl|profit|loss|winrate|drawdown|risk|stop|liquid|volume|score)/.test(text)) score += 4;
  if (/(avoid|never|only|prefer|wait|close|open|reduce|increase)/.test(text)) score += 2;
  if (performance?.winrate != null) score += Math.min(2, Math.max(0, Number(performance.winrate) / 50));
  if (Number(performance?.maxDrawdownUsd || 0) < 0 && /(drawdown|risk|size|stop|wait)/.test(text)) score += 3;
  if (Number(performance?.closedTradeCount || 0) > 0) score += 1;
  return score;
}

async function fileExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}
