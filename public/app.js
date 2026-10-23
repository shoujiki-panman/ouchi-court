// おうち裁判の画面。書記官（と弁護人）は Gemini Live がリアルタイムに聞いて進め、
// 判決は3人の判事（別々の AI）の合議を、裁判長タヌキがまとめて言い渡す。
import { Live, Speaker, startMic } from "./live.js";
import { sfx } from "./sfx.js";
import { PUNISHMENTS } from "./punishments.js";
import { addressedParty, selfNamedParty } from "./names.js";

const BAILIFF = `あなたは家庭の法廷「おうち裁判」の書記官タヌ吉です。きょうだいや家族の小さなけんかを、テレビのゲームショーのようにテンション高く、楽しく進行します。相手は5〜10歳の子どもと、その親。
登場するのは: 原告と被告（子ども）、調査官ホー（フクロウの探偵。investigate で呼ぶ。調べものと再現イラストの係）、原告側の弁護人ポン子、被告側の弁護人コン太（どちらもあなたが声色を変えて演じる。必ず「弁護人ポン子です」「弁護人コン太です」と名乗ってから話す）、証人（見ていた親など）、そして判決を出す裁判長タヌキと3人の判事（別の係。call_judge で呼ぶ）。
段取り（急がない。子どもが言い合いを楽しめるように、各段でしっかり時間をとる）:
1. 開廷を宣言し、原告に名前と、何があったかを聞く。名前を聞いたら「〇〇さんですね？」と一度だけ確かめ、違うと言われたら正しい名前に直す（音声の聞き取りで名前を聞き違えることがあるため）。被告の名前も同じように確かめる。弁護人ポン子として「つまり〇〇さんは、〜と言いたいのですね？」と整理する。
2. 被告に名前と言い分を聞く。弁護人コン太として同じように整理する。
3. 「議論タイム、スタート！」と宣言する。「おかしいと思ったら『異議あり！』、相手の言葉をやっつけたいときは『論破！』と言ってね」と伝える。原告と被告に交互に、相手の言い分への言い返しを聞く。2〜3往復するまで続ける。弁護人は自分から「異議あり！」と言わない（異議は子どもが言う）。
4. 「証拠品タイム！」と宣言する。「証拠になる物はある？あったら証拠品ボタンでカメラに見せてね」と聞く。証拠品が届いたら何が写っているか言う。見ていた人がいれば証人として呼ぶ。「調べてほしいことがあれば調査官ホーを呼べるよ」と一言だけ伝える。子どもが頼んだら「調査官ホー、出番です！」と言って investigate を呼ぶ（調べるなら search、その場面を絵にするなら illustrate）。
5. 二人に、最後に言っておきたいことを1つずつ聞く。
6. 「判決が聞きたくなったら、判決ボタンを押すか『判決お願いします』と言ってね」と言う。だれかが「判決お願いします」と言うか、判決ボタンが押されるまで call_judge は絶対に呼ばない。それまでは議論や証拠品を続けてよい。
7. 判決のあと、罰ゲームがちゃんとできたかを楽しく確かめ、「これにて閉廷！」で締める。
法廷ドラマの決まり:
- 誰かが「論破！」と言ったら（または論破の知らせが届いたら）、「おおっと、論破が出ました！」と盛り上げ、論破した人に名前と、どこがおかしいと思ったかを聞く。そのあと論破された側にも言い分を聞く。
- 誰かが「異議あり！」と言ったら、「異議を認めます。どうぞ」と言って、その人の話を聞く。
- investigate は、子どもが「調べて」「証拠がほしい」とはっきり頼んだときだけ呼ぶ（自分から何度も呼ばない。1回の裁判で2回まで）。
守ること: 次に話す人を必ず名前で呼ぶ。1回に聞くことは1つだけ。1回のせりふは2文まで。子どもが話している途中で口をはさまない。話がそれたらやさしく戻す。どちらかを悪者にしない。恥ずかしい思いをさせない。日本語で話す。`;

// 司会のキレ（10/16「司会のキレが悪い」）
const MC_STYLE = `司会のしかた（いちばん大事）:
- テレビのバラエティの司会者のように、キレよく。1回のせりふは1〜2文・30字前後。長い説明・前置き・丁寧すぎる敬語（〜でしょうか、〜いただけますか）はやめて、親しみやすいタメ口寄りで話す。
- 最初は落ち着いて、ゆっくりやさしく。子どもが考えている間はせかさない。「テンポを上げて」の知らせが来たら速く短く熱く、「落ち着いて」の知らせが来たらまたゆっくりに戻す。
- 合いの手を入れる: 「さあ！」「おおっと！」「ここで！」「なるほどー！」「出たー！」。
- 相手の言葉を一言でツッコむ・まとめる（例:「プリン事件、勃発！」「それは聞き捨てならない！」）→ すぐ次の人に名前を呼んで1つだけ聞く。
- 同じ言い回しをくり返さない。子どもの言葉をそのまま拾って返す。`;

// ひとりで挑戦（お題で議論）のときの段取り
const SOLO = (topic, side, rv) => `あなたは「おうち裁判 ひとりで挑戦モード」の書記官タヌ吉（司会）。子ども1人が、お題についてライバル弁護士コン太と3分の議論バトルで対決する。
ルール（開廷のときに短く・はっきり伝える）: 3ラウンド勝負。子どもが意見を言うたびに判事が採点する。理由の強さで最大3点、具体例を出したら+1、コン太の反論に答えたら+1、「論破！」のあとにいい理由を言えたら+2、同じ理由の使い回しは−1。理由が弱いぶんはコン太の点になる。最終ラウンドは得点2倍！同点ならサドンデス。
ライバル・コン太の戦績: レベル${rv.level}、これまで子どもの${rv.wins}勝${rv.losses}敗${rv.draws ? `${rv.draws}引き分け` : ""}。${rv.wins + rv.losses + rv.draws === 0 ? "今日が初対決。" : rv.lastResult === "win" ? "前回は子どもが勝ったので、コン太はリベンジに燃えている（開廷のときコン太に一言言わせる）。" : rv.lastResult === "lose" ? "前回はコン太が勝ったので、コン太は少し得意げ（開廷のときコン太に一言言わせる）。" : ""}
お題:「${topic.motion}」
説明: ${topic.detail ?? topic.background}
賛成の例: ${topic.pro ?? "（自分で考えて）"}
反対の例: ${topic.con ?? "（自分で考えて）"}
子どもは「${side}」側。弁護人ポン子は子どもの味方（試合中は応援の一言だけ。アドバイスは試合のあとに画面で出す）。弁護人コン太は反対側のライバル。どちらもあなたが声色を変えて演じ、名乗ってから話す。
段取り:
1. 開廷！ルールを一言で。子どもに名前を聞く。聞こえた名前で「〇〇さんですね？」と確かめたら、そこで話すのをやめて返事を待つ（お題に進まない）。「はい」なら2へ。「ちがう」と言われたら、もう一度ゆっくり聞き直す。2回聞いても自信がなければ、名前は使わず「チャレンジャー」と呼ぶ（音声の聞き取りで名前を聞き違えることがあるため）。
2. お題の説明を2〜3文で（上の説明を使う）。賛成・反対の例を1つずつ言い、「ラウンド1！${side}側の〇〇さん、どう思う？」と聞く。
3. 各ラウンド: 子どもが意見を言う → 採点の知らせが届いたら1文だけ実況 → 知らせの指示どおりに進める。アドバイスや説明は試合中にしない（白熱させる）。
コン太とポン子の決めゼリフは、画面が別の声で話す。あなたは司会のタヌ吉だけを演じ、コン太やポン子になりきって話さない。コン太の反論は画面の箱に出る。反論の知らせが来たら、司会として子どもに分かる言葉で言い直して伝え、知らせの指示どおりに聞く。
4. 「試合終了」の知らせが来たら「勝負あり！」とだけ言う。判決は画面が始めるので、ひとりで挑戦では call_judge を呼ばない（自分でラウンドを数えて終わらせない。採点の知らせが来るまで次へ進まない）。
5. 判決と罰ゲームのあと「これにて閉廷！」。
守ること: 子どもが話している途中で口をはさまない。子どもを言い負かして終わらせない。考えを言えたことを必ずほめる。日本語で話す。`;

const CALL_JUDGE = {
  name: "call_judge",
  description: "だれかが『判決お願いします』と言うか、判決ボタンが押されたときだけ呼ぶ（それより前に呼ばない）。3人の判事が合議し、裁判長タヌキが判決を言い渡す（判決の文はこの道具の結果で返る）。",
  parameters: {
    type: "OBJECT",
    properties: {
      plaintiff: { type: "STRING", description: "原告の名前" },
      defendant: { type: "STRING", description: "被告の名前" },
      summary: { type: "STRING", description: "争点と双方の言い分を3文で。証拠品があればそれも" },
    },
    required: ["plaintiff", "defendant", "summary"],
  },
  behavior: "BLOCKING",
};

// 舞台に立つ人
const INVESTIGATE = {
  name: "investigate",
  description: "調査官ホー（フクロウの探偵）に調べてもらう。だれかが「調べて」「本当？」「証拠がほしい」と言ったとき、証拠品タイムに証拠が足りないとき、事実を確かめたいときに呼ぶ。mode=search は資料を調べる、mode=illustrate はその場面の再現イラストを作る。",
  parameters: {
    type: "OBJECT",
    properties: {
      query: { type: "STRING", description: "調べること、または再現したい場面（日本語で短く）" },
      mode: { type: "STRING", enum: ["search", "illustrate"], description: "search=調べる / illustrate=再現イラスト" },
    },
    required: ["query", "mode"],
  },
  behavior: "BLOCKING",
};

const CAST = {
  judge: { img: "img/judge.jpg", name: "裁判長タヌキ" },
  bailiff: { img: "img/bailiff.jpg", name: "書記官タヌ吉" },
  lawyerP: { img: "img/lawyerP.jpg", name: "弁護人ポン子" },
  lawyerD: { img: "img/lawyerD.jpg", name: "弁護人コン太" },
  witness: { img: "img/witness.jpg", name: "証言台" },
  // ふたりで対戦のけんかした2人。絵は証言台の子どもを使い回し、輪の色で区別する（名前が分かったら名札に足す）
  plaintiff: { img: "img/witness.jpg", name: "原告" },
  defendant: { img: "img/witness.jpg", name: "被告" },
  detective: { img: "img/detective.jpg", name: "調査官ホー" },
};

// 円形の法廷に席を並べる（裁判長が上、まわりに書記官・弁護人・証言台）。調査官ホーは呼ばれたときだけ中央に出る
// ふたりで対戦は、天秤（原告=左・ピンク／被告=右・青）にそろえて 左=原告側（ポン子・原告）、右=被告側（コン太・被告）。証言台は出さない
const SEATS = {
  solo: { judge: [50, 3], bailiff: [15, 14], lawyerP: [85, 14], lawyerD: [14, 44], witness: [86, 44] },
  // 書記官は左上の外側。弁護人と原告・被告の上下は舞台の高さの 30% あける。立ち絵（中央）と名札（左下）にかからない位置
  versus: { judge: [50, 3], bailiff: [9, 9], lawyerP: [22, 22], plaintiff: [22, 52], lawyerD: [78, 22], defendant: [78, 52] },
  // スマホ（幅 560px 以下）は立ち絵が幅の半分以上あるので、席を左右の端に寄せる
  versusNarrow: { judge: [50, 3], bailiff: [15, 8], lawyerP: [15, 24], plaintiff: [15, 54], lawyerD: [90, 24], defendant: [90, 54] },
};
for (const id of ["judge", "bailiff", "lawyerP", "lawyerD", "witness", "plaintiff", "defendant"]) {
  const el = document.createElement("div");
  el.className = "seat";
  el.id = `seat-${id}`;
  el.innerHTML = `<div class="ring"><img src="${CAST[id].img}" alt=""></div><span>${CAST[id].name}</span>`;
  document.getElementById("stage").append(el);
}
function layoutSeats(m) {
  const pos = SEATS[m === "solo" ? "solo" : innerWidth <= 560 ? "versusNarrow" : "versus"];
  document.querySelectorAll(".seat").forEach((el) => {
    const p = pos[el.id.slice(5)];
    el.style.display = p ? "" : "none";
    if (!p) return;
    el.style.left = `calc(${p[0]}% - 37px)`;
    el.style.top = `${p[1]}%`;
  });
}
layoutSeats("solo");

const $ = (id) => document.getElementById(id);
// AI の返事・子どもの発言・URL の値を HTML に入れるときは必ず通す（タグとして動かないように）
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
// リンクは http(s) だけ（javascript: などは捨てる）
const safeUrl = (u) => { try { const x = new URL(String(u ?? ""), location.href); return /^https?:$/.test(x.protocol) ? x.href : ""; } catch { return ""; } };
const record = [];
const evidence = [];
let mode = "versus", topic = null, side = "賛成";
let live, stopMic, speaker, camStream, judging = false, speakingTurn = "", who = "", heardTurn = "", lastStatement = "";
let micController;
// ?metrics は数値の利用量だけを保持。?debug の発言ログとは別にし、外部送信しない。
const metricsMode = new URLSearchParams(location.search).has("metrics");
const usageConnections = [];
let usageConnectionNumber = 0, droppedUsageConnections = 0;
function newUsageConnection(model) {
  if (!metricsMode) return null;
  const entry = {
    connection: ++usageConnectionNumber,
    mode: mode === "solo" ? "solo" : "versus",
    model: typeof model === "string" && /^[a-z0-9][a-z0-9._-]{0,80}$/i.test(model) ? model : "UNKNOWN",
    observedElapsedMs: 0,
    usage: null,
  };
  usageConnections.push(entry);
  if (usageConnections.length > 20) {
    usageConnections.shift();
    droppedUsageConnections++;
  }
  return entry;
}
if (metricsMode) {
  const snapshot = () => JSON.parse(JSON.stringify({
    schemaVersion: 1,
    scope: "Gemini Live only; reported snapshots, not a bill or total game cost",
    droppedConnections: droppedUsageConnections,
    connections: usageConnections,
  }));
  window.__courtMetrics = {
    snapshot,
    download() {
      download(new Blob([JSON.stringify(snapshot(), null, 2)], { type: "application/json" }), "ouchi-court-live-usage.json");
    },
  };
}

const pass = () => $("pass").value || localStorage.getItem("ouchi-court-pass") || "";
// この端末の合図（乱数）。コン太の戦績を端末ごとに分けるためだけに使う。保存できない環境ではこのページの間だけ
let memCourtId = "";
const courtId = () => {
  try {
    let id = localStorage.getItem("ouchi.courtId");
    if (!id) localStorage.setItem("ouchi.courtId", (id = crypto.randomUUID()));
    return id;
  } catch {
    return (memCourtId ||= crypto.randomUUID());
  }
};
const api = async (path, body) => {
  const headers = { "content-type": "application/json", "x-passphrase": pass(), ...(path === "/api/rival" ? { "x-court-id": courtId() } : {}) };
  const r = await fetch(path, { method: "POST", headers, body: JSON.stringify(body ?? {}) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? r.status);
  return j;
};

// 舞台：立ち絵・名札・せりふの箱（1文字ずつ）
let typing = Promise.resolve();
let scene = 0; // 話し手が変わるたびに増やし、前の人の1文字ずつ表示を打ち切る
// 節目の記録（デモ動画の字幕合わせ用。?debug のときだけ）
// デモで文字から送った発言は、Live が書き起こしとして返してくることがあり二重に数えた（10/21）→ しばらく「聞こえた」を無視する
let ignoreHeardUntil = 0;
const evt = (kind, text = "") => window.__events?.push({ t: performance.now(), kind, text: String(text).slice(0, 80) });
function onStage(id, text, { fresh = false } = {}) {
  if (["witness", "plaintiff", "defendant"].includes(id)) boxHold = false;
  if (fresh) evt("stage", `${id}: ${text}`);
  const c = CAST[id];
  if (who !== id || fresh) {
    const changed = who !== id;
    who = id;
    if (changed) {
      $("hero").classList.add("swap");
      setTimeout(() => {
        $("heroImg").src = c.img.replace(".jpg", ".png");
        $("hero").classList.remove("swap");
        const entry = { lawyerP: "enter-right", lawyerD: "enter-left", judge: "enter-zoom", detective: "enter-spin" }[id] ?? "enter-zoom";
        $("hero").classList.remove("enter-left", "enter-right", "enter-zoom", "enter-spin");
        void $("hero").offsetWidth;
        $("hero").classList.add(entry);
      }, 180);
    }
    $("nameplate").textContent = c.name;
    $("box").textContent = "";
    scene++;
    document.querySelectorAll(".seat").forEach((el) => el.classList.toggle("on", el.id === `seat-${id}`));
  }
  const mine = scene;
  typing = typing.then(async () => {
    for (const ch of text) {
      if (mine !== scene) return;
      $("box").textContent += ch;
      $("box").scrollTop = $("box").scrollHeight;
      await new Promise((r) => setTimeout(r, 28));
    }
  });
}
const talk = (on) => $("hero").classList.toggle("talk", on);
// コン太とポン子は、AIの司会とは別の声で、こちらから話させる（10/16「他のキャラが喋らない・切り替わらない」）
// 声は AivisSpeech で作っておいた決めゼリフ（public/voice/）。ブラウザの読み上げは声が変だった（10/16）
// 長いセリフは文字だけ出して、頭に短い決めゼリフの声を入れる（法廷バトルも一部だけ声が入る）
let npcTalking = false;
// コン太の反論を箱に出したまま、子どもが話し始めるまで書記官の文字で上書きしない
let boxHold = false;
const NPC_LINES = {
  lawyerD: { objection: "異議あり！", doukana: "それはどうかな？", chotto: "ちょっと待った！その意見には穴があるよ！", gunu: "ぐぬぬ……！そこを突かれるとは……！", iisugi: "くっ、今のはちょっと言いすぎたか……！", madamada: "まだまだ！次のラウンドで取り返してやる！", kuzurenai: "ふふん、ぼくの言い分は崩れないよ！", dousita: "どうした？撃ち抜けなかったみたいだね！", zannen: "残念！ぼくの勝ちが近づいてきたかな？", hantai: "でも、反対の理由だってちゃんとあるんだよ！", chigau: "本当にそうかな？ぼくはちがうと思うね！" },
  lawyerP: { nice: "ナイス論破！バッチリ効いたね！", sugoi: "すごい！コン太の弱いところ、ちゃんと見抜いたね！", daijoubu: "だいじょうぶ！次で取り返そう！", oshii: "おしい！黄色いところをよく見てね！", gyakuten: "まだ逆転できるよ、がんばって！" },
};
// key: 決めゼリフ（声あり）。text を渡すと、声は key、画面の文字は text
function npcSay(id, key, text) {
  evt("npc", `${id}: ${text ?? NPC_LINES[id][key]}`);
  const line = text ?? NPC_LINES[id][key];
  onStage(id, line, { fresh: true });
  note(CAST[id].name, line);
  closeNote();
  if (paused) return new Promise((r) => setTimeout(r, 1200));
  return new Promise((done) => {
    const a = new Audio(`voice/${id === "lawyerD" ? "kon" : "pon"}-${key}.mp3`);
    a.volume = 0.95;
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      npcTalking = false;
      talk(false);
      // 文字だけの続きがあるときは、読む時間を少し置く
      setTimeout(done, text ? Math.min(2500, text.length * 60) : 250);
    };
    a.onended = end;
    a.onerror = end;
    npcTalking = true;
    talk(true);
    beat?.loud(false);
    a.play().catch(end);
    setTimeout(end, 6000);
  });
}
const pick = (a) => a[Math.floor(Math.random() * a.length)];
(function lipsync() {
  const amp = npcTalking ? 0.25 + 0.35 * Math.abs(Math.sin(performance.now() / 90)) : speaker ? speaker.level() : 0;
  $("hero").style.setProperty("--amp", amp.toFixed(3));
  document.querySelector(".seat.on")?.style.setProperty("--amp", amp.toFixed(3));
  requestAnimationFrame(lipsync);
})();
function motion(cls, ms = 600) {
  $("hero").classList.remove(cls);
  void $("hero").offsetWidth;
  $("hero").classList.add(cls);
  setTimeout(() => $("hero").classList.remove(cls), ms);
}
function speedLines() {
  $("speed").classList.remove("on");
  void $("speed").offsetWidth;
  $("speed").classList.add("on");
}
function jiggleSeats() {
  document.querySelectorAll(".seat").forEach((el, i) => {
    setTimeout(() => {
      el.classList.remove("jiggle");
      void el.offsetWidth;
      el.classList.add("jiggle");
    }, i * 60);
  });
}

// 子どもの発言を、法廷を横切って飛ばす。言い分の要（勝手に・わざと・先に 等）は金色に。タップで論破
const WEAK = /(勝手に|わざと|先に|ずっと|全部|絶対|いつも|だって|ちょっとだけ|知らなかった|してない|やってない|〇〇のせい)/g;
function flyStatement(text) {
  const t = text.trim();
  if (t.length < 4) return;
  lastStatement = t;
  pickName(t);
  heat(8);
  react("statement");
  lawyersCheck(t);
  const el = document.createElement("div");
  el.className = "fly display";
  el.style.top = `${18 + Math.random() * 38}%`;
  el.innerHTML = t.replace(/[<>&]/g, "").replace(WEAK, "<b>$1</b>");
  if (mode === "solo") el.classList.add("mine");
  else el.onclick = () => ronpa(t, el);
  $("stage").append(el);
  setTimeout(() => el.remove(), 9500);
}
async function ronpa(statement = lastStatement, el) {
  if (!live || !statement) return;
  el?.classList.add("hit");
  ronpaCount++;
  ronpaBoost = true;
  ronpaArmed = true;
  heat(25);
  score(100, "論破");
  react("ronpa");
  await shout("論破！");
  live.send({ clientContent: { turns: [{ role: "user", parts: [{ text: `（だれかが「${statement}」という発言に「論破！」と言いました。どこがおかしいと思ったのか、論破した人に名前と理由を聞いてください）` }] }], turnComplete: true } });
  note("論破", statement);
}
// 状態の一行は、エラーのときだけ出す（ふだんの「開廷中」などは画面に出さない 10/21）
const status = (t, err = false) => {
  $("status").textContent = t;
  $("status").classList.toggle("err", err);
};
function note(whoName, text) {
  const last = record[record.length - 1];
  if (last && last.who === whoName && !last.closed) last.text += text;
  else record.push({ who: whoName, text });
  $("log").textContent = record.map((r) => `${r.who}: ${r.text}`).join("\n");
}
const closeNote = () => record.length && (record[record.length - 1].closed = true);

// 異議あり！ ／ 待った！
async function shout(word = "異議あり！") {
  evt("shout", word);
  const el = $("shout");
  el.textContent = word;
  el.classList.toggle("gold", word.startsWith("閉廷"));
  speedLines();
  motion("lunge", 560);
  el.classList.remove("on");
  void el.offsetWidth;
  el.classList.add("on");
  $("stage").classList.remove("shake");
  void $("stage").offsetWidth;
  $("stage").classList.add("shake");
  flash();
  if (speaker) await sfx.objection(speaker.ctx);
}
function flash() {
  $("flash").classList.remove("on");
  void $("flash").offsetWidth;
  $("flash").classList.add("on");
}
function stamp(text) {
  evt("stamp", text);
  $("stamp").textContent = text;
  $("stamp").classList.remove("on");
  void $("stamp").offsetWidth;
  $("stamp").classList.add("on");
  setTimeout(() => $("stamp").classList.remove("on"), 4500);
}

async function openCourt(resume = false) {
  userClosed = false;
  const gen = ++courtGen;
  let connectionClosed = false;
  const active = () => gen === courtGen && !userClosed && !connectionClosed;
  micController?.abort();
  const controller = new AbortController();
  micController = controller;
  // 再開・再試合では前の接続を残さない。遅れて届く旧接続の通知は世代で除外する。
  stopMic?.();
  stopMic = null;
  live?.close();
  speaker?.dispose();
  layoutSeats(mode);
  if (!resume) {
    STEPS = mode === "solo" ? SOLO_STEPS : VERSUS_STEPS;
    stepNow = -1;
    step("open");
    paused = false;
    $("paused").classList.remove("on");
  }
  if (!resume) {
    parties.length = 0;
    lastCalled = -1;
    CAST.plaintiff.name = "原告";
    CAST.defendant.name = "被告";
    $("seat-plaintiff").querySelector("span").textContent = "原告";
    $("seat-defendant").querySelector("span").textContent = "被告";
    record.length = 0;
    evidence.length = 0;
    $("evidence").innerHTML = "";
    $("log").textContent = "";
    $("box").textContent = "";
    heatVal = 0;
    tempo = "calm";
    investigations = 0;
    soloScore = { player: 0, rival: 0 };
    arguing = false;
    rounds = 0;
    suddenDeath = false;
    extraRound = false;
    gameOver = false;
    if (mode !== "solo") bullets = [];
    ronpaArmed = false;
    breakdown = { reason: 0, example: 0, counter: 0, ronpa: 0, repeat: 0, final: 0, noreason: 0, through: 0 };
    rebutted = false;
    roundWins = { player: 0, rival: 0 };
    best = { text: "", strength: -1 };
    hints = [];
    clearInterval(soloClock);
    $("result").classList.remove("on");
    STEPS = mode === "solo" ? SOLO_STEPS : VERSUS_STEPS;
    $("soloScore").style.display = mode === "solo" ? "flex" : "none";
    if (mode === "solo") showSoloScore();
    $("balP").textContent = mode === "solo" ? `あなた（${side}）` : "原告";
    $("balD").textContent = mode === "solo" ? "コン太（反対側）" : "被告";
    balanceVal = 0;
    $("balMark").style.left = "50%";
  }
  if (!resume) shownPhase = "";
  $("resume").style.display = "none";
  if (resume) {
    stopMic?.();
    beat?.stop();
  }
  judged = resume ? judged : false;
  adjourned = false;
  localStorage.setItem("ouchi-court-pass", pass());
  $("open").disabled = true;
  status("開廷の準備中…");
  try {
    const { token, model } = await api("/api/token");
    if (!active()) return;
    speaker = new Speaker();
    onStage("judge", "これより、おうち裁判を開廷します。", { fresh: true });
    if (!resume) await sfx.fanfare(speaker.ctx);
    if (!active()) return;
    beat = sfx.bgm(); // 魔王魂のBGM（落ち着き→議論→白熱）
    if (!resume) {
      heatVal = 0;
      points = 0;
      combo = 0;
      ronpaCount = objectionCount = evidenceCount = 0;
      $("pts").textContent = "0";
    }
    heat(0);
    const usageEntry = newUsageConnection(model);
    const usageStarted = performance.now();
    live = new Live({
      token,
      model,
      setup: {
        generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } } } },
        systemInstruction: { parts: [{ text: `${mode === "solo" ? SOLO(topic, side, rivalInfo) : BAILIFF}\n\n${MC_STYLE}` }] },
        tools: [{ functionDeclarations: [CALL_JUDGE, INVESTIGATE] }],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        realtimeInputConfig: { automaticActivityDetection: { silenceDurationMs: mode === "solo" ? 2500 : 1300 } },
      },
      on: {
        usage: usageEntry ? (summary) => {
          usageEntry.observedElapsedMs = Math.round(performance.now() - usageStarted);
          usageEntry.usage = summary;
        } : undefined,
        ready: async () => {
          if (!active()) return;
          const restart = resume && record.length ? `接続が切れたので再開します。これまでの法廷記録:\n${record.map((r) => `${r.who}: ${r.text}`).join("\n").slice(-3000)}\n続きから進めてください（開廷の宣言はしない）。${judged ? "判決はもう出ています。" : ""}` : "開廷してください。";
          try {
            const releaseMic = await startMic((b64, lvl) => {
              if (!active() || judging || paused || npcTalking) return;
              live.audio(b64);
            }, { signal: controller.signal });
            // 許可ダイアログ中に閉廷・切断・再開した場合、遅れて取得したマイクも解放する。
            if (!active()) {
              releaseMic();
              return;
            }
            stopMic = releaseMic;
            live.send({ clientContent: { turns: [{ role: "user", parts: [{ text: restart }] }], turnComplete: true } });
            status("開廷中：そのまま話しかけてください");
          } catch (e) {
            if (!active()) return;
            shutLive();
            status(`マイクが使えません（${e.message}）。ブラウザのマイクの許可を確かめてください。`, true);
            $("resume").style.display = "inline-block";
            return;
          }
          ["close", "objection", "evidenceBtn", "ronpa", "verdictBtn", "pauseBtn"].forEach((id) => ($(id).disabled = false));
        },
        audio: (b64) => {
          if (paused || !active()) return; // 閉じたあと・古い接続から届いた声は鳴らさない
          talk(true);
          beat?.loud(true);
          speaker.play(b64);
        },
        heard: (t) => {
          if (!active() || Date.now() < ignoreHeardUntil) return;

          if (/論破|ろんぱ/.test(t)) ronpa();
          else if (/異議あり|いぎあり/.test(t)) {
            objectionCount++;
            heat(15);
            score(50, "異議");
            react("objection");
            shout("異議あり！");
          }
          const sid = childSeat(heardTurn + t);
          if (who !== sid) onStage(sid, "", { fresh: true });
          onStage(sid, t);
          note("証言台", t);
          heardTurn += t;
        },
        said: (t) => {
          if (!active()) return; // 閉じたあとの文字起こしは無視（10/21 結果のあとも話し続けた）
          if (/これにて閉廷|閉廷します|閉廷！/.test(speakingTurn + t)) adjourn();
          if (/議論タイム|言い返し|反論はある/.test(speakingTurn + t)) phase("debate");
          const said = speakingTurn + t;
          confirmName(said);
          if (mode === "solo" && !arguing && /お題/.test(said)) step("topic");
          if (mode === "solo" && !arguing && /ラウンド1|どう思う/.test(said)) {
            arguing = true;
            beat?.level(0.5);
            step("r1");
            startSoloClock();
          }
          if (/原告/.test(said)) step("plaintiff");
          if (/被告/.test(said) && stepNow >= 1) step("defendant");
          if (/議論タイム|言い返し|反論/.test(said)) step("debate");
          if (/証拠/.test(said) && stepNow >= 3) step("evidence");
          if (/最後に|言っておきたい|言い残し/.test(said)) step("last");
          if (/証拠品タイム|証拠(品|になる|はある|を見せ)/.test(speakingTurn + t)) phase("evidence");
          if (heardTurn) {
            flyStatement(heardTurn);
            heardTurn = "";
          }
          speakingTurn += t;
          // ふたりで対戦：書記官が呼びかけた人（「ハナさん、どうぞ」など）を、次に話す子どもの手がかりにする
          // 呼びかけだけを数え、「アカさんに」のような言及では動かさない（names.js）
          if (mode !== "solo") {
            const called = addressedParty(speakingTurn, parties);
            if (called >= 0) lastCalled = called;
          }
          // 名乗ったらその人に切りかえる（文の途中でも）。「コン太、どうぞ」のような呼びかけでは切りかえない
          const tail = speakingTurn.slice(-24);
          const named = /ポン子(です|よ！|だよ)|弁護人ポン子/.test(tail) ? "lawyerP" : /コン太(です|だ！|だよ|様)|弁護人コン太/.test(tail) ? "lawyerD" : /タヌ吉(です|だよ)|書記官タヌ吉/.test(tail) ? "bailiff" : null;
          const id = named ?? (speakingTurn.length === t.length ? "bailiff" : who);
          // 声の高さもキャラごとに変える（音声は文字起こしとほぼ同じ順で届くので、名乗った所から切りかわる）
          if (boxHold) {
            note(CAST.bailiff.name, t);
            return;
          }
          if (who !== id) {
            speakingTurn = t;
            onStage(id, t, { fresh: true });
          } else onStage(id, t);
          note(CAST[id].name, t);
        },
        interrupted: () => {
          if (!active()) return;
          beat?.loud(false);
          speaker.stop();
          talk(false);
        },
        turnComplete: () => {
          if (!active()) return;
          dbg.tc++;
          turnWaiters.splice(0).forEach((r) => r());
          if (speaker) speaker.rate = 1; // 次の番は書記官の声から
          speakingTurn = "";

          setTimeout(() => active() && !speaker.busy && beat?.loud(false), 600);
          closeNote();
          setTimeout(() => active() && !speaker.busy && talk(false), 400);
        },
        toolCall: (calls) => active() && calls.forEach((c) => (c.name === "investigate" ? investigateCall(c) : judge(c))),
        goAway: () => active() && status("まもなく接続が切れます（10分ごと）"),
        closed: (e) => {
          connectionClosed = true;
          controller.abort();
          if (gen !== courtGen) return;
          stopMic?.();
          stopMic = null;
          if (userClosed) return;
          speaker?.stop();
          beat?.loud(false);
          status(`接続が切れました（${e?.code ?? ""} ${e?.reason ?? ""}）。「再開する」で続きから始められます。`, true);
          $("resume").style.display = "inline-block";
        },
        error: (m) => active() && status(m, true),
      },
    });
  } catch (e) {
    if (!active()) return;
    shutLive();
    status(`開廷できませんでした: ${e.message}`, true);
    $("open").disabled = false;
  }
}

// 判事たちの合議：3人がそれぞれ票を入れ、裁判長タヌキがまとめて言い渡す
let judged = false;
let userClosed = false;
// 試合・閉廷のあと：書記官の最後の声が鳴り終わるのを待って（最長 ms）、マイクと Live を閉じる。
// userClosed を立てるので「接続が切れたので再開」は出ない。閉廷ボタン・もう一回はそのまま使える（10/21 結果のあとも話し続け、スペイン語になった）
// courtGen：待っているあいだに「もう一回！」で新しい試合が始まったら、そちらは閉じない
const turnWaiters = [];
let courtGen = 0;
async function closeAfterSpeech(ms = 6000) {
  if (userClosed) return;
  const gen = courtGen;
  const end = Date.now() + ms;
  await new Promise((r) => {
    turnWaiters.push(r);
    setTimeout(r, ms);
  });
  while (Date.now() < end && speaker?.busy) await new Promise((r) => setTimeout(r, 200));
  if (gen === courtGen) shutLive();
}
function shutLive() {
  if (userClosed) return;
  userClosed = true;
  evt("live", "closed");
  micController?.abort();
  micController = null;
  stopMic?.();
  stopMic = null;
  live?.close();
  status("閉廷しました");
}
// 書記官（AI）への返事：道具の呼び出しから来たときは toolResponse、コードから始めたときは普通の知らせ
function reply(call, result) {
  if (call.id) live.toolResponse([{ id: call.id, name: call.name, response: { result } }]);
  else live.send({ clientContent: { turns: [{ role: "user", parts: [{ text: `（${result}）` }] }], turnComplete: true } });
}
async function judge(call) {
  evt("judge", call.id ? "ai" : "code");
  if (call.name !== "call_judge") return;
  boxHold = false;
  // ひとりで挑戦の判決は、点数をつけ終えた画面だけが始める（書記官が先に呼ぶと最終ラウンドの点が入らない 10/16）
  if (mode === "solo" && call.id && !gameOver) {
    reply(call, "まだ試合中。判決は画面が始めるので待つ。今のラウンドの採点の知らせを待ってから進める。");
    return;
  }
  if (judged) {
    if (call.id) reply(call, "判決はもう出ている。くり返さず、罰や仲直りを確かめて閉廷する。");
    return;
  }
  judged = true;
  endTurn();
  step("verdict");
  judging = true;
  closeNote();
  onStage("judge", "ただいま、判事たちが合議中です……", { fresh: true });
  status("合議中…");
  beat?.stop();
  const drum = sfx.drumroll(speaker.ctx, 12);
  try {
    const names = mode === "solo" ? [parties[0] ?? "プレイヤー", "コン太"] : parties.length === 2 ? [...parties] : [call.args?.plaintiff, call.args?.defendant].filter(Boolean);
    const soloNote = mode === "solo" ? `（ひとりで挑戦モード: お題「${topic?.motion}」。ポイント あなた${soloScore.player} - ${soloScore.rival}コン太（多い方を勝ちにする）。子ども=${parties[0] ?? "プレイヤー"}（${side}）vs 弁護人コン太（反対側）。子どもの理由の良さで判定する。勝ち負けは子ども名か「コン太」で）\n` : "";
    const lean = balanceVal < -20 ? `${parties[0]}さん寄り` : balanceVal > 20 ? `${parties[1]}さん寄り` : "五分五分";
    const text = `${soloNote}原告: ${parties[0]} / 被告: ${parties[1]} / 法廷の天秤: ${lean}（${balanceVal}）\n${call.args?.summary ?? ""}\n\n${record.map((r) => `${r.who}: ${r.text}`).join("\n")}`.slice(-6000);
    // ひとりで挑戦は、点数で勝ち負けを決めて判事に伝える
    const soloWinner = mode !== "solo" ? undefined : soloScore.player > soloScore.rival ? names[0] : soloScore.player < soloScore.rival ? "コン太" : "draw";
    const v = await api("/api/verdict", { record: text, names, evidence: evidence.map((e) => e.label), winner: soloWinner, points: `${soloScore.player}対${soloScore.rival}` });
    let soloResult = null, penaltyImg = null;
    if (mode === "solo") {
      clearInterval(soloClock);
      $("feverClock").textContent = "";
      soloResult = soloScore.player > soloScore.rival ? "win" : soloScore.player < soloScore.rival ? "lose" : "draw";
      const perfect = soloResult === "win" && roundWins.player >= rounds && rounds >= 3;
      v.stamp = perfect ? "完全論破！" : { win: "勝訴！", lose: "敗訴…", draw: "引き分け" }[soloResult];
      v.who = soloResult === "win" ? "コン太" : soloResult === "lose" ? `${parties[0] ?? "あなた"}` : "二人";
      // 罰ゲームの絵は、判決を読んでいるあいだに作っておく（負けた方がやる。子どもが負けたら書記官がお手本）
      penaltyImg = api("/api/penalty-image", { id: v.punishment?.id, who: soloResult === "win" ? "rival" : "clerk" }).catch(() => null);
      api("/api/rival", { result: soloResult }).then((r) => (rivalInfo = { ...r, lastResult: soloResult })).catch(() => {});
    }
    // 判決の声は、投票を見せているあいだに作っておく（前は投票が終わってから作っていて待たされた）
    const voiceP = api("/api/voice", { text: v.speech }).catch(() => null);
    await voteTime(v.panel ?? []);
    // 声が間に合わなければ待たずに文字で進む（テンポ優先）
    const voice = await Promise.race([voiceP, new Promise((r) => setTimeout(() => r(null), 3000))]);
    drum.stop();
    await sfx.cymbal(speaker.ctx);
    stamp(v.stamp ?? "和解");
    react("verdict");
    flash();
    onStage("judge", v.speech, { fresh: true });
    talk(true);
    note("裁判長タヌキ", v.speech);
    closeNote();
    if (voice) await (voice.mimeType?.includes("wav") ? speaker.playWav(voice.audio) : speaker.play(voice.audio));
    talk(false);
    motion("slam", 520);
    await sfx.gavel(speaker.ctx);
    step("penalty");
    if (v.punishment) await punishmentTime(v.punishment, v.who, penaltyImg);
    if (mode === "solo") {
      await resultCard(soloResult, v);
      // 試合は終わり。書記官には「これにて閉廷！」だけ言わせて、Live を閉じる
      reply(call, "試合は終わりました。日本語で『これにて閉廷！』とだけ言って、そのあとは何も話さない");
      await closeAfterSpeech(6000);
      return;
    }
    reply(call, `裁判長がたった今、判決を読み上げた（書記官は判決をくり返さないこと）。罰ゲーム: ${v.who ?? ""}「${v.punishment?.text ?? v.sentence}」（画面でもう発表して、やり終えた）。書記官は、罰や仲直りが今できているかを名前を呼んで楽しく確かめてから「これにて閉廷！」と締める。`);
  } catch (e) {
    drum.stop();
    status(`判事が来られませんでした: ${e.message}`, true);
    reply(call, "判事が不在。書記官が代わりに、二人に仲直りの握手をすすめて閉廷する。");
  } finally {
    judging = false;
    status(userClosed ? "閉廷しました" : "開廷中");
  }
}

// ドパガキ要素：ずっと鳴るビート・ヒートメーター・論破の点数とコンボ・観客のリアクション・最後の称号
let beat, heatVal = 0, points = 0, combo = 0, comboTimer, ronpaCount = 0, objectionCount = 0, evidenceCount = 0;
let fever = false;
// 盛り上がり（heat）はビートの速さだけに使う。画面のゲージは天秤（どちらが優勢か）に置きかえた（10/16「何でも増えればいいんだっけ？」）
let tempo = "calm";
function heat(add) {
  heatVal = Math.max(0, Math.min(100, heatVal + add));
  // 音楽は白熱してから（最初は無音で、ゆっくり話せるように 10/16）
  beat?.faster(80 + heatVal * 0.9);
  beat?.level(heatVal >= 60 ? 1 : heatVal >= 30 || arguing ? 0.5 : 0);
  const next = heatVal >= 60 ? "hot" : heatVal <= 25 ? "calm" : tempo;
  if (next !== tempo && live) {
    tempo = next;
    live.send({ clientContent: { turns: [{ role: "user", parts: [{ text: tempo === "hot" ? "（議論が白熱してきました。テンポを上げて！速く短く熱く回してください）" : "（少し落ち着きました。ゆっくりやさしい進行に戻してください）" }] }], turnComplete: false } });
  }
}
setInterval(() => heatVal > 0 && !judging && heat(-1), 1500); // 何もなければ少しずつ冷める

// 天秤ゲージ：マイナスは原告側、プラスは被告側が優勢。発言のたびに AI が「どちらを強くしたか」を判定して動かす
let balanceVal = 0, ronpaBoost = false;
function swayBy(n) {
  if (!n) return;
  balanceVal = Math.max(-100, Math.min(100, balanceVal + n * 12 * (ronpaBoost ? 2 : 1)));
  ronpaBoost = false;
  $("balMark").style.left = `${50 + balanceVal / 2}%`;
  if (mode !== "solo" && Math.abs(balanceVal) >= 70) comebackTime(balanceVal < 0 ? parties[1] : parties[0]);
}
// 逆転チャンス：押されている側が反撃する時間（20秒・点数3倍）
async function comebackTime(loser) {
  if (fever) return;
  fever = true;
  $("balance").classList.add("chance");
  $("stage").classList.add("fever");
  shout("逆転チャンス！");
  speaker?.clip("crowd/ganbare.mp3", 0.6);
  react("ronpa");
  beat?.faster(170);
  live?.send({ clientContent: { turns: [{ role: "user", parts: [{ text: `（天秤が大きくかたむきました。押されているのは${loser}さん。「逆転チャンス！」と盛り上げ、${loser}さんに「異議あり」か証拠品で反撃するよう、名前を呼んでうながしてください。今なら点数3倍です）` }] }], turnComplete: true } });
  let left = 20;
  await new Promise((done) => {
    const t = setInterval(() => {
      $("feverClock").textContent = left > 0 ? `逆転チャンス ${left}` : "";
      if (--left < 0) {
        clearInterval(t);
        done();
      }
    }, 1000);
  });
  fever = false;
  $("balance").classList.remove("chance");
  $("stage").classList.remove("fever");
  balanceVal = Math.sign(balanceVal) * 40;
  $("balMark").style.left = `${50 + balanceVal / 2}%`;
}
function bigScore(title, plus, total) {
  const el = document.createElement("div");
  el.className = "bigScore display";
  el.innerHTML = `<div>${esc(title)}</div><div class="plus">${esc(plus)}</div><div class="total">合計 ${esc(total)}pt</div>`;
  $("stage").append(el);
  $("score").classList.remove("bump");
  void $("score").offsetWidth;
  $("score").classList.add("bump");
  setTimeout(() => el.remove(), 2200);
}
function popAt(text, x = 50, y = 40) {
  const el = document.createElement("div");
  el.className = "pop display";
  el.textContent = text;
  el.style.left = `calc(${x}% - 60px)`;
  el.style.top = `${y}%`;
  $("stage").append(el);
  setTimeout(() => el.remove(), 1300);
}
function score(n, label) {
  combo++;
  clearTimeout(comboTimer);
  comboTimer = setTimeout(() => {
    combo = 0;
    $("combo").textContent = "";
  }, 20000);
  points += n * combo * (fever ? 3 : 1);
  $("pts").textContent = points;
  $("combo").textContent = combo > 1 ? `×${combo} COMBO` : "";
  const total = points;
  // 「異議あり！」などの叫びと重ならないよう、少しあとに出す
  setTimeout(() => bigScore(`${label}成功！`, `+${n * combo * (fever ? 3 : 1)}pt${combo > 1 ? `  ×${combo} COMBO` : ""}${fever ? "  FEVER×3" : ""}`, total), 1000);
  if (speaker) sfx.coin(speaker.ctx);
}
// 観客：声（public/crowd/）と、後ろを流れるテロップ
const CROWD = {
  statement: [["zawa", "ザワ…ザワ…"], ["maji", "まじで…？"], ["ee", "えーっ！？"]],
  ronpa: [["oo", "おおーっ！！"], ["ee", "えーーっ！？"]],
  objection: [["ee", "えーっ！？"], ["zawa", "ザワザワ…"]],
  verdict: [["yatta", "わーっ！やったー！"], ["oo", "おおーっ！"]],
  cheer: [["ganbare", "がんばれー！"]],
};
function crowd(kind) {
  const list = CROWD[kind] ?? CROWD.statement;
  const [clip, text] = list[Math.floor(Math.random() * list.length)];
  speaker?.clip(`crowd/${clip}.mp3`, kind === "statement" ? 0.3 : 0.5);
  for (let i = 0; i < 3; i++) {
    const t = document.createElement("div");
    t.className = "tel display";
    t.textContent = i === 0 ? text : ["ザワ…", "ザワ…", "ひそひそ…", "えー…", "なになに？"][Math.floor(Math.random() * 5)];
    t.style.top = `${12 + Math.random() * 50}%`;
    t.style.animationDelay = `${i * 0.5}s`;
    t.style.fontSize = `${1 + Math.random() * 0.8}rem`;
    $("stage").append(t);
    setTimeout(() => t.remove(), 7000);
  }
}
function react(kind = "statement") {
  if (kind === "statement" && heatVal < 50) return; // ふつうの発言では騒がない
  crowd(kind);
  jiggleSeats();
  const pool = { statement: ["😮", "🤔", "👀", "😂"], ronpa: ["🔥", "💥", "😱", "⚡"], objection: ["⚡", "😮"], verdict: ["🎉", "👏", "😂", "🎊"] }[kind];
  for (let i = 0; i < (kind === "statement" ? 3 : 8); i++) {
    const e = document.createElement("div");
    e.className = "emoji";
    e.textContent = pool[Math.floor(Math.random() * pool.length)];
    e.style.left = `${5 + Math.random() * 90}%`;
    e.style.animationDelay = `${Math.random() * 0.5}s`;
    $("stage").append(e);
    setTimeout(() => e.remove(), 2800);
  }
}
async function showTitle() {
  const t = ronpaCount >= 2 ? "論破王 👑" : objectionCount >= 2 ? "異議マスター ⚡" : evidenceCount ? "名探偵 🔍" : heatVal >= 80 ? "白熱バトラー 🔥" : "仲直りマスター 🤝";
  $("badge").textContent = t;
  $("title").classList.add("on");
  if (speaker) await sfx.fanfare(speaker.ctx);
  await new Promise((r) => setTimeout(r, 2500));
  $("title").classList.remove("on");
}

// 罰ゲーム：一覧をルーレットで回して、判事の選んだものに止める。時間つきなら数える
async function punishmentTime(p, who, imgPromise) {
  evt("penalty", p.text);
  $("rTitle").textContent = "罰ゲーム";
  $("rImg").innerHTML = "";
  $("rWho").textContent = who ? `${who} の罰ゲームは……` : "罰ゲームは……";
  $("rItem").classList.remove("done");
  $("count").textContent = "";
  $("roulette").classList.add("on");
  let delay = 45;
  for (let i = 0; i < 16; i++) {
    $("rItem").textContent = PUNISHMENTS[i % PUNISHMENTS.length].text;
    sfx.tick(speaker.ctx);
    await new Promise((r) => setTimeout(r, delay));
    delay *= 1.15;
  }
  $("rItem").textContent = p.text;
  $("rItem").classList.add("done");
  // 絵が間に合わなければ待たない（あとから出てきたら差しこむ）
  const showImg = (img) => img?.image && $("roulette").classList.contains("on") && ($("rImg").innerHTML = `<img src="data:image/jpeg;base64,${esc(img.image)}" alt="">`);
  const img = await Promise.race([imgPromise ?? Promise.resolve(null), new Promise((r) => setTimeout(() => r(null), 2000))]);
  if (img) showImg(img);
  else imgPromise?.then(showImg);
  await sfx.cymbal(speaker.ctx);
  await new Promise((r) => setTimeout(r, 1500));
  if (p.seconds) {
    for (let n = p.seconds; n > 0; n--) {
      $("count").textContent = n;
      sfx.tick(speaker.ctx);
      await new Promise((r) => setTimeout(r, 1000));
    }
    $("count").textContent = "おしまい！";
    await sfx.gavel(speaker.ctx);
    await new Promise((r) => setTimeout(r, 1200));
  }
  $("roulette").classList.remove("on");
}

// いまの状況：段取りのどこにいるか
const VERSUS_STEPS = [["open", "開廷"], ["plaintiff", "原告"], ["defendant", "被告"], ["debate", "議論"], ["evidence", "証拠品"], ["last", "最後のひとこと"], ["verdict", "判決"], ["penalty", "罰ゲーム"], ["closed", "閉廷"]];
const SOLO_STEPS = [["open", "開廷"], ["topic", "お題"], ["r1", "ラウンド1"], ["r2", "ラウンド2"], ["r3", "ラウンド3"], ["verdict", "判定"], ["penalty", "罰ゲーム"], ["closed", "閉廷"]];
let STEPS = SOLO_STEPS;
let stepNow = -1;
function step(id) {
  evt("step", id);
  const i = STEPS.findIndex(([k]) => k === id);
  if (i < stepNow) return; // 戻らない
  stepNow = i;
  $("steps").innerHTML = STEPS.map(([, label], n) => `<span class="${n < i ? "done" : n === i ? "now" : ""}">${label}</span>`).join("");
}
step("open");

// 一時停止と再開：止めている間はマイクを送らず、声と音楽を止める
let paused = false;
function togglePause() {
  if (!live) return;
  paused = !paused;
  $("paused").classList.toggle("on", paused);
  $("pauseBtn").querySelector("span").textContent = paused ? "▶" : "⏸";
  $("pauseBtn").title = paused ? "再開" : "一時停止";
  $("pauseBtn").setAttribute("aria-label", $("pauseBtn").title);
  if (paused) {
    speaker?.stop();
    beat?.pause?.();
    talk(false);
    status("一時停止中");
  } else {
    status("開廷中");
    beat?.resume?.();
    live.send({ clientContent: { turns: [{ role: "user", parts: [{ text: "（一時停止から再開しました。今どこまで進んでいたかを一言で言って、続きから進めてください）" }] }], turnComplete: true } });
  }
}

// ひとりで挑戦：子どもの番は、こちらで始めて終える（AI が途中で割り込まないように）。
// 終わるのは「以上」と言う／「以上！」ボタン／3.5秒だまる／時間切れ のどれか
let myTurn = false, turnTimer, quietSince = 0, spoke = false, turnLeft = 0;
// 書記官の声が流れ終わってから、子どもの番を始める（返事の生成は声より先に終わる）
let waiting = false;
const dbg = { tc: 0, wait: 0, begin: 0, skip: "" };
async function waitThenBegin() {
  dbg.wait++;
  if (waiting) return;
  waiting = true;
  for (let i = 0; i < 120 && speaker?.busy; i++) await new Promise((w) => setTimeout(w, 250));
  await new Promise((w) => setTimeout(w, 400));
  waiting = false;
  if (!judging && !paused && !speaker?.busy) beginTurn();
  else dbg.skip = `judging=${judging} paused=${paused} busy=${speaker?.busy}`;
}
function beginTurn() {
  dbg.begin++;
  if (myTurn || !live) return;
  myTurn = true;
  spoke = false;
  quietSince = 0;
  turnLeft = stepNow >= 3 ? 45 : 20;
  live.send({ realtimeInput: { activityStart: {} } });
  beat?.loud(false);
  clearInterval(turnTimer);
  turnTimer = setInterval(() => {
    $("feverClock").textContent = `あなたのターン ${turnLeft}`;
    if (--turnLeft < 0) endTurn();
  }, 1000);
}
function turnLevel(lvl) {
  if (lvl > 0.08) {
    spoke = true;
    quietSince = 0;
  } else if (spoke) {
    quietSince ||= Date.now();
    if (Date.now() - quietSince > 3500) endTurn();
  }
}
function endTurn() {
  if (!myTurn) return;
  myTurn = false;
  clearInterval(turnTimer);
  $("feverClock").textContent = "";
  $("turnBtn").style.display = "none";
  live?.send({ realtimeInput: { activityEnd: {} } });
}

// ひとりで挑戦の勝ち負け：議論タイムの発言ごとに判事が採点し、先に3ポイントで勝ち
let soloScore = { player: 0, rival: 0 };
let ronpaArmed = false;
let arguing = false, rounds = 0, best = { text: "", strength: -1 }, hints = [], soloClock, soloLeft = 180;
let rivalInfo = { level: 1, wins: 0, losses: 0, draws: 0 };
// バッジ：遊ぶたびに集まる（この端末に保存。消えても遊べる）
const BADGES = [
  { id: "first", icon: "🎤", name: "はじめての法廷", how: "1回あそぶ", ok: (g) => true },
  { id: "win", icon: "🏆", name: "はじめての勝訴", how: "コン太に勝つ", ok: (g) => g.win },
  { id: "perfect", icon: "💥", name: "完全論破", how: "3ラウンドぜんぶ勝つ", ok: (g) => g.perfect },
  { id: "example", icon: "📚", name: "具体例マスター", how: "具体例を3回入れる", ok: (g) => g.examples >= 3 },
  { id: "counter", icon: "🛡️", name: "反論キング", how: "コン太の反論に2回こたえる", ok: (g) => g.counters >= 2 },
  { id: "ronpa", icon: "🔫", name: "論破スナイパー", how: "「論破！」を決める", ok: (g) => g.ronpa > 0 },
  { id: "extra", icon: "⚡", name: "延長戦サバイバー", how: "異変の延長戦で勝つ", ok: (g) => g.win && g.extra },
  { id: "sudden", icon: "💀", name: "サドンデス勝利", how: "サドンデスで勝つ", ok: (g) => g.win && g.sudden },
  { id: "score20", icon: "🔥", name: "20点の壁", how: "1試合で20点とる", ok: (g) => g.score >= 20 },
  { id: "news", icon: "🗞️", name: "ニュース通", how: "いま話題のお題で勝つ", ok: (g) => g.win && g.news },
  { id: "both", icon: "🌈", name: "どっちも言える", how: "賛成と反対の両方で勝つ", ok: (g) => g.sidesWon.includes("賛成") && g.sidesWon.includes("反対") },
  { id: "lv5", icon: "👑", name: "コン太Lv5撃破", how: "Lv5のコン太に勝つ", ok: (g) => g.win && g.level >= 5 },
  { id: "share", icon: "📣", name: "挑戦状", how: "友だちに挑戦状を送る", ok: () => false },
];
const store = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
let startLevel = 1;
function earnBadges(result) {
  const have = store.get("ouchi.badges", []);
  const sidesWon = store.get("ouchi.sidesWon", []);
  if (result === "win" && !sidesWon.includes(side)) sidesWon.push(side);
  store.set("ouchi.sidesWon", sidesWon);
  const g = { win: result === "win", perfect: result === "win" && roundWins.player >= rounds && rounds >= 3, examples: breakdown.example, counters: breakdown.counter, ronpa: breakdown.ronpa, extra: extraRound, sudden: suddenDeath, score: soloScore.player, news: !!topic?.source, sidesWon, level: startLevel };
  const fresh = BADGES.filter((b) => !have.includes(b.id) && b.ok(g));
  store.set("ouchi.badges", [...have, ...fresh.map((b) => b.id)]);
  return fresh;
}
function showShelf() {
  const have = store.get("ouchi.badges", []);
  const next = BADGES.find((b) => !have.includes(b.id));
  // タイトルはバッジの1行（「バッジ 5/13｜つぎ：…」）だけ。アイコンの列と試合の記録は出さない（10/21）
  $("badgeShelf").innerHTML = `<div class="next">バッジ ${have.length}/${BADGES.length}${next ? `｜つぎ：${next.icon} ${next.how}` : "｜ぜんぶ集めた！"}</div>`;
}
showShelf();
function showSoloScore() {
  const label = gameOver ? "試合終了" : extraRound ? "⚡延長戦 ×2" : suddenDeath ? "サドンデス" : rounds >= 3 ? "試合終了" : rounds === 2 ? "最終ラウンド ×2" : `ラウンド ${rounds + 1}/3`;
  $("soloScore").innerHTML = `<span class="me">あなた ${soloScore.player}</span><span class="vs">-</span><span class="rival">${soloScore.rival} コン太</span><small>${label}｜コン太 Lv${esc(rivalInfo.level)}</small>`;
}
// 採点（10/16「勝敗は結構条件凝っていて欲しい」）
//  理由の強さ 0〜3（コン太は 3−強さ）／具体例 +1／コン太の反論に答えた +1／論破のあとに理由 +2／同じ理由の使い回し −1
//  最終ラウンドは2倍。3ラウンドとも上回れば「完全論破」。同点ならサドンデス（もう1ラウンド）
let breakdown = { reason: 0, example: 0, counter: 0, ronpa: 0, repeat: 0, final: 0, noreason: 0, through: 0 };
// コン太が直前のラウンドで言い返したか（r.line か 論破タイムのセリフ）。言い返されたのに答えないと「反論スルー」
let rebutted = false;
let roundWins = { player: 0, rival: 0 };
let suddenDeath = false;
// 異変ルーレット：僅差（2点以内）のとき、ときどき判決へのルーレットが狂って延長戦が1ラウンド増える（10/16 本人案）
let extraRound = false;
async function glitchRoulette() {
  $("rTitle").textContent = "運命のルーレット";
  $("rImg").innerHTML = "";
  $("count").textContent = "";
  $("rWho").textContent = "いよいよ判決へ……";
  $("rItem").classList.remove("done");
  $("roulette").classList.add("on");
  let delay = 60;
  for (let i = 0; i < 18; i++) {
    $("rItem").textContent = i % 2 ? "⚖️ 判決へ" : "？？？";
    sfx.tick(speaker.ctx);
    await new Promise((r) => setTimeout(r, delay));
    delay *= 1.13;
  }
  // 止まりかけて……異変
  $("stage").classList.add("glitch");
  $("rWho").textContent = "……！？ ルーレットに異変！";
  speaker?.clip("crowd/zawa.mp3", 0.6);
  for (let i = 0; i < 10; i++) {
    $("rItem").textContent = ["⚖️ 判決へ", "⚡ 延長戦", "⚖️ 判", "⚡ 延"][i % 4];
    await new Promise((r) => setTimeout(r, 90));
  }
  $("rItem").textContent = "⚡ 延長戦 ⚡";
  $("rItem").classList.add("done");
  await sfx.objection(speaker.ctx);
  await new Promise((r) => setTimeout(r, 1600));
  $("stage").classList.remove("glitch");
  $("roulette").classList.remove("on");
}
let gameOver = false;
async function soloPoint(r, statement) {
  if (judged || !arguing || !r.isArg) return; // 名前や返事は数えない
  const last = suddenDeath || extraRound || rounds === 2; // 最終ラウンド（またはサドンデス・延長戦）
  const mult = last ? 2 : 1;
  const st = Math.max(0, Math.min(3, r.strength ?? 0));
  const parts = [];
  let me = 0, rival = 0;
  // 理由の無い主張・お題と関係ない話には点をやらない（10/21「ちゃんと回答しなくても勝てちゃう」）
  if (!r.ontopic || !r.reason) {
    rival = !r.ontopic ? 3 : 2;
    parts.push(!r.ontopic ? "お題と関係ない：コン太+3" : "理由なし：コン太+2");
    if (!r.reason) breakdown.noreason += 1;
  } else {
    me = st;
    rival = 3 - st;
    parts.push(`理由+${st}`);
    breakdown.reason += st * mult;
    if (r.example) {
      me += 1;
      parts.push("具体例+1");
      breakdown.example += mult;
    }
    if (r.countered) {
      me += 1;
      parts.push("反論に答えた+1");
      breakdown.counter += mult;
    }
    if (ronpaArmed && st >= 2) {
      me += 2;
      parts.push("論破成功+2");
      breakdown.ronpa += 2 * mult;
    }
    if (r.repeat) {
      me -= 1;
      parts.push("使い回し−1");
      breakdown.repeat -= mult;
    }
  }
  ronpaArmed = false;
  const wasRebutted = rebutted;
  if (wasRebutted && !r.countered) {
    rival += 1;
    parts.push("反論スルー：コン太+1");
    breakdown.through += 1;
  }
  rebutted = false;
  me = Math.max(0, me) * mult;
  rival = rival * mult;
  if (last) {
    parts.push("最終ラウンド×2");
    breakdown.final += 1;
  }
  soloScore.player += me;
  soloScore.rival += rival;
  rounds++;
  if (me > rival) roundWins.player++;
  else if (rival > me) roundWins.rival++;
  if (st > best.strength) best = { text: statement, strength: st };
  if (r.hint) hints.push(r.hint);
  showSoloScore();
  const mine = me >= rival;
  shout(mine ? `+${me}pt！` : `コン太 +${rival}pt…`);
  popAt(parts.join("  "), 50, 30);
  speaker?.clip(mine ? "crowd/oo.mp3" : "crowd/ee.mp3", 0.5);
  if (mine) score(me * 10, "主張");
  heat(mine ? 20 : 12);
  // 終わりの判定：3ラウンド（同点ならサドンデス）
  let end = "";
  if (rounds >= 3 && !suddenDeath && soloScore.player === soloScore.rival) {
    suddenDeath = true;
    end = "同点！サドンデスに突入。次の1ラウンドで勝った方の勝ち、得点は2倍。「サドンデス！」と叫んで、最後のラウンドへ。";
    shout("サドンデス！");
  } else if (rounds === 3 && !extraRound && Math.abs(soloScore.player - soloScore.rival) <= 2 && Math.random() < 0.5) {
    extraRound = true;
    await glitchRoulette();
    shout("延長戦！");
    showSoloScore();
    end = "異変発生！判決のルーレットが狂って、延長戦が1ラウンド増えた！「異変発生！延長戦だ！」と叫んで、点差を言ってから延長ラウンド（得点2倍）へ。";
  } else if (rounds >= 3) {
    end = "試合終了！「勝負あり！」とだけ言ってください（判決はこちらで始めます）。";
    shout("勝負あり！");
    gameOver = true;
    clearInterval(soloClock);
    $("feverClock").textContent = "";
    setTimeout(() => judge({ name: "call_judge", id: null, args: {} }), 1500);
  }
  step(end.startsWith("試合終了") ? "verdict" : `r${Math.min(rounds + 1, 3)}`);
  // 次のラウンドの前に：（よかったらポン子がほめる）→ コン太の反論を箱に出す → 書記官が言い直して子どもに聞く
  // 論破タイム（流れる文を撃つ）は使わない（10/22「反論のところよくわからなかった」「自分の声が後回し」）
  const nextCue = `「ラウンド${rounds + 1}！」${rounds + 1 === 3 ? "（最終ラウンド！得点2倍と煽る）" : ""}`;
  live?.send({ clientContent: { turns: [{ role: "user", parts: [{ text: `（ラウンド${rounds}の採点: 子ども+${me}（${parts.join("・")}）、コン太+${rival}。合計 あなた${soloScore.player} - ${soloScore.rival}コン太。理由「${r.why}」。${end || "実況は1文だけ。このあとコン太の反論が画面に出るので、知らせが来るまで黙って待つ。"}）` }] }], turnComplete: true } });
  if (end) return;
  await waitClerk();
  // 反論の文：opponent の r.line があればそれ（速さ優先）。無ければ /api/debate の1行目。どちらも無ければ決まり文句
  let said = String(r.line ?? "").replace(/^異議あり！?/, "").trim();
  if (!said && bullets.length) {
    const d = await api("/api/debate", { topic: topic?.motion, side, statement, bullets, level: rivalInfo.level }).catch(() => null);
    said = String(d?.lines?.[0]?.text ?? "").trim();
  }
  rebutted = !!said;
  const rebuttal = said || NPC_LINES.lawyerD.hantai;
  if (me > rival) await npcSay("lawyerP", pick(["nice", "sugoi"]));
  // 箱の文字は、子どもが話し始めるまで書記官の言葉で上書きしない
  boxHold = true;
  await npcSay("lawyerD", pick(["doukana", "chotto"]), rebuttal);
  const name = parties[0] || "チャレンジャー";
  live?.send({ clientContent: { turns: [{ role: "user", parts: [{ text: `（コン太の反論は『${rebuttal}』。この反論を子どもに分かる言葉で1文で言い直してから、『${name}さん、どう返す？』と聞き、${nextCue}と言う。言い終わったら黙って子どもを待つ）` }] }], turnComplete: true } });
}
// 司会が話し終わるまで待つ（最長10秒）
async function waitClerk() {
  await new Promise((r) => setTimeout(r, 1200));
  for (let i = 0; i < 50 && speaker?.busy; i++) await new Promise((r) => setTimeout(r, 200));
}

// 証拠品＝ヒントカード：AIが開廷前に作っておく。試合中もお題の下に出して、話すときのヒントにする（10/16 本人案）
function showHintCards() {
  $("hintCards")?.remove();
  if (!bullets.length || mode !== "solo") return;
  const row = document.createElement("div");
  row.id = "hintCards";
  // 名前だけの小さいチップ（説明は title）
  row.innerHTML = bullets.map((b, i) => `<button type="button" class="hc" data-i="${i}" title="${esc(b.text)}"><b>${esc(b.name)}</b></button>`).join("");
  $("topicCard").append(row);
  // 押せる（10/21「カードをクリックしても押せない」）。論破タイム中は、舞台の証拠カードを選んだのと同じになる
  row.querySelectorAll(".hc").forEach((el) => (el.onclick = () => {
    if (!$("kotodama").classList.contains("on")) {
      el.classList.remove("nudge");
      void el.offsetWidth;
      el.classList.add("nudge");
      return;
    }
    selBullet = Number(el.dataset.i);
    if (speaker) sfx.tick(speaker.ctx);
    drawCylinder(true);
  }));
}
// ── 論破タイム（法廷バトル風の反論シーン） ──
// 相手のセリフが流れる → 黄色いウィークポイントのうち本物を、合う証拠カードで撃ち抜くと「論破」
let bullets = [], selBullet = 0;
function drawCylinder(on) {
  $("kotodama").innerHTML = bullets.map((b, i) => `<button class="kd ${i === selBullet ? "sel" : ""}" data-i="${i}"><b>${esc(b.name)}</b><small>${esc(b.text)}</small></button>`).join("");
  $("kotodama").classList.toggle("on", on);
  $("kotodama").querySelectorAll(".kd").forEach((el) => (el.onclick = () => {
    selBullet = Number(el.dataset.i);
    sfx.tick(speaker.ctx);
    drawCylinder(true);
  }));
  // お題の下の証拠カードも、選択の表示をそろえる（論破タイムのあいだだけ）
  document.querySelectorAll("#hintCards .hc").forEach((el) => el.classList.toggle("sel", on && Number(el.dataset.i) === selBullet));
}
async function nonstopDebate(d) {
  evt("debate", d.lines[0]?.text);
  selBullet = 0;
  $("stage").classList.add("debate");
  await banner("論破タイム 開始！");
  drawCylinder(true);
  npcSay("lawyerD", pick(["chotto", "doukana", "objection"]), d.lines[0].text).then(() => onStage("lawyerD", "証拠カードを選んで、黄色いウィークポイントを撃ち抜け！", { fresh: true }));
  heat(25);
  let done, missed = 0;
  const finish = new Promise((r) => (done = r));
  const els = d.lines.map((l, i) => {
    const el = document.createElement("div");
    el.className = `nsd display ${i ? "from-left" : ""}`;
    el.style.top = `${22 + i * 26}%`;
    el.style.animationDelay = `${i * 2.2}s`;
    const safe = (x) => x.replace(/[<>&]/g, "");
    const t = safe(l.text), w = safe(l.weak);
    el.innerHTML = `<small>${i ? "観客" : "コン太"}</small>${t.replace(w, `<b class="wp">${w}</b>`)}`;
    el.querySelector(".wp")?.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (i !== d.answer.line) {
        // 外れ：撃っても跳ね返される
        missed++;
        el.classList.add("deflect");
        setTimeout(() => el.classList.remove("deflect"), 500);
        sfx.tick(speaker.ctx);
        popAt("跳ね返された！", 50, 40);
        if (missed >= 2) done(null);
        return;
      }
      done({ el, line: l, full: selBullet === d.answer.bullet });
    });
    $("stage").append(el);
    return el;
  });
  const timer = setTimeout(() => done(null), 16000);
  const hit = await finish;
  clearTimeout(timer);
  drawCylinder(false);
  let out = { hit: false };
  if (hit) {
    const pts = hit.full ? 3 : 1;
    soloScore.player += pts;
    breakdown.ronpa += pts;
    ronpaCount++;
    showSoloScore();
    await cutIn("そこ、おかしいよ！");
    hit.el.classList.add("hit");
    await breakGlass();
    score(pts * 100, "論破");
    out = { hit: true, full: hit.full, pts, weak: hit.line.weak, bullet: bullets[selBullet]?.name ?? "" };
  } else {
    popAt("論破ならず……", 50, 40);
    speaker?.clip("crowd/ee.mp3", 0.5);
  }
  els.forEach((el) => setTimeout(() => el.remove(), 700));
  $("stage").classList.remove("debate");
  return out;
}
// 「そこ、おかしいよ！」の斜めの帯
async function cutIn(word) {
  evt("cutin", word);
  const el = $("cutin");
  el.querySelector("span").textContent = word;
  el.classList.remove("on");
  void el.offsetWidth;
  el.classList.add("on");
  speedLines();
  flash();
  await sfx.objection(speaker.ctx);
  await new Promise((r) => setTimeout(r, 900));
}
// 論破のガラスが割れる演出
async function breakGlass() {
  const g = $("glass");
  g.innerHTML = Array.from({ length: 14 }, () => {
    const x = Math.random() * 100, y = Math.random() * 100;
    const pts = Array.from({ length: 3 }, () => `${x + (Math.random() - 0.5) * 50}% ${y + (Math.random() - 0.5) * 50}%`).join(",");
    return `<i style="clip-path: polygon(${pts}); --dx: ${(Math.random() - 0.5) * 140}%; --dy: ${(Math.random() - 0.3) * 140}%; --r: ${(Math.random() - 0.5) * 540}deg"></i>`;
  }).join("") + `<b class="display">論破！</b>`;
  g.classList.remove("on");
  void g.offsetWidth;
  g.classList.add("on");
  sfx.glass(speaker.ctx);
  speaker?.clip("crowd/oo.mp3", 0.6);
  react("ronpa");
  heat(30);
  await new Promise((r) => setTimeout(r, 1600));
  g.classList.remove("on");
}
// 3分の持ち時間（議論が始まってから）。切れたら勝負あり
function startSoloClock() {
  clearInterval(soloClock);
  soloLeft = 180;
  soloClock = setInterval(() => {
    if (paused || npcTalking) return;
    soloLeft--;
    $("feverClock").textContent = `のこり ${Math.floor(soloLeft / 60)}:${String(soloLeft % 60).padStart(2, "0")}`;
    if (soloLeft <= 0) {
      clearInterval(soloClock);
      if (!judged) {
        live?.send({ clientContent: { turns: [{ role: "user", parts: [{ text: "（3分たちました！時間切れ。「勝負あり！」とだけ言ってください）" }] }], turnComplete: true } });
        shout("時間切れ！");
        gameOver = true;
        setTimeout(() => judge({ name: "call_judge", id: null, args: {} }), 3500);
      }
    }
  }, 1000);
}
// コーチ・ポン子のひとこと（画面の右下に出す）
function coach(text) {
  $("coach").innerHTML = `<img src="img/lawyerP.png" alt=""><div><b>コーチ ポン子</b><span class="ct"></span></div>`;
  $("coach").querySelector(".ct").textContent = String(text ?? "");
  $("coach").classList.remove("on");
  void $("coach").offsetWidth;
  $("coach").classList.add("on");
}

// 段の掲示：議論タイム・証拠品タイム
function banner(text) {
  evt("banner", text);
  $("banner").textContent = text;
  $("banner").classList.remove("on");
  void $("banner").offsetWidth;
  $("banner").classList.add("on");
  speaker?.clip("crowd/zawa.mp3", 0.5);
  return new Promise((r) => setTimeout(r, 1400));
}
let shownPhase = "";
function phase(kind) {
  // ひとりで挑戦では出さない（書記官が反論を言い直すと「議論タイム！ 異議あり・論破のチャンス！」が出てしまう 10/22）
  if (mode === "solo" || shownPhase === kind) return;
  shownPhase = kind;
  const text = { debate: "議論タイム！ 異議あり・論破のチャンス！", evidence: "証拠品タイム！ 証拠を突きつけろ！" }[kind];
  $("banner").textContent = text;
  $("banner").classList.remove("on");
  void $("banner").offsetWidth;
  $("banner").classList.add("on");
  $("evidenceBtn").classList.toggle("glow", kind === "evidence");
  $("objection").classList.toggle("glow", kind === "debate");
  $("ronpa").classList.toggle("glow", kind === "debate");
  heat(10);
  speaker?.clip("crowd/oo.mp3", 0.4);
  if (speaker) sfx.objection(speaker.ctx);
}

// 閉廷！：叫び＋木槌3回＋紙吹雪
let adjourned = false;
async function adjourn() {
  if (adjourned) return;
  adjourned = true;
  closeAfterSpeech(6000); // 「これにて閉廷」を言い終えたら、マイクと Live を閉じる（ふたりで対戦も）
  step("closed");
  shout("閉廷！");
  for (let i = 0; i < 60; i++) {
    const c = document.createElement("div");
    c.className = "confetti";
    c.style.left = `${Math.random() * 100}%`;
    c.style.background = ["#ff2d8a", "#ffd23f", "#8b3dff", "#fff"][i % 4];
    c.style.animationDelay = `${Math.random() * 0.8}s`;
    $("stage").append(c);
    setTimeout(() => c.remove(), 3600);
  }
  if (speaker) for (let i = 0; i < 3; i++) await sfx.gavel(speaker.ctx);
  beat?.stop();
  react("verdict");
  await showTitle();
}

// 結果カード（ひとりで挑戦）：お題・勝ち負け・スコア・いちばん良かった一言・コーチの総評・コン太の一言
async function resultCard(result, v) {
  evt("result", result);
  const rv = rivalInfo;
  const newBadges = earnBadges(result);
  // 試合の記録をこの端末に残す（タイトルの「これまでの試合」に出る）
  const hist = store.get("ouchi.history", []);
  hist.unshift({ at: Date.now(), topic: topic?.motion ?? "", side, result, me: soloScore.player, rival: soloScore.rival, best: best.text });
  store.set("ouchi.history", hist.slice(0, 50));
  const rivalLine = result === "win" ? `くっ…次は負けないぞ！（コン太 Lv${Math.min(5, (rv.level ?? 1))} にパワーアップ）` : result === "lose" ? "ふふん、ぼくの勝ち！でもいい勝負だったよ" : "引き分けか…次こそ決着をつけよう！";
  const title = v?.stamp ?? { win: "勝訴！", lose: "敗訴…", draw: "引き分け" }[result];
  // 友だちの挑戦状から来た人には、相手の点とくらべる
  const vsFriend = challenge && challenge.topic === topic?.motion ? `<div class="rf display">挑戦状の ${challenge.score}点 → あなた ${soloScore.player}点：${soloScore.player > challenge.score ? "🎉 超えた！" : soloScore.player === challenge.score ? "🤝 同点！" : "💧 あと少し！"}</div>` : "";
  // 結果カードは大事なものだけ。くわしくは開いたときだけ（10/16「ごちゃついてわかりにくい」）
  $("result").innerHTML = `<div class="card">
    <div class="rt display">${esc(title)}</div>
    <div class="rs display">あなた ${soloScore.player} - ${soloScore.rival} コン太</div>
    ${vsFriend}
    ${newBadges.length ? `<div class="nb display">NEW バッジ！ ${newBadges.map((b) => `${esc(b.icon)} ${esc(b.name)}`).join("　")}</div>` : ""}
    <div class="rc"><img src="img/lawyerD.png" alt=""><span>${rivalLine}</span></div>
    <div class="rbtns"><button id="shareX" class="display"><span>📣 友だちに挑戦状を送る</span></button><button id="again" class="display gold"><span>もう一回！</span></button></div>
    <div id="shareNote" class="rq"></div>
    <details class="more"><summary>くわしく見る（内訳・作戦メモ・名言）</summary>
      <div class="rq">お題：${esc(topic?.motion)}（あなたは${esc(side)}）</div>
      <div class="rq">内訳：理由 ${breakdown.reason}｜具体例 ${breakdown.example}｜反論に答えた ${breakdown.counter}｜使い回し ${breakdown.repeat}｜理由なし ${breakdown.noreason ?? 0}回｜反論スルー ${breakdown.through ?? 0}回｜ラウンド勝ち ${roundWins.player}/${rounds}${suddenDeath ? "｜サドンデス" : ""}${extraRound ? "｜延長戦" : ""}</div>
      <div class="rb"><b>きょうの名言</b>「${esc(best.text || "（また次回！）")}」</div>
      <div class="rc"><img src="img/lawyerP.png" alt=""><span><b>ポン子の作戦メモ（次はこうすると強いよ）</b>${hints.length ? hints.slice(-2).map((h) => `・${esc(h)}`).join("<br>") : "考えを自分の言葉で言えたのがすごい！"}</span></div>
      <div class="rp">通算 ${rv.wins ?? 0}勝 ${rv.losses ?? 0}敗</div>
      <button id="saveLog" class="mini">💾 記録を保存</button>
    </details>
    <button id="resultClose" class="mini">とじる</button></div>`;
  $("result").classList.add("on");
  sfx.fanfare(speaker.ctx);
  $("resultClose").onclick = () => $("result").classList.remove("on");
  $("again").onclick = () => {
    $("result").classList.remove("on");
    closeCourt();
    setTimeout(() => $("solo").click(), 1700);
  };
  // 記録を文字のファイルで保存（お題・点数・会話の全文）
  $("saveLog").onclick = () => {
    const d = new Date();
    const head = `おうち裁判の記録 ${d.toLocaleString("ja-JP")}\nお題：${topic?.motion ?? ""}（${side}）\n結果：${{ win: "勝訴", lose: "敗訴", draw: "引き分け" }[result]} あなた ${soloScore.player} - ${soloScore.rival} コン太\nきょうの名言：${best.text}\n\n`;
    download(new Blob([head + record.map((x) => `${x.who}: ${x.text}`).join("\n")], { type: "text/plain" }), `おうち裁判_${d.toISOString().slice(0, 10)}.txt`);
  };
  // 挑戦状：結果の画像＋同じお題で遊べるリンク。投稿するかは本人が決める（画面を開くだけ）。名前や名言は入れない
  $("shareX").onclick = async () => {
    const url = `${location.origin}/?t=${encodeURIComponent(topic?.motion ?? "")}&c=${soloScore.player}`;
    const text = `【おうち裁判 挑戦状】\nお題「${topic?.motion ?? ""}」\nわたしは【${side}】派で、AIライバルのコン太に ${soloScore.player}-${soloScore.rival} で${title}\nこの${soloScore.player}点、超えられる？ あなたはどっち派？\n#おうち裁判`;
    const png = await shareImage(title, url);
    const file = png && new File([png], "ouchi-court.png", { type: "image/png" });
    earnShareBadge();
    // スマホ：共有メニューで画像つきで送れる
    if (file && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], text: `${text}\n${url}` });
        return;
      } catch {}
    }
    // パソコン：画像を保存し、文もコピーして、X の投稿画面を開く（画像は貼り付けてもらう）
    if (png) download(png, "おうち裁判_挑戦状.png");
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
    } catch {}
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, "_blank");
    $("shareNote").textContent = "挑戦状の画像を保存して、文もコピーしました。Xの投稿画面に画像を貼ってね。";
  };
  await new Promise((r) => setTimeout(r, 1200));
}

function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
// 挑戦状の画像（1200×630。Xのカードの大きさ）。法廷バトル風：集中線・太い縁取りの文字・キャラの切り抜き
async function shareImage(title, url) {
  try {
    // 文字ごとにフォントの分割ファイルが読まれるので、使う文字を全部渡して読み込む（「完」だけ別の字体になった）
    const used = `おうち裁判 挑戦状${title}あなた0123456789-コン太お題「」${topic?.motion ?? ""}【】${side}派の点、超えられる？`;
    await Promise.all([30, 40, 54, 150].map((px) => document.fonts.load(`${px}px "Dela Gothic One"`, used)));
    const W = 1200, H = 630;
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const g = c.getContext("2d");
    const font = (px) => `${px}px "Dela Gothic One", sans-serif`;
    const outline = (t, x, y, px, fill, { stroke = "#000", shadow = null, align = "left" } = {}) => {
      g.font = font(px);
      g.textAlign = align;
      g.lineJoin = "round";
      if (shadow) {
        g.lineWidth = px / 5;
        g.strokeStyle = shadow;
        g.strokeText(t, x + px / 14, y + px / 14);
        g.fillStyle = shadow;
        g.fillText(t, x + px / 14, y + px / 14);
      }
      g.lineWidth = px / 6;
      g.strokeStyle = stroke;
      g.strokeText(t, x, y);
      g.fillStyle = fill;
      g.fillText(t, x, y);
    };
    // 背景：黒地にピンクの集中線（左の見出しから広がる）
    g.fillStyle = "#120717";
    g.fillRect(0, 0, W, H);
    g.save();
    g.translate(380, 250);
    for (let i = 0; i < 48; i++) {
      g.rotate((Math.PI * 2) / 48);
      g.fillStyle = i % 2 ? "rgba(255,79,163,.28)" : "rgba(138,63,252,.18)";
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(1400, -40);
      g.lineTo(1400, 40);
      g.fill();
    }
    g.restore();
    const glow = g.createRadialGradient(380, 250, 20, 380, 250, 420);
    glow.addColorStop(0, "rgba(255,79,163,.55)");
    glow.addColorStop(1, "rgba(18,7,23,0)");
    g.fillStyle = glow;
    g.fillRect(0, 0, W, H);
    // 右：コン太（ピンクの光を背負う）
    const kon = await new Promise((r) => {
      const i = new Image();
      i.onload = () => r(i);
      i.onerror = () => r(null);
      i.src = "img/lawyerD.png";
    });
    if (kon) {
      g.save();
      g.shadowColor = "#ff4fa3";
      g.shadowBlur = 40;
      g.drawImage(kon, 790, 90, 420, 420);
      g.restore();
    }
    // 左上：小さな看板
    g.fillStyle = "#ff4fa3";
    g.beginPath();
    g.moveTo(40, 30);
    g.lineTo(430, 30);
    g.lineTo(410, 92);
    g.lineTo(20, 92);
    g.fill();
    outline("おうち裁判 挑戦状", 48, 78, 40, "#fff", { stroke: "#000" });
    // 中央：判決の文字（大きく・斜め）
    g.save();
    g.translate(400, 270);
    g.rotate(-0.1);
    // 長い判決（完全論破！など）は幅に合わせて小さくする
    let px = 150;
    g.font = font(px);
    while (px > 70 && g.measureText(title).width > 640) g.font = font((px -= 6));
    outline(title, 0, 0, px, "#fff", { shadow: "#ff4fa3", align: "center" });
    g.restore();
    // 下：黒い斜めの帯に点数とお題
    g.fillStyle = "#000";
    g.beginPath();
    g.moveTo(0, 400);
    g.lineTo(W, 360);
    g.lineTo(W, H);
    g.lineTo(0, H);
    g.fill();
    g.fillStyle = "#ff4fa3";
    g.fillRect(0, 396, W, 6);
    outline(`あなた ${soloScore.player} - ${soloScore.rival} コン太`, 50, 470, 54, "#fff", { stroke: "#000" });
    g.font = font(30);
    g.textAlign = "left";
    g.fillStyle = "#ffd23f";
    const t = `お題「${topic?.motion ?? ""}」`;
    g.fillText(t.length > 30 ? `${t.slice(0, 29)}…」` : t, 50, 530);
    g.fillStyle = "#fff";
    g.fillText(`【${side}】派の ${soloScore.player}点、超えられる？`, 50, 580);
    g.font = "22px sans-serif";
    g.textAlign = "right";
    g.fillStyle = "#c9b8e0";
    g.fillText(url.replace(/^https?:\/\//, "").split("?")[0], W - 30, H - 24);
    return await new Promise((r) => c.toBlob(r, "image/png"));
  } catch {
    return null;
  }
}
// 挑戦状のリンク（?t=お題&c=点数）から来た人
const challenge = (() => {
  const q = new URLSearchParams(location.search);
  const sc = Number(q.get("c"));
  return q.get("t") && Number.isFinite(sc) && q.has("c") ? { topic: q.get("t").slice(0, 40), score: sc } : null;
})();
if (challenge) {
  const el = document.createElement("div");
  el.className = "challenge display";
  el.textContent = `📣 挑戦状がとどいた！「${challenge.topic}」で ${challenge.score}点。超えられる？`;
  $("intro").insertBefore(el, $("solo"));
}
function earnShareBadge() {
  const have = store.get("ouchi.badges", []);
  if (!have.includes("share")) store.set("ouchi.badges", [...have, "share"]);
}
// 投票タイム：3人の判事の票をスロットで回して、1つずつ止める
async function voteTime(panel) {
  evt("vote", panel.map((p) => p.vote).join("/"));
  $("reels").innerHTML = panel.map((p, i) => `<div class="reel spin" id="reel${i}"><small>${esc(p.title)}</small><div class="val display">？？？</div><div class="why"></div></div>`).join("");
  $("vote").classList.add("on");
  const names = [...new Set(panel.map((p) => p.vote))];
  const spinners = panel.map((_, i) => setInterval(() => {
    const el = document.querySelector(`#reel${i} .val`);
    if (el) el.textContent = [...names, "和解"][Math.floor(Math.random() * (names.length + 1))].replace("draw", "和解");
  }, 90));
  await new Promise((r) => setTimeout(r, 800));
  for (const [i, p] of panel.entries()) {
    clearInterval(spinners[i]);
    const reel = $(`reel${i}`);
    reel.classList.remove("spin");
    reel.querySelector(".val").textContent = p.vote === "draw" ? "和解" : `${p.vote}の勝ち`;
    reel.querySelector(".why").textContent = p.reason;
    sfx.tick(speaker.ctx);
    await new Promise((r) => setTimeout(r, 450));
  }
  await sfx.gavel(speaker.ctx);
  await new Promise((r) => setTimeout(r, 700));
  $("vote").classList.remove("on");
}

// 調査官ホーの出番：調べるか、再現イラストを作って、証拠品ファイルに入れる
let investigations = 0;
async function investigateCall(call) {
  if (++investigations > 2) {
    live.toolResponse([{ id: call.id, name: call.name, response: { result: "調査官ホーは今日はもう出番を使い切った（1回の裁判で2回まで）。書記官は二人の言い分で進める。" } }]);
    return;
  }
  const { query = "", mode = "search" } = call.args ?? {};
  onStage("detective", mode === "illustrate" ? `再現イラストを作成中…「${query}」` : `調査中…「${query}」`, { fresh: true });
  shout("調査開始！");
  heat(10);
  try {
    const r = await api("/api/investigate", { query, mode });
    const label = `証拠品${evidence.length + 1}：${r.caption}`;
    const card = document.createElement("div");
    card.className = "ev";
    if (r.image) {
      const url = `data:image/jpeg;base64,${r.image}`;
      card.innerHTML = `<img src="${esc(url)}" alt=""><div>${esc(label)}</div>`;
      evidence.push({ label, dataUrl: url });
      live.send({ realtimeInput: { video: { data: r.image, mimeType: "image/jpeg" } } });
    } else {
      card.innerHTML = `<div style="padding:6px;text-align:left;font-size:.68rem">🔍 ${esc(r.finding)}${r.sources?.length && safeUrl(r.sources[0].url) ? `<br><a href="${esc(safeUrl(r.sources[0].url))}" target="_blank" rel="noopener noreferrer" style="color:#ffd23f">出典：${esc(r.sources[0].title)}</a>` : ""}</div><div>${esc(label)}</div>`;
      evidence.push({ label: `${label}（${r.finding}）` });
    }
    $("evidence").append(card);
    showEvidence(card);
    evidenceCount++;
    score(80, "証拠");
    shout("証拠品、発見！");
    onStage("detective", r.finding, { fresh: true });
    note("調査官ホー", `${label}: ${r.finding}`);
    live.toolResponse([{ id: call.id, name: call.name, response: { result: `調査官ホーの報告（画面に証拠品として出した）: ${r.finding}。書記官はこの証拠品がだれの言い分に関係するかを二人に聞く。` } }]);
  } catch (e) {
    live.toolResponse([{ id: call.id, name: call.name, response: { result: "調査官ホーは調べきれなかった。書記官は二人に、ほかに証拠がないか聞く。" } }]);
  }
}
function showEvidence(card) {
  const big = card.cloneNode(true);
  big.className = "evBig";
  $("stage").append(big);
  setTimeout(() => big.remove(), 4500);
}

// 弁護人が自分から割り込む：子どもの発言のたびに、2人の弁護人（別々の AI）が「異議あり」をするか決める
let lastObjector = "", lawyerBusy = false;
// 原告・被告の名前：開廷の前に入れてもらう（音声の聞き違えで「カントウさん」になった 10/16）。入っていなければ最初の発言から拾う
const parties = [];
function showParties() {
  if (mode === "solo") {
    if (parties[0]) $("balP").textContent = `${parties[0]}（${side}）`;
    return;
  }
  if (parties[0]) $("balP").textContent = `${parties[0]}（原告）`;
  if (parties[1]) $("balD").textContent = `${parties[1]}（被告）`;
  // 席と立ち絵の名札にも名前を足す（「原告 ハナ」）
  CAST.plaintiff.name = parties[0] ? `原告 ${parties[0]}` : "原告";
  CAST.defendant.name = parties[1] ? `被告 ${parties[1]}` : "被告";
  $("seat-plaintiff").querySelector("span").textContent = CAST.plaintiff.name;
  $("seat-defendant").querySelector("span").textContent = CAST.defendant.name;
  if (who === "plaintiff" || who === "defendant") $("nameplate").textContent = CAST[who].name;
}
// 子どもが話したときに光らせる席。ひとりで挑戦は証言台。ふたりで対戦は原告か被告：
// 本人の名乗り（「〇〇です」）→ 直前に書記官が呼びかけた人 → 今の段（原告／被告）→ 原告
// 発言に相手の名前が入っているだけでは動かさない（10/23「アカさんの発言で被告の席が光った」）
let lastCalled = -1; // 0=原告, 1=被告, -1=まだ呼ばれていない
function childSeat(text = "") {
  if (mode === "solo") return "witness";
  const self = selfNamedParty(text, parties);
  if (self >= 0) return self === 1 ? "defendant" : "plaintiff";
  if (lastCalled >= 0) return lastCalled === 1 ? "defendant" : "plaintiff";
  const now = STEPS[stepNow]?.[0];
  if (now === "defendant") return "defendant";
  return "plaintiff";
}
// 書記官が「〇〇さんですね？」と確かめた名前（聞き違えを本人が直したあとの名前）
function confirmName(text) {
  const m = text.match(/([ァ-ヶーぁ-ん一-龠A-Za-z]{1,8})さん(?:ですね|で合って|、合って)/);
  if (!m) return;
  const slot = stepNow <= 1 ? 0 : 1;
  parties[slot] = m[1];
  showParties();
}
function pickName(text) {
  if (parties.length >= 2) return;
  // 発言の頭の名乗りだけ（10/24「冷蔵庫の最後のプリンを、…」から被告の名前「の最後のプリンを」を拾った）
  const m = text.trim().match(/^(?:わたしは|私は|ぼくは|僕は|おれは|俺は)?\s*([ァ-ヶーぁ-ん一-龠A-Za-z]{1,8}?)(?:です|だよ)/);
  if (m && parties.length < 2 && !parties.includes(m[1]) && !/^(うん|はい|いいえ|でも|だって)$/.test(m[1])) parties.push(m[1]);
  showParties();
}
let checkQueue = Promise.resolve();
function lawyersCheck(statement) {
  // 前の発言を判定しているあいだに来た発言も、順番に判定する（10/16 ラウンド3が数えられなかった）
  checkQueue = checkQueue.then(() => lawyersCheckNow(statement)).catch(() => {});
}
async function lawyersCheckNow(statement) {
  if (!live || judging) return;
  lawyerBusy = true;
  try {
    const recent = record.slice(-8).map((r) => `${r.who}: ${r.text}`).join("\n");
    const r =
      mode === "solo"
        ? await api("/api/opponent", { topic: topic?.motion, side, record: recent, last: statement, level: rivalInfo.level })
        : await api("/api/lawyers", { record: recent, last: statement, plaintiff: parties[0], defendant: parties[1] });
    swayBy(r.sway ?? 0);
    if (mode === "solo" && statement.length >= 3) soloPoint(r, statement);
    // 対戦モードでは勝手に「異議あり」を出さない（10/16「勝手に異議アリが発動する」）。異議は子どもが言う・押す
    if (false && mode === "solo" && r.id && r.id !== lastObjector) { // 10/16「すぐ割り込んでくる」→ 相手はコン太のターンでだけ話す
      lastObjector = r.id;
      // 話している途中に割り込むとせりふが切れる（10/16）。いまの人が話し終わるまで待つ
      for (let i = 0; i < 40 && speaker?.busy; i++) await new Promise((w) => setTimeout(w, 250));
      onStage(r.id, r.line, { fresh: true });
      objectionCount++;
      heat(15);
      react("objection");
      await shout("異議あり！");
      note(r.name, r.line);
      live.send({ clientContent: { turns: [{ role: "user", parts: [{ text: `（${r.name}が割り込みました:「${r.line}」。書記官は「異議を認めます」と言い、${r.name}の言い分を受けて、相手の子に聞いてください）` }] }], turnComplete: true } });
    } else lastObjector = "";
  } catch {}
  lawyerBusy = false;
}

// 証拠品：カメラで撮って Live に見せる（判事にも名前を渡す）
async function showCamera() {
  camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
  $("video").srcObject = camStream;
  $("cam").style.display = "block";
}
function hideCamera() {
  camStream?.getTracks().forEach((t) => t.stop());
  $("cam").style.display = "none";
}
function submitEvidence() {
  const v = $("video");
  const c = document.createElement("canvas");
  c.width = 640;
  c.height = Math.round((640 * v.videoHeight) / v.videoWidth) || 480;
  c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
  const dataUrl = c.toDataURL("image/jpeg", 0.8);
  const label = `証拠品${evidence.length + 1}`;
  evidence.push({ label, dataUrl });
  const card = document.createElement("div");
  card.className = "ev";
  card.innerHTML = `<img src="${dataUrl}" alt=""><div>${label}</div>`;
  $("evidence").append(card);
  hideCamera();
  evidenceCount++;
  heat(20);
  score(80, "証拠");
  shout("これが証拠だ！");
  live.send({ realtimeInput: { video: { data: dataUrl.split(",")[1], mimeType: "image/jpeg" } } });
  live.send({ clientContent: { turns: [{ role: "user", parts: [{ text: `（${label}が提出されました。何が写っているか確かめてください）` }] }], turnComplete: true } });
  note("証拠品", `${label}を提出`);
}

function closeCourt() {
  userClosed = true;
  micController?.abort();
  micController = null;
  setTimeout(() => {
    $("intro").classList.remove("hide");
    layoutSeats("solo");
    loadRival();
    showShelf();
    $("topicCard").style.display = "none";
    $("soloScore").style.display = "none";
    $("feverClock").textContent = "";
    $("box").textContent = "";
    $("status").textContent = "";
    $("turnBtn").style.display = "none";
    $("kotodama").classList.remove("on");
    $("result").classList.remove("on");
    $("stage").classList.remove("debate", "fever", "glitch");
    document.querySelectorAll(".fly, .nsd").forEach((el) => el.remove());
    document.body.classList.remove("solo", "versus");
    document.querySelectorAll("#steps span").forEach((el) => (el.className = ""));
  }, 1500);
  beat?.stop();
  stopMic?.();
  stopMic = null;
  live?.close();
  speaker?.dispose();
  hideCamera();
  $("open").disabled = false;
  ["close", "objection", "evidenceBtn", "ronpa", "verdictBtn", "pauseBtn"].forEach((id) => ($(id).disabled = true));
}

$("open").onclick = () => {
  mode = "versus";
  $("intro").classList.add("hide");
  document.body.classList.remove("solo");
  document.body.classList.add("versus");
  $("topicCard").style.display = "none";
  openCourt(false);
};
// ひとりで挑戦：お題を選んで、賛成か反対かを決めてから開廷
$("solo").onclick = async () => {
  $("intro").classList.add("hide");
  $("topics").innerHTML = "<p>いま話題のお題を探しています…</p>";
  $("topics").style.display = "block";
  try {
    const { topics } = await api("/api/topics");
    // いま話題を先に、定番はまぜて。🔀 で次の4つ（10/16「テーマはシャッフルできない？」）
    const mix = (a) => a.map((t) => [Math.random(), t]).sort((x, y) => x[0] - y[0]).map((x) => x[1]);
    // いま話題を先に、そのあとはAIの新作と定番をまぜる
    const pool = [...mix(topics.filter((t) => t.source)), ...mix(topics.filter((t) => !t.source))];
    // シェアのリンク（?t=お題）から来たら、そのお題を先頭に（ニュースが変わっていても、お題だけで遊べる）
    const shared = new URLSearchParams(location.search).get("t")?.slice(0, 40);
    if (shared) {
      const i = pool.findIndex((t) => t.motion === shared);
      pool.unshift(i >= 0 ? pool.splice(i, 1)[0] : { motion: shared, background: "シェアされたお題だよ。", detail: "友だちがシェアしたお題。あなたはどっち派？", source: null });
    }
    let page = 0, chosen;
    const draw = () => {
      const shown = Array.from({ length: Math.min(4, pool.length) }, (_, i) => pool[(page * 4 + i) % pool.length]);
      chosen = shown[0];
      $("topicList").innerHTML = shown
        .map((t, i) => `<button class="topic sub" data-i="${i}"><span><b>${esc(t.motion)}</b><small>${esc(t.detail ?? t.background)}${t.source ? "（いま話題から）" : t.fresh ? "（AIの新作）" : ""}</small></span></button>`)
        .join("");
      $("topicList").querySelectorAll(".topic").forEach((b) => (b.onclick = () => {
        chosen = shown[Number(b.dataset.i)];
        $("topicList").querySelectorAll(".topic").forEach((x) => x.classList.toggle("chosen", x === b));
      }));
      $("topicList").querySelector(".topic").classList.add("chosen");
    };
    $("topics").innerHTML =
      `<div class="pickRow"><button id="topicBack" class="mini">← もどる</button><span class="pick">お題をえらんでね</span><button id="shuffle" class="mini">🔀 ほかのお題</button></div><div id="topicList"></div>` +
      `<div class="sides"><button class="side" data-s="賛成"><span>👍 賛成で戦う</span></button><button class="side sub" data-s="反対"><span>👎 反対で戦う</span></button></div>`;
    draw();
    $("topicBack").onclick = () => {
      $("topics").style.display = "none";
      $("intro").classList.remove("hide");
    };
    $("shuffle").onclick = () => {
      page++;
      draw();
    };
    $("topics").querySelectorAll(".side").forEach((b) => (b.onclick = async () => {
      mode = "solo";
      document.body.classList.remove("versus");
      document.body.classList.add("solo");
      topic = chosen;
      side = b.dataset.s;
      try {
        // 証拠カード（証拠のカード）を3つ配る。論破タイムで撃つ弾
        api("/api/kotodama", { topic: topic.motion, side, detail: topic.detail ?? topic.background, pro: topic.pro, con: topic.con })
          .then((k) => {
            bullets = k.bullets ?? [];
            showHintCards();
          })
          .catch(() => (bullets = []));
        rivalInfo = await api("/api/rival", {});
        rivalInfo.lastResult = rivalInfo.last;
        startLevel = rivalInfo.level ?? 1;
      } catch {}
      $("topics").style.display = "none";
      // お題は1行。くわしくは開いたときだけ（PCでスクロールが要った 10/16）
      $("topicCard").innerHTML = `<details><summary><b>お題：${esc(topic.motion)}</b> <small>あなたは「${esc(side)}」側・くわしく ▾</small></summary><p>${esc(topic.detail ?? topic.background)}</p><div class="pc"><span>👍 賛成：${esc(topic.pro ?? "？")}</span><span>👎 反対：${esc(topic.con ?? "？")}</span></div>${topic.source && safeUrl(topic.source.url) ? `<small>話題のもと：<a href="${esc(safeUrl(topic.source.url))}" target="_blank" rel="noopener noreferrer">${esc(topic.source.title)}</a></small>` : ""}</details>`;
      $("topicCard").style.display = "block";
      showHintCards();
      shout("あなた VS コン太");
      openCourt(false);
    }));
  } catch (e) {
    $("topics").innerHTML = `<p>お題を取れませんでした: ${esc(e.message)}</p>`;
  }
};
$("resume").onclick = () => openCourt(true);
$("close").onclick = async () => {
  await adjourn();
  setTimeout(closeCourt, 1500);
};
$("ronpa").onclick = () => ronpa();
$("turnBtn").onclick = () => live?.send({ clientContent: { turns: [{ role: "user", parts: [{ text: "（以上です。子どもが話し終わりました。受けて次へ進んでください）" }] }], turnComplete: true } });
$("pauseBtn").onclick = togglePause;
$("verdictBtn").onclick = () => {
  if (!live || judged) return;
  shout("判決を求む！");
  live.send({ clientContent: { turns: [{ role: "user", parts: [{ text: "判決お願いします！（判決ボタンが押されました。すぐ call_judge を呼んでください）" }] }], turnComplete: true } });
};
$("objection").onclick = () => {
  objectionCount++;
  heat(15);
  score(50, "異議");
  shout("異議あり！");
  live?.send({ clientContent: { turns: [{ role: "user", parts: [{ text: "異議あり！" }] }], turnComplete: true } });
};
$("evidenceBtn").onclick = showCamera;
$("submitEv").onclick = submitEvidence;
$("cancelEv").onclick = hideCamera;
$("pass").value = localStorage.getItem("ouchi-court-pass") ?? "";
$("pass").oninput = () => localStorage.setItem("ouchi-court-pass", $("pass").value);

// 確かめ用（?debug のときだけ）：声の代わりに文字で発言する
if (new URLSearchParams(location.search).has("debug")) {
  window.__events = [];
  window.__court = {
    // 子ども役の声（mp3）を流し、流し終わってから発言として送る（デモ動画用）
    speak(text, url) {
      evt("child", text);
      onStage(childSeat(text), text, { fresh: true });
      return new Promise((done) => {
        const a = new Audio(url);
        a.onended = a.onerror = () => {
          ignoreHeardUntil = Date.now() + 15000;
          flyStatement(text);
          note("証言台", text);
          closeNote();
          live.send({ clientContent: { turns: [{ role: "user", parts: [{ text }] }], turnComplete: true } });
          done();
        };
        a.play().catch(() => a.onended());
      });
    },
    async showShare(ms = 4500) {
      const url = URL.createObjectURL(await shareImage(document.querySelector("#result .rt")?.textContent || "勝訴！", location.origin));
      const el = document.createElement("div");
      el.id = "sharePreview";
      el.innerHTML = `<img src="${url}" alt="">`;
      $("stage").append(el);
      evt("share", "");
      await new Promise((r) => setTimeout(r, ms));
      el.remove();
    },
    events: () => window.__events,
    say(text) {
      ignoreHeardUntil = Date.now() + 15000;
      flyStatement(text);
      onStage(childSeat(text), text, { fresh: true });
      note("証言台", text);
      closeNote();
      live.send({ clientContent: { turns: [{ role: "user", parts: [{ text }] }], turnComplete: true } });
    },
    ronpa: () => ronpa(),
    glitch: () => glitchRoulette(),
    shareImg: async (title = "勝訴！", me = 12, rv = 3, t = "夏休みは、もっと長くするべき？") => {
      soloScore = { player: me, rival: rv };
      topic = { motion: t };
      return URL.createObjectURL(await shareImage(title, location.origin));
    },
    cut: async () => { await cutIn("そこ、おかしいよ！"); await breakGlass(); },
    state: () => ({ myTurn, turnLeft, connected: live?.ws?.readyState, mode, ...dbg }),
  };
}


// 対戦モードは今は出さない（10/16「対戦はまだいらないかも」）。コードは残す

$("resume").style.display = "none";
// タイトル画面に、ライバルの戦績を出す
async function loadRival() {
  try {
    const r = await api("/api/rival", {});
    const n = (r.wins ?? 0) + (r.losses ?? 0) + (r.draws ?? 0);
    $("rivalLine").textContent = n ? `Lv${r.level}｜あなたの ${r.wins}勝 ${r.losses}敗${r.draws ? ` ${r.draws}分` : ""}${r.last === "win" ? "（リベンジに燃えている！）" : ""}` : "はじめての対決！";
  } catch {}
}
loadRival();
