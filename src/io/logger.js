import fs from "node:fs/promises";
import path from "node:path";

export class EventLog {
  constructor(root) {
    this.file = path.join(root, "logs", "riflow.log");
  }

  async write(type, payload = {}) {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const line = JSON.stringify({ ts: new Date().toISOString(), type, ...payload });
    await fs.appendFile(this.file, `${line}\n`, "utf8");
  }

  async tail(limit = 80) {
    try {
      const raw = await fs.readFile(this.file, "utf8");
      return raw.trim().split(/\r?\n/).filter(Boolean).slice(-limit);
    } catch {
      return [];
    }
  }
}
