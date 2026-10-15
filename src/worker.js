// おうち裁判（Alexa+ の体験をブラウザで再現したもの）のサーバー側。
//   POST /api/token    … Gemini Live の使い捨てトークンを渡す（API キーはブラウザに出さない）
//   POST /api/verdict  … 判事が判決を考える（判例集＝おやすみ MCP を引き、判決後に記録する）
//   POST /api/voice    … 判事の声（Gemini TTS。書記官とは別の声）
// 合言葉なしで使える（1日の回数に上限）。画面（public/）はだれでも開ける。
import { mcpClient } from "./mcp.js";
import { PUNISHMENTS, punishmentList } from "../public/punishments.js";

const GEMINI = "https://generativelanguage.googleapis.com/v1beta";

const JUDGE_PROMPT =
  "あなたは家庭の裁判所の「タヌキ判事」。きょうだいや家族の小さなけんかを、法廷ごっこで楽しく裁く。相手は5〜10歳。" +
  "重々しく、でもちょっとおとぼけで笑える裁判長。法廷の記録・3人の判事の票・過去の判例を読み、判決を出す。結論（だれの勝ちか・票数）はすでに決まっているので、そのとおりに言い渡し、変えないこと。" +
  "speech は読み上げる判決文で、必ず「判決を言い渡します。」で始め、4文まで: 勝った方（引き分け・和解もよい）／どちらの言い分のどこが良くてどこがよくなかったか／" +
  "判例が渡されたときだけ、その中身どおりに一言ふれる（判例がないときや、No precedents のときは過去の話をしない。日付や中身を作らない）／罰。" +
  "罰は、次の罰ゲームの一覧から1つ選び、punishment にその id を入れる（だれがやるかも決める。和解なら二人でやる）:\n" + punishmentList() + "\n" +
  "子どもを恥ずかしい目にあわせる罰、食べ物やおもちゃを取り上げる罰、痛い罰は絶対に出さない。どちらかを悪者と決めつけない。" +
  '出力は JSON だけ: {"speech": "...", "winner": "名前か draw", "punishment": "罰ゲームの id", "who": "罰ゲームをする人（名前 or 二人）", "sentence": "罰の一言", "issue": "何のけんか（10字程度）", "plaintiff": "名前", "defendant": "名前"}';

const json = (data, status = 200) => Response.json(data, { status });

// 混んでいるとき（high demand・503・429）は、次のモデルで試す
const FALLBACK = { "gemini-3.5-flash": ["gemini-flash-latest", "gemini-3.8-flash"], "gemini-flash-lite-latest": ["gemini-3.1-flash-lite", "gemini-3.5-flash"], "gemini-3.8-flash-lite-tts": ["gemini-3.8-flash-tts", "gemini-2.5-flash-preview-tts"] };

async function gemini(env, model, body) {
  let last;
  for (const m of [model, ...(FALLBACK[model] ?? [])]) {
    const r = await fetch(`${GEMINI}/models/${m}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": env.GEMINI_API_KEY, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (r.ok) return j;
    last = new Error(`${m}: ${j.error?.message ?? r.status}`);
    if (!(r.status === 503 || r.status === 429 || /demand|overloaded|unavailable/i.test(j.error?.message ?? ""))) throw last;
    console.log(`${m} busy, trying next`);
  }
  throw last;
}

const mcp = async (env) => {
  const client = mcpClient(env.OYASUMI_MCP_URL, env.MCP_TOKEN, (url, init) => env.OYASUMI.fetch(url, init));
  await client.connect();
  return client;
};
const textOf = (r) => (r.content ?? []).filter((x) => x.type === "text").map((x) => x.text).join("\n");

// Gemini Live の使い捨てトークン（1回だけ・1分以内に接続・30分で失効）。モデルだけ固定する。
async function token(env) {
  const now = Date.now();
  const r = await fetch(`${GEMINI}/auth_tokens`, {
    method: "POST",
    headers: { "x-goog-api-key": env.GEMINI_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({
      uses: 1,
      expireTime: new Date(now + 30 * 60 * 1000).toISOString(),
      newSessionExpireTime: new Date(now + 60 * 1000).toISOString(),
      // ドキュメントにある liveConnectConstraints は REST では「Cannot find field」で断られた（10/15）。1回きり・30分で失効させる

    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`token: ${j.error?.message ?? r.status}`);
  return { token: j.name, model: env.LIVE_MODEL };
}

// 合議の判事3人。見る所と、考える AI（会社）がそれぞれ違う。
const PANEL = [
  { id: "heart", title: "気持ち判事", view: "どちらがどれだけ嫌な気持ちになったか、気持ちを大事にして判断する", via: "gemini", model: "gemini-flash-lite-latest" },
  { id: "rule", title: "ルール判事", view: "順番・持ち主・先にしたこと など、家のルールと公平さで判断する", via: "workers", model: "@cf/mistralai/mistral-small-3.1-24b-instruct" },
  { id: "peace", title: "仲直り判事", view: "どう決めれば二人が一番早く仲直りできるかで判断する", via: "workers", model: "@cf/meta/llama-4-scout-17b-16e-instruct" },
];
const PANEL_PROMPT = (j) =>
  `あなたは家庭の法廷の「${j.title}」。${j.view}。子どものけんかなので、どちらかを悪者にしない。` +
  '出力は JSON だけ: {"vote": "勝った方の名前か draw", "reason": "25字以内の理由"}';

const parseJson = (raw) => JSON.parse(String(raw).slice(String(raw).indexOf("{"), String(raw).lastIndexOf("}") + 1));

async function panelVote(env, j, record) {
  const user = `法廷の記録:\n${record}`;
  if (j.via === "gemini") {
    const out = await gemini(env, j.model, {
      systemInstruction: { parts: [{ text: PANEL_PROMPT(j) }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.6 },
    });
    return parseJson(out.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join(""));
  }
  const out = await env.AI.run(j.model, {
    messages: [
      { role: "system", content: PANEL_PROMPT(j) },
      { role: "user", content: user },
    ],
    max_tokens: 200,
    temperature: 0.6,
    response_format: { type: "json_object" },
  });
  const r = out.response ?? out.choices?.[0]?.message?.content;
  return typeof r === "string" ? parseJson(r) : r;
}

// 判決：判例を引く → 3人の判事が票を入れる → 裁判長タヌキがまとめて言い渡す → 判例集に記録する
async function verdict(env, { record, names }) {
  const client = await mcp(env);
  const [prec, ...votes] = await Promise.all([
    names?.length ? client.callTool("get_precedents", { names }).then(textOf).catch(() => "No precedents.") : "No precedents.",
    ...PANEL.map((j) =>
      Promise.race([panelVote(env, j, record), new Promise((_, no) => setTimeout(() => no(new Error("timeout")), 9000))])
        .then((v) => ({ title: j.title, model: j.model, vote: String(v?.vote ?? "draw"), reason: String(v?.reason ?? "").slice(0, 40) }))
        .catch(() => ({ title: j.title, model: j.model, vote: "draw", reason: "（考えがまとまらず棄権）" })),
    ),
  ]);
  // 票を数えて結論はコードが決める（AI に数えさせたら「引き分け2・ハナ1」を「2対1でハナ」と読み違えた 10/15）
  const count = new Map();
  for (const v of votes) count.set(v.vote, (count.get(v.vote) ?? 0) + 1);
  const [top, n] = [...count.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["draw", 0];
  const decided = n >= 2 ? top : "draw";
  const score = decided === "draw" ? (n >= 2 ? `${n}対${votes.length - n}で和解（引き分け）` : "票が割れたので和解（引き分け）") : `${n}対${votes.length - n}で${decided}の勝ち`;
  const tally = `${votes.map((v) => `${v.title}: ${v.vote === "draw" ? "和解" : `${v.vote}の勝ち`}（${v.reason}）`).join("\n")}\n結論（変えないこと）: ${score}`;
  const out = await gemini(env, env.JUDGE_MODEL, {
    systemInstruction: { parts: [{ text: JUDGE_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: `法廷の記録:\n${record}\n\n判事たちの票:\n${tally}\n\n${prec}` }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0.8 },
  });
  const raw = out.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "{}";
  const v = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
  if (!v.speech) throw new Error("no verdict");
  await client
    .callTool("file_case", {
      plaintiff: v.plaintiff || names?.[0] || "原告",
      defendant: v.defendant || names?.[1] || "被告",
      issue: v.issue || "けんか",
      winner: decided,
      verdict: v.speech,
      sentence: v.sentence || "",
    })
    .catch((e) => console.log(`file_case failed: ${e}`));
  const winner = decided;
  const stamp = winner === "draw" ? "和解" : winner === (v.defendant || names?.[1]) ? "無罪" : "有罪";
  const pun = PUNISHMENTS.find((p) => p.id === v.punishment) ?? PUNISHMENTS[Math.floor(Math.random() * PUNISHMENTS.length)];
  return { ...v, panel: votes, stamp, punishment: pun, precedents: prec };
}

// 判事の声（24kHz の PCM を base64 で返す）
async function voice(env, text) {
  const out = await gemini(env, env.JUDGE_TTS_MODEL, {
    contents: [{ parts: [{ text: `重々しく、ゆっくり、でもどこかおとぼけな裁判官として読み上げて: ${text}` }] }],
    generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Gacrux" } } } },
  });
  const part = out.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!part) throw new Error("no audio");
  return { audio: part.inlineData.data, mimeType: part.inlineData.mimeType };
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (!pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    // 絵づくり（作るときだけ使う・MCP の合言葉つき）: Cloudflare Workers AI の画像モデル（鍵いらず）
    if (pathname === "/api/art") {
      if (request.headers.get("authorization") !== `Bearer ${env.MCP_TOKEN}`) return json({ error: "unauthorized" }, 401);
      const { prompt, model, width, height } = await request.json();
      const out = await env.AI.run(model ?? "@cf/black-forest-labs/flux-1-schnell", { prompt, steps: 8, ...(width ? { width, height } : {}) });
      if (out?.image) return json({ image: out.image });
      return new Response(out, { headers: { "content-type": "image/png" } });
    }
    if (request.method !== "POST") return json({ error: "POST only" }, 405);
    // 合言葉はやめた（10/15「合言葉とか知らない」）。代わりに1日の回数で止める（家族の合言葉があれば上限なし）
    const family = env.LOGIN_PASSPHRASE && request.headers.get("x-passphrase") === env.LOGIN_PASSPHRASE;
    if (!family && (pathname === "/api/token" || pathname === "/api/verdict")) {
      const day = new Date().toISOString().slice(0, 10);
      const k = `count:${pathname}:${day}`;
      const n = Number((await env.COURT.get(k)) ?? "0");
      if (n >= Number(env.DAILY_COURTS ?? "40")) return json({ error: "今日の法廷はもう閉まりました。また明日！" }, 429);
      await env.COURT.put(k, String(n + 1), { expirationTtl: 60 * 60 * 48 });
    }
    try {
      if (pathname === "/api/token") return json(await token(env));
      if (pathname === "/api/verdict") return json(await verdict(env, await request.json()));
      if (pathname === "/api/voice") return json(await voice(env, (await request.json()).text));
      return json({ error: "not found" }, 404);
    } catch (e) {
      console.log(`${pathname} failed: ${e}`);
      return json({ error: String(e) }, 500);
    }
  },
};
