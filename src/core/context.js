import path from "node:path";
import { fileURLToPath } from "node:url";
import { JsonStore } from "../io/json-store.js";
import { EventLog } from "../io/logger.js";
import { DecisionLog } from "../io/decision-log.js";

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
  safety: {
    dryRun: true,
    paused: false,
    emergencyPause: false
  },
  sizing: {
    gasReserveSol: 0.2,
    minDeploySol: 0.15,
    maxDeploySol: 0.5,
    defaultRiskPct: 0.12,
    maxExposurePerTokenSol: 0.5
  },
  management: {
    minClaimFeeUsd: 2,
    claimFeeThresholdUsd: 2,
    outOfRangeMaxMinutes: 30,
    maxOutOfRangeMinutes: 30,
    minimumHoldMinutes: 5,
    emergencyStopLossPct: -20,
    stopLossPct: -12,
    takeProfitPct: 25,
    trailingTakeProfitPct: 12,
    trailingActivationPct: 8,
    trailingDropPct: 4,
    minPositionAgeMinutes: 5,
    tvlDropClosePct: 35,
    volumeDropClosePct: 65,
    feeDropClosePct: 65,
    redeployOnOutOfRange: true,
    closeOnTokenWarning: true,
    cooldownAfterCloseMinutes: 30,
    maxRedeploysPerPosition: 2,
    minScoreForRedeploy: 78
  },
  strategy: {
    minCandidateScore: 70,
    maxOpenPositions: 2,
    maxExposurePerTokenUsd: 150,
    maxExposurePerPoolUsd: 150,
    entryCooldownMinutes: 30,
    allowYoungPools: false,
    minPoolAgeHours: 1,
    requireCompleteData: false
  },
  dlmm: {
    rangeMode: "balanced",
    defaultRangeWidthPct: 7,
    tightRangeWidthPct: 3,
    wideRangeWidthPct: 15,
    maxFeeAccrualPctPerDay: 0.08
  },
  paperTrading: {
    startingBalanceSol: 5,
    solUsd: 150,
    daemonInterval: "1m",
    singlePosition: true,
    relaxed: false,
    forceEntry: false,
    aiTimeout: "120s"
  },
  memory: {
    poolScoreBoostMax: 8,
    poolScorePenaltyMax: 20
  },
  analytics: {
    equityCurveFile: "data/equity-curve.json",
    maxPoints: 5000
  },
  screening: {
    minTvlUsd: 15000,
    maxTvlUsd: 150000,
    minVolumeUsd: 25000,
    minHolders: 160,
    minOrganicScore: 60,
    minBinStep: 20,
    maxBinStep: 125,
    maxTopHolderPct: 35,
    blacklist: [],
    blockedWarnings: ["scam", "unsafe metadata", "blacklist"]
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
  scanner: {
    source: "meteora-dlmm",
    meteoraApiUrl: "",
    heliusRpcUrl: "",
    limit: 12,
    refreshSeconds: 30
  }
};

const defaultState = {
  startedAt: null,
  paperBalanceSol: 5,
  positions: [],
  closedTrades: [],
  lastScan: [],
  lastRawScan: [],
  lastFilteredOut: [],
  providerBooks: {},
  battleHistory: []
};

export async function loadContext() {
  const store = new JsonStore(ROOT);
  const config = await store.read("data/config.json", defaultConfig);
  const state = await store.read("data/state.json", defaultState);
  const log = new EventLog(ROOT);
  const decisions = new DecisionLog(ROOT);
  applyEnv(config, await readEnvFiles([path.join(ROOT, ".env"), config.llm?.inheritEnvPath]));
  normalizeConfig(config);
  normalizeState(config, state);
  return { root: ROOT, store, config, state, log, decisions };
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
  config.auto ||= {};
  config.auto.paperOnly = true;
  config.safety ||= {};
  config.safety.dryRun = config.safety.dryRun !== false;
  config.safety.paused = Boolean(config.safety.paused);
  config.safety.emergencyPause = Boolean(config.safety.emergencyPause);
  config.sizing ||= {};
  config.sizing.gasReserveSol ??= 0.2;
  config.sizing.minDeploySol ??= config.risk?.deployMinSol ?? 0.15;
  config.sizing.maxDeploySol ??= config.risk?.deployMaxSol ?? 0.5;
  config.sizing.defaultRiskPct ??= 0.12;
  config.sizing.maxExposurePerTokenSol ??= config.sizing.maxDeploySol;
  config.management ||= {};
  config.management.minClaimFeeUsd ??= 2;
  config.management.claimFeeThresholdUsd ??= config.management.minClaimFeeUsd;
  config.management.outOfRangeMaxMinutes ??= 30;
  config.management.maxOutOfRangeMinutes ??= config.management.outOfRangeMaxMinutes;
  config.management.minimumHoldMinutes ??= config.management.minPositionAgeMinutes ?? 5;
  config.management.emergencyStopLossPct ??= -20;
  config.management.stopLossPct ??= config.risk?.stopLossPct ?? -12;
  config.management.takeProfitPct ??= config.risk?.takeProfitPct ?? 25;
  config.management.trailingTakeProfitPct ??= 12;
  config.management.trailingActivationPct ??= 8;
  config.management.trailingDropPct ??= 4;
  config.management.minPositionAgeMinutes ??= 5;
  config.management.tvlDropClosePct ??= 35;
  config.management.volumeDropClosePct ??= 65;
  config.management.feeDropClosePct ??= 65;
  config.management.redeployOnOutOfRange ??= true;
  config.management.closeOnTokenWarning ??= true;
  config.management.cooldownAfterCloseMinutes ??= 30;
  config.management.maxRedeploysPerPosition ??= 2;
  config.management.minScoreForRedeploy ??= 78;
  config.strategy ||= {};
  config.strategy.minCandidateScore ??= 70;
  config.strategy.maxOpenPositions ??= config.risk?.maxOpenPositions ?? 2;
  config.strategy.maxExposurePerTokenUsd ??= (config.sizing?.maxExposurePerTokenSol ?? config.risk?.deployMaxSol ?? 0.5) * 150;
  config.strategy.maxExposurePerPoolUsd ??= config.strategy.maxExposurePerTokenUsd;
  config.strategy.entryCooldownMinutes ??= 30;
  config.strategy.allowYoungPools ??= false;
  config.strategy.minPoolAgeHours ??= 1;
  config.strategy.requireCompleteData ??= false;
  config.dlmm ||= {};
  config.dlmm.rangeMode ||= "balanced";
  config.dlmm.defaultRangeWidthPct ??= 7;
  config.dlmm.tightRangeWidthPct ??= 3;
  config.dlmm.wideRangeWidthPct ??= 15;
  config.dlmm.maxFeeAccrualPctPerDay ??= 0.08;
  config.paperTrading ||= {};
  config.paperTrading.startingBalanceSol ??= 0.1;
  config.paperTrading.solUsd ??= 150;
  config.paperTrading.daemonInterval ||= "1m";
  config.paperTrading.singlePosition ??= true;
  config.paperTrading.relaxed ??= false;
  config.paperTrading.forceEntry ??= false;
  config.paperTrading.aiTimeout ||= "120s";
  config.memory ||= {};
  config.memory.poolScoreBoostMax ??= 8;
  config.memory.poolScorePenaltyMax ??= 20;
  config.analytics ||= {};
  config.analytics.equityCurveFile ||= "data/equity-curve.json";
  config.analytics.maxPoints ??= 5000;
  config.screening ||= {};
  config.screening.minTvlUsd ??= config.risk?.minLiquidityUsd ?? 15000;
  config.screening.maxTvlUsd ??= 150000;
  config.screening.minVolumeUsd ??= config.risk?.minVolume24hUsd ?? 25000;
  config.screening.minHolders ??= 160;
  config.screening.minOrganicScore ??= 60;
  config.screening.minBinStep ??= 20;
  config.screening.maxBinStep ??= 125;
  config.screening.maxTopHolderPct ??= 35;
  config.screening.requireCompleteData ??= false;
  config.screening.blacklist ||= [];
  config.screening.blockedWarnings ||= ["scam", "unsafe metadata", "blacklist"];
  config.scanner ||= {};
  config.scanner.source ||= "meteora-dlmm";
  config.scanner.meteoraApiUrl ||= process.env.RIFLOW_METEORA_API_URL || "";
  config.scanner.heliusRpcUrl ||= process.env.RIFLOW_RPC_URL || process.env.RPC_URL || "";
  config.scanner.limit ??= 12;
  config.scanner.refreshSeconds ??= 30;
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
  state.lastRawScan ||= [];
  state.lastFilteredOut ||= [];
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
