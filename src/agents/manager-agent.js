import { markPositionWithMarketData, openPositions } from "../services/portfolio.js";

export async function evaluateManagerRules(ctx) {
  const cfg = ctx.config.management || {};
  const rows = [];
  for (const position of openPositions(ctx.state)) {
    const marked = await markPositionWithMarketData(position, ctx.config);
    const ageMinutes = ageMinutesOf(position.openedAt);
    const claimableFeeUsd = Number(marked.claimableFeesUsd ?? marked.estimatedFeesUsd ?? simulatedFeeUsd(marked));
    const outOfRangeMinutes = marked.outOfRangeSince
      ? ageMinutesOf(marked.outOfRangeSince)
      : Math.max(0, Number(marked.pnlPct || 0) < -6 ? ageMinutes : 0);
    const minHold = Number(cfg.minimumHoldMinutes ?? cfg.minPositionAgeMinutes ?? 5);
    const canCloseByAge = ageMinutes >= minHold;
    marked.peakPnlPct = Math.max(Number(position.peakPnlPct || 0), Number(marked.pnlPct || 0));
    marked.maxDrawdownPct = Math.min(Number(position.maxDrawdownPct || 0), Number(marked.pnlPct || 0));
    let action = "HOLD";
    const reasons = [];

    if (ctx.config.safety?.paused || ctx.config.safety?.emergencyPause) {
      reasons.push("paused");
      rows.push({ position: marked, action, reasons, claimableFeeUsd, outOfRangeMinutes });
      continue;
    }
    if (claimableFeeUsd >= Number(cfg.claimFeeThresholdUsd ?? cfg.minClaimFeeUsd ?? 2)) {
      action = "CLAIM";
      reasons.push(`claimable fee ${claimableFeeUsd} >= threshold`);
    }
    if (Number(marked.pnlPct || 0) <= Number(cfg.emergencyStopLossPct ?? -20)) {
      action = "CLOSE";
      reasons.push(`emergency stop loss ${marked.pnlPct}%`);
    }
    if (canCloseByAge && outOfRangeMinutes >= Number(cfg.maxOutOfRangeMinutes ?? cfg.outOfRangeMaxMinutes ?? 30)) {
      action = cfg.redeployOnOutOfRange && canRedeploy(marked, ctx.config) ? "REDEPLOY" : "CLOSE";
      reasons.push(`out of range ${outOfRangeMinutes}m`);
    }
    if (canCloseByAge && Number(marked.pnlPct || 0) <= Number(cfg.stopLossPct ?? -12)) {
      action = "CLOSE";
      reasons.push(`stop loss ${marked.pnlPct}%`);
    }
    if (canCloseByAge && Number(marked.pnlPct || 0) >= Math.max(0.01, Number(cfg.takeProfitPct ?? 25))) {
      action = "CLOSE";
      reasons.push(`take profit ${marked.pnlPct}%`);
    }
    const trailingActive = Number(marked.peakPnlPct || 0) >= Number(cfg.trailingActivationPct ?? 8);
    if (canCloseByAge && trailingActive && Number(marked.pnlPct || 0) <= Number(marked.peakPnlPct || 0) - Number(cfg.trailingDropPct ?? cfg.trailingTakeProfitPct ?? 4)) {
      action = "CLOSE";
      reasons.push(`trailing take profit peak ${marked.peakPnlPct}% now ${marked.pnlPct}%`);
    }
    if (canCloseByAge && dropPct(marked.currentTvlUsd, marked.entryTvlUsd) <= -Math.abs(Number(cfg.tvlDropClosePct ?? 35))) {
      action = "CLOSE";
      reasons.push(`TVL dropped ${dropPct(marked.currentTvlUsd, marked.entryTvlUsd)}%`);
    }
    if (canCloseByAge && dropPct(marked.currentFees24hUsd, marked.entryFees24hUsd) <= -Math.abs(Number(cfg.feeDropClosePct ?? 65))) {
      action = "CLOSE";
      reasons.push(`fees dropped ${dropPct(marked.currentFees24hUsd, marked.entryFees24hUsd)}%`);
    }
    if (canCloseByAge && dropPct(marked.currentVolume24hUsd, marked.entryVolume24hUsd) <= -Math.abs(Number(cfg.volumeDropClosePct ?? 65))) {
      action = "CLOSE";
      reasons.push(`volume dropped ${dropPct(marked.currentVolume24hUsd, marked.entryVolume24hUsd)}%`);
    }
    if (cfg.closeOnTokenWarning !== false && (marked.warnings || []).some((warning) => /scam|critical|blacklist|freeze|mint|unsafe/i.test(String(warning)))) {
      action = "CLOSE";
      reasons.push(`token warning: ${(marked.warnings || [])[0]}`);
    }
    if (action === "HOLD" && !reasons.length) {
      if (!canCloseByAge) reasons.push(`minimum hold not reached: ${ageMinutes}m/${minHold}m`);
      reasons.push(`pnl ${marked.pnlPct ?? 0}% between stop ${Number(cfg.stopLossPct ?? -12)}% and take profit ${Number(cfg.takeProfitPct ?? 25)}%`);
      reasons.push(`claimable fee ${claimableFeeUsd} < threshold ${Number(cfg.claimFeeThresholdUsd ?? cfg.minClaimFeeUsd ?? 2)}`);
      if (outOfRangeMinutes > 0) reasons.push(`out of range ${outOfRangeMinutes}m < max ${Number(cfg.maxOutOfRangeMinutes ?? cfg.outOfRangeMaxMinutes ?? 30)}m`);
    }
    rows.push({ position: marked, action, reasons, claimableFeeUsd, outOfRangeMinutes, ageMinutes });
  }
  return rows;
}

function ageMinutesOf(ts) {
  return Math.max(0, Math.round((Date.now() - new Date(ts || Date.now()).getTime()) / 60000));
}

function simulatedFeeUsd(position) {
  const age = ageMinutesOf(position.openedAt);
  const base = Math.max(0, Number(position.sizeSol || 0) * 150 * 0.001);
  return Number((base * Math.max(1, age / 30)).toFixed(2));
}

function canRedeploy(position, config) {
  const cfg = config.management || {};
  if (Number(position.redeployCount || 0) >= Number(cfg.maxRedeploysPerPosition ?? 2)) return false;
  if (Number(position.initialMetrics?.candidateScoreAdjusted ?? position.initialMetrics?.score ?? 0) < Number(cfg.minScoreForRedeploy ?? 78)) return false;
  if (dropPct(position.currentFees24hUsd, position.entryFees24hUsd) <= -Math.abs(Number(cfg.feeDropClosePct ?? 65))) return false;
  if (dropPct(position.currentTvlUsd, position.entryTvlUsd) <= -Math.abs(Number(cfg.tvlDropClosePct ?? 35))) return false;
  return true;
}

function dropPct(current, entry) {
  const now = Number(current);
  const start = Number(entry);
  if (!Number.isFinite(now) || !Number.isFinite(start) || start <= 0) return 0;
  return Number((((now - start) / start) * 100).toFixed(2));
}
