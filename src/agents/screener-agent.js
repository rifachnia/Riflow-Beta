import { scanMarketDetailed } from "../services/scanner.js";
import { loadAllPoolMemory } from "../services/pool-memory.js";

export async function runScreenerScan(ctx) {
  const poolMemory = await loadAllPoolMemory(ctx);
  ctx.config.__state = ctx.state;
  const scan = await scanMarketDetailed(ctx.config, poolMemory);
  delete ctx.config.__state;
  ctx.state.lastRawScan = scan.raw;
  ctx.state.lastScan = scan.passed;
  ctx.state.lastFilteredOut = scan.rejected.map((item) => ({
    symbol: item.symbol,
    poolAddress: item.poolAddress,
    reasons: item.hardFilter?.reasons || []
  }));
  return scan;
}
