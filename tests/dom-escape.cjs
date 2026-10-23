// 画面の表示経路で、AI の返事・お題・子どもの発言に混ざったタグやリンクが動かないことを確かめる（架空データだけ）
// public/ をこの PC から配り、/api/* は架空の応答に置き換える。外へのリクエストはすべて止める。
// 使い方: NODE_PATH=<playwright が入っている node_modules> node tests/dom-escape.cjs [app.js の別パス]
//   2つ目の引数を渡すと、その app.js で同じテストを回す（直す前の版で失敗することの確認用）
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");

const PUBLIC = path.join(__dirname, "..", "public");
const APP = process.argv[2] ? path.resolve(process.argv[2]) : path.join(PUBLIC, "app.js");
const ORIGIN = "http://court.test";
// 動いたら window.__xss が増える
const IMG = `<img src=x onerror="window.__xss++">`;
const EVIL = `${IMG}<script>window.__xss++</script>"'&`;
const JS_URL = "javascript:window.__xss++";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".mp3": "audio/mpeg", ".svg": "image/svg+xml", ".json": "application/json" };

const fake = {
  "/api/topics": { topics: [{ motion: `お題${EVIL}`, detail: `説明${EVIL}`, pro: `賛成${EVIL}`, con: `反対${EVIL}`, source: { url: JS_URL, title: `出典${EVIL}` } }] },
  "/api/kotodama": { bullets: [{ name: `札${EVIL}`, text: `中身${EVIL}` }, { name: "ふつうの札", text: "ふつう" }] },
  "/api/rival": { level: 1, wins: 0, losses: 0, draws: 0, last: null },
  "/api/investigate": { finding: `調査${EVIL}`, caption: `証拠${EVIL}`, sources: [{ url: JS_URL, title: `出典${EVIL}` }] },
};

let failed = 0;
const check = (name, cond, detail = "") => {
  console.log(`${cond ? "ok" : "not ok"} - ${name}${cond || !detail ? "" : `\n    ${detail}`}`);
  if (!cond) failed++;
};

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ locale: "ja-JP" });
  const external = [];
  await ctx.addInitScript(() => {
    window.__xss = 0;
    window.alert = () => window.__xss++;
  });
  await ctx.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== ORIGIN) {
      external.push(url.origin);
      return route.abort();
    }
    if (url.pathname.startsWith("/api/")) {
      const body = fake[url.pathname];
      return route.fulfill({ status: body ? 200 : 503, contentType: "application/json", body: JSON.stringify(body ?? { error: "テスト用に止めています" }) });
    }
    const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    if (file === "app.js") {
      // テストのときだけ、中の関数に触れる1行を足す（ファイル自体は変えない）
      const src = fs.readFileSync(APP, "utf8");
      const hook = `\nwindow.__t = { coach, resultCard, investigateCall, set(o) { if ("best" in o) best = o.best; if ("hints" in o) hints = o.hints; if ("speaker" in o) speaker = o.speaker; if ("live" in o) live = o.live; } };\n`;
      return route.fulfill({ status: 200, contentType: "text/javascript", body: src + hook });
    }
    const full = path.join(PUBLIC, file);
    if (!full.startsWith(PUBLIC) || !fs.existsSync(full)) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ status: 200, contentType: TYPES[path.extname(full)] ?? "application/octet-stream", body: fs.readFileSync(full) });
  });

  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${ORIGIN}/`);
  await page.waitForFunction(() => window.__t, null, { timeout: 10000 });

  // 検出のしくみ自体が動くこと（わざと素の HTML を入れる）
  const control = await page.evaluate(async () => {
    const d = document.createElement("div");
    d.innerHTML = `<img src=x onerror="window.__xss++">`;
    document.body.append(d);
    await new Promise((r) => setTimeout(r, 300));
    d.remove();
    const n = window.__xss;
    window.__xss = 0;
    return n;
  });
  check("positive control: a raw <img onerror> does run in this harness", control === 1, `__xss=${control}`);

  const inspect = (sel) =>
    page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      return {
        imgs: [...el.querySelectorAll("img")].filter((i) => !/^(img\/|data:image)/.test(i.getAttribute("src") ?? "")).length,
        scripts: el.querySelectorAll("script").length,
        jsLinks: [...el.querySelectorAll("a")].filter((a) => /^\s*javascript:/i.test(a.getAttribute("href") ?? "")).length,
        onAttrs: [...el.querySelectorAll("*")].filter((n) => [...n.attributes].some((a) => /^on/i.test(a.name))).length,
        text: el.textContent,
        title: [...el.querySelectorAll("[title]")].map((n) => n.getAttribute("title")).join("|"),
      };
    }, sel);
  const clean = (name, r, mustShow = true) => {
    check(`${name}: rendered`, !!r);
    if (!r) return;
    check(`${name}: no injected <img>/<script>/on* attributes`, r.imgs === 0 && r.scripts === 0 && r.onAttrs === 0, JSON.stringify({ imgs: r.imgs, scripts: r.scripts, onAttrs: r.onAttrs }));
    check(`${name}: no javascript: link`, r.jsLinks === 0, `jsLinks=${r.jsLinks}`);
    if (mustShow) check(`${name}: injected markup is shown as plain text`, r.text.includes("<img src=x onerror=") || r.title.includes("<img src=x onerror="), r.text.slice(0, 120));
  };

  // 1. お題の一覧（/api/topics の架空応答）
  await page.$eval("#solo", (el) => el.click());
  await page.waitForSelector("#topicList .topic", { timeout: 10000 });
  clean("topic list", await inspect("#topicList"));

  // 2. お題カードとヒントの札（/api/kotodama の架空応答）。開廷は /api/token が 503 なので先へ進まない
  await page.$eval("#topics .side", (el) => el.click());
  await page.waitForSelector("#topicCard details", { timeout: 10000 });
  await page.waitForSelector("#hintCards .hc", { timeout: 10000 });
  clean("topic card", await inspect("#topicCard"));
  clean("hint cards", await inspect("#hintCards"));

  // 3. コーチのひとこと・結果カード（名言・作戦メモ・判決のハンコ）
  await page.evaluate((EVIL) => {
    // 音は鳴らさない身代わり（app.js が speaker に呼ぶものをすべて空で用意する）
    const speaker = { ctx: new AudioContext(), busy: false, rate: 1, level: () => 0, clip() {}, stop() {}, play() {}, playWav() {} };
    window.__t.set({ speaker, best: { text: `名言${EVIL}`, strength: 3 }, hints: [`作戦${EVIL}`] });
    window.__t.coach(`コーチ${EVIL}`);
    window.__t.resultCard("win", { stamp: `勝訴${EVIL}` }).catch(() => {});
  }, EVIL);
  await page.waitForSelector("#result .card", { timeout: 10000 });
  clean("coach", await inspect("#coach"));
  const result = await inspect("#result");
  clean("result card", result);
  check("result card: quote, hint and stamp all shown as text", ["名言<img", "作戦<img", "勝訴<img"].every((s) => result?.text.includes(s)), result?.text.slice(0, 200));

  // 4. 調査官の証拠品（/api/investigate の架空応答・javascript: の出典）
  await page.evaluate(() => {
    window.__t.set({ live: { toolResponse() {}, send() {} } });
    return window.__t.investigateCall({ id: "t1", name: "investigate", args: { query: "テスト", mode: "search" } }).catch(() => {});
  });
  await page.waitForSelector("#evidence .ev", { timeout: 10000 });
  clean("evidence card", await inspect("#evidence"));

  await page.waitForTimeout(800);
  const xss = await page.evaluate(() => window.__xss);
  check("no injected handler ran anywhere (window.__xss === 0)", xss === 0, `__xss=${xss}`);
  // index.html の Google Fonts は読みにいくが、ここで止めている（外へは出ていない）
  const fonts = /^https:\/\/fonts\.(googleapis|gstatic)\.com$/;
  const other = [...new Set(external)].filter((o) => !fonts.test(o));
  check("no request other than the (blocked) Google Fonts stylesheet tried to leave the fake origin", other.length === 0, other.join(", "));
  if (external.length) console.log(`# blocked: ${[...new Set(external)].join(", ")}`);
  check("no unexpected page errors", errors.length === 0, [...new Set(errors)].slice(0, 5).join(" / "));

  await browser.close();
  console.log(failed ? `\n${failed} failed` : "\nall passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
