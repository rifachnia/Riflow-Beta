export function buildMemoryUpdate({ existing, coach, performance }) {
  return {
    lessons: [
      ...(existing.lessons || []),
      ...(coach.new_rules || []),
      ...(coach.mistakes || []).map((item) => `Avoid: ${item}`),
      ...(coach.successes || []).map((item) => `Prefer: ${item}`)
    ],
    avoid_patterns: [...(existing.avoid_patterns || []), ...(coach.mistakes || []), ...(coach.weak_conditions || [])],
    preferred_patterns: [...(existing.preferred_patterns || []), ...(coach.successes || []), ...(coach.strong_conditions || [])],
    confidence_adjustments: [...(existing.confidence_adjustments || []), ...(coach.confidence_adjustments || [])],
    risk_improvements: [...(existing.risk_improvements || []), ...(coach.risk_improvements || [])],
    performance_snapshot: performance
  };
}
