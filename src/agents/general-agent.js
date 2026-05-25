export function generalStatus(ctx) {
  return {
    dry_run: ctx.config.safety?.dryRun !== false,
    paused: Boolean(ctx.config.safety?.paused || ctx.config.safety?.emergencyPause),
    active_provider: ctx.config.llm?.activeProviderId,
    paper_balance_sol: ctx.state.paperBalanceSol,
    candidates: ctx.state.lastScan?.length || 0,
    filtered_out: ctx.state.lastFilteredOut?.length || 0,
    open_positions: (ctx.state.positions || []).filter((position) => position.status === "open").length
  };
}
