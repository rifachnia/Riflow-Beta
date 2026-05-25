export async function loadLessons(ctx) {
  return ctx.store.read("memory/lessons.json", { lessons: [] });
}

export async function addLessonFromTrade(ctx, trade, position = {}) {
  const data = await loadLessons(ctx);
  const lesson = {
    id: `lesson_${Date.now().toString(36)}`,
    created_at: new Date().toISOString(),
    poolAddress: trade.poolAddress || position.poolAddress || trade.symbol,
    pool_address: trade.poolAddress || position.poolAddress || trade.symbol,
    symbol: trade.symbol,
    entryScore: trade.entryScore ?? position.scoreAtOpen ?? position.initialMetrics?.candidateScore ?? position.initialMetrics?.score ?? null,
    entry_reason: position.reason || trade.entryReason || "unknown",
    entryReason: position.reason || trade.entryReason || "unknown",
    exit_reason: trade.reason || trade.exitReason || "closed by rule/manual",
    exitReason: trade.reason || trade.exitReason || "closed by rule/manual",
    duration_minutes: trade.durationMinutes ?? durationMinutes(position.openedAt || trade.openedAt, trade.closedAt),
    durationMinutes: trade.durationMinutes ?? durationMinutes(position.openedAt || trade.openedAt, trade.closedAt),
    initial_metrics: position.initialMetrics || {
      scoreAtOpen: position.scoreAtOpen || null,
      confidence: position.aiConfidence || null
    },
    final_pnl: { pnlPct: trade.pnlPct, pnlUsd: trade.pnlUsd },
    pnlPct: trade.pnlPct,
    feesUsd: trade.feeUsd || trade.estimatedFeesUsd || 0,
    fee_earned: trade.feeUsd || trade.estimatedFeesUsd || 0,
    maxDrawdownPct: trade.maxDrawdownPct ?? position.maxDrawdownPct ?? Math.min(0, Number(trade.pnlPct || 0)),
    outOfRangeMinutes: trade.outOfRangeMinutes ?? position.totalOutOfRangeMinutes ?? 0,
    whatWorked: Number(trade.pnlUsd || 0) > 0
      ? ["price/range setup closed profitable", Number(trade.feeUsd || 0) > 0 ? "fees contributed to result" : null].filter(Boolean)
      : [],
    whatFailed: Number(trade.pnlUsd || 0) <= 0
      ? ["setup did not produce positive simulated PnL", Number(trade.outOfRangeMinutes || 0) > 0 ? "position spent time out of range" : null].filter(Boolean)
      : [],
    what_worked: Number(trade.pnlUsd || 0) > 0 ? "Setup closed profitable in simulation." : "",
    what_failed: Number(trade.pnlUsd || 0) <= 0 ? "Setup did not produce positive simulated PnL." : "",
    futureRuleSuggestion: Number(trade.pnlUsd || 0) > 0
      ? "Prefer similar high-score pools only when fee yield and range status remain healthy."
      : "Avoid similar setup unless score, fee yield, and range stability improve.",
    shouldPreferSimilar: Number(trade.pnlUsd || 0) > 0,
    shouldAvoidSimilar: Number(trade.pnlUsd || 0) <= 0,
    future_bias: Number(trade.pnlUsd || 0) > 0 ? "prefer similar setup with same safeguards" : "avoid similar setup unless metrics improve"
  };
  data.lessons.unshift(lesson);
  data.lessons = data.lessons.slice(0, 200);
  await ctx.store.write("memory/lessons.json", data);
  return lesson;
}

export async function getLessonsForPrompt(ctx, limit = 12) {
  const data = await loadLessons(ctx);
  return (data.lessons || []).slice(0, limit).map((lesson) => ({
    symbol: lesson.symbol,
    entry_reason: lesson.entry_reason,
    exit_reason: lesson.exit_reason,
    final_pnl: lesson.final_pnl,
    future_bias: lesson.future_bias
  }));
}

function durationMinutes(start, end) {
  const a = new Date(start || Date.now()).getTime();
  const b = new Date(end || Date.now()).getTime();
  return Math.max(0, Math.round((b - a) / 60000));
}
