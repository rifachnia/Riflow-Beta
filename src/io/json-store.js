import fs from "node:fs/promises";
import path from "node:path";

export class JsonStore {
  constructor(root) {
    this.root = root;
  }

  resolve(file) {
    return path.join(this.root, file);
  }

  async read(file, fallback) {
    try {
      const raw = await fs.readFile(this.resolve(file), "utf8");
      return JSON.parse(raw);
    } catch {
      return structuredClone(fallback);
    }
  }

  async write(file, value) {
    const target = this.resolve(file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }
}
