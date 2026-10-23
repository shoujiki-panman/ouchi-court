// /api/rival の端末ごとの分離・返す中身の最小化と、画面の esc()/safeUrl() を確かめる（架空データだけ・依存なし）
// 使い方: node tests/rival-escape.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const { default: worker } = await import(`${ROOT}/src/worker.js`);

// 架空の KV（読み書きしたキーを記録する）
const store = new Map([["rival", JSON.stringify({ level: 4, wins: 9, losses: 1, draws: 0, history: [{ topic: "FAKE-TOPIC", best: "FAKE-OLD-STATEMENT" }] })]]);
const reads = [], writes = [];
const COURT = {
  async get(k, type) { reads.push(k); const v = store.get(k); return v == null ? null : type === "json" ? JSON.parse(v) : v; },
  async put(k, v) { writes.push(k); store.set(k, v); },
};
const env = { COURT };
const call = async (id, body) => {
  const headers = { "content-type": "application/json" };
  if (id !== undefined) headers["x-court-id"] = id;
  const r = await worker.fetch(new Request("https://example.test/api/rival", { method: "POST", headers, body: JSON.stringify(body) }), env);
  return { status: r.status, body: await r.json() };
};
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-9222-222222222222";
const KEYS = ["draws", "last", "level", "losses", "wins"];
let n = 0;
const ok = (name) => console.log(`ok ${++n} - ${name}`);

// 1. A が2勝。余計な欄（お題・発言）を送っても残らない・返らない
await call(A, { result: "win", topic: "FAKE <b>topic</b>", best: "FAKE secret statement A" });
const a = await call(A, { result: "win", best: "FAKE secret statement A2" });
assert.equal(a.status, 200);
assert.deepEqual(Object.keys(a.body).sort(), KEYS);
assert.equal(a.body.wins, 2);
assert.equal(a.body.level, 3);
assert.equal(a.body.last, "win");
ok("client A records its own wins; response has only level/wins/losses/draws/last");

// 2. B は A の戦績を見ない
const b0 = await call(B, {});
assert.deepEqual(b0.body, { level: 1, wins: 0, losses: 0, draws: 0, last: null });
await call(B, { result: "lose" });
const b1 = await call(B, {});
assert.equal(b1.body.losses, 1);
assert.equal(b1.body.wins, 0);
const a2 = await call(A, {});
assert.equal(a2.body.wins, 2);
assert.equal(a2.body.losses, 0);
ok("client B is isolated from client A (both directions)");

// 3. 発言・お題が KV にも応答にも無い
const dump = JSON.stringify([...store.entries()].filter(([k]) => k !== "rival"));
assert.ok(!/FAKE secret|FAKE <b>|topic|best|history/.test(dump), dump);
assert.ok(!JSON.stringify([a.body, b0.body, b1.body]).includes("FAKE"));
ok("no statements/topics/history stored or returned");

// 4. 旧共有キー "rival" は読まない・消さない・書かない
assert.ok(!reads.includes("rival"), `reads: ${reads}`);
assert.ok(!writes.includes("rival"));
assert.ok(store.get("rival").includes("FAKE-OLD-STATEMENT"));
ok("legacy shared key 'rival' is never read, written or deleted");

// 5. KV のキーは ID そのものではなくハッシュ
for (const k of writes) {
  assert.match(k, /^rival:v2:[0-9a-f]{64}$/);
  assert.ok(!k.includes(A) && !k.includes(B));
}
ok("KV keys are SHA-256 hashes, not raw IDs");

// 6. ID が無い・形が違う・注入文字列 → 初期値だけ返し、何も書かない
const before = writes.length;
for (const bad of [undefined, "", "not-a-uuid", "rival", "../rival", "<script>alert(1)</script>", "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA", "11111111-1111-1111-1111-111111111111"]) {
  const r = await call(bad, { result: "win" });
  assert.deepEqual(r.body, { level: 1, wins: 0, losses: 0, draws: 0, last: null }, String(bad));
}
assert.equal(writes.length, before);
ok("missing/invalid IDs get defaults and write nothing");

// 7. result が想定外なら書かない
const w0 = writes.length;
await call(A, { result: "hacked" });
assert.equal(writes.length, w0);
ok("unknown result values are ignored");

// 8. 画面側の esc / safeUrl（app.js から取り出して検査）
const src = readFileSync(`${ROOT}/public/app.js`, "utf8");
const escLine = src.match(/^const esc = .*$/m)[0];
const urlLine = src.match(/^const safeUrl = .*$/m)[0];
const { esc, safeUrl } = new Function("location", `${escLine}\n${urlLine}\nreturn { esc, safeUrl };`)({ href: "https://ouchi-court.panman.workers.dev/" });
const evil = `<img src=x onerror=alert(1)>"'&</small><script>alert(2)</script>`;
const out = esc(evil);
assert.ok(!/[<>"']/.test(out), out);
assert.equal(out, "&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;&lt;/small&gt;&lt;script&gt;alert(2)&lt;/script&gt;");
assert.equal(esc(null), "");
assert.equal(esc(3), "3");
ok("esc() neutralizes tags, quotes and ampersands");
assert.equal(safeUrl("javascript:alert(1)"), "");
assert.equal(safeUrl("data:text/html,<b>x</b>"), "");
assert.equal(safeUrl(" JaVaScRiPt:alert(1)"), "");
assert.equal(safeUrl("https://example.com/a?b=1"), "https://example.com/a?b=1");
assert.equal(safeUrl("http://example.com/"), "http://example.com/");
ok("safeUrl() allows only http(s)");

// 9. 指定の表示箇所が esc / textContent を通っている（静的確認）
const must = [
  /class="hc" data-i="\$\{i\}" title="\$\{esc\(b\.text\)\}"><b>\$\{esc\(b\.name\)\}/,
  /<b>\$\{esc\(b\.name\)\}<\/b><small>\$\{esc\(b\.text\)\}<\/small>/,
  /\$\("coach"\)\.querySelector\("\.ct"\)\.textContent = /,
  /きょうの名言<\/b>「\$\{esc\(best\.text/,
  /map\(\(h\) => `・\$\{esc\(h\)\}`\)/,
  /<div class="rt display">\$\{esc\(title\)\}/,
  /お題：\$\{esc\(topic\.motion\)\}/,
  /<b>\$\{esc\(t\.motion\)\}<\/b><small>\$\{esc\(t\.detail \?\? t\.background\)\}/,
  /🔍 \$\{esc\(r\.finding\)\}/,
];
for (const re of must) assert.match(src, re);
// innerHTML を使う行（複数行の結果カードは 1 つにまとめて）に、素の発言・AI 出力が残っていない
const start = src.indexOf('$("result").innerHTML');
const resultCard = src.slice(start, src.indexOf("</div>`;", start));
const htmlBlocks = [...src.split("\n").filter((l) => /innerHTML/.test(l)), resultCard];
const raw = /\$\{(best\.text|topic\??\.motion|topic\.detail|topic\.pro|topic\.con|r\.finding|b\.text|b\.name|t\.motion|t\.detail|text|h|title|p\.title|e\.message)[ }]/;
const bad = htmlBlocks.filter((b) => raw.test(b));
assert.deepEqual(bad, [], bad.join("\n---\n"));
ok("named innerHTML sites now escape model/child text");

console.log(`\n${n} passed`);
