# Riflow Trade

Riflow is a CLI trading agent shell. It is intentionally organized as its own project: different command shape, different module layout, different state model, and a terminal-oriented operator experience.

This first version is paper-mode by default. It gives you the core workflow without copying another dashboard:

- `status` shows wallet, risk, PnL, and open exposure.
- `watch` opens an interactive terminal cockpit.
- `scan` produces scored token candidates from a local scanner adapter.
- `positions` lists active positions.
- `open <symbol>` creates a paper position.
- `close <id>` closes a paper position.
- `logs` tails the local event log.

## Run

```bash
cd /d E:\riflowtrade
npm run status
npm run scan
npm start
```

Or run commands directly:

```bash
node src/cli.js status
node src/cli.js watch
node src/cli.js open FLOW 0.25
node src/cli.js close pos_...
```

To use the shorter `riflow` command from this folder, link it once:

```bash
npm link
riflow providers
```

## AI Mode

Riflow talks to Xiaomi MiMo through an OpenAI-compatible endpoint. The default config points to the local Riflow proxy:

```bash
cd /d E:\riflowtrade
npm run mimo:proxy
```

Then from Riflow:

```bash
node src/cli.js ai:test
node src/cli.js decide
node src/cli.js auto
```

`auto` is paper-only in this build. It asks AI for `OPEN`, `CLOSE`, or `WAIT`, then applies risk gates before changing the paper portfolio.

If `ai:test` returns `API key required`, the current upstream/gateway credential is not accepted. The AI integration is already wired; update `LLM_BASE_URL` and `LLM_API_KEY` in `.env` or `data/config.json`.

## Adaptive Trader Memory

Riflow gives each configured AI trader its own local memory file under `memory/`, such as:

```text
memory/mimo.json
memory/gemini.json
memory/openai.json
memory/claude.json
```

The model does not permanently learn by itself. Riflow stores lessons, avoid/prefer patterns, confidence adjustments, risk improvements, and performance snapshots locally, then injects that memory into future paper-trading prompts.

The shared trader prompt includes portfolio summary, open positions, scanner candidates, performance summary, lessons learned, recent decisions, model-specific memory, risk config, and auto-trade config. The model must return strict JSON only:

```json
{
  "action": "OPEN|CLOSE|WAIT",
  "symbol": "optional",
  "confidence": 0,
  "reason": "concise explanation",
  "risk_level": "LOW|MEDIUM|HIGH"
}
```

The prompt always tells providers to preserve capital first, prefer `WAIT` when uncertain, avoid overtrading, never assume missing data, and use only provided data. There is no live trading in this build.

## Performance Coach

The coach reviews recent closed paper trades and recent AI decisions for one provider/model, then consolidates new lessons into that model's memory.

```bash
riflow coach mimo --last 7d
riflow coach mimo --trades 50
riflow memory show mimo
riflow memory reset mimo
riflow memory export mimo
riflow memory import mimo ./backup-memory.json
```

Example workflow:

```bash
riflow use mimo
riflow scan
riflow auto
riflow coach mimo --last 7d
riflow memory show mimo
```

Memory consolidation removes duplicates, keeps actionable rules, caps active lessons to 20 per section, and prioritizes rules backed by PnL, winrate, or drawdown signals.

## Multi-Provider Leaderboard

Configured providers live in `data/config.json` under `llm.providers`.

```bash
riflow providers
riflow select-provider
riflow test-provider
riflow add-provider
riflow use mimo
riflow leaderboard
riflow stats mimo
riflow battle --models mimo,mimo-fast --rounds 10
riflow coach mimo --last 7d
riflow memory show mimo
```

Battle mode is paper-only. Each model receives the same scanner snapshot per round, then gets an independent paper book under `state.providerBooks`. Every position and closed trade stores `providerId` and `modelId`.

Inside `watch`:

```text
r refresh scanner
o open the top scanner candidate
c close the first open position
l toggle event log panel
q quit
```

## Design Direction

The app is built around a terminal product rather than a web dashboard. The folder structure separates core rules, storage, services, and UI:

- `src/core`: context, formatting, risk math
- `src/io`: JSON store and logging
- `src/prompts`: shared trader, coach, and memory prompt builders
- `src/services`: scanner and portfolio logic
- `memory`: model-specific adaptive memory files
- `src/ui`: terminal screen rendering

Live trading adapters can be added later under `src/services` without changing the operator commands.
