import { age, money, pct, shortId, sol, usd } from "../core/format.js";
import { portfolioStats } from "../services/portfolio.js";
import { summarizeRisk } from "../core/risk.js";

const clear = "\x1b[3J\x1b[2J\x1b[H";
const hideCursor = "\x1b[?25l";
const showCursor = "\x1b[?25h";
const reset = "\x1b[0m";
const bold = "\x1b[1m";
const dim = "\x1b[2m";
const green = "\x1b[32m";
const red = "\x1b[31m";
const cyan = "\x1b[36m";
const yellow = "\x1b[33m";
const gray = "\x1b[90m";

export const logo = [
  " ____  ___ _____ _     ___  _    _ ",
  "|  _ \\|_ _|  ___| |   / _ \\| |  | |",
  "| |_) || || |_  | |  | | | | |  | |",
  "|  _ < | ||  _| | |__| |_| | |/\\| |",
  "|_| \\_\\___|_|   |_____\\___/ \\_/\\_/ "
].join("\n");

function stripAnsi(text) {
  return String(text).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
}

function pad(text, width) {
  const raw = stripAnsi(text);
  return raw.length >= width ? text : `${text}${" ".repeat(width - raw.length)}`;
}

function trim(text, width) {
  const raw = stripAnsi(text);
  if (raw.length <= width) return text;
  return `${raw.slice(0, Math.max(0, width - 3))}...`;
}

function colorNumber(value, rendered = money(value)) {
  return Number(value) >= 0 ? `${green}${rendered}${reset}` : `${red}${rendered}${reset}`;
}

function bar(value, width = 18) {
  const filled = Math.max(0, Math.min(width, Math.round((Number(value) / 100) * width)));
  return `[${"=".repeat(filled)}${"-".repeat(width - filled)}]`;
}

function box(title, lines, width = 58) {
  const inner = width - 4;
  const top = `+${"-".repeat(width - 2)}+`;
  const head = `| ${bold}${pad(title.toUpperCase(), inner)}${reset} |`;
  const body = lines.map((line) => `| ${pad(trim(line, inner), inner)} |`);
  return [top, head, `| ${" ".repeat(inner)} |`, ...body, top].join("\n");
}

function columns(left, right, gap = 2) {
  const a = left.split("\n");
  const b = right.split("\n");
  const width = Math.max(...a.map((line) => stripAnsi(line).length));
  const rows = Math.max(a.length, b.length);
  const out = [];
  for (let i = 0; i < rows; i++) {
    out.push(`${pad(a[i] || "", width)}${" ".repeat(gap)}${b[i] || ""}`);
  }
  return out.join("\n");
}

function kv(label, value, width = 18) {
  return `${gray}${pad(label, width)}${reset}${value}`;
}

function header(ctx) {
  const name = ctx.config.identity?.name || "Riflow";
  const mode = ctx.config.mode === "live" ? `${red}LIVE${reset}` : `${green}PAPER${reset}`;
  const ts = new Date().toLocaleTimeString();
  return [
    `${cyan}${bold}${logo}${reset}`,
    `${bold}${name.toUpperCase()}${reset} ${dim}AI paper trading CLI${reset}`,
    `${dim}${"-".repeat(84)}${reset}`,
    `${kv("mode", mode, 8)} ${kv("time", ts, 8)} ${kv("source", ctx.config.scanner?.source || "local", 8)}`
  ].join("\n");
}

export function renderHelp() {
  return [
    `${cyan}${bold}${logo}${reset}`,
    "",
    `${bold}Riflow${reset} ${dim}AI paper-trading lab for model battles${reset}`,
    "",
    `${bold}Usage${reset}`,
    `  ${cyan}riflow${reset} ${gray}<command>${reset} ${gray}[options]${reset}`,
    `  ${cyan}node src/cli.js${reset} ${gray}<command>${reset} ${gray}[options]${reset}`,
    "",
    `${bold}Essential commands${reset}`,
    `  ${cyan}status${reset}                 account, active model, paper PnL`,
    `  ${cyan}scan${reset}                   refresh token candidates`,
    `  ${cyan}screen${reset}                 hard filters -> screener AI -> critic -> dry-run executor`,
    `  ${cyan}meteora-scan${reset}           fetch real Meteora DLMM pools for paper screening`,
    `  ${cyan}dummy-run${reset}              paper-only runner using real pool data`,
    `  ${cyan}dummy-report${reset}           summarize real-pool paper performance`,
    `  ${cyan}trading-setup${reset}          configure daemon/risk/range settings interactively`,
    `  ${cyan}start-daemon${reset}           start paper daemon with saved setup`,
    `  ${cyan}daemon${reset}                 24/7 paper daemon with lock, heartbeat, backoff`,
    `  ${cyan}daemon-status${reset}          show current daemon heartbeat/status`,
    `  ${cyan}manage${reset}                 deterministic manager rules for open positions`,
    `  ${cyan}candidates${reset}             show hard-filtered candidates and rejects`,
    `  ${cyan}pnl${reset}                    show paper PnL summary`,
    `  ${cyan}watch${reset}                  open live terminal cockpit`,
    `  ${cyan}providers${reset}              list configured AI providers`,
    `  ${cyan}select-provider${reset}        choose active provider interactively`,
    `  ${cyan}test-provider${reset}          send "hello" to check provider key/model`,
    `  ${cyan}add-provider${reset}           add OpenAI, Gemini, Claude, OpenRouter, custom`,
    `  ${cyan}use${reset} ${gray}<providerId>${reset}      switch active provider`,
    `  ${cyan}leaderboard${reset}            rank providers by paper performance`,
    `  ${cyan}battle${reset} ${gray}--models a,b --rounds 10${reset}`,
    `  ${cyan}memory show${reset} ${gray}<modelId>${reset} show adaptive model memory`,
    `  ${cyan}memory reset${reset} ${gray}<modelId>${reset} clear adaptive model memory`,
    `  ${cyan}coach${reset} ${gray}<modelId> --last 7d${reset} review recent paper trades`,
    "",
    `${bold}Trading sandbox${reset}`,
    `  ${cyan}decide${reset}                 ask active provider for OPEN/CLOSE/WAIT`,
    `  ${cyan}auto${reset}                   run paper-only AI loop`,
    `  ${cyan}positions${reset}              list open paper positions`,
    `  ${cyan}open${reset} ${gray}<symbol> [sol]${reset}    manual paper open`,
    `  ${cyan}close${reset} ${gray}<id> [pnlPct]${reset}    manual paper close`,
    `  ${cyan}claim${reset} ${gray}[id]${reset}              dry-run/paper claim fees`,
    `  ${cyan}emergency-close${reset}        immediately close all open paper positions`,
    `  ${cyan}dry-run${reset} ${gray}on|off${reset}          toggle dry-run safety mode`,
    `  ${cyan}pause${reset} / ${cyan}resume${reset}          stop or resume execution gates`,
    `  ${cyan}reset all --yes${reset}         reset paper PnL, dummy logs, and memory`,
    `  ${cyan}lessons${reset} ${gray}[limit]${reset}         show closed-trade lessons`,
    `  ${cyan}decision-logs${reset} ${gray}[lines]${reset}   show structured decision logs`,
    `  ${cyan}logs${reset} ${gray}[lines]${reset}           show event log`,
    "",
    `${bold}Try next${reset}`,
    `  ${gray}$${reset} ${cyan}riflow providers${reset}`,
    `  ${gray}$${reset} ${cyan}riflow screen${reset}`,
    `  ${gray}$${reset} ${cyan}riflow dummy-run --source meteora-dlmm --rounds 3 --interval 30s${reset}`,
    `  ${gray}$${reset} ${cyan}riflow daemon --source meteora-dlmm --interval 5m --single-position --ai-timeout 120s${reset}`,
    `  ${gray}$${reset} ${cyan}riflow manage${reset}`,
    `  ${gray}$${reset} ${cyan}riflow battle --models mimo,mimo-fast --rounds 10${reset}`,
    `  ${gray}$${reset} ${cyan}riflow coach mimo --last 7d${reset}`,
    `  ${gray}$${reset} ${cyan}riflow memory show mimo${reset}`,
    `  ${gray}$${reset} ${cyan}riflow watch${reset}`,
    "",
    `${dim}No live trading exists in this build. All provider battles are paper-only.${reset}`
  ].join("\n");
}

export function renderStatus(ctx) {
  const stats = portfolioStats(ctx.state);
  const risk = summarizeRisk(ctx.config, ctx.state);
  const riskState = risk.canOpen ? `${green}ready${reset}` : `${yellow}blocked${reset}`;
  const provider = (ctx.config.llm?.providers || []).find((item) => item.id === ctx.config.llm?.activeProviderId);

  return [
    header(ctx),
    "",
    box("account", [
      kv("wallet", ctx.config.walletPublicKey ? shortId(ctx.config.walletPublicKey) : "not configured"),
      kv("provider", provider ? `${provider.id} / ${provider.model}` : "not configured"),
      kv("dry run", ctx.config.safety?.dryRun !== false ? `${green}on${reset}` : `${yellow}off${reset}`),
      kv("paused", ctx.config.safety?.paused || ctx.config.safety?.emergencyPause ? `${yellow}yes${reset}` : "no"),
      kv("paper balance", sol(ctx.state.paperBalanceSol)),
      kv("open slots", `${risk.openCount}/${ctx.config.risk.maxOpenPositions}`),
      kv("deployed", `${sol(stats.deployedSol)} / ${sol(risk.maxSol)}`),
      kv("risk state", riskState)
    ]),
    "",
    box("performance", [
      kv("realized pnl", colorNumber(stats.realizedPnlUsd)),
      kv("floating pnl", colorNumber(stats.floatingPnlUsd)),
      kv("session equity", colorNumber(stats.equityUsd)),
      kv("closed trades", String(stats.closed.length)),
      kv("winrate", stats.winrate == null ? "-" : pct(stats.winrate))
    ])
  ].join("\n");
}

export function renderPositions(ctx) {
  const rows = portfolioStats(ctx.state).open;
  if (!rows.length) return box("positions", [`${dim}No open positions. Press 'o' in watch mode to paper-open the top candidate.${reset}`]);
  return box("positions", [
    `${gray}${pad("ID", 12)} ${pad("SYMBOL", 8)} ${pad("SIZE", 10)} ${pad("PNL", 12)} ${pad("AGE", 6)}${reset}`,
    ...rows.map((position) => [
      pad(shortId(position.id, 11, 0), 12),
      pad(position.symbol, 8),
      pad(sol(position.sizeSol), 10),
      pad(colorNumber(position.pnlUsd, `${money(position.pnlUsd)} ${pct(position.pnlPct)}`), 12),
      pad(age(position.openedAt), 6)
    ].join(" "))
  ], 76);
}

export function renderScan(rows) {
  if (!rows.length) return box("scanner", [`${dim}No candidates yet. Press 'r' or run scan.${reset}`], 76);
  return box("scanner", [
    `${gray}${pad("SYMBOL", 8)} ${pad("SCORE", 25)} ${pad("LIQ", 10)} ${pad("VOL24H", 10)} ${pad("FLAGS", 16)}${reset}`,
    ...rows.slice(0, 10).map((row) => {
      const badge = row.score >= 80 ? green : row.score >= 65 ? yellow : gray;
      const flags = (row.flags || []).join(", ") || "-";
      return [
        pad(row.symbol, 8),
        `${badge}${pad(`${String(row.score).padStart(3)} ${bar(row.score, 14)}`, 25)}${reset}`,
        pad(usd(row.liquidityUsd), 10),
        pad(usd(row.volume24hUsd), 10),
        trim(flags, 16)
      ].join(" ");
    })
  ], 76);
}

export function renderTrades(ctx) {
  const closed = (ctx.state.closedTrades || []).slice(0, 6);
  if (!closed.length) return box("recent closes", [`${dim}No closed trades yet.${reset}`], 76);
  return box("recent closes", [
    `${gray}${pad("TRADE", 12)} ${pad("SYMBOL", 8)} ${pad("PNL", 14)} ${pad("CLOSED", 8)}${reset}`,
    ...closed.map((trade) => [
      pad(shortId(trade.id, 11, 0), 12),
      pad(trade.symbol, 8),
      pad(colorNumber(trade.pnlUsd, `${money(trade.pnlUsd)} ${pct(trade.pnlPct)}`), 14),
      pad(age(trade.closedAt), 8)
    ].join(" "))
  ], 76);
}

export function renderLogs(lines) {
  const body = lines.length ? lines.slice(-8).map((line) => trim(line, 72)) : [`${dim}No logs yet.${reset}`];
  return box("event log", body, 76);
}

export function renderWatch(ctx, logLines = [], notice = "") {
  const stats = portfolioStats(ctx.state);
  const risk = summarizeRisk(ctx.config, ctx.state);
  return clear + hideCursor + [
    `${cyan}${bold}${logo}${reset}`,
    `${bold}Riflow watch${reset} ${dim}paper-only live cockpit${reset}`,
    `${gray}mode${reset} ${green}PAPER${reset}  ${gray}balance${reset} ${sol(ctx.state.paperBalanceSol)}  ${gray}open${reset} ${risk.openCount}/${ctx.config.risk.maxOpenPositions}  ${gray}realized${reset} ${colorNumber(stats.realizedPnlUsd)}  ${gray}floating${reset} ${colorNumber(stats.floatingPnlUsd)}`,
    `${gray}keys${reset} ${cyan}r${reset} refresh  ${cyan}a${reset} ask-ai  ${cyan}o${reset} open-top  ${cyan}c${reset} close-first  ${cyan}l${reset} logs  ${cyan}q${reset} quit`,
    notice ? `${yellow}${notice}${reset}` : `${dim}waiting for input...${reset}`,
    "",
    `${bold}Positions${reset}`,
    renderPositionsPlain(ctx),
    "",
    `${bold}Scanner${reset}`,
    renderScanPlain(ctx.state.lastScan || []),
    "",
    `${bold}Recent closes${reset}`,
    renderTradesPlain(ctx),
    "",
    `${bold}Event log${reset}`,
    renderLogsPlain(logLines),
    "",
    `${dim}No live orders are sent.${reset}`
  ].join("\n");
}

export function restoreTerminal() {
  return showCursor + reset;
}

function renderPositionsPlain(ctx) {
  const rows = portfolioStats(ctx.state).open;
  if (!rows.length) return `${dim}  No open positions.${reset}`;
  return [
    `${gray}  ID           SYMBOL   SIZE       PNL             AGE${reset}`,
    ...rows.map((position) => `  ${pad(shortId(position.id, 11, 0), 12)} ${pad(position.symbol, 8)} ${pad(sol(position.sizeSol), 10)} ${pad(colorNumber(position.pnlUsd, `${money(position.pnlUsd)} ${pct(position.pnlPct)}`), 15)} ${age(position.openedAt)}`)
  ].join("\n");
}

function renderScanPlain(rows) {
  if (!rows.length) return `${dim}  No candidates yet. Press r to scan.${reset}`;
  return [
    `${gray}  SYMBOL   SCORE                  LIQ        VOL24H     FLAGS${reset}`,
    ...rows.slice(0, 10).map((row) => {
      const badge = row.score >= 80 ? green : row.score >= 65 ? yellow : gray;
      const flags = (row.flags || []).join(", ") || "-";
      return `  ${pad(row.symbol, 8)} ${badge}${pad(`${String(row.score).padStart(3)} ${bar(row.score, 12)}`, 22)}${reset} ${pad(usd(row.liquidityUsd), 10)} ${pad(usd(row.volume24hUsd), 10)} ${flags}`;
    })
  ].join("\n");
}

function renderTradesPlain(ctx) {
  const closed = (ctx.state.closedTrades || []).slice(0, 5);
  if (!closed.length) return `${dim}  No closed trades yet.${reset}`;
  return closed.map((trade) => `  ${pad(trade.symbol, 8)} ${pad(colorNumber(trade.pnlUsd, `${money(trade.pnlUsd)} ${pct(trade.pnlPct)}`), 15)} ${trade.providerId || "manual"} ${age(trade.closedAt)}`).join("\n");
}

function renderLogsPlain(lines) {
  if (!lines.length) return `${dim}  No logs yet.${reset}`;
  return lines.slice(-5).map((line) => `  ${trim(line, 110)}`).join("\n");
}
