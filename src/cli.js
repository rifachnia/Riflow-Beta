#!/usr/bin/env node
import { loadContext, saveState } from "./core/context.js";
import fs from "node:fs/promises";
import { money, pct } from "./core/format.js";
import { summarizeRisk } from "./core/risk.js";
import { createPaperPosition, closePaperPosition, openPositions } from "./services/portfolio.js";
import { scanMarket } from "./services/scanner.js";
import { decideNextAction } from "./services/agent.js";
import { chatText, hasAiConfig } from "./services/ai.js";
import { applyDecision } from "./services/auto-runner.js";
import { runCoach } from "./services/coach.js";
import { loadMemory, memoryFile, resetMemory, saveMemory } from "./services/memory.js";
import { getProvider, leaderboard as getLeaderboard, listProviders, providerBook, providerContext, providerStats, useProvider } from "./services/providers.js";
import { renderHelp, renderLogs, renderPositions, renderScan, renderStatus, renderWatch, restoreTerminal } from "./ui/screen.js";

const [, , command = "help", ...args] = process.argv;
const clear = "\x1b[2J\x1b[H";
const clearAll = "\x1b[3J\x1b[2J\x1b[H";
const reset = "\x1b[0m";
const bold = "\x1b[1m";
const dim = "\x1b[2m";
const cyan = "\x1b[36m";
const green = "\x1b[32m";
const yellow = "\x1b[33m";
const hideCursor = "\x1b[?25l";
const showCursor = "\x1b[?25h";

function help() {
  return renderHelp();
}

async function status() {
  const ctx = await loadContext();
  console.log(renderStatus(ctx));
}

async function menu() {
  const items = [
    { label: "Status", hint: "account, active provider, paper PnL", run: status },
    { label: "Watch cockpit", hint: "live interactive paper cockpit", run: () => watch({ returnToMenu: true }) },
    { label: "Scan candidates", hint: "refresh scanner snapshot", run: scan },
    { label: "Providers", hint: "list AI providers", run: providers },
    { label: "Select provider", hint: "set active AI provider", run: selectProvider, noPause: true },
    { label: "Test provider", hint: "send hello prompt to active/provider", run: testProvider },
    { label: "Add provider", hint: "OpenAI, Gemini, Claude, OpenRouter, custom", run: addProvider, noPause: true },
    { label: "Leaderboard", hint: "rank model paper performance", run: leaderboard },
    { label: "Stats: mimo", hint: "show Xiaomi MiMo paper book", run: () => withArgs(["mimo"], stats) },
    { label: "Battle: mimo vs mimo-fast", hint: "1 paper round, same scan snapshot", run: () => withArgs(["--models", "mimo,mimo-fast", "--rounds", "1"], battle) },
    { label: "Memory: mimo", hint: "show adaptive model memory", run: () => withArgs(["show", "mimo"], memoryCommand) },
    { label: "Coach: mimo", hint: "review recent paper performance", run: () => withArgs(["mimo", "--last", "7d"], coachCommand) },
    { label: "Logs", hint: "show latest event log", run: logs },
    { label: "Help", hint: "show full CLI command reference", run: () => console.log(help()) },
    { label: "Quit", hint: "leave Riflow", quit: true }
  ];
  if (!process.stdin.isTTY || !process.stdout.isTTY) return menuPrompt(items);

  let selected = 0;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  redrawLauncher(items, selected);

  const waitKey = () => new Promise((resolve) => {
    const onData = (key) => {
      process.stdin.off("data", onData);
      resolve(key);
    };
    process.stdin.on("data", onData);
  });

  try {
    while (true) {
      if (process.stdin.isTTY && !process.stdin.isRaw) process.stdin.setRawMode(true);
      const key = await waitKey();
      const previous = selected;
      if (key === "\u0003" || key.toLowerCase() === "q" || key === "0") break;
      if (key === "\u001b[A") selected = (selected - 1 + items.length) % items.length;
      else if (key === "\u001b[B") selected = (selected + 1) % items.length;
      else if (/^\d$/.test(key)) {
        const index = key === "0" ? items.length - 1 : Number(key) - 1;
        if (items[index]?.quit) break;
        if (items[index]) selected = index;
      }
      else if (key === "\r" || key === "\n") {
        const item = items[selected];
        if (item.quit) break;
        process.stdin.setRawMode(false);
        process.stdout.write(clearAll + showCursor);
        try {
          await item.run();
        } catch (error) {
          console.error(`Error: ${error.message}`);
        }
        if (!item.noPause) {
          console.log(`\n${dim}Press any key to return to launcher...${reset}`);
          process.stdin.resume();
          process.stdin.setRawMode(true);
          await waitKey();
        }
        process.stdin.resume();
        if (process.stdin.isTTY) process.stdin.setRawMode(true);
        redrawLauncher(items, selected);
        continue;
      }
      if (previous !== selected) {
        renderMenuRow(items, previous, selected);
        renderMenuRow(items, selected, selected);
        process.stdout.write(`\x1b[${menuRow(selected)};1H`);
      }
    }
  } finally {
    if (process.stdin.isTTY && process.stdin.isRaw) process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdout.write(clearAll + showCursor + reset);
  }
}

function redrawLauncher(items, selected) {
  process.stdout.write(clearAll + hideCursor);
  printLauncherFrame(items);
  renderMenuRows(items, selected);
}

async function withArgs(nextArgs, fn) {
  args.splice(0, args.length, ...nextArgs);
  return fn();
}

async function menuPrompt(items) {
  const readline = await import("node:readline/promises");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  printLauncherFrame(items);
  renderMenuRows(items, -1);
  while (true) {
    const answer = (await rl.question(`${cyan}riflow>${reset} `)).trim();
    if (!answer) continue;
    if (["q", "quit", "exit"].includes(answer.toLowerCase())) break;
    const numeric = Number(answer);
    const item = Number.isInteger(numeric) ? items[numeric - 1] : findMenuItem(items, answer);
    if (!item) console.log(`${yellow}Unknown command.${reset} Type a number, command name, or q.`);
    else if (item.quit) break;
    else await item.run();
  }
  rl.close();
}

function printLauncherFrame(items = []) {
  console.log(`${cyan}${bold} ____  ___ _____ _     ___  _    _ ${reset}`);
  console.log(`${cyan}${bold}|  _ \\|_ _|  ___| |   / _ \\| |  | |${reset}`);
  console.log(`${cyan}${bold}| |_) || || |_  | |  | | | | |  | |${reset}`);
  console.log(`${cyan}${bold}|  _ < | ||  _| | |__| |_| | |/\\| |${reset}`);
  console.log(`${cyan}${bold}|_| \\_\\___|_|   |_____\\___/ \\_/\\_/ ${reset}`);
  console.log("");
  console.log(`${bold}Riflow Launcher${reset} ${dim}AI paper-trading CLI${reset}`);
  console.log(`${dim}Use Up/Down, Enter to run, q to quit.${reset}`);
  for (let i = 0; i < Math.max(2, items.length + 1); i++) console.log("");
  console.log(`${yellow}No live trading in this build. All actions are paper-only.${reset}`);
  console.log("");
}

function menuRow(index) {
  return 9 + index;
}

function renderMenuRows(items, selected) {
  items.forEach((_, index) => renderMenuRow(items, index, selected));
  process.stdout.write(`\x1b[${menuRow(Math.max(0, selected))};1H`);
}

function renderMenuRow(items, index, selected) {
  const item = items[index];
  const isSelected = index === selected;
  const pointer = isSelected ? `${green}>${reset}` : " ";
  const label = isSelected ? `${green}${item.label}${reset}` : item.label;
  const line = `${pointer} ${cyan}${String(index + 1).padStart(2)}${reset}  ${label.padEnd(24)} ${dim}${item.hint}${reset}`;
  process.stdout.write(`\x1b[${menuRow(index)};1H\x1b[2K${line}`);
}

function findMenuItem(items, answer) {
  const wanted = answer.toLowerCase();
  return items.find((item) => item.label.toLowerCase() === wanted)
    || items.find((item) => item.label.toLowerCase().startsWith(wanted));
}

async function scan() {
  const ctx = await loadContext();
  const rows = await scanMarket(ctx.config);
  ctx.state.lastScan = rows;
  await saveState(ctx);
  await ctx.log.write("scan.completed", { count: rows.length, leader: rows[0]?.symbol || null });
  console.log(renderScan(rows));
}

async function aiTest() {
  const ctx = await loadContext();
  if (!hasAiConfig(ctx.config)) throw new Error("MiMo config not found. Check .env or data/config.json llm.inheritEnvPath.");
  if (!ctx.state.lastScan?.length) {
    ctx.state.lastScan = await scanMarket(ctx.config);
    await saveState(ctx);
  }
  const decision = await decideNextAction(ctx);
  console.log(JSON.stringify({
    provider: ctx.config.llm.activeProviderId,
    model: getProvider(ctx.config).model,
    ok: true,
    sampleDecision: decision
  }, null, 2));
}

async function decide() {
  const ctx = await loadContext();
  if (!ctx.state.lastScan?.length) {
    ctx.state.lastScan = await scanMarket(ctx.config);
    await saveState(ctx);
  }
  const decision = await decideNextAction(ctx);
  await ctx.log.write("ai.decision", { ...decision });
  console.log(JSON.stringify(decision, null, 2));
}

async function positions() {
  const ctx = await loadContext();
  console.log(renderPositions(ctx));
}

async function providers() {
  const ctx = await loadContext();
  console.log("PROVIDERS\n");
  for (const provider of listProviders(ctx.config)) {
    const active = provider.active ? "*" : " ";
    const enabled = provider.enabled === false ? "off" : "on";
    console.log(`${active} ${provider.id.padEnd(12)} ${String(provider.model).padEnd(18)} ${enabled.padEnd(4)} ${provider.name || ""}`);
  }
}

async function selectProvider() {
  const readline = await import("node:readline/promises");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const ctx = await loadContext();
    const rows = listProviders(ctx.config);
    console.log("SELECT PROVIDER\n");
    rows.forEach((provider, index) => {
      const active = provider.active ? "*" : " ";
      const enabled = provider.enabled === false ? "off" : "on";
      console.log(`${String(index + 1).padStart(2)} ${active} ${provider.id.padEnd(14)} ${String(provider.model).padEnd(24)} ${enabled.padEnd(4)} ${provider.name || ""}`);
    });
    const answer = (await rl.question("\nChoose number or provider id: ")).trim();
    const numeric = Number(answer);
    const provider = Number.isInteger(numeric) ? rows[numeric - 1] : rows.find((item) => item.id === answer);
    if (!provider) throw new Error("provider not found");
    await setActiveProvider(provider.id);
    console.log(`\nActive provider: ${provider.id} (${provider.model})`);
  } finally {
    rl.close();
  }
}

async function testProvider() {
  const readline = await import("node:readline/promises");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const ctx = await loadContext();
    const rows = listProviders(ctx.config);
    console.log("TEST PROVIDER\n");
    rows.forEach((provider, index) => {
      const active = provider.active ? "*" : " ";
      console.log(`${String(index + 1).padStart(2)} ${active} ${provider.id.padEnd(14)} ${String(provider.model).padEnd(24)} ${provider.name || ""}`);
    });
    const answer = (await rl.question("\nProvider to test (blank = active): ")).trim();
    const numeric = Number(answer);
    const provider = answer
      ? (Number.isInteger(numeric) ? rows[numeric - 1] : rows.find((item) => item.id === answer))
      : getProvider(ctx.config);
    if (!provider) throw new Error("provider not found");
    const prompt = "Hello, which model am I speaking with right now? Answer in one short sentence.";
    console.log(`\nSending: ${prompt}`);
    const reply = await chatText(ctx.config, prompt, provider);
    console.log(`\nOK ${provider.id} (${provider.model})`);
    console.log(`Reply: ${reply || "(empty response)"}`);
  } finally {
    rl.close();
  }
}

async function addProvider() {
  const readline = await import("node:readline/promises");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const presets = providerPresets();
  try {
    console.log("ADD AI PROVIDER\n");
    presets.forEach((preset, index) => {
      console.log(`${String(index + 1).padStart(2)}  ${preset.label.padEnd(18)} ${preset.note}`);
    });
    const selected = Number(await rl.question("\nChoose provider type: "));
    const preset = presets[selected - 1];
    if (!preset) throw new Error("invalid provider type");

    const ctx = await loadContext();
    const defaultId = uniqueProviderId(ctx.config, preset.id);
    const id = sanitizeId((await rl.question(`provider id (${defaultId}): `)).trim() || defaultId);
    const name = (await rl.question(`display name (${preset.name}): `)).trim() || preset.name;
    const model = (await rl.question(`model (${preset.model}): `)).trim() || preset.model;
    const baseUrl = preset.askBaseUrl
      ? ((await rl.question(`base url (${preset.baseUrl}): `)).trim() || preset.baseUrl)
      : preset.baseUrl;
    const key = await rl.question("api key (blank to configure later): ");
    const apiKeyEnv = `RIFLOW_${id.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;

    const provider = {
      id,
      name,
      type: preset.type,
      baseUrl,
      apiKeyEnv,
      model,
      temperature: 0.2,
      maxTokens: 700,
      enabled: true
    };
    const rawConfig = await ctx.store.read("data/config.json", {});
    rawConfig.llm ||= {};
    rawConfig.llm.providers ||= [];
    if (rawConfig.llm.providers.some((item) => item.id === id)) throw new Error(`provider already exists: ${id}`);
    rawConfig.llm.providers.push(provider);
    rawConfig.llm.activeProviderId ||= id;
    await ctx.store.write("data/config.json", rawConfig);

    ctx.state.providerBooks ||= {};
    ctx.state.providerBooks[id] ||= { paperBalanceSol: ctx.state.paperBalanceSol ?? 5, positions: [], closedTrades: [] };
    await saveState(ctx);

    if (key.trim()) await upsertEnv(apiKeyEnv, key.trim());
    console.log(`\nAdded provider ${id} (${model}).`);
    console.log(`Use it with: node src\\cli.js use ${id}`);
  } finally {
    rl.close();
  }
}

function providerPresets() {
  return [
    { id: "openai", label: "OpenAI", note: "native OpenAI-compatible API", name: "OpenAI", type: "openai-compatible", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
    { id: "openrouter", label: "OpenRouter", note: "route Claude/Gemini/OpenAI models", name: "OpenRouter", type: "openai-compatible", baseUrl: "https://openrouter.ai/api/v1", model: "anthropic/claude-3.5-sonnet" },
    { id: "claude", label: "Claude", note: "direct Anthropic Messages API", name: "Claude", type: "anthropic", baseUrl: "https://api.anthropic.com/v1", model: "claude-3-5-sonnet-latest" },
    { id: "gemini", label: "Gemini", note: "direct Google Gemini API", name: "Gemini", type: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", model: "gemini-1.5-flash" },
    { id: "mimo", label: "Xiaomi MiMo", note: "OpenAI-compatible MiMo/proxy", name: "Xiaomi MiMo", type: "openai-compatible", baseUrl: "http://127.0.0.1:19911/v1", model: "mimo-v2.5-pro" },
    { id: "custom", label: "Custom", note: "any OpenAI-compatible endpoint", name: "Custom OpenAI-Compatible", type: "openai-compatible", baseUrl: "http://localhost:1234/v1", model: "local-model", askBaseUrl: true }
  ];
}

function sanitizeId(value) {
  const id = String(value || "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!id) throw new Error("provider id is required");
  return id;
}

function uniqueProviderId(config, base) {
  const ids = new Set((config.llm?.providers || []).map((item) => item.id));
  let id = base;
  let i = 2;
  while (ids.has(id)) id = `${base}-${i++}`;
  return id;
}

async function upsertEnv(key, value) {
  const file = ".env";
  let raw = "";
  try { raw = await fs.readFile(file, "utf8"); } catch {}
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=.*$`, "m");
  const next = re.test(raw)
    ? raw.replace(re, line)
    : `${raw.trimEnd()}${raw.trim() ? "\n" : ""}${line}\n`;
  await fs.writeFile(file, next, "utf8");
}

async function useProviderCommand() {
  const providerId = args[0];
  if (!providerId) throw new Error("providerId is required");
  const ctx = await loadContext();
  await setActiveProvider(providerId, ctx);
  console.log(`Active provider: ${providerId}`);
}

async function setActiveProvider(providerId, existingCtx = null) {
  const ctx = existingCtx || await loadContext();
  useProvider(ctx.config, providerId);
  const rawConfig = await ctx.store.read("data/config.json", {});
  rawConfig.llm ||= {};
  rawConfig.llm.activeProviderId = providerId;
  await ctx.store.write("data/config.json", rawConfig);
}

async function leaderboard() {
  const ctx = await loadContext();
  console.log("MODEL LEADERBOARD\n");
  console.log("PROVIDER      MODEL              TRADES  WINRATE   PNL       DD        OPEN");
  for (const row of getLeaderboard(ctx)) {
    const winrate = row.winrate == null ? "-" : `${row.winrate.toFixed(1)}%`;
    console.log(`${row.providerId.padEnd(13)} ${String(row.modelId).padEnd(18)} ${String(row.closed.length).padStart(6)}  ${winrate.padStart(7)}  ${moneyCell(row.equityUsd).padStart(8)}  ${moneyCell(row.maxDrawdownUsd).padStart(8)}  ${String(row.open.length).padStart(4)}`);
  }
}

async function stats() {
  const providerId = args[0];
  if (!providerId) throw new Error("providerId is required");
  const ctx = await loadContext();
  const row = providerStats(ctx, providerId);
  console.log(`${row.providerName} (${row.providerId})`);
  console.log(`model       ${row.modelId}`);
  console.log(`balance     ${row.paperBalanceSol.toFixed(3)} SOL`);
  console.log(`open        ${row.open.length}`);
  console.log(`closed      ${row.closed.length}`);
  console.log(`realized    ${moneyCell(row.realizedPnlUsd)}`);
  console.log(`floating    ${moneyCell(row.floatingPnlUsd)}`);
  console.log(`equity      ${moneyCell(row.equityUsd)}`);
  console.log(`winrate     ${row.winrate == null ? "-" : `${row.winrate.toFixed(1)}%`}`);
  console.log(`drawdown    ${moneyCell(row.maxDrawdownUsd)}`);
}

function moneyCell(value) {
  return money(value).replace("+", "");
}

async function open() {
  const ctx = await loadContext();
  const symbol = args[0];
  const sizeSol = Number(args[1] || ctx.config.risk.deployMinSol);
  if (!symbol) throw new Error("symbol is required");
  if (!Number.isFinite(sizeSol) || sizeSol <= 0) throw new Error("sizeSol must be positive");

  const risk = summarizeRisk(ctx.config, ctx.state);
  if (!risk.canOpen) throw new Error("risk rules block new positions");
  if (sizeSol < ctx.config.risk.deployMinSol || sizeSol > ctx.config.risk.deployMaxSol) {
    throw new Error(`size must be between ${ctx.config.risk.deployMinSol} and ${ctx.config.risk.deployMaxSol} SOL`);
  }

  const position = createPaperPosition(symbol, sizeSol, getProvider(ctx.config));
  ctx.state.positions.push(position);
  ctx.state.paperBalanceSol = Number((ctx.state.paperBalanceSol - sizeSol).toFixed(6));
  await saveState(ctx);
  await ctx.log.write("position.opened", { id: position.id, symbol: position.symbol, sizeSol });
  console.log(`Opened ${position.symbol} paper position: ${position.id}`);
}

async function close() {
  const ctx = await loadContext();
  const id = args[0];
  const pnlPct = args[1] == null ? null : Number(args[1]);
  if (!id) throw new Error("positionId is required");

  const position = openPositions(ctx.state).find((item) => item.id === id);
  if (!position) throw new Error(`open position not found: ${id}`);

  position.status = "closed";
  position.closedAt = new Date().toISOString();
  const trade = closePaperPosition(position, pnlPct, getProvider(ctx.config));
  ctx.state.closedTrades.unshift(trade);
  ctx.state.paperBalanceSol = Number((ctx.state.paperBalanceSol + Number(position.sizeSol || 0)).toFixed(6));
  await saveState(ctx);
  await ctx.log.write("position.closed", { id, symbol: position.symbol, pnlPct: trade.pnlPct, providerId: trade.providerId, modelId: trade.modelId });
  console.log(`Closed ${position.symbol} at ${pct(trade.pnlPct)}: ${trade.id}`);
}

async function logs() {
  const ctx = await loadContext();
  const lines = await ctx.log.tail(Number(args[0] || 40));
  console.log(renderLogs(lines));
}

async function memoryCommand() {
  const action = String(args[0] || "show").toLowerCase();
  const modelId = args[1];
  if (!modelId) throw new Error("usage: riflow memory show|reset|export|import <modelId> [file]");
  const ctx = await loadContext();
  const key = memoryKeyForArg(ctx, modelId);

  if (action === "show") {
    console.log(JSON.stringify(await loadMemory(ctx, key), null, 2));
    return;
  }
  if (action === "reset") {
    await resetMemory(ctx, key);
    console.log(`Reset memory for ${key}.`);
    return;
  }
  if (action === "export") {
    console.log(JSON.stringify(await loadMemory(ctx, key), null, 2));
    return;
  }
  if (action === "import") {
    const file = args[2];
    if (!file) throw new Error("usage: riflow memory import <modelId> <file>");
    const imported = JSON.parse(await fs.readFile(file, "utf8"));
    await saveMemory(ctx, key, imported);
    console.log(`Imported memory for ${key} from ${file}.`);
    return;
  }
  throw new Error(`unknown memory action: ${action}`);
}

async function coachCommand() {
  const modelId = args[0];
  if (!modelId) throw new Error("usage: riflow coach <modelId> --last 7d OR --trades 50");
  const ctx = await loadContext();
  const provider = resolveProviderArg(ctx, modelId);
  const last = readFlag("last");
  const trades = Number(readFlag("trades") || 0);
  const options = {
    trades: trades > 0 ? trades : null,
    windowLabel: last ? `last ${last}` : trades > 0 ? `last ${trades} trades` : "recent"
  };
  if (last) options.sinceMs = Date.now() - parseDurationMs(last);

  console.log(`Coaching ${provider.id} (${provider.model}) using paper history only...`);
  const result = await runCoach(ctx, provider, options);
  console.log(JSON.stringify(result.coach, null, 2));
  console.log(`\nUpdated memory: ${memoryFile(provider.id)}`);
}

async function runAutoOnce() {
  const ctx = await loadContext();
  if (!ctx.state.lastScan?.length) {
    ctx.state.lastScan = await scanMarket(ctx.config);
    await saveState(ctx);
  }
  const decision = await decideNextAction(ctx);
  await ctx.log.write("ai.decision", { ...decision });
  const result = await applyDecision(ctx, decision);
  console.log(result);
}

async function auto() {
  const run = async () => {
    try {
      await runAutoOnce();
    } catch (error) {
      const ctx = await loadContext();
      await ctx.log.write("auto.error", { message: error.message });
      console.error(`AUTO ERROR: ${error.message}`);
    }
  };

  await run();
  const seconds = Math.max(10, Number((await loadContext()).config.auto?.intervalSeconds || 30));
  const timer = setInterval(run, seconds * 1000);
  process.on("SIGINT", () => {
    clearInterval(timer);
    process.stdout.write("\nAuto stopped.\n");
    process.exit(0);
  });
}

async function battle() {
  const modelArg = readFlag("models");
  const rounds = Number(readFlag("rounds") || 1);
  if (!modelArg) throw new Error("battle requires --models a,b,c");
  if (!Number.isFinite(rounds) || rounds < 1) throw new Error("--rounds must be a positive number");

  const ctx = await loadContext();
  const providerIds = modelArg.split(",").map((item) => item.trim()).filter(Boolean);
  for (const id of providerIds) getProvider(ctx.config, id);

  console.log(`Starting paper battle: ${providerIds.join(", ")} (${rounds} rounds)`);
  for (let round = 1; round <= rounds; round++) {
    const scan = await scanMarket(ctx.config);
    ctx.state.lastScan = scan;
    console.log(`\nRound ${round}/${rounds} | shared leader ${scan[0]?.symbol || "-"}`);

    for (const providerId of providerIds) {
      const provider = getProvider(ctx.config, providerId);
      const book = providerBook(ctx.state, providerId);
      const pctx = providerContext(ctx, providerId, scan);
      let decision;
      try {
        decision = await decideNextAction(pctx, provider);
      } catch (error) {
        decision = {
          action: "WAIT",
          providerId,
          modelId: provider.model,
          confidence: 0,
          reason: `model error: ${error.message.slice(0, 120)}`
        };
      }
      const result = applyDecisionToBook(ctx, book, provider, decision, scan);
      await ctx.log.write("battle.decision", { round, providerId, modelId: provider.model, action: decision.action, result });
      console.log(`  ${providerId.padEnd(12)} ${decision.action.padEnd(5)} ${result}`);
    }
    ctx.state.battleHistory.unshift({
      id: `battle_${Date.now().toString(36)}_${round}`,
      ts: new Date().toISOString(),
      round,
      providers: providerIds,
      scanLeader: scan[0]?.symbol || null
    });
    await saveState(ctx);
  }
  console.log("\nBattle complete.\n");
  await leaderboard();
}

function applyDecisionToBook(ctx, book, provider, decision, scan) {
  if (decision.action === "WAIT") return decision.reason || "wait";

  if (decision.action === "OPEN") {
    const candidate = scan.find((item) => item.symbol === decision.symbol);
    const risk = summarizeRisk(ctx.config, book);
    const minScore = Number(ctx.config.auto?.minOpenScore ?? 78);
    if (!risk.canOpen) return "risk blocked open";
    if (!candidate) return "candidate missing";
    if (candidate.score < minScore) return `score ${candidate.score} below ${minScore}`;

    const requested = decision.sizeSol || ctx.config.risk.deployMinSol;
    const sizeSol = Math.min(ctx.config.risk.deployMaxSol, Math.max(ctx.config.risk.deployMinSol, requested));
    const position = createPaperPosition(candidate.symbol, sizeSol, provider);
    position.scoreAtOpen = candidate.score;
    position.reason = decision.reason;
    position.aiConfidence = decision.confidence;
    book.positions.push(position);
    book.paperBalanceSol = Number((book.paperBalanceSol - sizeSol).toFixed(6));
    return `opened ${position.symbol}`;
  }

  if (decision.action === "CLOSE") {
    const position = openPositions(book).find((item) => item.id === decision.positionId)
      || openPositions(book).find((item) => item.symbol === decision.symbol)
      || openPositions(book)[0];
    if (!position) return "no open position";
    position.status = "closed";
    position.closedAt = new Date().toISOString();
    const trade = closePaperPosition(position, null, provider);
    trade.reason = decision.reason;
    trade.aiConfidence = decision.confidence;
    book.closedTrades.unshift(trade);
    book.paperBalanceSol = Number((book.paperBalanceSol + Number(position.sizeSol || 0)).toFixed(6));
    return `closed ${position.symbol} ${pct(trade.pnlPct)}`;
  }

  return "unknown action";
}

function readFlag(name) {
  const prefix = `--${name}=`;
  const inline = args.find((item) => item.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : null;
}

function resolveProviderArg(ctx, value) {
  const wanted = String(value || "");
  const provider = (ctx.config.llm?.providers || []).find((item) => item.id === wanted || item.model === wanted);
  if (!provider) throw new Error(`provider/model not found: ${wanted}`);
  return provider;
}

function memoryKeyForArg(ctx, value) {
  return ((ctx.config.llm?.providers || []).find((item) => item.id === value || item.model === value)?.id) || value;
}

function parseDurationMs(value) {
  const match = String(value || "").trim().match(/^(\d+)\s*([hdw])$/i);
  if (!match) throw new Error("--last must look like 24h, 7d, or 4w");
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const hours = unit === "h" ? amount : unit === "d" ? amount * 24 : amount * 24 * 7;
  return hours * 60 * 60 * 1000;
}

async function watch(options = {}) {
  let ctx = await loadContext();
  if (!ctx.state.startedAt) {
    ctx.state.startedAt = new Date().toISOString();
    await saveState(ctx);
  }

  let notice = "";
  let showLogs = true;

  async function refreshScan(fresh) {
    fresh.state.lastScan = await scanMarket(fresh.config);
    await saveState(fresh);
    await fresh.log.write("scan.completed", {
      count: fresh.state.lastScan.length,
      leader: fresh.state.lastScan[0]?.symbol || null
    });
  }

  async function draw(message = notice) {
    ctx = await loadContext();
    if (!ctx.state.lastScan?.length) await refreshScan(ctx);
    const lines = showLogs ? await ctx.log.tail(8) : [];
    process.stdout.write(renderWatch(ctx, lines, message));
  }

  async function openTopCandidate() {
    const fresh = await loadContext();
    if (!fresh.state.lastScan?.length) await refreshScan(fresh);
    const top = fresh.state.lastScan[0];
    if (!top) {
      notice = "no candidate";
      return;
    }

    const risk = summarizeRisk(fresh.config, fresh.state);
    if (!risk.canOpen) {
      notice = "risk blocked";
      return;
    }

    const sizeSol = Math.min(fresh.config.risk.deployMaxSol, Math.max(fresh.config.risk.deployMinSol, 0.25));
    const position = createPaperPosition(top.symbol, sizeSol);
    position.scoreAtOpen = top.score;
    position.reason = `top scanner candidate, score ${top.score}`;
    fresh.state.positions.push(position);
    fresh.state.paperBalanceSol = Number((fresh.state.paperBalanceSol - sizeSol).toFixed(6));
    await saveState(fresh);
    await fresh.log.write("position.opened", { id: position.id, symbol: position.symbol, sizeSol, score: top.score });
    notice = `opened ${position.symbol}`;
  }

  async function closeFirstPosition() {
    const fresh = await loadContext();
    const position = openPositions(fresh.state)[0];
    if (!position) {
      notice = "nothing to close";
      return;
    }

    position.status = "closed";
    position.closedAt = new Date().toISOString();
    const trade = closePaperPosition(position, null);
    fresh.state.closedTrades.unshift(trade);
    fresh.state.paperBalanceSol = Number((fresh.state.paperBalanceSol + Number(position.sizeSol || 0)).toFixed(6));
    await saveState(fresh);
    await fresh.log.write("position.closed", { id: position.id, symbol: position.symbol, pnlPct: trade.pnlPct });
    notice = `closed ${position.symbol} ${pct(trade.pnlPct)}`;
  }

  async function askAiOnce() {
    const fresh = await loadContext();
    if (!fresh.state.lastScan?.length) await refreshScan(fresh);
    const decision = await decideNextAction(fresh);
    await fresh.log.write("ai.decision", { ...decision });
    notice = await applyDecision(fresh, decision);
  }

  await draw();
  const timer = setInterval(() => draw(), Math.max(5, ctx.config.scanner.refreshSeconds || 20) * 1000);

  return new Promise((resolve) => {
    const cleanup = () => {
      clearInterval(timer);
      process.off("SIGINT", cleanup);
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.stdin.off("data", onData);
      process.stdout.write(`${restoreTerminal()}\n`);
      if (options.returnToMenu) resolve();
      else process.exit(0);
    };

    const onData = async (key) => {
      try {
        if (key === "\u0003" || key.toLowerCase() === "q") {
          cleanup();
          return;
        }
        if (key.toLowerCase() === "r") {
          const fresh = await loadContext();
          await refreshScan(fresh);
          notice = "scanner refreshed";
        }
        if (key.toLowerCase() === "a") await askAiOnce();
        if (key.toLowerCase() === "o") await openTopCandidate();
        if (key.toLowerCase() === "c") await closeFirstPosition();
        if (key.toLowerCase() === "l") {
          showLogs = !showLogs;
          notice = showLogs ? "logs visible" : "logs hidden";
        }
        await draw();
      } catch (error) {
        notice = error.message;
        await draw();
      }
    };

    process.on("SIGINT", cleanup);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", onData);
    }
  });
}

async function main() {
  const handlers = {
    menu,
    status,
    scan,
    "ai:test": aiTest,
    decide,
    auto,
    providers,
    "add-provider": addProvider,
    "select-provider": selectProvider,
    "test-provider": testProvider,
    use: useProviderCommand,
    leaderboard,
    stats,
    memory: memoryCommand,
    coach: coachCommand,
    battle,
    positions,
    open,
    close,
    logs,
    watch
  };
  if (command === "help" || command === "--help" || command === "-h") {
    console.log(help());
    return;
  }
  const handler = handlers[command];
  if (!handler) {
    console.log(help());
    process.exitCode = 1;
    return;
  }
  await handler();
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
