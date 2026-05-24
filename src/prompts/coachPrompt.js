export const coachSchema = [
  "Return strict JSON only. No markdown. No commentary.",
  "Schema:",
  "{\"mistakes\":[],\"successes\":[],\"strong_conditions\":[],\"weak_conditions\":[],\"new_rules\":[],\"confidence_adjustments\":[],\"risk_improvements\":[],\"summary\":\"\"}",
  "Only include actionable observations backed by the supplied paper-trading data.",
  "Do not recommend live trading."
].join("\n");

export function buildCoachMessages({ provider, memory, trades, decisions, stats, windowLabel }) {
  return [{
    role: "user",
    content: JSON.stringify({
      task: "Review this model's recent paper trades and AI decisions, then produce coaching insights.",
      paperOnly: true,
      provider: provider ? { id: provider.id, model: provider.model, name: provider.name || provider.id } : null,
      review_window: windowLabel,
      performance_snapshot: stats,
      current_memory: memory,
      recent_closed_trades: trades,
      recent_ai_decisions: decisions,
      requested_output: {
        mistakes: "recurring mistakes",
        successes: "successful patterns",
        strong_conditions: "market conditions that worked",
        weak_conditions: "market conditions that failed",
        new_rules: "new trading rules",
        confidence_adjustments: "how confidence should be adjusted",
        risk_improvements: "risk management improvements",
        summary: "short summary"
      }
    })
  }];
}
