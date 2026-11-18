import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { checkHealth } from "../scripts/health-check.mjs";

const exec = promisify(execFile);
const paths = ["/", "/app.js", "/live.js", "/names.js", "/sfx.js", "/punishments.js", "/capture-worklet.js"];
const files = new Map(await Promise.all([...paths, "/live-usage.js"].map(async (path) => [path, await readFile(new URL(`../public/${path === "/" ? "index.html" : path.slice(1)}`, import.meta.url))])));
// The old deployment predates usage tracking; both revisions must be supported.
const legacyLive = files.get("/live.js").toString().replace(/^import \{ LiveUsage \} from "\.\/live-usage\.js";\r?\n/m, "");

async function fixture(t, override = () => false) {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ path: request.url, method: request.method, authorization: request.headers.authorization, cookie: request.headers.cookie });
    if (override(request, response)) return;
    const file = request.url === "/live.js" ? legacyLive : files.get(request.url);
    response.writeHead(file ? 200 : 404, { "content-type": request.url === "/" ? "text/html; charset=utf-8" : "application/javascript; charset=utf-8" });
    response.end(file ?? "Not found");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  return { baseUrl: `http://127.0.0.1:${server.address().port}/`, requests };
}

test("legacy deployment passes without fetching a module that it does not import", async (t) => {
  const { baseUrl, requests } = await fixture(t);
  const result = await checkHealth({ baseUrl });
  assert.equal(result.ok, true);
  assert.equal(result.scope, "static-delivery-only");
  assert.deepEqual(requests.map((r) => r.path).sort(), [...paths].sort());
  assert.ok(requests.every((r) => r.method === "GET" && !r.authorization && !r.cookie && !r.path.startsWith("/api/")));
});

test("the new literal usage dependency is checked when live.js imports it", async (t) => {
  const { baseUrl, requests } = await fixture(t, (request, response) => {
    if (request.url !== "/live.js") return false;
    response.writeHead(200, { "content-type": "application/javascript" }); response.end(files.get("/live.js")); return true;
  });
  const result = await checkHealth({ baseUrl });
  assert.equal(result.ok, true);
  assert.deepEqual(requests.map((r) => r.path).sort(), [...paths, "/live-usage.js"].sort());
  assert.equal(result.checks.find((r) => r.path === "/live-usage.js").status, 200);
});

test("new deployment fails when the required usage module returns SPA fallback", async (t) => {
  const { baseUrl } = await fixture(t, (request, response) => {
    if (request.url === "/live.js") {
      response.writeHead(200, { "content-type": "application/javascript" }); response.end(files.get("/live.js")); return true;
    }
    if (request.url !== "/live-usage.js") return false;
    response.writeHead(200, { "content-type": "text/html" }); response.end(files.get("/")); return true;
  });
  const result = await checkHealth({ baseUrl });
  assert.equal(result.ok, false);
  assert.match(result.checks.find((r) => r.path === "/live-usage.js").error, /content type/);
});

test("an unavailable asset fails the check, even when the home page is healthy", async (t) => {
  const { baseUrl } = await fixture(t, (request, response) => {
    if (request.url !== "/capture-worklet.js") return false;
    response.writeHead(503); response.end("internal text must not be logged"); return true;
  });
  const result = await checkHealth({ baseUrl });
  assert.equal(result.ok, false);
  assert.equal(result.checks.find((r) => r.path === "/capture-worklet.js").error, "HTTP 503");
  assert.ok(!JSON.stringify(result).includes("internal text"));
});

test("a 200 SPA fallback for a missing JS asset is a failure", async (t) => {
  const { baseUrl } = await fixture(t, (request, response) => {
    if (request.url !== "/live.js") return false;
    response.writeHead(200, { "content-type": "text/html" }); response.end(files.get("/")); return true;
  });
  const result = await checkHealth({ baseUrl });
  assert.equal(result.ok, false);
  assert.match(result.checks.find((r) => r.path === "/live.js").error, /content type/);
});

test("an unrelated or stale landing page does not pass on HTTP status alone", async (t) => {
  const { baseUrl } = await fixture(t, (request, response) => {
    if (request.url !== "/") return false;
    response.writeHead(200, { "content-type": "text/html" }); response.end("<html><title>Maintenance</title></html>"); return true;
  });
  const result = await checkHealth({ baseUrl });
  assert.equal(result.ok, false);
  assert.match(result.checks.find((r) => r.path === "/").error, /signature/);
});

test("redirects are rejected without following them to API routes", async (t) => {
  const { baseUrl, requests } = await fixture(t, (request, response) => {
    if (request.url !== "/app.js") return false;
    response.writeHead(302, { location: "/api/token" }); response.end(); return true;
  });
  const result = await checkHealth({ baseUrl });
  assert.equal(result.ok, false);
  assert.equal(result.checks.find((r) => r.path === "/app.js").status, 302);
  assert.ok(requests.every((r) => !r.path.startsWith("/api/")));
});

test("the timeout includes a response body that never finishes", async (t) => {
  const { baseUrl } = await fixture(t, (request, response) => {
    if (request.url !== "/names.js") return false;
    response.writeHead(200, { "content-type": "application/javascript" }); response.write("// waiting"); return true;
  });
  const result = await checkHealth({ baseUrl, timeoutMs: 100 });
  assert.equal(result.ok, false);
  assert.match(result.checks.find((r) => r.path === "/names.js").error, /Timed out/);
});

test("large response bodies are stopped instead of retained in the report", async (t) => {
  const { baseUrl } = await fixture(t, (request, response) => {
    if (request.url !== "/sfx.js") return false;
    response.writeHead(200, { "content-type": "application/javascript" }); response.end("x".repeat(512 * 1024 + 1)); return true;
  });
  const result = await checkHealth({ baseUrl });
  assert.equal(result.ok, false);
  assert.match(result.checks.find((r) => r.path === "/sfx.js").error, /512 KiB/);
});

test("credentials, queries and API base paths are rejected before a request", async () => {
  for (const baseUrl of ["https://user:password@example.test/", "https://example.test/api/token", "https://example.test/?secret=x", "file:///tmp/"]) {
    await assert.rejects(checkHealth({ baseUrl }), /HTTP\(S\) origin/);
  }
  await assert.rejects(checkHealth({ timeoutMs: 0 }), /timeoutMs/);
});

test("CLI returns JSON and a success or failure exit status", async (t) => {
  const { baseUrl } = await fixture(t);
  const script = fileURLToPath(new URL("../scripts/health-check.mjs", import.meta.url));
  const good = await exec(process.execPath, [script, baseUrl]);
  assert.equal(JSON.parse(good.stdout).ok, true);
  await assert.rejects(exec(process.execPath, [script, `${baseUrl}?invalid=1`]), (error) => {
    assert.equal(error.code, 1);
    assert.equal(JSON.parse(error.stderr).ok, false);
    return true;
  });
});
