import { scoreCandidate } from "../core/risk.js";

const symbols = ["RIFT", "NUSA", "FLOW", "KAI", "EMBER", "LUMA", "VAULT", "ORBIT", "PULSE", "KITE", "NOVA", "SORA"];

function seededNumber(seed, mod) {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % mod;
}

export async function scanMarket(config) {
  const nowBucket = Math.floor(Date.now() / 60000);
  const rows = symbols.map((symbol, index) => {
    const seed = `${symbol}:${nowBucket}:${index}`;
    const liquidityUsd = 9000 + seededNumber(seed, 90000);
    const volume24hUsd = 8000 + seededNumber(`${seed}:v`, 160000);
    const ageHours = 1 + seededNumber(`${seed}:a`, 96);
    const holders = 80 + seededNumber(`${seed}:h`, 2400);
    const flags = [];
    if (holders < 160) flags.push("thin holders");
    if (ageHours < 2) flags.push("fresh launch");
    if (liquidityUsd < config.risk.minLiquidityUsd) flags.push("low liquidity");

    const token = {
      symbol,
      pair: `${symbol}/SOL`,
      liquidityUsd,
      volume24hUsd,
      ageHours,
      holders,
      momentum: seededNumber(`${seed}:m`, 3) === 0 ? "flat" : "rising",
      flags
    };

    return { ...token, score: scoreCandidate(token, config) };
  });

  return rows.sort((a, b) => b.score - a.score).slice(0, config.scanner.limit || 12);
}
