import fs from "node:fs/promises";
import path from "node:path";

export async function acquireRuntimeLock(root, name = "riflow-daemon") {
  const file = path.join(root, "data", `${name}.lock.json`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const existing = await readJson(file, null);
  if (existing?.pid && isProcessAlive(existing.pid)) {
    throw new Error(`${name} already appears to be running with pid ${existing.pid}`);
  }
  const lock = { name, pid: process.pid, startedAt: new Date().toISOString() };
  await fs.writeFile(file, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
  return async () => {
    const current = await readJson(file, null);
    if (current?.pid === process.pid) await fs.rm(file, { force: true });
  };
}

export async function writeRuntimeStatus(root, status) {
  const file = path.join(root, "data", "runtime-status.json");
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify({
    updatedAt: new Date().toISOString(),
    pid: process.pid,
    ...status
  }, null, 2)}\n`, "utf8");
}

export async function readRuntimeStatus(root) {
  return readJson(path.join(root, "data", "runtime-status.json"), null);
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}
