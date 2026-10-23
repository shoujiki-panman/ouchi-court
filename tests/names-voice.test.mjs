// 名前の見分け方（public/names.js）と、判決の声（/api/voice）が本文だけを読むことを確かめる（架空データ・外へは出ない）
// 使い方: node tests/names-voice.test.mjs
import assert from "node:assert/strict";
const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const { addressedParty, selfNamedParty } = await import(`${ROOT}/public/names.js`);

let n = 0;
const ok = (name) => console.log(`ok ${++n} - ${name}`);
const P = ["デモテストアカ", "デモテストアオ"]; // 0=原告, 1=被告

// ── 書記官の呼びかけ ──
assert.equal(addressedParty("それでは、アオさん、改めてアカさんに心を込めてごめんなさいを言えますか？", P), 1);
ok("addresses Ao even though Aka is mentioned later (アカさんに = mention)");
assert.equal(addressedParty("おおっと、アオさんから和解の提案です！アカさん、この提案についてどう思いますか？", P), 0);
ok("アオさんから = mention; アカさん、 = address");
assert.equal(addressedParty("弁護人コン太です。つまりアオさんは、名前が読めなかったのですね。議論タイム、スタート！", P), -1);
ok("mention only (アオさんは) is not an address");
assert.equal(addressedParty("デモテストアカさんですね？承知しました！それでは被告さん、お名前と言い分を聞かせてくれるかな？", P), 1);
ok("name confirmation, then the defendant is addressed (role word)");
assert.equal(addressedParty("デモテストアカさんですね？承知しました！それでは被告さん、お名前と言い分を聞かせてくれるかな？", [P[0]]), 1);
ok("same, before the defendant's name is known");
assert.equal(addressedParty("デモテストアカさんですね？", P), 0);
ok("confirmation 「〇〇さんですね？」 counts as addressing that person");
assert.equal(addressedParty("それでは被告アオさん、プリンについて言い分を聞かせてくれるかな？", P), 1);
ok("short name after a role word (被告アオさん、)");
assert.equal(addressedParty("さあ、開廷します！まずは原告さん、お名前と何があったか教えてくれるかな？", []), 0);
ok("plaintiff addressed by role before any names");
assert.equal(addressedParty("コン太さん、どうぞ！", P), -1);
ok("non-party names are ignored");
assert.equal(addressedParty("素晴らしい仲直りですね！お二人はこれで判決をお願いしそうですか？", P), -1);
ok("no individual address → -1 (caller keeps the previous one)");
// 句読点なし／は付きの直接の問い（レビュー指摘）と、ただの言及との区別
const M = ["デモテストモモ", "デモテストクリ"];
assert.equal(addressedParty("モモさんはどう思いますか？", M), 0);
assert.equal(addressedParty("モモさんどう思う？", M), 0);
assert.equal(addressedParty("クリさんの言い分を聞きました。では、モモさんはどう思いますか？", M), 0);
ok("direct questions without 、 (「モモさんはどう思いますか？」「モモさんどう思う？」) address Momo");
assert.equal(addressedParty("モモさんは名前が消えかけていたと言っています。", M), -1);
assert.equal(addressedParty("モモさんは名前が読めなかったのですね。", M), -1);
assert.equal(addressedParty("モモさんは名前が消えかけていたと言っています。クリさん、どう思う？", M), 1);
ok("「モモさんは名前が…。」 is a mention, not an address");
assert.equal(addressedParty("クリさん、モモさんはどう思っていると思う？", M), 1);
ok("a 、-address earlier in the same question wins over 「〇〇さんは…？」");
// 役名＋「の人／の方」での呼びかけ（take5-duo 10/24 実例）と、言及との区別
assert.equal(addressedParty("名前付きプリンを勝手に食べられたなんて、それは聞き捨てならない！では、被告の人、名前を教えてくれるかな？", [M[0]]), 1);
assert.equal(addressedParty("まずは原告の人、名前と何があったか教えて！", []), 0);
assert.equal(addressedParty("デモテストモモさんですね？それでは被告の方、お名前を教えてくれるかな？", [M[0]]), 1);
ok("「被告の人、」「原告の人、」「被告の方、」 address by role (the last address in the turn wins)");
assert.equal(addressedParty("被告の人に聞いてみよう。", M), -1);
assert.equal(addressedParty("被告の人は名前が読めなかったそうです。", M), -1);
ok("「被告の人に」「被告の人は…。」 are mentions");
// ひらがな表記（take7-duo 10/24 実例：書記官は「モモ」を「もも」と書いた）。相手の名前の言及（クリさんの）では決めない
assert.equal(addressedParty("ももさん、クリさんの言い分に、何か言い返しはありますか？", M), 0);
assert.equal(addressedParty("ももさん、クリさんのこの提案について、どう思いますか？", M), 0);
assert.equal(addressedParty("それで、何があったのか、ももさん教えてくれるかな？", M), 0);
ok("hiragana 「ももさん、」 addresses デモテストモモ; 「クリさんの」 stays a mention");
assert.equal(selfNamedParty("ももです", M), 0);
assert.equal(selfNamedParty("デモテストくりです", M), 1);
ok("self-introduction matches across hiragana/katakana");
let q = "モモさんはどう思";
assert.equal(addressedParty(q, M), -1);
q += "いますか？";
assert.equal(addressedParty(q, M), 0);
ok("fragmented 「モモさんは…」: decided only once the sentence ends with ？");
// 断片で届く（Live の文字起こし）
let acc = "おおっと、アカさ";
assert.equal(addressedParty(acc, P), -1);
acc += "ん、どう思う？";
assert.equal(addressedParty(acc, P), 0);
ok("fragmented transcript: decided only once 「さん、」 is complete");
// 名前の頭が同じでも、末尾で見分ける／同じ長さで両方に合うときは決めない
assert.equal(addressedParty("アオさん、どうぞ", ["デモテストアオ", "デモテストアオイ"]), 0);
assert.equal(addressedParty("テストさん、どうぞ", ["デモテストアカ", "デモテストアオ"]), -1);
ok("shared prefixes: suffix decides; ambiguous → -1");

// ── 子どもの名乗り ──
assert.equal(selfNamedParty("デモテストアオです", P), 1);
assert.equal(selfNamedParty("わたしはデモテストアカです", P), 0);
assert.equal(selfNamedParty("アオです", P), 1);
ok("self-introduction picks the speaker");
assert.equal(selfNamedParty("アオさんが勝手に食べたんです", P), -1);
assert.equal(selfNamedParty("名前が消えかけていても、私が取っておいたのは知っていたはずです。", P), -1);
assert.equal(selfNamedParty("はい", P), -1);
assert.equal(selfNamedParty("ごめんね。次からは名前を確かめてから食べます。", P), -1);
ok("mentioning the other player or ordinary statements is not a self-introduction");

// ── 判決の声：本文だけを音声合成へ ──
const { default: worker } = await import(`${ROOT}/src/worker.js`);
const sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  sent.push({ url: String(url), body: JSON.parse(init.body) });
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { data: "AAAA", mimeType: "audio/L16;rate=24000" } }] } }] }), { status: 200, headers: { "content-type": "application/json" } });
};
const speech = "判決を言い渡します。テストさんの勝ちです。";
const r = await worker.fetch(new Request("https://example.test/api/voice", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: speech }) }), { GEMINI_API_KEY: "test-key-not-real", JUDGE_TTS_MODEL: "tts-test-model" });
globalThis.fetch = realFetch;
assert.equal(r.status, 200);
assert.equal(sent.length, 1);
assert.ok(sent[0].url.includes("/models/tts-test-model:generateContent"));
const parts = sent[0].body.contents[0].parts;
assert.deepEqual(parts, [{ text: speech }]);
assert.ok(!JSON.stringify(sent[0].body.contents).includes("読み上げて"));
assert.equal(sent[0].body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, "Gacrux");
ok("/api/voice sends only the verdict text (no style instruction in the spoken text); voice unchanged");

console.log(`\n${n} passed`);
