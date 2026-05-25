import fs from "node:fs/promises";
import path from "node:path";

export class DecisionLog {
  constructor(root) {
    this.file = path.join(root, "logs", "decisions.jsonl");
  }

  async write(entry) {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const row = normalizeDecisionEntry(entry);
    await fs.appendFile(this.file, `${JSON.stringify(row)}\n`, "utf8");
    return row;
  }

  async tail(limit = 50) {
    try {
      const raw = await fs.readFile(this.file, "utf8");
      return raw.trim().split(/\r?\n/).filter(Boolean).slice(-limit).map((line) => JSON.parse(line));
    } catch {
      return [];
    }
  }
}

export function normalizeDecisionEntry(entry) {
  return {
    timestamp: entry.timestamp || new Date().toISOString(),
    dry_run: entry.dry_run !== false,
    agent_name: entry.agent_name || "General Agent",
    action_type: entry.action_type || "SKIP",
    pool_address: entry.pool_address || entry.poolAddress || null,
    token_address: entry.token_address || entry.tokenAddress || null,
    symbol: entry.symbol || null,
    input_metrics: entry.input_metrics || {},
    memory_used: entry.memory_used || [],
    reasoning_summary: String(entry.reasoning_summary || entry.reason || "").slice(0, 500),
    confidence_score: Number(entry.confidence_score ?? entry.confidence ?? 0),
    risk_notes: Array.isArray(entry.risk_notes) ? entry.risk_notes : [],
    final_decision: entry.final_decision || null,
    execution_result: entry.execution_result || null,
    pnl_result: entry.pnl_result || null,
    fee_result: entry.fee_result || null
  };
}
