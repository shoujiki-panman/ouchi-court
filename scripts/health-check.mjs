#!/usr/bin/env node
// Static delivery check only. Never opens a court, calls /api/, or executes downloaded code.
import { pathToFileURL } from "node:url";

export const DEFAULT_BASE_URL = "https://ouchi-court.panman.workers.dev/";
const MAX_BODY_BYTES = 512 * 1024;
const JS_TYPE = /^(?:application|text)\/(?:javascript|ecmascript)(?:;|$)/i;
const PROBES = [
  { path: "/", type: /^text\/html(?:;|$)/i, signatures: [/<title>おうち裁判<\/title>/, /id=["']solo["']/, /<script\b[^>]*src=["'](?:\.\/)?app\.js["']/] },
  { path: "/app.js", type: JS_TYPE, signatures: [/from\s+["']\.\/live\.js["']/, /startMic/] },
  { path: "/live.js", type: JS_TYPE, signatures: [/export\s+class\s+Live\b/, /export\s+class\s+Speaker\b/, /startMic/] },
  { path: "/names.js", type: JS_TYPE, signatures: [/addressedParty/, /selfNamedParty/] },
  { path: "/sfx.js", type: JS_TYPE, signatures: [/export\s+const\s+sfx\b/] },
  { path: "/punishments.js", type: JS_TYPE, signatures: [/export\s+const\s+PUNISHMENTS\b/] },
  { path: "/capture-worklet.js", type: JS_TYPE, signatures: [/registerProcessor\(["']capture["']/] },
];
// Only this observed, literal dependency is recognized. Never follow arbitrary downloaded URLs.
const LIVE_USAGE_IMPORT = /^\s*import\s+\{\s*LiveUsage\s*\}\s+from\s+["']\.\/live-usage\.js["'];?\s*$/m;
const LIVE_USAGE_PROBE = { path: "/live-usage.js", type: JS_TYPE, signatures: [/export\s+class\s+LiveUsage\b/] };

function checkedOrigin(baseUrl) {
  const url = new URL(baseUrl);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      url.search || url.hash || url.pathname !== "/") {
    throw new Error("Use an HTTP(S) origin with no credentials, path, query, or fragment.");
  }
  return url.origin;
}

async function readBoundedBody(response) {
  if (!response.body) throw new Error("Empty response body");
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new Error("Response exceeds the 512 KiB safety limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function probe(origin, spec, timeoutMs) {
  const start = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let status = null;
  try {
    const response = await fetch(`${origin}${spec.path}`, {
      method: "GET",
      redirect: "manual", // A redirect must never turn a static check into an API request.
      credentials: "omit",
      headers: { "user-agent": "OuchiCourt-StaticHealth/1.0", "cache-control": "no-cache" },
      signal: controller.signal,
    });
    status = response.status;
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`HTTP ${status}`);
    }
    if (!spec.type.test(response.headers.get("content-type") ?? "")) {
      await response.body?.cancel();
      throw new Error("Unexpected content type (possible fallback or error page)");
    }
    const body = await readBoundedBody(response);
    if (spec.path !== "/" && /^\s*(?:<!doctype\s+html|<html\b)/i.test(body)) {
      throw new Error("HTML returned for JavaScript (possible SPA fallback)");
    }
    if (!spec.signatures.every((signature) => signature.test(body))) {
      throw new Error("Expected application signature missing");
    }
    return {
      path: spec.path, ok: true, status, elapsedMs: Math.round(performance.now() - start),
      ...(spec.path === "/live.js" && LIVE_USAGE_IMPORT.test(body) ? { requiredAssets: ["/live-usage.js"] } : {}),
    };
  } catch (error) {
    return {
      path: spec.path,
      ok: false,
      status,
      elapsedMs: Math.round(performance.now() - start),
      // Do not include a server response body, which could contain private data.
      error: controller.signal.aborted ? `Timed out after ${timeoutMs} ms` : error.message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkHealth({ baseUrl = DEFAULT_BASE_URL, timeoutMs = 8000 } = {}) {
  const origin = checkedOrigin(baseUrl);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) {
    throw new Error("timeoutMs must be an integer between 1 and 60000");
  }
  const checks = await Promise.all(PROBES.map((spec) => probe(origin, spec, timeoutMs)));
  if (checks.find((check) => check.path === "/live.js")?.requiredAssets?.includes("/live-usage.js")) {
    checks.push(await probe(origin, LIVE_USAGE_PROBE, timeoutMs));
  }
  return { ok: checks.every((check) => check.ok), scope: "static-delivery-only", origin, checkedAt: new Date().toISOString(), checks };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length > 4) throw new Error("Usage: node scripts/health-check.mjs [origin] [timeout-ms]");
    const result = await checkHealth({
      baseUrl: process.argv[2] ?? DEFAULT_BASE_URL,
      timeoutMs: process.argv[3] === undefined ? 8000 : Number(process.argv[3]),
    });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.message }));
    process.exitCode = 1;
  }
}
