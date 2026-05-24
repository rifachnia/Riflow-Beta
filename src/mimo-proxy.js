#!/usr/bin/env node
import http from "node:http";

const PORT = Number(process.env.PORT || 19911);
const UPSTREAM = (process.env.UPSTREAM_BASE || "https://opengateway.gitlawb.com/v1/xiaomi-mimo").replace(/\/+$/, "");

function send(res, status, body, headers = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Api-Key, api-key",
    "Content-Type": "application/json",
    ...headers
  });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function authHeaders(req) {
  return {
    ...(req.headers.authorization ? { "Authorization": req.headers.authorization } : {}),
    ...(req.headers["x-api-key"] ? { "X-Api-Key": req.headers["x-api-key"] } : {}),
    ...(req.headers["api-key"] ? { "api-key": req.headers["api-key"] } : {})
  };
}

http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, "");
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/health") {
    return send(res, 200, { ok: true, upstream: UPSTREAM, port: PORT });
  }

  if (req.method === "POST" && ["/v1/chat/completions", "/chat/completions"].includes(url.pathname)) {
    try {
      const raw = await readBody(req);
      const upstream = await fetch(`${UPSTREAM}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Accept-Encoding": "identity",
          ...authHeaders(req)
        },
        body: raw
      });
      const text = await upstream.text();
      return send(res, upstream.status, text, {
        "Content-Type": upstream.headers.get("content-type") || "application/json"
      });
    } catch (error) {
      return send(res, 502, { error: { message: error.message, type: "upstream_error" } });
    }
  }

  return send(res, 404, { error: "not found" });
}).listen(PORT, () => {
  console.log(`Riflow MiMo proxy: http://127.0.0.1:${PORT}/v1 -> ${UPSTREAM}`);
});
