// 実際の public/app.js の childSeat（子どもが話したときに光らせる席）を、ローカルのページで確かめる（架空データ・外へは出ない）。
// public/ をこの PC から配り、/api/* は止める。テストのときだけ、配る app.js の末尾に中の変数を設定する1行を足す（ファイルは変えない）。
// 使い方: NODE_PATH=<playwright が入っている node_modules> node tests/seat.cjs
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const PUBLIC = path.join(__dirname, "..", "public");
const ORIGIN = "http://court.test";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".mp3": "audio/mpeg", ".svg": "image/svg+xml", ".json": "application/json" };
let failed = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "ok" : "not ok"} - ${name}${cond ? "" : `  (${detail})`}`); if (!cond) failed++; };

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const external = [];
  await ctx.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== ORIGIN) { external.push(url.origin); return route.abort(); }
    if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "stubbed" }) });
    const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    if (file === "app.js") {
      const hook = `\nwindow.__s = { childSeat, addressedParty, set(o) { if ("mode" in o) mode = o.mode; if ("parties" in o) { parties.length = 0; parties.push(...o.parties); } if ("lastCalled" in o) lastCalled = o.lastCalled; if ("step" in o) { STEPS = o.mode === "solo" ? SOLO_STEPS : VERSUS_STEPS; stepNow = STEPS.findIndex(([k]) => k === o.step); } }, heard(text) { const c = addressedParty(text, parties); if (c >= 0) lastCalled = c; return lastCalled; } };\n`;
      return route.fulfill({ status: 200, contentType: "text/javascript", body: fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8") + hook });
    }
    const full = path.join(PUBLIC, file);
    if (!full.startsWith(PUBLIC) || !fs.existsSync(full)) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ status: 200, contentType: TYPES[path.extname(full)] ?? "application/octet-stream", body: fs.readFileSync(full) });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${ORIGIN}/`);
  await page.waitForFunction(() => window.__s, null, { timeout: 10000 });
  const seat = (o, text) => page.evaluate(([o, text]) => { window.__s.set(o); return window.__s.childSeat(text); }, [o, text]);
  const P = ["デモテストアカ", "デモテストアオ"];

  // ひとりで挑戦は常に証言台（名前や相手の名前が入っていても）
  check("solo: witness", (await seat({ mode: "solo", parties: ["DemoTest62"], lastCalled: -1, step: "r1" }, "DemoTest62です")) === "witness");
  check("solo: witness even with names in text", (await seat({ mode: "solo", parties: ["賛成"], lastCalled: 1, step: "r2" }, "デモテストアオさんが言うけど")) === "witness");

  // ふたりで対戦
  const V = { mode: "versus", parties: P };
  // 書記官の呼びかけ（実例）→ 子どもの席
  let lc = await page.evaluate(([o]) => { window.__s.set({ ...o, lastCalled: -1, step: "debate" }); return window.__s.heard("おおっと、アオさんから和解の提案です！アカさん、この提案についてどう思いますか？"); }, [V]);
  check("versus: 「アオさんから…アカさん、」→ addressed Aka (0)", lc === 0, `lastCalled=${lc}`);
  check("versus: Aka's reply goes to the plaintiff seat", (await seat({}, "名前が消えかけていても、私が取っておいたのは知っていたはずです。")) === "plaintiff");
  lc = await page.evaluate(() => window.__s.heard("アカさんの条件が出ました！それでは、アオさん、改めてアカさんに心を込めてごめんなさいを言えますか？"));
  check("versus: 「アオさん、改めてアカさんに…」→ addressed Ao (1)", lc === 1, `lastCalled=${lc}`);
  check("versus: Ao's reply goes to the defendant seat", (await seat({}, "ごめんね。次からは名前を確かめてから食べます。")) === "defendant");
  // 相手の全名を言っても席は動かない（前は相手の席になった）
  check("versus: mentioning the other's full name does not move the seat", (await seat({ ...V, lastCalled: 0, step: "debate" }, "デモテストアオさんが勝手に食べたんです")) === "plaintiff");
  // 名乗りは本人の席
  check("versus: self-introduction overrides the last address", (await seat({ ...V, lastCalled: 0, step: "debate" }, "デモテストアオです")) === "defendant");
  // 名前の確認のあと被告へ呼びかけ → 被告の名乗り（被告の名前はまだ知らない）
  lc = await page.evaluate(() => { window.__s.set({ mode: "versus", parties: ["デモテストアカ"], lastCalled: -1, step: "plaintiff" }); return window.__s.heard("デモテストアカさんですね？承知しました！それでは被告さん、お名前と言い分を聞かせてくれるかな？"); });
  check("versus: confirmation then 「被告さん、」→ defendant (1)", lc === 1, `lastCalled=${lc}`);
  check("versus: the defendant's first words go to the defendant seat", (await seat({}, "デモテストアオです")) === "defendant");
  // 句読点なし／は付きの問い → 問われた人の席（前の話者の席を残さない）。ただの言及では動かない
  const MK = { mode: "versus", parties: ["デモテストモモ", "デモテストクリ"] };
  lc = await page.evaluate(([o]) => { window.__s.set({ ...o, lastCalled: 1, step: "debate" }); return window.__s.heard("モモさんはどう思いますか？"); }, [MK]);
  check("versus: 「モモさんはどう思いますか？」 after Kuri spoke → Momo (0)", lc === 0, `lastCalled=${lc}`);
  check("versus: Momo's reply goes to the plaintiff seat", (await seat({}, "勝手に食べたのはよくないと思います。")) === "plaintiff");
  lc = await page.evaluate(([o]) => { window.__s.set({ ...o, lastCalled: 1, step: "debate" }); return window.__s.heard("モモさんどう思う？"); }, [MK]);
  check("versus: 「モモさんどう思う？」 → Momo (0)", lc === 0, `lastCalled=${lc}`);
  lc = await page.evaluate(([o]) => { window.__s.set({ ...o, lastCalled: 1, step: "debate" }); return window.__s.heard("モモさんは名前が消えかけていたと言っています。"); }, [MK]);
  check("versus: 「モモさんは名前が…。」 (mention) keeps Kuri (1)", lc === 1, `lastCalled=${lc}`);
  // 呼びかけが無いときは段で
  check("versus: no address yet, defendant step → defendant", (await seat({ ...V, lastCalled: -1, step: "defendant" }, "でも、名前が消えかけていて読めませんでした。")) === "defendant");
  check("versus: no address yet, plaintiff step → plaintiff", (await seat({ ...V, lastCalled: -1, step: "plaintiff" }, "冷蔵庫の最後のプリンを…")) === "plaintiff");

  check("no unexpected page errors", errors.length === 0, errors.join(" / "));
  const other = [...new Set(external)].filter((o) => !/fonts\.(googleapis|gstatic)\.com/.test(o));
  check("no request left the local origin (except blocked Google Fonts)", other.length === 0, other.join(", "));
  await browser.close();
  console.log(failed ? `\n${failed} failed` : "\nall passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
