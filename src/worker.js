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
  if (j.via !== "gemini" && Date.now() < aiOutUntil) return askGemini(env, PANEL_PROMPT(j), user);
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
  }).catch((e) => {
    // 失敗の理由を残す（無料枠切れ等が見えないまま「採点されない」になった 10/16）
    console.log(`AI ${j.model} failed: ${e}`);
    if (/4006|daily free allocation/.test(String(e))) aiOutUntil = Date.now() + 30 * 60 * 1000;
    return { fallback: true };
  });
  if (out.fallback) return askGemini(env, PANEL_PROMPT(j), user);
  const r = out.response ?? out.choices?.[0]?.message?.content;
  return typeof r === "string" ? parseJson(r) : r;
}

// 判決：判例を引く → 3人の判事が票を入れる → 裁判長タヌキがまとめて言い渡す → 判例集に記録する
async function verdict(env, { record, names, winner: forced, points }) {
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
  // ひとりで挑戦は点数で勝ち負けが決まる（票がちがうと「何も話していないのに勝った」になった 10/16）
  if (forced) for (const v of votes) v.vote = forced;
  const count = new Map();
  for (const v of votes) count.set(v.vote, (count.get(v.vote) ?? 0) + 1);
  const [top, n] = [...count.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["draw", 0];
  const decided = forced ?? (n >= 2 ? top : "draw");
  const score = forced ? (forced === "draw" ? `点数 ${points} で引き分け` : `点数 ${points} で${forced}の勝ち`) : decided === "draw" ? (n >= 2 ? `${n}対${votes.length - n}で和解（引き分け）` : "票が割れたので和解（引き分け）") : `${n}対${votes.length - n}で${decided}の勝ち`;
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
  // id が外れたら、セリフに出てくる罰ゲームを探す（セリフは「ポンポコポン」なのに画面は別の罰、が起きた 10/16）
  const key = (p) => p.text.replace(/[「」（）()]/g, "").slice(0, 6);
  const said = `${v.punishment ?? ""} ${v.speech ?? ""}`;
  const pun = PUNISHMENTS.find((p) => p.id === v.punishment) ?? PUNISHMENTS.find((p) => said.includes(key(p))) ?? PUNISHMENTS[Math.floor(Math.random() * PUNISHMENTS.length)];
  return { ...v, panel: votes, stamp, punishment: pun, precedents: prec };
}

// Workers AI に JSON で答えさせる小さな道具
let aiOutUntil = 0;
async function askGemini(env, system, user) {
  const out = await gemini(env, "gemini-flash-lite-latest", {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: user }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0.6 },
  });
  return parseJson(out.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "{}");
}
async function ask(env, model, system, user, maxTokens = 220) {
  // Workers AI の無料枠（1日1万ニューロン）が切れたら、Gemini の軽いモデルで代わりに答える（10/16 テストで使い切って採点が止まった）
  if (Date.now() < aiOutUntil) return askGemini(env, system, user);
  const out = await env.AI.run(model, {
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    max_tokens: maxTokens,
    temperature: 0.6,
    response_format: { type: "json_object" },
  }).catch((e) => {
    // 失敗の理由を残す（無料枠切れ等が見えないまま「採点されない」になった 10/16）
    console.log(`AI ${model} failed: ${e}`);
    // 無料枠切れなら、しばらく Workers AI を呼ばずに最初から Gemini へ（毎回失敗を待つと採点が遅れて落ちる）
    if (/4006|daily free allocation/.test(String(e))) aiOutUntil = Date.now() + 30 * 60 * 1000;
    return { fallback: true };
  });
  if (out.fallback) return askGemini(env, system, user);
  const r = out.response ?? out.choices?.[0]?.message?.content;
  return typeof r === "string" ? parseJson(r) : r;
}
const within = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error("timeout")), ms))]);

// 弁護人（2人とも別の AI）：相手の発言が自分の依頼人に不利・言いすぎ・食い違いなら「異議あり！」と割り込む
const LAWYERS = [
  { id: "lawyerP", name: "弁護人ポン子", side: "原告", model: "@cf/mistralai/mistral-small-3.1-24b-instruct" },
  { id: "lawyerD", name: "弁護人コン太", side: "被告", model: "@cf/meta/llama-4-scout-17b-16e-instruct" },
];
async function lawyers(env, { record, last, plaintiff, defendant }) {
  // 「だれを責めている発言か」だけを AI に聞き、どの弁護人が出るかはコードが決める（AI に任せたら依頼人の側に異議を出した 10/16）
  const p = plaintiff || "原告", d = defendant || "被告";
  const v = await within(
    ask(
      env,
      "@cf/mistralai/mistral-small-3.1-24b-instruct",
      `家庭の法廷。原告=${p}、被告=${d}。いちばん新しい発言が、どちらかを悪い・ずるい・わざと・勝手に などと責めたり決めつけたりしているかを判定する。` +
        `責められている人が${p}なら "plaintiff"、${d}なら "defendant"、だれも責めていない・ふつうの説明なら "none"。` +
        `lean は、この発言がどちらの言い分を強くするか（筋の通った理由・事実・相手の矛盾をついた なら強くなる。ただの悪口や決めつけは強くならない）: "plaintiff" / "defendant" / "none"。strength は 1〜3。` +
        '出力は JSON だけ: {"target": "plaintiff | defendant | none", "lean": "plaintiff | defendant | none", "strength": 1}',
      `これまで:\n${record}\n\nいちばん新しい発言: ${last}`,
    ),
    9000,
  ).catch(() => ({ target: "none" }));
  // 天秤：この発言がどちらを強くしたか（-3〜3。マイナスは原告側）
  const sway = v?.lean === "plaintiff" ? -Math.min(3, Number(v.strength) || 1) : v?.lean === "defendant" ? Math.min(3, Number(v.strength) || 1) : 0;
  if (v?.target !== "plaintiff" && v?.target !== "defendant") return { id: null, sway };
  const l = LAWYERS.find((x) => x.side === (v.target === "plaintiff" ? "原告" : "被告"));
  const client = v.target === "plaintiff" ? p : d;
  // 出る弁護人が決まってから、その弁護人として依頼人をかばう一言を作る
  const w = await within(
    ask(
      env,
      l.model,
      `あなたは家庭の法廷の${l.name}。依頼人は${client}。いま${client}が責められた。${client}をかばう、子どもにも分かる一言を言う。相手を悪者にしない。` +
        '出力は JSON だけ: {"line": "異議あり！から始まる40字以内"}',
      `責めた発言: ${last}`,
      120,
    ),
    5000,
  ).catch(() => null);
  let line = String(w?.line ?? `異議あり！${client}さんのことを決めつけないでください！`).slice(0, 60);
  if (!line.startsWith("異議あり")) line = `異議あり！${line}`;
  return { id: l.id, name: l.name, line, sway, defends: v.target };
}

// 調査官ホー：「調べる」は Wikipedia（鍵いらず）を引いて子ども向けにまとめる。「再現」は状況の絵を描く（Workers AI の画像モデル）
async function investigate(env, { query, mode }) {
  if (mode === "illustrate") {
    const p = await within(
      ask(env, "@cf/mistralai/mistral-small-3.1-24b-instruct", '子どものけんかの場面を、絵を描く AI への英語の指示に直す。出力は JSON だけ: {"prompt": "英語で1文", "caption": "日本語で15字以内の題"}', query),
      12000,
    );
    const img = await env.AI.run("@cf/black-forest-labs/flux-1-schnell", {
      prompt: `${p.prompt}. Cute anime illustration, evidence photo style, bright, kid-friendly, no text.`,
      steps: 6,
    });
    return { kind: "illustrate", caption: p.caption || "再現イラスト", image: img.image, finding: `再現イラスト「${p.caption}」を作りました。` };
  }
  const api = (q) => `https://ja.wikipedia.org/w/api.php?${q}&format=json&origin=*`;
  const hdr = { headers: { "user-agent": "ouchi-court/0.1 (family mock trial; https://ouchi-court.panman.workers.dev)" } };
  // 長い問いのままだと関係ない記事が出る（10/16）。先に検索の言葉を1〜2語に絞る
  const kw = await within(ask(env, "@cf/mistralai/mistral-small-3.1-24b-instruct", '問いを、百科事典で引く日本語の見出し語1〜2語に直す。出力は JSON だけ: {"words": "語 語"}', query, 60), 6000).catch(() => ({ words: query }));
  const hits = (await (await fetch(api(`action=query&list=search&srlimit=2&srsearch=${encodeURIComponent(kw.words || query)}`), hdr)).json()).query?.search ?? [];
  let text = "";
  const sources = [];
  for (const h of hits) {
    const page = Object.values((await (await fetch(api(`action=query&prop=extracts&exintro=1&explaintext=1&titles=${encodeURIComponent(h.title)}`), hdr)).json()).query?.pages ?? {})[0];
    if (page?.extract) {
      text += `【${h.title}】${page.extract.slice(0, 700)}\n`;
      sources.push({ title: h.title, url: `https://ja.wikipedia.org/wiki/${encodeURIComponent(h.title)}` });
    }
  }
  const SUMMARY =
      "あなたは家庭の法廷の調査官ホー（フクロウの探偵）。調べた資料をもとに、問いに子どもにも分かる言葉で2文以内で答える。資料に答えがなければ「資料では分からなかった」と正直に言い、一般的な考え方を1文添える。" +
        'title は資料の名前ではなく、問いの中身を表す証拠品の名前にする。出力は JSON だけ: {"finding": "...", "title": "証拠品の名前（10字以内）", "used": "資料が答えに役立ったら true、関係なかったら false"}';
  const material = `問い: ${query}\n\n資料:\n${text || "（見つからなかった）"}`;
  // 弁護人と同時に呼ばれると Workers AI が遅くなる（10/16 7秒で打ち切られた）。長めに待ち、だめなら Gemini でまとめる
  const v = await within(ask(env, "@cf/mistralai/mistral-small-3.1-24b-instruct", SUMMARY, material), 12000).catch(async () => {
    const out = await gemini(env, "gemini-flash-lite-latest", {
      systemInstruction: { parts: [{ text: SUMMARY }] },
      contents: [{ role: "user", parts: [{ text: material }] }],
      generationConfig: { responseMimeType: "application/json" },
    });
    return parseJson(out.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join(""));
  });
  return { kind: "search", caption: v.title || "調査結果", finding: v.finding, sources: v.used === true || v.used === "true" ? sources : [] };
}

// ひとりで挑戦モードのお題：Wikipedia「最近の出来事」から、子どもが議論できる話題だけを選んで「〇〇に賛成？反対？」にする
const EVERGREEN = [
  { motion: "宿題は、なくしたほうがいい？", background: "毎日の宿題、あったほうがいい？ないほうがいい？", detail: "学校では毎日のように宿題が出るよね。家で復習できる一方で、遊ぶ時間や家族との時間が減るという声もあるよ。", pro: "遊びや好きなことに使える時間が増える", con: "家で練習しないと、習ったことを忘れちゃう", source: null },
  { motion: "給食に、毎日デザートを出すべき？", background: "デザートが毎日あったらうれしいけど…？", detail: "給食のデザートは、今はときどき出る特別なもの。毎日出たらうれしいけど、栄養やお金のことを考える大人もいるよ。", pro: "毎日の楽しみができて、給食がもっと好きになる", con: "あまいものが多いと体によくないし、特別感がなくなる", source: null },
  { motion: "ペットにするなら、ねこより犬？", background: "ペットにするなら、犬派？ねこ派？", detail: "犬はいっしょに散歩や遊びができて、ねこは自分のペースでのんびり。どちらも人気のペットだよ。", pro: "犬は散歩でいっしょに元気に遊べる", con: "ねこは静かで、お世話が少なくてすむ", source: null },
  { motion: "夏休みは、もっと長くするべき？", background: "夏休みがもっと長かったら…？", detail: "夏休みは今だいたい40日くらい。もっと長いと遊べるけど、暑さや勉強のことを心配する声もあるよ。", pro: "旅行や自由研究にじっくり取り組める", con: "長すぎると学校のリズムを忘れちゃう", source: null },
  { motion: "朝ごはんは、パンよりごはん？", background: "朝はパン派？ごはん派？", detail: "朝ごはんをパンにするか、ごはんにするかは家によってちがうよ。どちらにもいいところがあるんだ。", pro: "ごはんは腹もちがよくて、お昼まで元気", con: "パンはすぐ食べられて、いそがしい朝にぴったり", source: null },
  { motion: "おこづかいは、お手伝いでもらうべき？", background: "お手伝いしたらおこづかい、あり？なし？", detail: "毎月決まった額をもらう家もあれば、お手伝いをしたらもらえる家もあるよ。どちらがいいか意見が分かれるんだ。", pro: "がんばった分もらえると、やる気が出る", con: "家族のお手伝いは、お金のためじゃない", source: null },
  { motion: "ゲームは1日1時間までにするべき？", background: "ゲームの時間、決めたほうがいい？", detail: "ゲームは楽しいけど、やりすぎると目や睡眠が心配。時間を決める家も、決めない家もあるよ。", pro: "時間を決めると、宿題や外遊びもできる", con: "1時間だとステージが終わらないこともある", source: null },
  { motion: "学校の制服は、あったほうがいい？", background: "制服と私服、どっちがいい？", detail: "制服のある学校と、私服で通う学校があるよ。毎朝服を選ばなくていい一方で、好きな服を着たい人もいるんだ。", pro: "毎朝服で迷わないし、みんな同じで安心", con: "好きな服を着たほうが、自分らしくいられる", source: null },
  { motion: "大人になったら、宇宙旅行に行くべき？", background: "いつか宇宙に行けるとしたら？", detail: "宇宙に旅行する時代が少しずつ近づいているよ。地球を外から見られるけど、まだお金も勇気もたくさんいるんだ。", pro: "地球を宇宙から見るなんて一生の思い出", con: "まだ危ないし、地球にも楽しい場所がたくさんある", source: null },
  { motion: "ロボットに、お部屋のそうじを全部まかせていい？", background: "おそうじロボットに全部まかせたら？", detail: "床をそうじするロボットはもう多くの家にあるよ。全部まかせたら楽だけど、自分でやる大切さを言う人もいるんだ。", pro: "そうじの時間で、好きなことができる", con: "自分で片づける力がつかなくなる", source: null },
  { motion: "小学生もスマホを持っていい？", background: "連絡に便利。でも使いすぎも心配。", detail: "スマホを持つ小学生が増えているよ。家族とすぐ連絡できて安心な反面、ゲームや動画で使いすぎる心配もあるんだ。", pro: "何かあったときにすぐ家族に連絡できる", con: "ゲームや動画ばかりになって、勉強や睡眠がへる", source: null },
];
// 子どもに出さない話題（AI の判断だけに任せない。10/16 トラに襲われて亡くなったニュースがお題になった）
const UNSAFE = /死|亡くな|殺|遺体|事故|事件|逮捕|容疑|襲|負傷|けが|怪我|災害|地震|津波|火災|火事|台風|大雨|訴|裁判|判決|戦争|攻撃|爆|テロ|銃|自殺|いじめ|虐待|結婚|熱愛|交際|不倫|離婚|破局|妊娠|選挙|首相|大臣|議員|株|円安|物価|ギャンブル|酒|たばこ|薬物|降板|謝罪|声明|不祥事|活動休止|炎上|処分|税|病|入院|死去|訃報/;
// 日本語のニュースだけ（Googleトレンドには外国語の見出しが混ざる 10/16）
const JAPANESE = /[ぁ-んァ-ヶ]/;
async function topics(env) {
  const freshP = freshTopics(env);
  let items = [];
  let src = { title: "Googleトレンド（いま話題）", url: "https://trends.google.co.jp/trending?geo=JP" };
  // いま話題：Google トレンドの「急上昇」（公開の RSS・鍵いらず・数時間ごとに更新）。Wikipedia は遅れる（10/16「最近の話題についてこれない」）
  try {
    const rss = await (await fetch("https://trends.google.co.jp/trending/rss?geo=JP", { headers: { "user-agent": "Mozilla/5.0 (ouchi-court)" } })).text();
    items = [...rss.matchAll(/<item>([\s\S]*?)<\/item>/g)]
      .map((m) => {
        const t = m[1].match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "";
        const n = m[1].match(/<ht:news_item_title>([\s\S]*?)<\/ht:news_item_title>/)?.[1] ?? "";
        return `${t}：${n}`.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
      })
      .filter((t) => !UNSAFE.test(t) && JAPANESE.test(t))
      .slice(0, 25);
  } catch {}
  if (!items.length) try {
    src = { title: "Wikipedia「最近の出来事」", url: "https://ja.wikipedia.org/wiki/Portal:最近の出来事" };
    const r = await fetch("https://ja.wikipedia.org/w/api.php?action=parse&page=Portal:%E6%9C%80%E8%BF%91%E3%81%AE%E5%87%BA%E6%9D%A5%E4%BA%8B&prop=text&format=json&formatversion=2", {
      headers: { "user-agent": "ouchi-court/0.1 (family mock trial; https://ouchi-court.panman.workers.dev)" },
    });
    const html = (await r.json()).parse?.text ?? "";
    items = [...html.matchAll(/<li>([\s\S]*?)<\/li>/g)]
      .map((m) => m[1].replace(/<[^>]+>/g, "").replace(/&#?\w+;/g, " ").trim())
      .filter((t) => t.length > 20 && !UNSAFE.test(t))
      .slice(0, 25);
  } catch {}
  let picked = [];
  if (items.length) {
    // 1段目：番号で3つ選んでお題にする。2段目：説明は、選んだニュース1本だけを見せて書かせる
    // （一度に書かせると、別のニュースの説明が混ざった 10/16「スポーツの試合」のお題にマツダの説明）
    const v = await within(
      ask(
        env,
        "@cf/mistralai/mistral-small-3.1-24b-instruct",
        "いま話題のキーワードとニュースの番号つき一覧から、小学生が賛成・反対で楽しく議論できる話題を5つ選ぶ（それぞれ別のニュースから。同じニュースから2つ作らない）。人が亡くなった・けがをした・災害・事件・裁判・戦争・政治家の争い・芸能人の恋愛や結婚・お金のもうけ話は選ばない（スポーツ・ゲーム・食べ物・動物・科学・発明・記録・季節の行事などがよい）。" +
          "それぞれを、そのニュースから広げた「意見が分かれる」お題にする。ニュースの事実をそのまま聞くのではなく、子どもが自分の考えで賛成・反対を言えるもの。" +
          "例: 女性が初めて棋士になった → 「スポーツやゲームは、男女いっしょの大会にするべき？」／ノーベル賞の研究 → 「すぐ役に立たない研究にも、お金を使うべき？」。" +
          '出力は JSON だけ: {"topics": [{"n": 一覧の番号, "motion": "お題（25字以内）"}]}',
        items.map((t, i) => `${i}. ${t}`).join("\n"),
        800,
      ),
      20000,
    ).catch(() => null);
    const used = new Set();
    const chosen = (v?.topics ?? []).filter((t) => t?.motion && items[Number(t.n)] && !UNSAFE.test(t.motion) && !used.has(Number(t.n)) && used.add(Number(t.n))).slice(0, 5);
    picked = (
      await Promise.all(
        chosen.map(async (t) => {
          const news = items[Number(t.n)];
          const d = await within(
            ask(
              env,
              "@cf/mistralai/mistral-small-3.1-24b-instruct",
              `お題「${t.motion}」の説明を、下のニュース1本だけをもとに書く。background はニュースを10歳にも分かる言葉で一言（〜だよ。の口調・40字以内）。detail は、何があったか・なぜ話題か を10歳に分かる言葉で2〜3文（ニュースに書いていない事実を付け足さない。年・日付・数字はニュースに書いてあるものだけ。分からない所は「〜らしい」「〜と話題」にとどめる）。pro と con は、賛成派・反対派がよく言いそうな理由を1つずつ（子どもの言葉で）。` +
                '出力は JSON だけ: {"background": "...", "detail": "...", "pro": "...", "con": "..."}',
              news,
              500,
            ),
            12000,
          ).catch(() => null);
          if (!d?.detail || UNSAFE.test(`${d.detail}${d.background}`)) return null;
          return { motion: t.motion, background: d.background, detail: d.detail, pro: d.pro, con: d.con, source: { ...src, news } };
        }),
      )
    ).filter(Boolean);
  }
  // シャッフルできるように、いま話題・AIの新作・定番を全部返す（10/16「テーマはシャッフルできない？」「お題少なくないか？」）
  const fresh = await freshP;
  const seen = new Set();
  const all = [...picked, ...fresh, ...EVERGREEN].filter((t) => !seen.has(t.motion) && seen.add(t.motion));
  return { topics: all };
}

// AIの新作お題：いろいろなジャンルから子どもが賛成・反対で話せるお題を作る（1時間ごとにキャッシュごと入れかわる）
async function freshTopics(env) {
  const genres = ["食べ物", "動物", "学校", "家のこと", "遊び・ゲーム", "スポーツ", "科学・宇宙", "未来の発明", "季節の行事", "乗り物", "お金・おこづかい", "本・アニメ"];
  const v = await within(
    askGemini(
      env,
      `小学生が家族と賛成・反対で楽しく議論できるお題を12個作る。ジャンルは次から1つずつ: ${genres.join("、")}。` +
        "答えが1つに決まらず、どちらの側にも子どもの言葉で理由が言えるもの。人が傷つく話・怖い話・事件・病気・政治・恋愛は入れない。motion は「〜するべき？」「〜したほうがいい？」の形で25字以内。" +
        "background は一言（〜だよ。の口調・40字以内）、detail は10歳に分かる説明2文（作り話の数字や固有名詞を入れない）、pro と con は賛成派・反対派の理由を1つずつ（子どもの言葉）。" +
        '出力は JSON だけ: {"topics": [{"motion": "...", "background": "...", "detail": "...", "pro": "...", "con": "..."}]}',
      `今日の日付: ${new Date().toISOString().slice(0, 10)}（季節に合うお題もまぜる）`,
    ),
    15000,
  ).catch(() => null);
  return (v?.topics ?? [])
    .filter((t) => t?.motion && t?.detail && !UNSAFE.test(`${t.motion}${t.detail}${t.background}`))
    .slice(0, 12)
    .map((t) => ({ motion: String(t.motion).slice(0, 30), background: t.background, detail: t.detail, pro: t.pro, con: t.con, source: null, fresh: true }));
}

// ひとりで挑戦モードの相手：プレイヤーの主張に弱い所があれば、反対側の弁護人コン太が反論で割り込む
// ダンガンロンパの「ノンストップ議論」（10/16「もっとダンガンロンパっぽく」）
// 開廷前に、子どもが使える「コトダマ」（証拠・事実のカード）を3つ配る
async function kotodama(env, { topic, side, detail, pro, con }) {
  const v = await within(
    askGemini(
      env,
      `子ども向けのディベートゲーム。お題「${topic}」で子どもは「${side}」側。子どもが相手の言い分を崩すのに使える「コトダマ」（証拠や事実のカード）を3つ作る。` +
        "お題の説明に書いてあることか、だれでも知っている一般的なことだけを使う（数字や固有名詞を作らない）。name は10字以内、text はそのカードの中身を30字以内（10歳に分かる言葉）。3つは別々の切り口にする。" +
        '出力は JSON だけ: {"bullets": [{"name": "...", "text": "..."}]}',
      `お題の説明: ${detail ?? ""}\n賛成の理由の例: ${pro ?? ""}\n反対の理由の例: ${con ?? ""}`,
    ),
    9000,
  ).catch(() => null);
  const bullets = (v?.bullets ?? []).filter((b) => b?.name && b?.text).slice(0, 3).map((b) => ({ name: String(b.name).slice(0, 12), text: String(b.text).slice(0, 40) }));
  return { bullets };
}
// ノンストップ議論のセリフ：コン太ともう1人が反論。黄色い「ウィークポイント」のうち1つだけが、コトダマで崩せる本物の弱点
async function debate(env, { topic, side, statement, bullets = [], level = 1 }) {
  const list = bullets.map((b, i) => `${i}: ${b.name}（${b.text}）`).join("\n");
  const v = await within(
    askGemini(
      env,
      `子ども向けのディベートゲーム。お題「${topic}」で子どもは「${side}」側。子どもの発言に対して、反対側の2人が短く言い返すセリフを作る。` +
        "lines[0] はライバルのコン太（キツネの弁護人・少し生意気）、lines[1] は観客（ざわざわした声）。各セリフは35字以内で、子どもを傷つける言い方はしない。" +
        "それぞれのセリフに weak（セリフの中にそのまま入っている6〜14字の部分）を1つ決める。どちらか1つの weak だけを、下のコトダマのどれかで崩せる本物の弱点（言い過ぎ・決めつけ・説明と食い違う所）にする。もう1つはそれっぽいが崩せない所にする。" +
        `answer に、本物の弱点がある line の番号と、それを崩せる bullet の番号を入れる。コン太のレベルは${level}（高いほど弱点を目立たなくする）。` +
        '出力は JSON だけ: {"lines": [{"text": "...", "weak": "..."}, {"text": "...", "weak": "..."}], "answer": {"line": 0, "bullet": 0}}',
      `コトダマ:\n${list}\n\n子どもの発言: ${statement}`,
    ),
    9000,
  ).catch(() => null);
  const lines = (v?.lines ?? []).filter((l) => l?.text).slice(0, 2).map((l) => {
    const text = String(l.text).slice(0, 50);
    // weak がセリフに入っていなければ、真ん中あたりを弱点にする
    const weak = l.weak && text.includes(l.weak) ? String(l.weak) : text.slice(Math.floor(text.length / 3), Math.floor(text.length / 3) + 8);
    return { text, weak };
  });
  if (lines.length < 2 || !bullets.length) return { lines: [] };
  const line = Number(v?.answer?.line) === 1 ? 1 : 0;
  const bullet = Math.max(0, Math.min(bullets.length - 1, Number(v?.answer?.bullet) || 0));
  return { lines, answer: { line, bullet } };
}

async function opponent(env, { topic, side, record, last, level = 1 }) {
  const v = await within(
    ask(
      env,
      "@cf/mistralai/mistral-small-3.1-24b-instruct",
      `お題「${topic}」で、子どもは「${side}」側。あなたは反対側の弁護人コン太。子どもの最新の発言に、理由がない・決めつけ・前と食い違う などの弱い所があれば「異議あり！」で短く反論する。よい理由が言えていたら割り込まない。` +
        `argument は、この発言がお題についての意見や理由になっているか（「わかった」「はい」「賛成で戦う」など返事・名前・あいさつだけなら false）。` +
        `strength は意見の説得力（0=理由なし・「なんとなく」〜3=とても説得力がある。理由が1つでもちゃんと言えていれば2、具体例や比べ方まであれば3）。子どもにはやさしめに採点する。reason は判定の一言（子ども向けに20字以内）。` +
        `example は具体例（自分の体験・数字・比べ方など）を入れていたら true。countered は、コン太が直前に言った反論にちゃんと答えていたら true。repeat は、これまでに自分が言った理由とほぼ同じなら true。` +
        `hint は味方のコーチ「ポン子」の一言：まず良い所を1つほめてから、もっと強くなる言い方を1つだけ（例を入れて40字以内）。コン太の強さはレベル${level}（レベルが上がるほど line の反論を鋭くする）。` +
        '出力は JSON だけ: {"argument": true か false, "object": true か false, "line": "異議あり！から始まる40字以内", "strength": 0, "example": false, "countered": false, "repeat": false, "reason": "...", "hint": "..."}',
      `これまで:\n${record}\n\n子どもの最新の発言: ${last}`,
    ),
    12000,
  ).catch(() => ({ object: false, strength: 1 }));
  const strength = Math.max(0, Math.min(3, Number(v?.strength) || 0));
  // 天秤：説得力があればプレイヤー側（マイナス）、なければ相手側に少し
  const sway = strength >= 2 ? -strength : 1;
  const isArg = v?.argument === true || v?.argument === "true";
  // ライバルが強くなるほど、ポイントに要る説得力が上がる（レベル4から3が要る）
  const point = !isArg ? null : strength >= (level >= 4 ? 3 : 2) ? "player" : "rival";
  const hint = String(v?.hint ?? "").slice(0, 60);
  const why = String(v?.reason ?? (point === "player" ? "理由がしっかりしてる！" : "理由がもう少しほしい")).slice(0, 30);
  const flags = { example: v?.example === true || v?.example === "true", countered: v?.countered === true || v?.countered === "true", repeat: v?.repeat === true || v?.repeat === "true" };
  if (!v?.object || !v?.line) return { id: null, sway, point, why, hint, strength, isArg, ...flags };
  const line = String(v.line).startsWith("異議あり") ? String(v.line) : `異議あり！${v.line}`;
  return { id: "lawyerD", name: "弁護人コン太", line: line.slice(0, 60), sway, point, why, hint, strength, isArg, ...flags };
}

// ライバル・コン太の戦績（家族ごとに1つ）。勝つたびにコン太のレベルが上がる
async function rival(env, { result, topic, best } = {}) {
  const r = (await env.COURT.get("rival", "json")) ?? { level: 1, wins: 0, losses: 0, draws: 0, history: [] };
  if (!result) return r;
  if (result === "win") {
    r.wins++;
    r.level = Math.min(5, r.level + 1);
  } else if (result === "lose") r.losses++;
  else r.draws++;
  r.history = [...(r.history ?? []), { at: Date.now(), topic, result, best }].slice(-10);
  await env.COURT.put("rival", JSON.stringify(r));
  return r;
}

// 罰ゲームの絵：やる人（コン太 か 書記官タヌ吉がお手本）を、ポップな法廷ドラマ風に（Workers AI の画像モデル）
async function penaltyImage(env, { id, who }) {
  const p = PUNISHMENTS.find((x) => x.id === id) ?? PUNISHMENTS[0];
  const actor = who === "rival" ? "a cute cartoon fox boy lawyer in a navy suit" : "a cute cartoon tanuki (raccoon dog) court clerk with a pink bow tie";
  const img = await env.AI.run("@cf/black-forest-labs/flux-1-schnell", {
    prompt: `${actor} ${p.en ?? "doing a funny penalty game"}, comedic penalty game scene, pop art comic style, hot pink and neon purple burst background, speed lines, sparkles, big expressive face, kid-friendly, Japanese anime illustration, no text`,
    steps: 6,
  });
  return { image: img.image };
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
      if (pathname === "/api/lawyers") return json(await lawyers(env, await request.json()));
      if (pathname === "/api/topics") {
        // お題づくりは20秒近くかかるので、1時間は作ったものを使い回す（いま話題も数時間単位でしか変わらない）
        const cached = await env.COURT.get("topics", "json");
        if (cached) return json(cached);
        const t = await topics(env);
        if (t.topics.some((x) => x.source)) await env.COURT.put("topics", JSON.stringify(t), { expirationTtl: 3600 });
        return json(t);
      }
      if (pathname === "/api/opponent") return json(await opponent(env, await request.json()));
      if (pathname === "/api/rival") return json(await rival(env, await request.json()));
      if (pathname === "/api/kotodama") return json(await kotodama(env, await request.json()));
      if (pathname === "/api/debate") return json(await debate(env, await request.json()));
      if (pathname === "/api/penalty-image") return json(await penaltyImage(env, await request.json()));
      if (pathname === "/api/investigate") return json(await investigate(env, await request.json()));
      return json({ error: "not found" }, 404);
    } catch (e) {
      console.log(`${pathname} failed: ${e}`);
      return json({ error: String(e) }, 500);
    }
  },
};
