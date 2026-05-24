# Riflow Beta

AI-Powered Paper Trading CLI

Riflow is a terminal-based trading research and paper-trading platform that allows multiple AI models to act as independent traders.

Instead of relying on a single model, Riflow lets you compare Claude, Gemini, GPT, MiMo, DeepSeek, and other LLMs under the same market conditions.

Each AI trader maintains its own memory, performance history, and lessons learned over time.

> ⚠️ Current Status: Paper Trading Only
>
> Live trading is NOT implemented.
> No real funds are used.
> Riflow is currently focused on simulation, evaluation, and AI benchmarking.

---

## Features

### AI Trading Agents

Supports multiple providers:

- Claude
- Gemini
- OpenAI
- OpenRouter
- MiMo
- Compatible OpenAI-style endpoints

Each model can act as an independent trader.

---

### Paper Trading

Execute simulated trades without risking capital.

- OPEN
- CLOSE
- WAIT

All positions are virtual.

---

### Scanner

Analyze opportunities and generate trade candidates based on market data.

Scanner output is passed into the AI decision engine.

---

### Adaptive Memory System

Every AI trader has its own memory.

Example:

```text
memory/
├── claude.json
├── gemini.json
├── openai.json
└── mimo.json
```

Memory stores:

- Lessons learned
- Preferred patterns
- Avoid patterns
- Confidence adjustments
- Risk improvements

Models do not permanently learn.

Instead, Riflow injects memory back into future prompts to create adaptive behavior.

---

### Performance Coach

Riflow includes a reflection system that reviews historical trades.

The coach identifies:

- Recurring mistakes
- Successful patterns
- Strong market conditions
- Weak market conditions
- New trading rules

Generated lessons are stored in model memory.

---

### Shared Prompt Engine

All providers use the same prompt structure.

This ensures fair comparison between models.

Example:

```text
Claude
Gemini
GPT
MiMo
```

receive the same:

- Portfolio
- Market data
- Scanner output
- Performance summary
- Lessons learned
- Memory

This makes benchmarking more meaningful.

---

## Current Architecture

```text
Scanner
    ↓
Market Snapshot
    ↓
Prompt Builder
    ↓
AI Trader
    ↓
Decision
    ↓
Paper Trade
    ↓
Performance Tracking
    ↓
Coach Review
    ↓
Memory Update
    ↓
Next Trading Session
```

---

## Commands

### Run

```bash
riflow run
```

### Paper Trading

```bash
riflow run --paper
```

### Show Memory

```bash
riflow memory show claude
```

### Reset Memory

```bash
riflow memory reset claude
```

### Coach Review

Last 7 days:

```bash
riflow coach claude --last 7d
```

Last 50 trades:

```bash
riflow coach claude --trades 50
```

---

## Philosophy

Riflow is not trying to predict markets with a magical prompt.

The goal is to build a framework where AI models can:

1. Make trading decisions
2. Track performance
3. Analyze mistakes
4. Generate lessons
5. Improve future decision quality through memory

The model itself does not learn.

The system learns.

---

## Roadmap

### Completed

- CLI/TUI
- AI Integration Layer
- MiMo Proxy Support
- Scanner
- Paper Trading
- Position Management
- State Persistence
- Adaptive Memory
- Performance Coach
- Shared Prompt Engine

### In Progress

- Multi-model Leaderboards
- Strategy Comparison
- Backtesting Framework
- Battle Mode

### Planned

- Portfolio Analytics
- Risk Dashboards
- Market Regime Detection
- Strategy Marketplace

### Not Yet Implemented

- Live Trading
- Exchange Execution
- Real Capital Deployment

---

## Safety

Riflow currently operates in paper-trading mode only.

No exchange orders are submitted.

No real capital is used.

Always verify results independently.

---

## License

MIT