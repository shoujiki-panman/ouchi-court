// おうち裁判の画面。書記官（と弁護人）は Gemini Live がリアルタイムに聞いて進め、
// 判決は3人の判事（別々の AI）の合議を、裁判長タヌキがまとめて言い渡す。
import { Live, Speaker, startMic } from "./live.js";
import { sfx } from "./sfx.js";
import { PUNISHMENTS } from "./punishments.js";

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
const SOLO = (topic, side) => `あなたは「おうち裁判 ひとりで挑戦モード」の書記官タヌ吉（司会）。子ども1人が、お題についてライバル弁護士コン太と議論バトルで対決する。
ルール（最初に必ずはっきり伝える）: 議論タイムで子どもが意見を言うたびに、判事たちがその理由を採点する。理由がしっかりしていれば子どもに1ポイント、理由が弱ければコン太に1ポイント。先に3ポイント取った方の勝ち。点数の知らせが届いたら、短く実況して盛り上げる（「〇〇さん、1ポイント先取！」等）。
お題:「${topic.motion}」（背景: ${topic.background}）
子どもは「${side}」側。弁護人ポン子は子どもの味方（子どもの言いたいことを整理して助ける）。弁護人コン太は反対側として、子どもと本気で（でもやさしく）議論する。どちらもあなたが声色を変えて演じ、名乗ってから話す。
段取り:
1. 開廷！子どもに名前を聞いて「〇〇さんですね？」と確かめる。
1.5 お題の説明：何があったかを、下の説明を使って10歳にも分かるように2〜3文で話す。そのあと「賛成の人はこう考える：…」「反対の人はこう考える：…」と例を1つずつ言い、「${side}側のあなたは、どう思う？」と聞く。子どもが分からないことを聞いてきたら、やさしく答える。
説明: ${topic.detail ?? topic.background}
賛成の例: ${topic.pro ?? "（自分で考えて）"}
反対の例: ${topic.con ?? "（自分で考えて）"}
2. 子どもに「${side}」の理由を聞く。ポン子として「つまり〜ってことだね！」と整理。
3. コン太として反対側の理由を1つ、短く言う。
4. 「議論タイム、スタート！」ここからはターン制。子どものターン → コン太のターン を2〜3回くり返す。子どものターンでは「〇〇さんのターン！ゆっくり考えながらでいいよ。言い終わったら『以上！』ね」と言って黙って聞く（子どもが話し終わるまで口をはさまない。少し黙っても「以上」と言うまで待つ）。コン太のターンでは、子どもの言ったことを受けて反論を1つだけ、短く言い、「さあ、〇〇さんのターン！」と返す。子どもが良いことを言ったらしっかりほめる。
5. 「証拠品タイム！」「調べてほしいことがあれば調査官ホーを呼べるよ」と一言だけ伝え、子どもが頼んだら investigate を呼ぶ。
6. 最後のひとことを聞き、「判決ボタンか『判決お願いします』で判決だ！」と言う。それまで call_judge は呼ばない。
7. 判決のあと、罰ゲーム（負けたらコン太がやることもある）を確かめて「これにて閉廷！」。
守ること: 子どもを言い負かして終わらせない。子どもが考えを言えたことを必ずほめる。日本語で話す。`;

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
  detective: { img: "img/detective.jpg", name: "調査官ホー" },
};

// 円形の法廷に席を並べる（裁判長が上、まわりに書記官・弁護人・証言台）
const SEATS = { judge: [50, 3], bailiff: [15, 14], lawyerP: [85, 14], lawyerD: [14, 44], witness: [86, 44] }; // 調査官ホーは呼ばれたときだけ中央に出る
for (const [id, [x, y]] of Object.entries(SEATS)) {
  const el = document.createElement("div");
  el.className = "seat";
  el.id = `seat-${id}`;
  el.style.left = `calc(${x}% - 37px)`;
  el.style.top = `${y}%`;
  el.innerHTML = `<div class="ring"><img src="${CAST[id].img}" alt=""></div><span>${CAST[id].name}</span>`;
  document.getElementById("stage").append(el);
}

const $ = (id) => document.getElementById(id);
const record = [];
const evidence = [];
let mode = "versus", topic = null, side = "賛成";
let live, stopMic, speaker, camStream, judging = false, speakingTurn = "", who = "", heardTurn = "", lastStatement = "";

const pass = () => $("pass").value || localStorage.getItem("ouchi-court-pass") || "";
const api = async (path, body) => {
  const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json", "x-passphrase": pass() }, body: JSON.stringify(body ?? {}) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? r.status);
  return j;
};

// 舞台：立ち絵・名札・せりふの箱（1文字ずつ）
let typing = Promise.resolve();
let scene = 0; // 話し手が変わるたびに増やし、前の人の1文字ずつ表示を打ち切る
function onStage(id, text, { fresh = false } = {}) {
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
(function lipsync() {
  const amp = speaker ? speaker.level() : 0;
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
  el.onclick = () => ronpa(t, el);
  $("stage").append(el);
  setTimeout(() => el.remove(), 9500);
}
async function ronpa(statement = lastStatement, el) {
  if (!live || !statement) return;
  el?.classList.add("hit");
  ronpaCount++;
  ronpaBoost = true;
  heat(25);
  score(100, "論破");
  react("ronpa");
  await shout("論破！");
  live.send({ clientContent: { turns: [{ role: "user", parts: [{ text: `（だれかが「${statement}」という発言に「論破！」と言いました。どこがおかしいと思ったのか、論破した人に名前と理由を聞いてください）` }] }], turnComplete: true } });
  note("論破", statement);
}
const status = (t) => ($("status").textContent = t);
function note(whoName, text) {
  const last = record[record.length - 1];
  if (last && last.who === whoName && !last.closed) last.text += text;
  else record.push({ who: whoName, text });
  $("log").textContent = record.map((r) => `${r.who}: ${r.text}`).join("\n");
}
const closeNote = () => record.length && (record[record.length - 1].closed = true);

// 異議あり！ ／ 待った！
async function shout(word = "異議あり！") {
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
  $("stamp").textContent = text;
  $("stamp").classList.remove("on");
  void $("stamp").offsetWidth;
  $("stamp").classList.add("on");
  setTimeout(() => $("stamp").classList.remove("on"), 4500);
}

async function openCourt(resume = false) {
  userClosed = false;
  if (!resume) {
    stepNow = -1;
    step("open");
    paused = false;
    $("paused").classList.remove("on");
  }
  if (!resume) {
    parties.length = 0;
    record.length = 0;
    evidence.length = 0;
    $("evidence").innerHTML = "";
    $("log").textContent = "";
    $("box").textContent = "";
    heatVal = 0;
    tempo = "calm";
    investigations = 0;
    soloScore = { player: 0, rival: 0 };
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
    speaker = new Speaker();
    onStage("judge", "これより、おうち裁判を開廷します。", { fresh: true });
    if (!resume) await sfx.fanfare(speaker.ctx);
    beat = sfx.beat(speaker.ctx);
    if (!resume) {
      heatVal = 0;
      points = 0;
      combo = 0;
      ronpaCount = objectionCount = evidenceCount = 0;
      $("pts").textContent = "0";
    }
    heat(0);
    live = new Live({
      token,
      model,
      setup: {
        generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } } } },
        systemInstruction: { parts: [{ text: `${mode === "solo" ? SOLO(topic, side) : BAILIFF}\n\n${MC_STYLE}` }] },
        tools: [{ functionDeclarations: [CALL_JUDGE, INVESTIGATE] }],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        realtimeInputConfig: { automaticActivityDetection: { silenceDurationMs: mode === "solo" ? 2500 : 1300 } },
      },
      on: {
        ready: async () => {
          const restart = resume && record.length ? `接続が切れたので再開します。これまでの法廷記録:\n${record.map((r) => `${r.who}: ${r.text}`).join("\n").slice(-3000)}\n続きから進めてください（開廷の宣言はしない）。${judged ? "判決はもう出ています。" : ""}` : "開廷してください。";
          live.send({ clientContent: { turns: [{ role: "user", parts: [{ text: restart }] }], turnComplete: true } });
          try {
            stopMic = await startMic((b64, lvl) => {
              if (judging || paused) return;
              live.audio(b64);
            });
            status("開廷中：そのまま話しかけてください");
          } catch (e) {
            status(`マイクが使えません（${e.message}）。ブラウザのマイクの許可を確かめてください。`);
          }
          ["close", "objection", "evidenceBtn", "ronpa", "verdictBtn", "pauseBtn"].forEach((id) => ($(id).disabled = false));
        },
        audio: (b64) => {
          if (paused) return;
          talk(true);
          beat?.loud(true);
          speaker.play(b64);
        },
        heard: (t) => {

          if (/論破|ろんぱ/.test(t)) ronpa();
          else if (/異議あり|いぎあり/.test(t)) {
            objectionCount++;
            heat(15);
            score(50, "異議");
            react("objection");
            shout("異議あり！");
          }
          if (who !== "witness") onStage("witness", "", { fresh: true });
          onStage("witness", t);
          note("証言台", t);
          heardTurn += t;
        },
        said: (t) => {
          if (/これにて閉廷|閉廷します|閉廷！/.test(speakingTurn + t)) adjourn();
          if (/議論タイム|言い返し|反論はある/.test(speakingTurn + t)) phase("debate");
          const said = speakingTurn + t;
          confirmName(said);
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
          const id = /ポン子/.test(speakingTurn) ? "lawyerP" : /コン太/.test(speakingTurn) ? "lawyerD" : "bailiff";
          if (who !== id) onStage(id, speakingTurn, { fresh: true });
          else onStage(id, t);
          note(CAST[id].name, t);
        },
        interrupted: () => {
          beat?.loud(false);
          speaker.stop();
          talk(false);
        },
        turnComplete: () => {
          dbg.tc++;
          speakingTurn = "";
          if (mode === "solo") $("turnBtn").style.display = "inline-block";
          setTimeout(() => !speaker.busy && beat?.loud(false), 600);
          closeNote();
          setTimeout(() => !speaker.busy && talk(false), 400);
        },
        toolCall: (calls) => calls.forEach((c) => (c.name === "investigate" ? investigateCall(c) : judge(c))),
        goAway: () => status("まもなく接続が切れます（10分ごと）"),
        closed: (e) => {
          if (userClosed) return status("閉廷しました");
          beat?.loud(false);
          status(`接続が切れました（${e?.code ?? ""} ${e?.reason ?? ""}）。「再開する」で続きから始められます。`);
          $("resume").style.display = "inline-block";
        },
        error: (m) => status(m),
      },
    });
  } catch (e) {
    status(`開廷できませんでした: ${e.message}`);
    $("open").disabled = false;
  }
}

// 判事たちの合議：3人がそれぞれ票を入れ、裁判長タヌキがまとめて言い渡す
let judged = false;
let userClosed = false;
async function judge(call) {
  if (call.name !== "call_judge") return;
  if (judged) {
    live.toolResponse([{ id: call.id, name: call.name, response: { result: "判決はもう出ている。くり返さず、罰や仲直りを確かめて閉廷する。" } }]);
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
    const v = await api("/api/verdict", { record: text, names, evidence: evidence.map((e) => e.label) });
    await voteTime(v.panel ?? []);
    const voice = await api("/api/voice", { text: v.speech }).catch(() => null);
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
    if (v.punishment) await punishmentTime(v.punishment, v.who);
    live.toolResponse([
      { id: call.id, name: call.name, response: { result: `裁判長がたった今、判決を読み上げた（書記官は判決をくり返さないこと）。罰ゲーム: ${v.who ?? ""}「${v.punishment?.text ?? v.sentence}」（画面でもう発表して、やり終えた）。書記官は、罰や仲直りが今できているかを名前を呼んで楽しく確かめてから「これにて閉廷！」と締める。` } },
    ]);
  } catch (e) {
    drum.stop();
    status(`判事が来られませんでした: ${e.message}`);
    live.toolResponse([{ id: call.id, name: call.name, response: { result: "判事が不在。書記官が代わりに、二人に仲直りの握手をすすめて閉廷する。" } }]);
  } finally {
    judging = false;
    status("開廷中");
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
  beat?.level(heatVal < 30 ? 0 : heatVal < 60 ? 0.5 : 1);
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
  if (Math.abs(balanceVal) >= 70) comebackTime(balanceVal < 0 ? parties[1] : parties[0]);
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
  el.innerHTML = `<div>${title}</div><div class="plus">${plus}</div><div class="total">合計 ${total}pt</div>`;
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
async function punishmentTime(p, who) {
  $("rWho").textContent = who ? `${who} の罰ゲームは……` : "罰ゲームは……";
  $("rItem").classList.remove("done");
  $("count").textContent = "";
  $("roulette").classList.add("on");
  let delay = 50;
  for (let i = 0; i < 26; i++) {
    $("rItem").textContent = PUNISHMENTS[i % PUNISHMENTS.length].text;
    sfx.tick(speaker.ctx);
    await new Promise((r) => setTimeout(r, delay));
    delay *= 1.12;
  }
  $("rItem").textContent = p.text;
  $("rItem").classList.add("done");
  await sfx.cymbal(speaker.ctx);
  await new Promise((r) => setTimeout(r, 2200));
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
const STEPS = [["open", "開廷"], ["plaintiff", "原告"], ["defendant", "被告"], ["debate", "議論"], ["evidence", "証拠品"], ["last", "最後のひとこと"], ["verdict", "判決"], ["penalty", "罰ゲーム"], ["closed", "閉廷"]];
let stepNow = -1;
function step(id) {
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
  $("pauseBtn").querySelector("span").textContent = paused ? "▶ 再開" : "⏸ 一時停止";
  if (paused) {
    speaker?.stop();
    beat?.loud(false);
    talk(false);
    status("一時停止中");
  } else {
    status("開廷中");
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
  $("turnBtn").style.display = "inline-block";
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
function showSoloScore() {
  $("soloScore").innerHTML = `<span class="me">あなた ${soloScore.player}</span><span class="vs">-</span><span class="rival">${soloScore.rival} コン太</span><small>先に3ポイントで勝ち</small>`;
}
async function soloPoint(point, why) {
  if (judged || stepNow < 3) return; // 名前や説明のあいだは数えない（議論タイムから）
  soloScore[point]++;
  showSoloScore();
  const mine = point === "player";
  shout(mine ? "あなたのポイント！" : "コン太のポイント…");
  popAt(why, mine ? 30 : 70, 30);
  speaker?.clip(mine ? "crowd/oo.mp3" : "crowd/ee.mp3", 0.5);
  if (mine) score(100, "主張");
  live?.send({ clientContent: { turns: [{ role: "user", parts: [{ text: `（判事の採点: ${mine ? "子ども" : "コン太"}に1ポイント。理由「${why}」。いま あなた${soloScore.player} - ${soloScore.rival}コン太。短く実況して、次のターンへ）` }] }], turnComplete: false } });
  if (soloScore.player >= 3 || soloScore.rival >= 3) {
    await new Promise((w) => setTimeout(w, 1500));
    live?.send({ clientContent: { turns: [{ role: "user", parts: [{ text: `（${soloScore.player >= 3 ? "子ども" : "コン太"}が3ポイント先取！勝負あり。「勝負あり！」と言って、すぐ call_judge を呼んでください）` }] }], turnComplete: true } });
  }
}

// 段の掲示：議論タイム・証拠品タイム
let shownPhase = "";
function phase(kind) {
  if (shownPhase === kind) return;
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

// 投票タイム：3人の判事の票をスロットで回して、1つずつ止める
async function voteTime(panel) {
  $("reels").innerHTML = panel.map((p, i) => `<div class="reel spin" id="reel${i}"><small>${p.title}</small><div class="val display">？？？</div><div class="why"></div></div>`).join("");
  $("vote").classList.add("on");
  const names = [...new Set(panel.map((p) => p.vote))];
  const spinners = panel.map((_, i) => setInterval(() => {
    const el = document.querySelector(`#reel${i} .val`);
    if (el) el.textContent = [...names, "和解"][Math.floor(Math.random() * (names.length + 1))].replace("draw", "和解");
  }, 90));
  await new Promise((r) => setTimeout(r, 1600));
  for (const [i, p] of panel.entries()) {
    clearInterval(spinners[i]);
    const reel = $(`reel${i}`);
    reel.classList.remove("spin");
    reel.querySelector(".val").textContent = p.vote === "draw" ? "和解" : `${p.vote}の勝ち`;
    reel.querySelector(".why").textContent = p.reason;
    await sfx.gavel(speaker.ctx);
    await new Promise((r) => setTimeout(r, 700));
  }
  await new Promise((r) => setTimeout(r, 1500));
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
      card.innerHTML = `<img src="${url}" alt=""><div>${label}</div>`;
      evidence.push({ label, dataUrl: url });
      live.send({ realtimeInput: { video: { data: r.image, mimeType: "image/jpeg" } } });
    } else {
      card.innerHTML = `<div style="padding:6px;text-align:left;font-size:.68rem">🔍 ${r.finding}${r.sources?.length ? `<br><a href="${r.sources[0].url}" target="_blank" style="color:#ffd23f">出典：${r.sources[0].title}</a>` : ""}</div><div>${label}</div>`;
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
  const m = text.match(/(?:わたしは|私は|ぼくは|僕は|おれは|俺は)?\s*([ァ-ヶーぁ-ん一-龠A-Za-z]{1,8}?)(?:です|だよ|。|、|！)/);
  if (m && parties.length < 2 && !parties.includes(m[1]) && !/^(うん|はい|いいえ|でも|だって)$/.test(m[1])) parties.push(m[1]);
  showParties();
}
async function lawyersCheck(statement) {
  if (!live || judging || lawyerBusy) return;
  lawyerBusy = true;
  try {
    const recent = record.slice(-8).map((r) => `${r.who}: ${r.text}`).join("\n");
    const r =
      mode === "solo"
        ? await api("/api/opponent", { topic: topic?.motion, side, record: recent, last: statement })
        : await api("/api/lawyers", { record: recent, last: statement, plaintiff: parties[0], defendant: parties[1] });
    swayBy(r.sway ?? 0);
    if (mode === "solo" && r.point && statement.length >= 8) soloPoint(r.point, r.why);
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
  beat?.stop();
  stopMic?.();
  live?.close();
  speaker?.stop();
  hideCamera();
  $("open").disabled = false;
  ["close", "objection", "evidenceBtn", "ronpa", "verdictBtn", "pauseBtn"].forEach((id) => ($(id).disabled = true));
}

$("open").onclick = () => {
  mode = "versus";
  $("topicCard").style.display = "none";
  openCourt(false);
};
// ひとりで挑戦：お題を選んで、賛成か反対かを決めてから開廷
$("solo").onclick = async () => {
  $("topics").innerHTML = "<p>最近の話題からお題を探しています…</p>";
  $("topics").style.display = "block";
  try {
    const { topics } = await api("/api/topics");
    $("topics").innerHTML =
      `<div class="pick">お題をえらんでね</div>` +
      topics
        .map((t, i) => `<button class="topic sub" data-i="${i}"><span><b>${t.motion}</b><small>${t.detail ?? t.background}${t.source ? "（いま話題から）" : ""}</small></span></button>`)
        .join("") +
      `<div class="sides"><button class="side" data-s="賛成"><span>👍 賛成で戦う</span></button><button class="side sub" data-s="反対"><span>👎 反対で戦う</span></button></div>`;
    let chosen = topics[0];
    $("topics").querySelectorAll(".topic").forEach((b) => (b.onclick = () => {
      chosen = topics[Number(b.dataset.i)];
      $("topics").querySelectorAll(".topic").forEach((x) => x.classList.toggle("chosen", x === b));
    }));
    $("topics").querySelector(".topic").classList.add("chosen");
    $("topics").querySelectorAll(".side").forEach((b) => (b.onclick = () => {
      mode = "solo";
      topic = chosen;
      side = b.dataset.s;
      $("topics").style.display = "none";
      $("topicCard").innerHTML = `<b>お題：${topic.motion}</b><p>${topic.detail ?? topic.background}</p><div class="pc"><span>👍 賛成：${topic.pro ?? "？"}</span><span>👎 反対：${topic.con ?? "？"}</span></div><small>あなたは「${side}」側${topic.source ? `｜話題のもと：<a href="${topic.source.url}" target="_blank">${topic.source.title}</a>` : ""}</small>`;
      $("topicCard").style.display = "block";
      shout("あなた VS コン太");
      openCourt(false);
    }));
  } catch (e) {
    $("topics").innerHTML = `<p>お題を取れませんでした: ${e.message}</p>`;
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
  window.__court = {
    say(text) {
      flyStatement(text);
      onStage("witness", text, { fresh: true });
      note("証言台", text);
      closeNote();
      live.send({ clientContent: { turns: [{ role: "user", parts: [{ text }] }], turnComplete: true } });
    },
    ronpa: () => ronpa(),
    state: () => ({ myTurn, turnLeft, connected: live?.ws?.readyState, mode, ...dbg }),
  };
}

