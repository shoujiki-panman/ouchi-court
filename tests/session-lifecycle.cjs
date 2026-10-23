// Actual app.js, local fixture page, deferred microphone promises. No live APIs or microphone.
// NODE_PATH=<installed playwright node_modules> node tests/session-lifecycle.cjs
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const PUBLIC = path.join(__dirname, "..", "public");
const ORIGIN = "http://court.test";
const fakeLive = `
window.fixture = { connections: [], microphones: [], speakers: [], stopped: 0, audioCalls: 0 };
export class Speaker {
  constructor() { this.ctx = { state: 'running', currentTime: 0 }; this.busy = false; fixture.speakers.push(this); }
  dispose() { this.ctx.state = 'closed'; }
  stop() {} level() { return 0; } play() {} clip() {} playWav() {}
}
export class Live {
  constructor(options) { this.on = options.on; this.sent = []; this.closed = false; fixture.connections.push(this); }
  send(message) { this.sent.push(message); }
  close() { this.closed = true; }
  audio() { fixture.audioCalls++; }
  usageSummary() { return { schemaVersion: 1, observations: [] }; }
}
export function startMic(onChunk, { signal } = {}) {
  return new Promise((resolve, reject) => {
    const mic = { onChunk, reject, signal, released: false, resolve() {
      resolve(() => { if (!mic.released) { mic.released = true; fixture.stopped++; } });
    }};
    fixture.microphones.push(mic);
  });
}`;
const fakeSfx = `const noop = () => {}; const beat = new Proxy({}, { get: () => noop });
export const sfx = new Proxy({}, { get: (_, key) => key === 'bgm' ? () => beat : noop });`;

(async () => {
  const browser = await chromium.launch({ headless: true });
  let tests = 0;
  try {
    const context = await browser.newContext();
    const external = [];
    const errors = [];
    await context.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== ORIGIN) { external.push(url.origin); return route.abort(); }
      if (url.pathname.startsWith("/api/")) {
        const body = url.pathname === "/api/token" ? { token: "synthetic", model: "fixture" }
          : url.pathname === "/api/rival" ? { level: 1, wins: 0, losses: 0, draws: 0 } : { error: "stubbed" };
        return route.fulfill({ status: body.error ? 503 : 200, contentType: "application/json", body: JSON.stringify(body) });
      }
      const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      if (file === "live.js" || file === "sfx.js") {
        return route.fulfill({ contentType: "text/javascript", body: file === "live.js" ? fakeLive : fakeSfx });
      }
      const full = path.resolve(PUBLIC, file);
      if (!full.startsWith(PUBLIC + path.sep) || !fs.existsSync(full)) return route.fulfill({ status: 404, body: "" });
      let body = fs.readFileSync(full);
      if (file === "app.js") body = body.toString() + "\nwindow.lifecycle = { openCourt, shutLive, closeCourt };\n";
      const contentType = file.endsWith(".js") ? "text/javascript" : file.endsWith(".html") ? "text/html" : "application/octet-stream";
      return route.fulfill({ contentType, body });
    });
    const page = await context.newPage();
    page.on("pageerror", e => errors.push(e.message));
    const fresh = async () => {
      await page.goto(ORIGIN + "/");
      await page.waitForFunction(() => window.lifecycle);
      await page.evaluate(() => lifecycle.openCourt());
    };
    const ready = async index => page.evaluate(index => { void fixture.connections[index].on.ready(); }, index);
    const resolveMic = async index => {
      await page.evaluate(index => fixture.microphones[index].resolve(), index);
      await page.evaluate(() => Promise.resolve());
    };
    const check = (name, actual, expected) => { assert.deepEqual(actual, expected, name); console.log(`ok ${++tests} - ${name}`); };

    await fresh();
    await ready(0);
    check("clerk waits for microphone permission before starting", await page.evaluate(() => fixture.connections[0].sent.length), 0);
    await resolveMic(0);
    check("successful microphone permission starts the clerk", await page.evaluate(() => fixture.connections[0].sent.length), 1);
    await page.evaluate(() => fixture.connections[0].on.closed({ code: 1006 }));
    check("unexpected socket close releases the active microphone", await page.evaluate(() => fixture.stopped), 1);
    check("unexpected close offers explicit resume", await page.locator("#resume").evaluate(el => el.style.display), "inline-block");

    await fresh();
    await ready(0);
    await page.evaluate(() => lifecycle.shutLive());
    check("closure aborts pending microphone initialization", await page.evaluate(() => fixture.microphones[0].signal.aborted), true);
    await resolveMic(0);
    check("late microphone permission after user closure is released", await page.evaluate(() => fixture.stopped), 1);
    check("closed court never starts the clerk", await page.evaluate(() => fixture.connections[0].sent.length), 0);

    await fresh();
    await ready(0);
    await page.evaluate(() => fixture.connections[0].on.closed({ code: 1006 }));
    check("disconnect aborts pending microphone initialization", await page.evaluate(() => fixture.microphones[0].signal.aborted), true);
    await resolveMic(0);
    check("late permission after network disconnect is released", await page.evaluate(() => fixture.stopped), 1);

    await fresh();
    await ready(0);
    await page.evaluate(() => lifecycle.openCourt(true));
    check("replacement court disposes the previous speaker context", await page.evaluate(() => fixture.speakers.map(s => s.ctx.state)), ["closed", "running"]);
    await ready(1);
    await resolveMic(1);
    await resolveMic(0);
    await page.evaluate(() => fixture.connections[0].on.closed({ code: 1000 }));
    check("old connection cannot stop replacement microphone", await page.evaluate(() => fixture.microphones.map(m => m.released)), [true, false]);
    await page.evaluate(() => fixture.microphones[0].onChunk("stale", 1));
    check("late audio cannot enter replacement session", await page.evaluate(() => fixture.audioCalls), 0);
    await page.evaluate(() => fixture.connections[1].on.closed({ code: 1006 }));
    check("replacement disconnect releases its microphone", await page.evaluate(() => fixture.stopped), 2);

    await fresh();
    await ready(0);
    await resolveMic(0);
    await page.evaluate(() => lifecycle.closeCourt());
    check("closing court disposes speaker context", await page.evaluate(() => fixture.speakers[0].ctx.state), "closed");
    check("closing court releases its microphone", await page.evaluate(() => fixture.stopped), 1);

    await fresh();
    await ready(0);
    await page.evaluate(() => fixture.microphones[0].reject(new Error("permission denied")));
    await page.evaluate(() => Promise.resolve());
    check("microphone failure closes the billed connection", await page.evaluate(() => fixture.connections[0].closed), true);
    await page.evaluate(() => fixture.connections[0].on.closed({ code: 1000 }));
    check("microphone error survives close callback", await page.locator("#status").evaluate(el => el.textContent.includes("マイクが使えません")), true);
    check("normal page has no metrics export surface", await page.evaluate(() => typeof window.__courtMetrics), "undefined");
    await page.goto(ORIGIN + "/?metrics");
    await page.waitForFunction(() => window.lifecycle);
    await page.evaluate(async () => {
      await lifecycle.openCourt();
      fixture.connections[0].on.usage({ schemaVersion: 1, latestReportedUsage: { promptTokenCount: 20 } });
      await lifecycle.openCourt(true);
      fixture.connections[1].on.usage({ schemaVersion: 1, latestReportedUsage: { promptTokenCount: 7 } });
    });
    const report = await page.evaluate(() => window.__courtMetrics.snapshot());
    check("reconnect counters remain separate observations", report.connections.map(c => c.usage.latestReportedUsage.promptTokenCount), [20, 7]);
    check("metrics mode does not enable transcript debug logs", await page.evaluate(() => typeof window.__events), "undefined");
    await page.evaluate(() => { window.__courtMetrics.snapshot().connections[0].usage.latestReportedUsage.promptTokenCount = 999; });
    check("export cannot mutate retained observations", await page.evaluate(() => window.__courtMetrics.snapshot().connections[0].usage.latestReportedUsage.promptTokenCount), 20);
    check("no page errors", errors, []);
    check("no request leaves fixture origin except blocked fonts", external.filter(origin => !origin.includes("fonts.google")), []);
    console.log(`All ${tests} lifecycle checks passed.`);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
