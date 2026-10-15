// おうち裁判（Alexa+ の体験をブラウザで再現したもの）のサーバー側。
//   POST /api/token    … Gemini Live の使い捨てトークンを渡す（API キーはブラウザに出さない）
//   POST /api/verdict  … 判事が判決を考える（判例集＝おやすみ MCP を引き、判決後に記録する）
//   POST /api/voice    … 判事の声（Gemini TTS。書記官とは別の声）
// どれも家族の合言葉（x-passphrase）が要る。画面（public/）はだれでも開ける。
import { mcpClient } from "./mcp.js";

const GEMINI = "https://generativelanguage.googleapis.com/v1beta";

const JUDGE_PROMPT =
  "あなたは家庭の裁判所の「タヌキ判事」。きょうだいや家族の小さなけんかを、法廷ごっこで楽しく裁く。相手は5〜10歳。" +
  "重々しく、でもちょっとおとぼけで笑える判事。法廷の記録と過去の判例を読み、判決を出す。" +
  "speech は読み上げる判決文で、必ず「判決を言い渡します。」で始め、4文まで: 勝った方（引き分け・和解もよい）／どちらの言い分のどこが良くてどこがよくなかったか／" +
  "判例があれば一言ふれる（例: 被告は先週もおやつの件で…）／罰。" +
  "罰は笑える小さな挑戦（変顔を10秒・ゾウのまねで部屋を一周・相手のいいところを3つ言う 等）か、仲直りの合図か、家の約束（歯磨き一番乗り 等）。" +
  "子どもを恥ずかしい目にあわせる罰、食べ物やおもちゃを取り上げる罰、痛い罰は絶対に出さない。どちらかを悪者と決めつけない。" +
  '出力は JSON だけ: {"speech": "...", "winner": "名前か draw", "sentence": "罰", "issue": "何のけんか（10字程度）", "plaintiff": "名前", "defendant": "名前"}';

const json = (data, status = 200) => Response.json(data, { status });

async function gemini(env, model, body) {
  const r = await fetch(`${GEMINI}/models/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": env.GEMINI_API_KEY, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`${model}: ${j.error?.message ?? r.status}`);
  return j;
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

// 判決：判例を引く → 判事が考える → 判例集に記録する
async function verdict(env, { record, names }) {
  const client = await mcp(env);
  const prec = names?.length ? textOf(await client.callTool("get_precedents", { names })) : "No precedents.";
  const out = await gemini(env, env.JUDGE_MODEL, {
    systemInstruction: { parts: [{ text: JUDGE_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: `法廷の記録:\n${record}\n\n${prec}` }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0.8, thinkingConfig: { thinkingLevel: "low" } },
  });
  const raw = out.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "{}";
  const v = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
  if (!v.speech) throw new Error("no verdict");
  await client
    .callTool("file_case", {
      plaintiff: v.plaintiff || names?.[0] || "原告",
      defendant: v.defendant || names?.[1] || "被告",
      issue: v.issue || "けんか",
      winner: v.winner || "draw",
      verdict: v.speech,
      sentence: v.sentence || "",
    })
    .catch((e) => console.log(`file_case failed: ${e}`));
  return { ...v, precedents: prec };
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
    if (request.method !== "POST") return json({ error: "POST only" }, 405);
    if (!env.LOGIN_PASSPHRASE || request.headers.get("x-passphrase") !== env.LOGIN_PASSPHRASE) return json({ error: "合言葉が違います" }, 401);
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
