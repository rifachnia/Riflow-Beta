#!/usr/bin/env node
import { loadContext, saveState } from "./core/context.js";
import fs from "node:fs/promises";
import { money, pct } from "./core/format.js";
import { summarizeRisk } from "./core/risk.js";
import { computeDeploySize } from "./core/sizing.js";
import { runScreenerScan } from "./agents/screener-agent.js";
import { reviewDecision } from "./agents/critic-agent.js";
import { evaluateManagerRules } from "./agents/manager-agent.js";
import { generalStatus } from "./agents/general-agent.js";
import { createPaperPosition, createPaperPositionFromCandidate, closePaperPosition, closePaperPositionWithMarketData, markPositionWithMarketData, openPositions } from "./services/portfolio.js";
import { scanMarket } from "./services/scanner.js";
import { decideNextAction } from "./services/agent.js";
import { chatText, hasAiConfig } from "./services/ai.js";
import { applyDecision } from "./services/auto-runner.js";
import { runCoach } from "./services/coach.js";
import { addLessonFromTrade, loadLessons } from "./services/lessons.js";
import { loadMemory, memoryFile, resetMemory, saveMemory } from "./services/memory.js";
import { loadPoolMemory, updatePoolMemoryFromDecision, updatePoolMemoryFromTrade } from "./services/pool-memory.js";
import { estimatePaperPnl } from "./services/meteora.js";
import { buildRange } from "./services/dlmm-strategy.js";
import { acquireRuntimeLock, readRuntimeStatus, writeRuntimeStatus } from "./services/runtime.js";
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
    { label: "Trading setup", hint: "choose interval, TP/SL, range, safety options", run: tradingSetup, noPause: true },
    { label: "Start paper daemon", hint: "run 24/7 paper loop with saved settings", run: startConfiguredDaemon, noPause: true },
    { label: "Daemon status", hint: "show live paper PnL and heartbeat", run: daemonStatus },
    { label: "Emergency close all", hint: "immediately close every open paper position", run: emergencyCloseAll },
    { label: "Reset PnL / paper", hint: "clear paper PnL, positions, dummy logs, memory", run: resetFromMenu, noPause: true },
    { label: "Watch cockpit", hint: "live interactive paper cockpit", run: () => watch({ returnToMenu: true }) },
    { label: "Scan candidates", hint: "refresh scanner snapshot", run: scan },
    { label: "Screen agent", hint: "hard filters -> AI -> critic -> dry-run executor", run: screen },
    { label: "Manage positions", hint: "deterministic manager safety rules", run: manage },
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
  const scan = await runScreenerScan(ctx);
  await saveState(ctx);
  await ctx.log.write("scan.completed", { count: scan.passed.length, filtered: scan.rejected.length, leader: scan.passed[0]?.symbol || null });
  if (hasFlag("json")) console.log(JSON.stringify(scan.passed, null, 2));
  else printCandidateTable(scan.passed);
  if (scan.rejected.length) console.log(`\n${dim}Hard filters rejected ${scan.rejected.length} candidates before AI.${reset}`);
}

async function screen() {
  const ctx = await loadContext();
  const provider = getProvider(ctx.config);
  const scan = await runScreenerScan(ctx);
  await saveState(ctx);
  if (!scan.passed.length) {
    const entry = await ctx.decisions.write({
      dry_run: ctx.config.safety?.dryRun !== false,
      agent_name: "Screener Agent",
      action_type: "SKIP",
      input_metrics: { raw: scan.raw.length, passed: 0, rejected: scan.rejected.length },
      reasoning_summary: "No candidates passed hard filters.",
      risk_notes: scan.rejected.slice(0, 5).flatMap((item) => item.hardFilter?.reasons || []),
      final_decision: { action: "SKIP" },
      execution_result: { simulated: true, skipped: true }
    });
    console.log(JSON.stringify(entry, null, 2));
    return;
  }

  let decision;
  try {
    decision = await decideNextAction(ctx, provider);
  } catch (error) {
    decision = {
      action: "SKIP",
      symbol: null,
      confidence: 0,
      reason: `AI unavailable: ${error.message}`,
      risk_level: "HIGH",
      providerId: provider.id,
      modelId: provider.model
    };
  }
  const critic = reviewDecision(ctx, decision, scan.passed);
  const candidate = scan.passed.find((item) => item.symbol === critic.finalDecision.symbol || item.poolAddress === critic.finalDecision.poolAddress);
  const result = await executeReviewedDecision(ctx, critic, candidate, provider);
  const entry = await ctx.decisions.write({
    dry_run: ctx.config.safety?.dryRun !== false,
    agent_name: "Critic/Risk Agent",
    action_type: mapActionType(critic.finalDecision.action),
    pool_address: candidate?.poolAddress || critic.finalDecision.poolAddress,
    token_address: candidate?.tokenAddress,
    symbol: candidate?.symbol || critic.finalDecision.symbol,
    input_metrics: candidate || { passed: scan.passed.length },
    memory_used: [memoryFile(provider.id), candidate?.poolAddress ? `memory/pools.json:${candidate.poolAddress}` : null].filter(Boolean),
    reasoning_summary: critic.reasoning_summary || critic.finalDecision.reason,
    confidence_score: critic.finalDecision.confidence,
    risk_notes: critic.riskNotes,
    final_decision: critic.finalDecision,
    execution_result: result
  });
  if (candidate) await updatePoolMemoryFromDecision(ctx, candidate, entry);
  console.log(JSON.stringify(entry, null, 2));
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

async function candidates() {
  const ctx = await loadContext();
  const rows = (await runScreenerScan(ctx)).passed;
  await saveState(ctx);
  if (hasFlag("json")) console.log(JSON.stringify(rows, null, 2));
  else printCandidateTable(rows);
  if (ctx.state.lastFilteredOut?.length) {
    console.log("\nFILTERED OUT");
    for (const item of ctx.state.lastFilteredOut.slice(0, 10)) {
      console.log(`${String(item.symbol).padEnd(8)} ${item.reasons.join("; ")}`);
    }
  }
}

async function meteoraScan() {
  const ctx = await loadContext();
  const oldSource = ctx.config.scanner.source;
  ctx.config.scanner.source = "meteora-dlmm";
  const scan = await runScreenerScan(ctx);
  ctx.config.scanner.source = oldSource;
  ctx.state.lastRawScan = scan.raw;
  ctx.state.lastScan = scan.passed;
  ctx.state.lastFilteredOut = scan.rejected.map((item) => ({
    symbol: item.symbol,
    poolAddress: item.poolAddress,
    reasons: item.hardFilter?.reasons || []
  }));
  await saveState(ctx);
  if (hasFlag("json")) {
    console.log(JSON.stringify(scan, null, 2));
    return;
  }
  printCandidateTable(scan.passed);
  console.log(`\nsource ${scan.source || "meteora-dlmm"} | passed ${scan.passed.length} | filtered ${scan.rejected.length}`);
  for (const item of scan.rejected.slice(0, 10)) {
    console.log(`${String(item.symbol || "-").padEnd(8)} ${(item.hardFilter?.reasons || []).join("; ")}`);
  }
}

async function pnl() {
  const ctx = await loadContext();
  const row = providerStats(ctx, ctx.config.llm.activeProviderId);
  console.log(JSON.stringify({
    provider: row.providerId,
    model: row.modelId,
    open: row.open.length,
    closed: row.closed.length,
    realizedPnlUsd: row.realizedPnlUsd,
    floatingPnlUsd: row.floatingPnlUsd,
    equityUsd: row.equityUsd,
    winrate: row.winrate,
    maxDrawdownUsd: row.maxDrawdownUsd
  }, null, 2));
}

async function manage() {
  const ctx = await loadContext();
  const evaluations = await evaluateManagerRules(ctx);
  if (!evaluations.length) {
    console.log("No open positions.");
    return;
  }

  const results = [];
  for (const item of evaluations) {
    let execution = { simulated: ctx.config.safety?.dryRun !== false, action: item.action, result: "held" };
    if (item.action === "CLAIM") execution = await claimPosition(ctx, item.position, item);
    if (item.action === "CLOSE") execution = await closePositionByRule(ctx, item.position, item);
    const entry = await ctx.decisions.write({
      dry_run: ctx.config.safety?.dryRun !== false,
      agent_name: "Manager Agent",
      action_type: item.action,
      pool_address: item.position.poolAddress || item.position.symbol,
      symbol: item.position.symbol,
      input_metrics: {
        pnlPct: item.position.pnlPct,
        pnlUsd: item.position.pnlUsd,
        claimableFeeUsd: item.claimableFeeUsd,
        outOfRangeMinutes: item.outOfRangeMinutes
      },
      reasoning_summary: item.reasons.join("; ") || "No deterministic close/claim rule triggered.",
      confidence_score: item.action === "HOLD" ? 65 : 100,
      risk_notes: item.reasons,
      final_decision: { action: item.action, positionId: item.position.id },
      execution_result: execution,
      pnl_result: item.action === "CLOSE" ? { pnlPct: item.position.pnlPct, pnlUsd: item.position.pnlUsd } : null,
      fee_result: { claimableFeeUsd: item.claimableFeeUsd }
    });
    results.push(entry);
  }
  console.log(JSON.stringify(results, null, 2));
}

async function dummyRun() {
  const ctx = await loadContext();
  const source = readFlag("source") || ctx.config.scanner.source || "meteora-dlmm";
  const rounds = Number(readFlag("rounds") || 0);
  const duration = readFlag("duration");
  const intervalMs = parseFlexibleDurationMs(readFlag("interval") || ctx.config.paperTrading?.daemonInterval || "30s");
  const maxRounds = rounds > 0 ? rounds : Math.max(1, Math.ceil(parseFlexibleDurationMs(duration || "5m") / intervalMs));
  const startingBalance = Number(ctx.state.paperBalanceSol || 0);
  const forceEntry = hasFlag("force-entry") || hasFlag("force-open") || Boolean(ctx.config.paperTrading?.forceEntry);
  const untilExit = hasFlag("until-exit");
  const singlePosition = hasFlag("single-position") || hasFlag("one-position") || Boolean(ctx.config.paperTrading?.singlePosition);
  applyManagementOverrides(ctx);
  applyScreeningOverrides(ctx);
  applyAiTimeoutOverride(ctx);
  let opened = 0;
  let closed = 0;
  let claimed = 0;
  ctx.config.scanner.source = source;
  ctx.config.safety ||= {};
  ctx.config.safety.dryRun = true;

  console.log(`${bold}Riflow dummy-run${reset} source=${source} rounds=${maxRounds} interval=${formatMs(intervalMs)} paperOnly=true forceEntry=${forceEntry} singlePosition=${singlePosition}`);
  console.log(`${dim}No transactions will be sent. Press Ctrl+C to stop.${reset}\n`);

  for (let round = 1; round <= maxRounds; round++) {
    console.log(`${cyan}[${new Date().toLocaleTimeString()}] round ${round}/${maxRounds}${reset} scanning pools...`);
    const scan = await runScreenerScan(ctx);
    await saveState(ctx);
    console.log(`  scan: ${green}${scan.passed.length} passed${reset}, ${scan.rejected.length} filtered (${scan.source || source})`);
    let decision;
    const provider = getProvider(ctx.config);
    const shouldSkipNewEntry = singlePosition && openPositions(ctx.state).length > 0;
    try {
      if (shouldSkipNewEntry) {
        decision = { action: "SKIP", reason: "single-position mode: open position exists, skipping new entry AI", confidence: 100 };
      } else {
        if (scan.passed.length) console.log(`  asking ${provider.id}/${provider.model} for paper decision...`);
        decision = scan.passed.length ? await decideNextAction(ctx, provider) : { action: "SKIP", reason: "no candidates passed hard filters", confidence: 0 };
      }
    } catch (error) {
      decision = { action: "SKIP", reason: `AI unavailable: ${error.message}`, confidence: 0, risk_level: "HIGH" };
    }
    console.log(`  decision: ${decision.action || "SKIP"} ${decision.symbol || ""} conf=${decision.confidence || 0} reason=${String(decision.reason || "").slice(0, 120)}`);
    if (forceEntry && openPositions(ctx.state).length === 0 && scan.passed.length && decision.action !== "OPEN") {
      const top = scan.passed[0];
      decision = {
        action: "OPEN",
        symbol: top.symbol,
        poolAddress: top.poolAddress,
        confidence: 100,
        reason: `forced paper-test entry into top hard-filtered candidate ${top.symbol}; original agent chose WAIT/SKIP`,
        risk_level: "MEDIUM",
        providerId: provider.id,
        modelId: provider.model
      };
      console.log(`  force-entry: overriding to OPEN ${top.symbol} for paper test only`);
    }
    const critic = reviewDecision(ctx, decision, scan.passed);
    const candidate = scan.passed.find((item) => item.symbol === critic.finalDecision.symbol || item.poolAddress === critic.finalDecision.poolAddress);
    if (critic.approved && critic.finalDecision.action === "OPEN" && candidate) {
      const position = await paperOpenDummy(ctx, candidate, critic.finalDecision, provider);
      opened++;
      await ctx.decisions.write(realPoolDecisionEntry("Screener Agent", "DEPLOY", candidate, critic, {
        simulated: true,
        result: "paper_opened",
        position
      }));
      console.log(`  opened paper position: ${position.symbol} ${position.sizeSol} SOL (${position.poolAddress})`);
    } else {
      await ctx.decisions.write(realPoolDecisionEntry("Critic/Risk Agent", mapActionType(critic.finalDecision.action), candidate, critic, {
        simulated: true,
        result: "skipped",
        reason: critic.riskNotes.join("; ") || critic.finalDecision.reason
      }));
      console.log(`  skipped: ${critic.riskNotes.join("; ") || critic.finalDecision.reason || "no action"}`);
    }

    console.log("  managing open positions...");
    const manageResults = await manageDummyRound(ctx);
    printManagerSummary(manageResults);
    closed += manageResults.closed;
    claimed += manageResults.claimed;
    console.log(`  manager: closed=${manageResults.closed} claimed=${manageResults.claimed}`);
    if (untilExit && opened > 0 && openPositions(ctx.state).length === 0) {
      console.log("  until-exit: position closed, stopping runner.");
      break;
    }
    if (round < maxRounds) await sleepWithProgress(intervalMs, `next round ${round + 1}/${maxRounds}`);
  }
  await saveState(ctx);
  const report = await buildDummyReport(ctx, startingBalance, { opened, closed, claimed });
  await appendEquityPoint(ctx, report);
  console.log(`\n${bold}Final dummy performance${reset}`);
  if (hasFlag("json")) console.log(JSON.stringify(report, null, 2));
  else printDummyReport(report);
}

async function dummyReport() {
  const ctx = await loadContext();
  const report = await buildDummyReport(ctx);
  if (hasFlag("json")) console.log(JSON.stringify(report, null, 2));
  else printDummyReport(report);
}

async function daemon() {
  let ctx = await loadContext();
  const source = readFlag("source") || ctx.config.scanner.source || "meteora-dlmm";
  const intervalMs = parseFlexibleDurationMs(readFlag("interval") || ctx.config.paperTrading?.daemonInterval || `${ctx.config.scanner?.refreshSeconds || 30}s`);
  const maxErrorBackoffMs = parseFlexibleDurationMs(readFlag("max-backoff") || "5m");
  const forceEntry = hasFlag("force-entry") || hasFlag("force-open") || Boolean(ctx.config.paperTrading?.forceEntry);
  const relaxed = hasFlag("relaxed") || hasFlag("paper-test") || Boolean(ctx.config.paperTrading?.relaxed);
  const singlePosition = hasFlag("single-position") || hasFlag("one-position") || Boolean(ctx.config.paperTrading?.singlePosition);
  applyAiTimeoutOverride(ctx);
  const releaseLock = await acquireRuntimeLock(ctx.root, "riflow-daemon");
  let stopping = false;
  let round = 0;
  let opened = 0;
  let closed = 0;
  let claimed = 0;
  let consecutiveErrors = 0;
  let stopRequested = false;

  const shutdown = async () => {
    if (stopRequested) return;
    stopRequested = true;
    stopping = true;
    await writeRuntimeStatus(ctx.root, { mode: "stopping", round, source, opened, closed, claimed });
    await releaseLock();
    process.stdout.write("\nRiflow daemon stopped cleanly.\n");
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  const onKey = async (key) => {
    const text = String(key || "").toLowerCase();
    if (text === "\u0003" || text === "q") await shutdown();
    if (text === "c") {
      console.log("\nEmergency close requested from daemon keyboard.");
      await emergencyCloseAll();
    }
  };
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", onKey);
  }

  console.log(`${bold}Riflow daemon${reset} source=${source} interval=${formatMs(intervalMs)} paperOnly=true forceEntry=${forceEntry} relaxed=${relaxed} singlePosition=${singlePosition}`);
  console.log(`${yellow}Live execution is not implemented. This daemon is paper/dry-run only.${reset}`);
  console.log(`${dim}Status file: data/runtime-status.json | q/Ctrl+C stop | c emergency close all.${reset}\n`);

  try {
    while (!stopping) {
      round++;
      ctx = await loadContext();
      ctx.config.scanner.source = source;
      ctx.config.safety ||= {};
      ctx.config.safety.dryRun = true;
      applyManagementOverrides(ctx);
      if (relaxed) applyScreeningOverrides(ctx);
      applyAiTimeoutOverride(ctx);

      await writeRuntimeStatus(ctx.root, {
        mode: "running",
        round,
        source,
        intervalMs,
        forceEntry,
        relaxed,
        opened,
        closed,
        claimed,
        consecutiveErrors,
        lastStep: "round-start"
      });

      try {
        console.log(`${cyan}[${new Date().toLocaleString()}] daemon round ${round}${reset} scanning pools...`);
        const result = await runDaemonRound(ctx, { source, forceEntry, singlePosition });
        opened += result.opened;
        closed += result.closed;
        claimed += result.claimed;
        consecutiveErrors = 0;
        console.log(`  summary: decision=${result.decision.action} opened=${result.opened} closed=${result.closed} claimed=${result.claimed} open=${result.openCount}`);
        await writeRuntimeStatus(ctx.root, {
          mode: "running",
          round,
          source,
          opened,
          closed,
          claimed,
          consecutiveErrors,
          lastDecision: result.decision,
          lastScan: result.scanSummary,
          openCount: result.openCount,
          performance: await buildDaemonPerformance(ctx),
          lastStep: "sleeping"
        });
        await appendEquityPoint(ctx, await buildDummyReport(ctx, null, { opened, closed, claimed }));
        await sleepWithProgress(intervalMs, `daemon round ${round + 1}`, () => stopping);
      } catch (error) {
        consecutiveErrors++;
        const backoff = Math.min(maxErrorBackoffMs, intervalMs * Math.max(1, consecutiveErrors));
        console.error(`  daemon error: ${error.message}`);
        await writeRuntimeStatus(ctx.root, {
          mode: "error-backoff",
          round,
          source,
          opened,
          closed,
          claimed,
          consecutiveErrors,
          lastError: error.message,
          backoffMs: backoff
        });
        await sleepWithProgress(backoff, `retry after error ${consecutiveErrors}`, () => stopping);
      }
    }
  } finally {
    if (process.stdin.isTTY) {
      process.stdin.off("data", onKey);
      process.stdin.setRawMode(false);
      process.stdin.pause();
    }
    await releaseLock();
  }
}

async function daemonStatus() {
  const ctx = await loadContext();
  const status = await readRuntimeStatus(ctx.root);
  console.log(JSON.stringify({
    ...status,
    performance: await buildDaemonPerformance(ctx)
  }, null, 2));
}

async function tradingSetup() {
  const readline = await import("node:readline/promises");
  const ctx = await loadContext();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log(`${bold}RIFLOW PAPER DAEMON SETUP${reset}`);
    console.log(`${dim}All execution remains paper-only. These settings power npm start -> Start paper daemon.${reset}\n`);
    const raw = await ctx.store.read("data/config.json", {});
    raw.paperTrading ||= {};
    raw.management ||= {};
    raw.strategy ||= {};
    raw.dlmm ||= {};
    raw.scanner ||= {};
    raw.sizing ||= {};
    raw.risk ||= {};

    raw.scanner.source = await ask(rl, "scanner source", raw.scanner.source || ctx.config.scanner.source || "meteora-dlmm");
    const balanceProfile = Number(await ask(rl, "planned starting wallet SOL", raw.paperTrading.startingBalanceSol ?? ctx.config.paperTrading.startingBalanceSol ?? 0.1));
    applyWalletProfile(raw, balanceProfile);
    raw.paperTrading.daemonInterval = await ask(rl, "daemon interval", raw.paperTrading.daemonInterval || ctx.config.paperTrading.daemonInterval || "1m");
    raw.paperTrading.singlePosition = await askBool(rl, "single position mode", raw.paperTrading.singlePosition ?? ctx.config.paperTrading.singlePosition ?? true);
    raw.paperTrading.forceEntry = await askBool(rl, "force paper entry for testing", raw.paperTrading.forceEntry ?? ctx.config.paperTrading.forceEntry ?? false);
    raw.paperTrading.relaxed = await askBool(rl, "relaxed filters for paper experiments", raw.paperTrading.relaxed ?? ctx.config.paperTrading.relaxed ?? false);
    raw.paperTrading.aiTimeout = await ask(rl, "AI timeout", raw.paperTrading.aiTimeout || ctx.config.paperTrading.aiTimeout || "120s");
    raw.management.takeProfitPct = Number(await ask(rl, "take profit %", raw.management.takeProfitPct ?? ctx.config.management.takeProfitPct ?? 25));
    raw.management.stopLossPct = Number(await ask(rl, "stop loss %", raw.management.stopLossPct ?? ctx.config.management.stopLossPct ?? -12));
    raw.management.minimumHoldMinutes = Number(await ask(rl, "minimum hold minutes", raw.management.minimumHoldMinutes ?? ctx.config.management.minimumHoldMinutes ?? 5));
    raw.management.claimFeeThresholdUsd = Number(await ask(rl, "claim fee threshold USD", raw.management.claimFeeThresholdUsd ?? ctx.config.management.claimFeeThresholdUsd ?? 2));
    raw.management.maxOutOfRangeMinutes = Number(await ask(rl, "max out-of-range minutes", raw.management.maxOutOfRangeMinutes ?? ctx.config.management.maxOutOfRangeMinutes ?? 30));
    raw.management.redeployOnOutOfRange = await askBool(rl, "redeploy on out-of-range if pool still strong", raw.management.redeployOnOutOfRange ?? ctx.config.management.redeployOnOutOfRange ?? true);
    raw.strategy.minCandidateScore = Number(await ask(rl, "minimum candidate score", raw.strategy.minCandidateScore ?? ctx.config.strategy.minCandidateScore ?? 70));
    raw.strategy.maxOpenPositions = Number(await ask(rl, "max open positions", raw.strategy.maxOpenPositions ?? ctx.config.strategy.maxOpenPositions ?? 2));
    raw.dlmm.rangeMode = await ask(rl, "DLMM range mode tight/balanced/wide", raw.dlmm.rangeMode || ctx.config.dlmm.rangeMode || "balanced");

    await ctx.store.write("data/config.json", raw);
    console.log(`\nSizing profile: balance=${raw.paperTrading.startingBalanceSol} SOL reserve=${raw.sizing.gasReserveSol} SOL min=${raw.sizing.minDeploySol} max=${raw.sizing.maxDeploySol} riskPct=${raw.sizing.defaultRiskPct}`);
    console.log(`\n${green}Saved.${reset} Next: choose "Start paper daemon" from npm start.`);
  } finally {
    rl.close();
  }
}

async function startConfiguredDaemon() {
  const ctx = await loadContext();
  const p = ctx.config.paperTrading || {};
  args.splice(0, args.length,
    "--source", ctx.config.scanner?.source || "meteora-dlmm",
    "--interval", p.daemonInterval || "1m",
    "--ai-timeout", p.aiTimeout || "120s"
  );
  if (p.singlePosition !== false) args.push("--single-position");
  if (p.forceEntry) args.push("--force-entry");
  if (p.relaxed) args.push("--relaxed");
  console.log(`${yellow}Starting paper daemon from saved setup. Press Ctrl+C to stop.${reset}\n`);
  return daemon();
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
  if (ctx.config.safety?.paused || ctx.config.safety?.emergencyPause) throw new Error("bot is paused");
  if (!risk.canOpen) throw new Error("risk rules block new positions");
  if (sizeSol < ctx.config.risk.deployMinSol || sizeSol > ctx.config.risk.deployMaxSol) {
    throw new Error(`size must be between ${ctx.config.risk.deployMinSol} and ${ctx.config.risk.deployMaxSol} SOL`);
  }

  const position = createPaperPosition(symbol, sizeSol, getProvider(ctx.config));
  if (ctx.config.safety?.dryRun !== false) {
    await ctx.decisions.write({
      dry_run: true,
      agent_name: "General Agent",
      action_type: "DEPLOY",
      symbol: position.symbol,
      reasoning_summary: "Manual open command in dry-run mode.",
      confidence_score: 100,
      final_decision: { action: "OPEN", symbol: position.symbol, sizeSol },
      execution_result: { simulated: true, result: "would_deploy", position }
    });
    console.log(`DRY-RUN would open ${position.symbol} paper position: ${position.id}`);
    return;
  }
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
  if (ctx.config.safety?.paused || ctx.config.safety?.emergencyPause) throw new Error("bot is paused");

  const position = openPositions(ctx.state).find((item) => item.id === id);
  if (!position) throw new Error(`open position not found: ${id}`);

  position.status = "closed";
  position.closedAt = new Date().toISOString();
  const trade = closePaperPosition(position, pnlPct, getProvider(ctx.config));
  trade.poolAddress = position.poolAddress || position.symbol;
  if (ctx.config.safety?.dryRun !== false) {
    await ctx.decisions.write({
      dry_run: true,
      agent_name: "General Agent",
      action_type: "CLOSE",
      pool_address: trade.poolAddress,
      symbol: trade.symbol,
      reasoning_summary: "Manual close command in dry-run mode.",
      confidence_score: 100,
      final_decision: { action: "CLOSE", positionId: id },
      execution_result: { simulated: true, result: "would_close", trade },
      pnl_result: { pnlPct: trade.pnlPct, pnlUsd: trade.pnlUsd }
    });
    position.status = "open";
    delete position.closedAt;
    console.log(`DRY-RUN would close ${position.symbol} at ${pct(trade.pnlPct)}: ${trade.id}`);
    return;
  }
  ctx.state.closedTrades.unshift(trade);
  ctx.state.paperBalanceSol = Number((ctx.state.paperBalanceSol + Number(position.sizeSol || 0)).toFixed(6));
  await saveState(ctx);
  await ctx.log.write("position.closed", { id, symbol: position.symbol, pnlPct: trade.pnlPct, providerId: trade.providerId, modelId: trade.modelId });
  const lesson = await addLessonFromTrade(ctx, trade, position);
  trade.lessonSummary = lesson.future_bias;
  await updatePoolMemoryFromTrade(ctx, trade);
  console.log(`Closed ${position.symbol} at ${pct(trade.pnlPct)}: ${trade.id}`);
}

async function claim() {
  const ctx = await loadContext();
  const id = args[0];
  const position = openPositions(ctx.state).find((item) => item.id === id) || openPositions(ctx.state)[0];
  if (!position) throw new Error("no open position to claim");
  const result = await claimPosition(ctx, position, { claimableFeeUsd: Number(args[1] || ctx.config.management.minClaimFeeUsd || 0) });
  await ctx.decisions.write({
    dry_run: ctx.config.safety?.dryRun !== false,
    agent_name: "General Agent",
    action_type: "CLAIM",
    pool_address: position.poolAddress || position.symbol,
    symbol: position.symbol,
    reasoning_summary: "Manual claim command.",
    confidence_score: 100,
    final_decision: { action: "CLAIM", positionId: position.id },
    execution_result: result,
    fee_result: { claimableFeeUsd: result.claimedFeeUsd || 0 }
  });
  console.log(JSON.stringify(result, null, 2));
}

async function emergencyCloseAll() {
  const ctx = await loadContext();
  const positions = openPositions(ctx.state);
  if (!positions.length) {
    console.log("No open paper positions to close.");
    return;
  }
  console.log(`${yellow}Emergency closing ${positions.length} open paper position(s).${reset}`);
  const forcedCtx = { ...ctx, config: { ...ctx.config, safety: { ...ctx.config.safety, dryRun: false, paused: false, emergencyPause: false } } };
  const results = [];
  for (const position of positions) {
    const execution = await closePositionByRule(forcedCtx, position, { reasons: ["manual emergency close"] });
    await ctx.decisions.write({
      dry_run: true,
      paperOnly: true,
      agent_name: "General Agent",
      action_type: "CLOSE",
      pool_address: position.poolAddress || position.symbol,
      symbol: position.symbol,
      reasoning_summary: "Manual emergency close all.",
      confidence_score: 100,
      risk_notes: ["manual emergency close"],
      final_decision: { action: "CLOSE", positionId: position.id },
      execution_result: execution,
      pnl_result: execution.trade ? { pnlPct: execution.trade.pnlPct, pnlUsd: execution.trade.pnlUsd } : null,
      fee_result: { estimatedFeesUsd: execution.trade?.estimatedFeesUsd || execution.trade?.feeUsd || 0 }
    });
    results.push(execution.trade);
  }
  console.log("Closed:");
  for (const trade of results) console.log(`  ${trade.symbol} ${trade.positionId} pnl=${pct(trade.pnlPct, 3)} ${money(trade.pnlUsd)} fees=${money(trade.feeUsd || trade.estimatedFeesUsd || 0)}`);
}

async function dryRunCommand() {
  const ctx = await loadContext();
  const value = String(args[0] || "status").toLowerCase();
  if (value === "on" || value === "true") await updateSafety(ctx, { dryRun: true });
  else if (value === "off" || value === "false") await updateSafety(ctx, { dryRun: false });
  const fresh = await loadContext();
  console.log(`DRY_RUN=${fresh.config.safety?.dryRun !== false}`);
}

async function pause() {
  const ctx = await loadContext();
  await updateSafety(ctx, { paused: true });
  console.log("Riflow paused. Screen/manage will skip execution.");
}

async function resume() {
  const ctx = await loadContext();
  await updateSafety(ctx, { paused: false, emergencyPause: false });
  console.log("Riflow resumed in paper/dry-run-safe mode.");
}

async function lessonsCommand() {
  const ctx = await loadContext();
  const data = await loadLessons(ctx);
  console.log(JSON.stringify((data.lessons || []).slice(0, Number(args[0] || 30)), null, 2));
}

async function decisionLogs() {
  const ctx = await loadContext();
  const rows = await ctx.decisions.tail(Number(args[0] || 30));
  console.log(JSON.stringify(rows, null, 2));
}

async function resetCommand() {
  const target = String(args[0] || "help").toLowerCase();
  if (target === "help" || !["paper", "memory", "logs", "all"].includes(target)) {
    console.log([
      "Usage:",
      "  riflow reset paper --yes [--balance 5]",
      "  riflow reset memory --yes",
      "  riflow reset logs --yes",
      "  riflow reset all --yes [--balance 5]",
      "",
      "This preserves config, providers, API keys, and .env."
    ].join("\n"));
    return;
  }
  if (!hasFlag("yes") && !hasFlag("confirm")) {
    throw new Error("reset requires --yes so this cannot be run by accident");
  }

  const ctx = await loadContext();
  await assertDaemonStopped(ctx);
  const changed = [];

  if (target === "paper" || target === "all") {
    await resetPaperState(ctx, Number(readFlag("balance") || 5));
    changed.push("paper state / PnL / positions / provider books");
  }
  if (target === "memory" || target === "all") {
    await resetMemoryArtifacts(ctx);
    changed.push("model memory / pool memory / lessons");
  }
  if (target === "logs" || target === "all") {
    await resetLogs(ctx);
    changed.push("event logs / decision logs / runtime status");
  }

  console.log(`Reset complete: ${changed.join(", ")}.`);
}

async function resetFromMenu() {
  const readline = await import("node:readline/promises");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log(`${bold}RESET RIFLOW PAPER DATA${reset}`);
    console.log(`${dim}Config, providers, API keys, and .env are preserved.${reset}\n`);
    console.log("1  Reset PnL only          positions, closed trades, provider books");
    console.log("2  Reset memory only       lessons, model memory, pool memory");
    console.log("3  Reset logs only         decision/event/runtime logs");
    console.log("4  Reset everything        PnL, memory, logs");
    console.log("5  Cancel\n");
    const choice = (await rl.question("Choose reset option: ")).trim();
    const map = { "1": "paper", "2": "memory", "3": "logs", "4": "all" };
    const target = map[choice];
    if (!target) {
      console.log("Cancelled.");
      return;
    }
    const balance = target === "paper" || target === "all"
      ? (await rl.question("starting paper balance SOL (5): ")).trim() || "5"
      : null;
    const confirm = (await rl.question(`Type RESET to confirm ${target}: `)).trim();
    if (confirm !== "RESET") {
      console.log("Cancelled.");
      return;
    }
    args.splice(0, args.length, target, "--yes");
    if (balance) args.push("--balance", balance);
    await resetCommand();
  } finally {
    rl.close();
  }
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

async function executeReviewedDecision(ctx, critic, candidate, provider) {
  const decision = critic.finalDecision;
  const dryRun = ctx.config.safety?.dryRun !== false;
  if (!critic.approved || decision.action === "SKIP" || decision.action === "HOLD" || decision.action === "WAIT") {
    return { dry_run: dryRun, simulated: true, result: "skipped", reason: critic.riskNotes.join("; ") || decision.reason };
  }
  if (decision.action === "OPEN") {
    const sizeSol = decision.sizeSol || computeDeploySize(ctx.config, ctx.state, decision.symbol);
    const position = candidate
      ? createPaperPositionFromCandidate(candidate, sizeSol, provider, ctx.config)
      : createPaperPosition(decision.symbol, sizeSol, provider);
    position.scoreAtOpen = candidate?.score ?? null;
    position.reason = decision.reason || "Screener Agent decision";
    position.aiConfidence = decision.confidence;
    if (dryRun) return { dry_run: true, simulated: true, result: "would_deploy", position };
    ctx.state.positions.push(position);
    ctx.state.paperBalanceSol = Number((ctx.state.paperBalanceSol - sizeSol).toFixed(6));
    await saveState(ctx);
    return { dry_run: false, simulated: false, result: "deployed_paper", position };
  }
  return { dry_run: dryRun, simulated: true, result: "no_executor_for_action", action: decision.action };
}

async function claimPosition(ctx, position, evaluation = {}) {
  const dryRun = ctx.config.safety?.dryRun !== false;
  const claimedFeeUsd = Number(evaluation.claimableFeeUsd || 0);
  if (dryRun) return { dry_run: true, simulated: true, result: "would_claim", positionId: position.id, claimedFeeUsd };
  position.claimedFeesUsd = Number((Number(position.claimedFeesUsd || 0) + claimedFeeUsd).toFixed(2));
  await saveState(ctx);
  return { dry_run: false, simulated: false, result: "claimed_paper_fee", positionId: position.id, claimedFeeUsd };
}

async function closePositionByRule(ctx, position, evaluation = {}) {
  const dryRun = ctx.config.safety?.dryRun !== false;
  const trade = position.source === "meteora-dlmm"
    ? await closePaperPositionWithMarketData(position, ctx.config, getProvider(ctx.config))
    : closePaperPosition(position, null, getProvider(ctx.config));
  trade.poolAddress = position.poolAddress || position.symbol;
  trade.reason = evaluation.reasons?.join("; ") || "manager rule";
  trade.feeUsd = Number(evaluation.claimableFeeUsd || 0);
  if (dryRun) return { dry_run: true, simulated: true, result: "would_close", trade };
  const livePosition = ctx.state.positions.find((item) => item.id === position.id) || position;
  livePosition.status = "closed";
  livePosition.closedAt = trade.closedAt;
  ctx.state.closedTrades.unshift(trade);
  ctx.state.paperBalanceSol = Number((ctx.state.paperBalanceSol + Number(position.sizeSol || 0)).toFixed(6));
  await saveState(ctx);
  const lesson = await addLessonFromTrade(ctx, trade, position);
  trade.lessonSummary = lesson.future_bias;
  await updatePoolMemoryFromTrade(ctx, trade);
  return { dry_run: false, simulated: false, result: "closed_paper", trade };
}

async function redeployPositionByRule(ctx, position, evaluation = {}) {
  const oldTrade = await closePaperPositionWithMarketData(position, ctx.config, getProvider(ctx.config));
  oldTrade.reason = evaluation.reasons?.join("; ") || "redeploy out-of-range";
  oldTrade.action = "REDEPLOY";
  const livePosition = ctx.state.positions.find((item) => item.id === position.id) || position;
  livePosition.status = "closed";
  livePosition.closedAt = oldTrade.closedAt;
  ctx.state.closedTrades.unshift(oldTrade);
  const currentCandidate = {
    ...position.initialMetrics,
    currentPrice: position.currentPrice || position.markPrice || position.entryPrice,
    activeBin: position.currentActiveBin ?? position.entryActiveBin,
    binStep: position.binStep,
    tvlUsd: position.currentTvlUsd ?? position.entryTvlUsd,
    activeTvlUsd: position.currentActiveTvlUsd ?? position.entryActiveTvlUsd,
    fees24hUsd: position.currentFees24hUsd ?? position.entryFees24hUsd,
    volume24hUsd: position.currentVolume24hUsd ?? position.entryVolume24hUsd
  };
  const next = {
    ...position,
    id: `pos_${Date.now().toString(36)}`,
    status: "open",
    openedAt: new Date().toISOString(),
    entryTimestamp: new Date().toISOString(),
    entryPrice: currentCandidate.currentPrice,
    entryActiveBin: currentCandidate.activeBin ?? null,
    entryTvlUsd: currentCandidate.tvlUsd ?? null,
    entryActiveTvlUsd: currentCandidate.activeTvlUsd ?? null,
    entryFees24hUsd: currentCandidate.fees24hUsd ?? null,
    entryVolume24hUsd: currentCandidate.volume24hUsd ?? null,
    estimatedFeesUsd: 0,
    claimableFeesUsd: 0,
    totalOutOfRangeMinutes: 0,
    outOfRangeSince: null,
    redeployCount: Number(position.redeployCount || 0) + 1,
    peakPnlPct: 0,
    maxDrawdownPct: 0,
    reason: oldTrade.reason,
    initialMetrics: currentCandidate,
    calculationMode: "approximate-dlmm",
    ...buildRange(currentCandidate, ctx.config)
  };
  ctx.state.positions.push(next);
  await saveState(ctx);
  await updatePoolMemoryFromTrade(ctx, oldTrade);
  return { dry_run: false, simulated: true, result: "redeployed_paper", trade: oldTrade, position: next };
}

async function paperOpenDummy(ctx, candidate, decision, provider) {
  const sizeSol = decision.sizeSol || computeDeploySize(ctx.config, ctx.state, candidate.symbol);
  const position = createPaperPositionFromCandidate(candidate, sizeSol, provider, ctx.config);
  position.reason = decision.reason || "dummy-run screener decision";
  position.aiConfidence = decision.confidence;
  position.scoreAtOpen = candidate.score;
  ctx.state.positions.push(position);
  ctx.state.paperBalanceSol = Number((ctx.state.paperBalanceSol - sizeSol).toFixed(6));
  await saveState(ctx);
  await updatePoolMemoryFromDecision(ctx, candidate, {
    timestamp: new Date().toISOString(),
    action_type: "DEPLOY",
    final_decision: decision,
    reasoning_summary: decision.reason,
    confidence_score: decision.confidence,
    execution_result: { result: "paper_opened", position }
  });
  return position;
}

async function manageDummyRound(ctx) {
  const evaluations = await evaluateManagerRules(ctx);
  let closed = 0;
  let claimed = 0;
  let held = 0;
  const summaries = [];
  for (const item of evaluations) {
    let execution = { simulated: true, result: "held" };
    const livePosition = ctx.state.positions.find((position) => position.id === item.position.id);
    if (livePosition) Object.assign(livePosition, item.position);
    if (item.action === "HOLD") held++;
    if (item.action === "CLAIM") {
      execution = await claimPosition({ ...ctx, config: { ...ctx.config, safety: { ...ctx.config.safety, dryRun: false } } }, item.position, item);
      claimed++;
    }
    if (item.action === "CLOSE") {
      execution = await closePositionByRule({ ...ctx, config: { ...ctx.config, safety: { ...ctx.config.safety, dryRun: false } } }, item.position, item);
      closed++;
    }
    if (item.action === "REDEPLOY") {
      execution = await redeployPositionByRule({ ...ctx, config: { ...ctx.config, safety: { ...ctx.config.safety, dryRun: false } } }, item.position, item);
      closed++;
    }
    await ctx.decisions.write({
      dry_run: true,
      source: item.position.source || "local-sim",
      calculationMode: item.position.calculationMode || "approximate",
      agent_name: "Manager Agent",
      action_type: item.action,
      pool_address: item.position.poolAddress || item.position.symbol,
      token_address: item.position.tokenAddress || item.position.baseMint || null,
      symbol: item.position.symbol,
      input_metrics: item.position,
      reasoning_summary: item.reasons.join("; ") || "manager hold",
      confidence_score: item.action === "HOLD" ? 65 : 100,
      risk_notes: item.reasons,
      final_decision: { action: item.action, positionId: item.position.id },
      execution_result: execution,
      pnl_result: execution.trade ? { pnlPct: execution.trade.pnlPct, pnlUsd: execution.trade.pnlUsd } : null,
      fee_result: { estimatedFeesUsd: execution.trade?.estimatedFeesUsd || item.claimableFeeUsd || 0 }
    });
    summaries.push({
      action: item.action,
      symbol: item.position.symbol,
      id: item.position.id,
      entryPrice: item.position.entryPrice,
      currentPrice: item.position.currentPrice || item.position.markPrice,
      pnlPct: item.position.pnlPct,
      pnlUsd: item.position.pnlUsd,
      estimatedFeesUsd: item.position.estimatedFeesUsd,
      claimableFeeUsd: item.claimableFeeUsd,
      ageMinutes: item.ageMinutes,
      reasons: item.reasons || []
    });
  }
  return { closed, claimed, held, summaries };
}

async function runDaemonRound(ctx, options = {}) {
  const provider = getProvider(ctx.config);
  const scan = await runScreenerScan(ctx);
  await saveState(ctx);
  console.log(`  scan: ${green}${scan.passed.length} passed${reset}, ${scan.rejected.length} filtered (${scan.source || options.source || ctx.config.scanner.source})`);

  let decision;
  const shouldSkipNewEntry = options.singlePosition && openPositions(ctx.state).length > 0;
  try {
    if (shouldSkipNewEntry) {
      decision = { action: "SKIP", reason: "single-position mode: open position exists, skipping new entry AI", confidence: 100 };
    } else {
      if (scan.passed.length) console.log(`  asking ${provider.id}/${provider.model} for paper decision...`);
      decision = scan.passed.length
        ? await decideNextAction(ctx, provider)
        : { action: "SKIP", reason: "no candidates passed hard filters", confidence: 0 };
    }
  } catch (error) {
    decision = { action: "SKIP", reason: `AI unavailable: ${error.message}`, confidence: 0, risk_level: "HIGH" };
  }

  if (options.forceEntry && openPositions(ctx.state).length === 0 && scan.passed.length && decision.action !== "OPEN") {
    const top = scan.passed[0];
    decision = {
      action: "OPEN",
      symbol: top.symbol,
      poolAddress: top.poolAddress,
      confidence: 100,
      reason: `forced paper-test entry into top hard-filtered candidate ${top.symbol}; original agent chose WAIT/SKIP`,
      risk_level: "MEDIUM",
      providerId: provider.id,
      modelId: provider.model
    };
    console.log(`  force-entry: overriding to OPEN ${top.symbol} for paper test only`);
  }

  console.log(`  decision: ${decision.action || "SKIP"} ${decision.symbol || ""} conf=${decision.confidence || 0} reason=${String(decision.reason || "").slice(0, 160)}`);
  const critic = reviewDecision(ctx, decision, scan.passed);
  const candidate = scan.passed.find((item) => item.symbol === critic.finalDecision.symbol || item.poolAddress === critic.finalDecision.poolAddress);
  let opened = 0;

  if (critic.approved && critic.finalDecision.action === "OPEN" && candidate) {
    const position = await paperOpenDummy(ctx, candidate, critic.finalDecision, provider);
    opened = 1;
    await ctx.decisions.write(realPoolDecisionEntry("Screener Agent", "DEPLOY", candidate, critic, {
      simulated: true,
      result: "paper_opened",
      position
    }));
    console.log(`  opened paper position: ${position.symbol} ${position.sizeSol} SOL (${position.poolAddress})`);
  } else {
    await ctx.decisions.write(realPoolDecisionEntry("Critic/Risk Agent", mapActionType(critic.finalDecision.action), candidate, critic, {
      simulated: true,
      result: "skipped",
      reason: critic.riskNotes.join("; ") || critic.finalDecision.reason
    }));
    console.log(`  skipped: ${critic.riskNotes.join("; ") || critic.finalDecision.reason || "no action"}`);
  }

  console.log("  managing open positions...");
  const managed = await manageDummyRound(ctx);
  printManagerSummary(managed);
  console.log(`  manager: held=${managed.held} closed=${managed.closed} claimed=${managed.claimed}`);
  return {
    opened,
    closed: managed.closed,
    claimed: managed.claimed,
    decision,
    scanSummary: { passed: scan.passed.length, filtered: scan.rejected.length, source: scan.source || ctx.config.scanner.source },
    openCount: openPositions(ctx.state).length
  };
}

function printManagerSummary(managed) {
  for (const item of managed.summaries || []) {
    const pnl = `${Number(item.pnlPct || 0).toFixed(3)}% / $${Number(item.pnlUsd || 0).toFixed(4)}`;
    const fees = `$${Number(item.estimatedFeesUsd ?? item.claimableFeeUsd ?? 0).toFixed(4)}`;
    const price = item.entryPrice != null || item.currentPrice != null
      ? ` entry=${formatPrice(item.entryPrice)} current=${formatPrice(item.currentPrice)}`
      : "";
    console.log(`    ${item.action} ${item.symbol} pnl=${pnl} fees=${fees} age=${item.ageMinutes ?? 0}m${price}`);
    const reason = (item.reasons || []).join("; ");
    if (reason) console.log(`      why: ${reason}`);
  }
}

function formatPrice(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  if (Math.abs(n) < 0.001) return n.toPrecision(6);
  return n.toFixed(6);
}

function printCandidateTable(rows) {
  if (!rows.length) {
    console.log("No candidates passed current filters.");
    return;
  }
  console.log("Rank Symbol     Pair              Score Quality   TVL        Volume     Fees       Fee/TVL Holders Risks");
  rows.forEach((row, index) => {
    const risks = [...(row.rejectReasons || []), ...(row.riskSignals || [])].slice(0, 2).join("; ") || "-";
    console.log([
      String(index + 1).padStart(4),
      String(row.symbol || "-").padEnd(10),
      String(row.pair || "-").padEnd(17),
      String(row.candidateScore ?? row.score ?? "-").padStart(5),
      String(row.qualityLabel || "-").padEnd(9),
      money(row.tvlUsd ?? row.liquidityUsd).padEnd(10),
      money(row.volume24hUsd).padEnd(10),
      money(row.fees24hUsd).padEnd(10),
      `${Number(row.feeTvlRatio ?? 0).toFixed(3)}%`.padEnd(7),
      String(row.holders ?? "-").padEnd(7),
      risks
    ].join(" "));
  });
}

function realPoolDecisionEntry(agentName, actionType, candidate, critic, execution) {
  const decision = critic.finalDecision || {};
  return {
    dry_run: true,
    source: candidate?.source || "meteora-dlmm",
    calculationMode: "approximate",
    agent_name: agentName,
    action_type: actionType,
    pool_address: candidate?.poolAddress || decision.poolAddress || null,
    token_address: candidate?.tokenAddress || candidate?.baseMint || null,
    symbol: candidate?.symbol || decision.symbol || null,
    input_metrics: candidate || {},
    memory_used: [candidate?.poolAddress ? `memory/pools.json:${candidate.poolAddress}` : null].filter(Boolean),
    reasoning_summary: decision.reason || critic.reasoning_summary,
    confidence_score: decision.confidence || 0,
    risk_notes: critic.riskNotes || [],
    final_decision: decision,
    execution_result: execution,
    pnl_result: execution?.trade ? { pnlPct: execution.trade.pnlPct, pnlUsd: execution.trade.pnlUsd } : null,
    fee_result: { estimatedFeesUsd: execution?.trade?.estimatedFeesUsd || 0 },
    entry_price: execution?.position?.entryPrice || null,
    current_price: execution?.trade?.currentPrice || null,
    entry_active_bin: execution?.position?.entryActiveBin || null,
    current_active_bin: execution?.trade?.currentActiveBin || null,
    warnings: candidate?.warnings || []
  };
}

async function buildDummyReport(ctx, startingBalance = null, counters = {}) {
  const open = openPositions(ctx.state);
  const marked = await Promise.all(open.map((position) => markPositionWithMarketData(position, ctx.config)));
  const closed = ctx.state.closedTrades || [];
  const realizedPnl = closed.reduce((sum, trade) => sum + Number(trade.pnlUsd || 0), 0);
  const floatingPnl = marked.reduce((sum, position) => sum + Number(position.pnlUsd || 0), 0);
  const feesEstimated = closed.reduce((sum, trade) => sum + Number(trade.estimatedFeesUsd || trade.feeUsd || 0), 0)
    + marked.reduce((sum, position) => sum + Number(position.estimatedFeesUsd || 0), 0);
  const wins = closed.filter((trade) => Number(trade.pnlUsd || 0) > 0);
  const losses = closed.filter((trade) => Number(trade.pnlUsd || 0) < 0);
  const sorted = [...closed].sort((a, b) => Number(b.pnlUsd || 0) - Number(a.pnlUsd || 0));
  const grossProfit = wins.reduce((sum, trade) => sum + Number(trade.pnlUsd || 0), 0);
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + Number(trade.pnlUsd || 0), 0));
  const averageWin = wins.length ? grossProfit / wins.length : 0;
  const averageLoss = losses.length ? grossLoss / losses.length : 0;
  const totalFees = feesEstimated;
  return {
    source: ctx.config.scanner?.source || "unknown",
    paperOnly: true,
    calculationMode: "approximate",
    startingBalance: startingBalance ?? null,
    endingPaperEquityUsd: Number(((Number(ctx.state.paperBalanceSol || 0) * 150) + realizedPnl + floatingPnl).toFixed(4)),
    realizedPnlUsd: Number(realizedPnl.toFixed(4)),
    floatingPnlUsd: Number(floatingPnl.toFixed(4)),
    feesEstimatedUsd: Number(feesEstimated.toFixed(4)),
    tradesOpened: counters.opened ?? open.length + closed.length,
    tradesClosed: counters.closed ?? closed.length,
    feesClaimed: counters.claimed ?? null,
    winrate: closed.length ? Number(((wins.length / closed.length) * 100).toFixed(2)) : null,
    profitFactor: grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(3)) : wins.length ? null : 0,
    averageWinUsd: Number(averageWin.toFixed(4)),
    averageLossUsd: Number(averageLoss.toFixed(4)),
    expectancyUsd: closed.length ? Number(((grossProfit - grossLoss) / closed.length).toFixed(4)) : 0,
    maxDrawdownUsd: maxDrawdown(closed),
    bestTrade: sorted[0] || null,
    worstTrade: sorted.at(-1) || null,
    averageHoldMinutes: average(closed.map((trade) => trade.durationMinutes ?? durationMinutesOf(trade.openedAt, trade.closedAt))),
    feeContributionPct: Math.abs(realizedPnl + floatingPnl) > 0 ? Number(((totalFees / Math.abs(realizedPnl + floatingPnl)) * 100).toFixed(2)) : null,
    outOfRangeEvents: closed.filter((trade) => Number(trade.outOfRangeMinutes || 0) > 0).length + marked.filter((position) => position.outOfRange).length,
    redeployCount: closed.filter((trade) => trade.action === "REDEPLOY").length + marked.reduce((sum, position) => sum + Number(position.redeployCount || 0), 0),
    openExposureSol: Number(marked.reduce((sum, position) => sum + Number(position.sizeSol || 0), 0).toFixed(4)),
    perSymbol: perSymbolPerformance([...closed, ...marked]),
    openPositions: marked
  };
}

function printDummyReport(report) {
  console.log(`${bold}RIFLOW DUMMY REPORT${reset}`);
  console.log(`source=${report.source} mode=paper calculation=${report.calculationMode}`);
  console.log(`equity=${money(report.endingPaperEquityUsd)} realized=${money(report.realizedPnlUsd)} floating=${money(report.floatingPnlUsd)} fees=${money(report.feesEstimatedUsd)}`);
  console.log(`trades opened=${report.tradesOpened} closed=${report.tradesClosed} winrate=${report.winrate ?? "-"}% profitFactor=${report.profitFactor ?? "-"} expectancy=${money(report.expectancyUsd)}`);
  console.log(`drawdown=${money(report.maxDrawdownUsd)} avgHold=${report.averageHoldMinutes}m feeContribution=${report.feeContributionPct ?? "-"}% redeploys=${report.redeployCount}`);
  if (report.openPositions?.length) {
    console.log("\nOPEN POSITIONS");
    for (const position of report.openPositions) {
      console.log(`${position.id} ${position.symbol} pnl=${Number(position.pnlPct || 0).toFixed(3)}%/${money(position.pnlUsd)} fees=${money(position.estimatedFeesUsd || 0)} range=${position.outOfRange ? "OUT" : "in"} ${position.poolAddress || ""}`);
    }
  }
  if (report.bestTrade) console.log(`\nbest=${report.bestTrade.symbol} ${Number(report.bestTrade.pnlPct || 0).toFixed(3)}% ${money(report.bestTrade.pnlUsd)}`);
  if (report.worstTrade) console.log(`worst=${report.worstTrade.symbol} ${Number(report.worstTrade.pnlPct || 0).toFixed(3)}% ${money(report.worstTrade.pnlUsd)}`);
}

async function appendEquityPoint(ctx, report) {
  const file = ctx.config.analytics?.equityCurveFile || "data/equity-curve.json";
  const data = await ctx.store.read(file, { points: [] });
  data.points ||= [];
  data.points.push({
    timestamp: new Date().toISOString(),
    equityUsd: report.endingPaperEquityUsd,
    realizedPnlUsd: report.realizedPnlUsd,
    floatingPnlUsd: report.floatingPnlUsd,
    feesUsd: report.feesEstimatedUsd,
    openPositions: report.openPositions?.length || 0
  });
  data.points = data.points.slice(-Number(ctx.config.analytics?.maxPoints || 5000));
  await ctx.store.write(file, data);
}

async function buildDaemonPerformance(ctx) {
  const open = await Promise.all(openPositions(ctx.state).map((position) => markPositionWithMarketData(position, ctx.config)));
  const closed = ctx.state.closedTrades || [];
  const realizedPnlUsd = closed.reduce((sum, trade) => sum + Number(trade.pnlUsd || 0), 0);
  const floatingPnlUsd = open.reduce((sum, position) => sum + Number(position.pnlUsd || 0), 0);
  const estimatedFeesUsd = open.reduce((sum, position) => sum + Number(position.estimatedFeesUsd || 0), 0);
  return {
    realizedPnlUsd: Number(realizedPnlUsd.toFixed(4)),
    floatingPnlUsd: Number(floatingPnlUsd.toFixed(4)),
    estimatedOpenFeesUsd: Number(estimatedFeesUsd.toFixed(4)),
    openCount: open.length,
    closedCount: closed.length,
    openPositions: open.map((position) => ({
      id: position.id,
      symbol: position.symbol,
      poolAddress: position.poolAddress,
      sizeSol: position.sizeSol,
      pnlPct: position.pnlPct,
      pnlUsd: position.pnlUsd,
      estimatedFeesUsd: position.estimatedFeesUsd,
      calculationMode: position.calculationMode,
      entryPrice: position.entryPrice,
      currentPrice: position.currentPrice,
      entryActiveBin: position.entryActiveBin ?? null,
      currentActiveBin: position.currentActiveBin ?? null,
      warnings: position.warnings || []
    }))
  };
}

function maxDrawdown(trades) {
  let equity = 0;
  let peak = 0;
  let dd = 0;
  for (const trade of [...trades].reverse()) {
    equity += Number(trade.pnlUsd || 0);
    peak = Math.max(peak, equity);
    dd = Math.min(dd, equity - peak);
  }
  return Number(dd.toFixed(4));
}

function average(values) {
  const rows = values.map(Number).filter((value) => Number.isFinite(value));
  return rows.length ? Number((rows.reduce((sum, value) => sum + value, 0) / rows.length).toFixed(2)) : 0;
}

function durationMinutesOf(start, end) {
  return Math.max(0, Math.round((new Date(end || Date.now()).getTime() - new Date(start || Date.now()).getTime()) / 60000));
}

function perSymbolPerformance(rows) {
  const map = {};
  for (const row of rows) {
    const symbol = row.symbol || "UNKNOWN";
    map[symbol] ||= { trades: 0, pnlUsd: 0, feesUsd: 0, wins: 0 };
    map[symbol].trades++;
    map[symbol].pnlUsd += Number(row.pnlUsd || 0);
    map[symbol].feesUsd += Number(row.feeUsd || row.estimatedFeesUsd || 0);
    if (Number(row.pnlUsd || 0) > 0) map[symbol].wins++;
  }
  return Object.fromEntries(Object.entries(map).map(([symbol, row]) => [symbol, {
    trades: row.trades,
    pnlUsd: Number(row.pnlUsd.toFixed(4)),
    feesUsd: Number(row.feesUsd.toFixed(4)),
    winrate: row.trades ? Number(((row.wins / row.trades) * 100).toFixed(2)) : null
  }]));
}

async function updateSafety(ctx, patch) {
  const rawConfig = await ctx.store.read("data/config.json", {});
  rawConfig.safety ||= {};
  Object.assign(rawConfig.safety, patch);
  await ctx.store.write("data/config.json", rawConfig);
}

async function resetPaperState(ctx, balanceSol) {
  const balance = Number.isFinite(balanceSol) && balanceSol >= 0 ? balanceSol : 5;
  ctx.state.startedAt = new Date().toISOString();
  ctx.state.paperBalanceSol = balance;
  ctx.state.positions = [];
  ctx.state.closedTrades = [];
  ctx.state.lastScan = [];
  ctx.state.lastRawScan = [];
  ctx.state.lastFilteredOut = [];
  ctx.state.battleHistory = [];
  ctx.state.providerBooks = {};
  for (const provider of ctx.config.llm?.providers || []) {
    ctx.state.providerBooks[provider.id] = {
      paperBalanceSol: balance,
      positions: [],
      closedTrades: []
    };
  }
  await saveState(ctx);
}

async function resetMemoryArtifacts(ctx) {
  await ctx.store.write("memory/lessons.json", { lessons: [] });
  await ctx.store.write("memory/pools.json", {});
  const memoryDir = ctx.store.resolve("memory");
  await fs.mkdir(memoryDir, { recursive: true });
  const files = await fs.readdir(memoryDir).catch(() => []);
  const ids = new Set((ctx.config.llm?.providers || []).map((provider) => provider.id));
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    if (file === "lessons.json" || file === "pools.json") continue;
    ids.add(file.replace(/\.json$/i, ""));
  }
  for (const id of ids) await resetMemory(ctx, id);
}

async function resetLogs(ctx) {
  await fs.mkdir(ctx.store.resolve("logs"), { recursive: true });
  await fs.writeFile(ctx.store.resolve("logs/decisions.jsonl"), "", "utf8");
  await fs.writeFile(ctx.store.resolve("logs/riflow.log"), "", "utf8");
  await fs.rm(ctx.store.resolve("data/runtime-status.json"), { force: true });
  await fs.rm(ctx.store.resolve("data/riflow-daemon.lock.json"), { force: true });
}

async function assertDaemonStopped(ctx) {
  const status = await readRuntimeStatus(ctx.root);
  if (status?.pid && isProcessAlive(status.pid)) {
    throw new Error(`daemon is still running with pid ${status.pid}. Stop it first, or run: Stop-Process -Id ${status.pid}`);
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

function mapActionType(action) {
  const value = String(action || "SKIP").toUpperCase();
  if (value === "OPEN") return "DEPLOY";
  if (value === "WAIT") return "HOLD";
  return ["DEPLOY", "SKIP", "HOLD", "CLAIM", "CLOSE", "REDEPLOY"].includes(value) ? value : "SKIP";
}

function readFlag(name) {
  const prefix = `--${name}=`;
  const inline = args.find((item) => item.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : null;
}

function hasFlag(name) {
  return args.includes(`--${name}`);
}

function applyManagementOverrides(ctx) {
  ctx.config.management ||= {};
  const takeProfit = readFlag("take-profit");
  const stopLoss = readFlag("stop-loss");
  const minAge = readFlag("min-age");
  if (takeProfit != null) ctx.config.management.takeProfitPct = Number(takeProfit);
  if (stopLoss != null) ctx.config.management.stopLossPct = Number(stopLoss);
  if (minAge != null) ctx.config.management.minPositionAgeMinutes = Number(minAge);
}

function applyScreeningOverrides(ctx) {
  ctx.config.screening ||= {};
  if (hasFlag("relaxed") || hasFlag("paper-test")) {
    Object.assign(ctx.config.screening, {
      minTvlUsd: 0,
      maxTvlUsd: 10_000_000,
      minVolumeUsd: 0,
      minHolders: 0,
      minOrganicScore: 0,
      minBinStep: 0,
      maxBinStep: 10_000,
      maxTopHolderPct: 100,
      requireCompleteData: false,
      blockedWarnings: []
    });
  }
}

function applyAiTimeoutOverride(ctx) {
  const timeout = readFlag("ai-timeout") || readFlag("timeout") || ctx.config.paperTrading?.aiTimeout;
  if (!timeout) return;
  ctx.config.llm ||= {};
  ctx.config.llm.requestTimeoutMs = parseFlexibleDurationMs(timeout);
}

async function ask(rl, label, fallback) {
  const answer = (await rl.question(`${label} (${fallback}): `)).trim();
  return answer || fallback;
}

async function askBool(rl, label, fallback) {
  const suffix = fallback ? "Y/n" : "y/N";
  const answer = (await rl.question(`${label} (${suffix}): `)).trim().toLowerCase();
  if (!answer) return Boolean(fallback);
  return ["y", "yes", "true", "1", "on"].includes(answer);
}

function applyWalletProfile(raw, balanceSol) {
  const balance = Math.max(0, Number(balanceSol || 0.1));
  raw.paperTrading.startingBalanceSol = Number(balance.toFixed(4));
  if (balance <= 0.15) {
    Object.assign(raw.sizing, {
      gasReserveSol: 0.02,
      minDeploySol: 0.02,
      maxDeploySol: 0.04,
      defaultRiskPct: 0.35,
      maxExposurePerTokenSol: 0.04
    });
    raw.risk.deployMinSol = 0.02;
    raw.risk.deployMaxSol = 0.04;
    raw.risk.maxOpenPositions = 1;
    raw.strategy.maxOpenPositions = 1;
    raw.strategy.maxExposurePerTokenUsd = 6;
    raw.strategy.maxExposurePerPoolUsd = 6;
    return;
  }
  if (balance <= 0.5) {
    Object.assign(raw.sizing, {
      gasReserveSol: 0.03,
      minDeploySol: 0.04,
      maxDeploySol: 0.08,
      defaultRiskPct: 0.25,
      maxExposurePerTokenSol: 0.08
    });
    raw.risk.deployMinSol = 0.04;
    raw.risk.deployMaxSol = 0.08;
    raw.risk.maxOpenPositions = 2;
    raw.strategy.maxOpenPositions = 2;
    raw.strategy.maxExposurePerTokenUsd = 12;
    raw.strategy.maxExposurePerPoolUsd = 12;
    return;
  }
  Object.assign(raw.sizing, {
    gasReserveSol: 0.08,
    minDeploySol: 0.08,
    maxDeploySol: Math.min(0.25, Math.max(0.1, balance * 0.2)),
    defaultRiskPct: 0.18,
    maxExposurePerTokenSol: Math.min(0.25, Math.max(0.1, balance * 0.2))
  });
  raw.risk.deployMinSol = raw.sizing.minDeploySol;
  raw.risk.deployMaxSol = raw.sizing.maxDeploySol;
  raw.risk.maxOpenPositions = 2;
  raw.strategy.maxOpenPositions = 2;
  raw.strategy.maxExposurePerTokenUsd = Number((raw.sizing.maxExposurePerTokenSol * 150).toFixed(2));
  raw.strategy.maxExposurePerPoolUsd = raw.strategy.maxExposurePerTokenUsd;
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

function parseFlexibleDurationMs(value) {
  const match = String(value || "").trim().match(/^(\d+)\s*([smhd])$/i);
  if (!match) throw new Error("duration must look like 30s, 5m, 2h, or 1d");
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === "s") return amount * 1000;
  if (unit === "m") return amount * 60 * 1000;
  if (unit === "h") return amount * 60 * 60 * 1000;
  return amount * 24 * 60 * 60 * 1000;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

async function sleepWithProgress(ms, label, shouldStop = () => false) {
  const started = Date.now();
  const tick = Math.min(30000, Math.max(1000, Math.floor(ms / 5)));
  while (Date.now() - started < ms && !shouldStop()) {
    const remaining = Math.max(0, ms - (Date.now() - started));
    process.stdout.write(`  waiting ${formatMs(remaining)} until ${label}...\r`);
    await sleep(Math.min(tick, remaining));
  }
  process.stdout.write(`${" ".repeat(80)}\r`);
}

function formatMs(ms) {
  const total = Math.ceil(Number(ms || 0) / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes <= 0) return `${seconds}s`;
  if (seconds === 0) return `${minutes}m`;
  return `${minutes}m${String(seconds).padStart(2, "0")}s`;
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
    "meteora-scan": meteoraScan,
    screen,
    manage,
    "dummy-run": dummyRun,
    "dummy-report": dummyReport,
    daemon,
    "trading-setup": tradingSetup,
    "start-daemon": startConfiguredDaemon,
    "daemon-status": daemonStatus,
    candidates,
    pnl,
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
    claim,
    "dry-run": dryRunCommand,
    dryrun: dryRunCommand,
    pause,
    resume,
    "emergency-close": emergencyCloseAll,
    "close-all": emergencyCloseAll,
    reset: resetCommand,
    "reset-dummy": () => withArgs(["all", "--yes"], resetCommand),
    "reset-paper": () => withArgs(["paper", "--yes"], resetCommand),
    lessons: lessonsCommand,
    "decision-logs": decisionLogs,
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
