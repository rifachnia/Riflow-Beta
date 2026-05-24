import path from "node:path";
import { fileURLToPath } from "node:url";
import { JsonStore } from "../io/json-store.js";
import { EventLog } from "../io/logger.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "..", "..");

const defaultConfig = {
  identity: { name: "Riflow", operator: "local" },
  mode: "paper",
  walletPublicKey: "",
  llm: {
    enabled: true,
    activeProviderId: "mimo",
    baseUrl: "",
    apiKey: "",
    model: "mimo-v2.5-pro",
    temperature: 0.2,
    maxTokens: 700,
    inheritEnvPath: "E:/mbgtrade/.env",
    providers: []
  },
  auto: {
    enabled: false,
    intervalSeconds: 30,
    minOpenScore: 78,
    paperOnly: true
  },
  risk: {
    maxOpenPositions: 2,
    deployMinSol: 0.15,
    deployMaxSol: 0.5,
    stopLossPct: -12,
    takeProfitPct: 25,
    maxTokenAgeHours: 48,
    minLiquidityUsd: 15000,
    minVolume24hUsd: 25000
  },
  scanner: { source: "local-sim", limit: 12, refreshSeconds: 20 }
};

const defaultState = {
  startedAt: null,
  paperBalanceSol: 5,
  positions: [],
  closedTrades: [],
  lastScan: [],
  providerBooks: {},
  battleHistory: []
};

export async function loadContext() {
  const store = new JsonStore(ROOT);
  const config = await store.read("data/config.json", defaultConfig);
  const state = await store.read("data/state.json", defaultState);
  const log = new EventLog(ROOT);
  applyEnv(config, await readEnvFiles([path.join(ROOT, ".env"), config.llm?.inheritEnvPath]));
  normalizeConfig(config);
  normalizeState(config, state);
  return { root: ROOT, store, config, state, log };
}

export async function saveState(ctx) {
  await ctx.store.write("data/state.json", ctx.state);
}

async function readEnvFiles(files) {
  const env = {};
  for (const file of files.filter(Boolean)) {
    try {
      const raw = await import("node:fs/promises").then((fs) => fs.readFile(file, "utf8"));
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const index = trimmed.indexOf("=");
        if (index < 1) continue;
        const key = trimmed.slice(0, index).trim();
        const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
        if (key && env[key] == null) env[key] = value;
      }
    } catch {
      // Optional env files are allowed to be missing.
    }
  }
  return env;
}

function applyEnv(config, env) {
  config.mode = process.env.RIFLOW_MODE || config.mode;
  config.walletPublicKey = process.env.RIFLOW_WALLET_PUBLIC_KEY || config.walletPublicKey;
  config.llm ||= {};
  config.llm.baseUrl = process.env.LLM_BASE_URL || config.llm.baseUrl || env.LLM_BASE_URL;
  const configuredKey = config.llm.apiKey === "local-proxy" ? "" : config.llm.apiKey;
  config.llm.apiKey = process.env.LLM_API_KEY || configuredKey || env.LLM_API_KEY || "local-proxy";
  config.llm.model = process.env.LLM_MODEL || config.llm.model || env.LLM_MODEL || "mimo-v2.5-pro";
  for (const provider of config.llm.providers || []) {
    if (provider.apiKeyEnv) provider.apiKey = process.env[provider.apiKeyEnv] || env[provider.apiKeyEnv] || provider.apiKey;
    if (provider.apiKey === "local-proxy") provider.apiKey = config.llm.apiKey;
    if (!provider.baseUrl) provider.baseUrl = config.llm.baseUrl;
  }
}

function normalizeConfig(config) {
  config.llm ||= {};
  if (!Array.isArray(config.llm.providers) || !config.llm.providers.length) {
    config.llm.providers = [{
      id: config.llm.activeProviderId || "mimo",
      name: "Xiaomi MiMo",
      type: "openai-compatible",
      baseUrl: config.llm.baseUrl,
      apiKey: config.llm.apiKey,
      model: config.llm.model || "mimo-v2.5-pro",
      temperature: config.llm.temperature ?? 0.2,
      maxTokens: config.llm.maxTokens ?? 700,
      enabled: config.llm.enabled !== false
    }];
  }
  config.llm.activeProviderId ||= config.llm.providers[0]?.id || "mimo";
}

function normalizeState(config, state) {
  state.positions ||= [];
  state.closedTrades ||= [];
  state.lastScan ||= [];
  state.providerBooks ||= {};
  state.battleHistory ||= [];
  for (const provider of config.llm.providers || []) {
    state.providerBooks[provider.id] ||= {
      paperBalanceSol: state.paperBalanceSol ?? 5,
      positions: [],
      closedTrades: []
    };
  }
}
