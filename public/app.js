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
const SOLO = (topic, side, rv) => `あなたは「おうち裁判 ひとりで挑戦モード」の書記官タヌ吉（司会）。子ども1人が、お題についてライバル弁護士コン太と3分の議論バトルで対決する。
ルール（開廷のときに短く・はっきり伝える）: 3ラウンド勝負。子どもが意見を言うたびに判事が採点する。理由の強さで最大3点、具体例を出したら+1、コン太の反論に答えたら+1、「論破！」のあとにいい理由を言えたら+2、同じ理由の使い回しは−1。理由が弱いぶんはコン太の点になる。最終ラウンドは得点2倍！同点ならサドンデス。
ライバル・コン太の戦績: レベル${rv.level}、これまで子どもの${rv.wins}勝${rv.losses}敗${rv.draws ? `${rv.draws}引き分け` : ""}。${rv.wins + rv.losses + rv.draws === 0 ? "今日が初対決。" : rv.lastResult === "win" ? "前回は子どもが勝ったので、コン太はリベンジに燃えている（開廷のときコン太に一言言わせる）。" : rv.lastResult === "lose" ? "前回はコン太が勝ったので、コン太は少し得意げ（開廷のときコン太に一言言わせる）。" : ""}
お題:「${topic.motion}」
説明: ${topic.detail ?? topic.background}
賛成の例: ${topic.pro ?? "（自分で考えて）"}
反対の例: ${topic.con ?? "（自分で考えて）"}
子どもは「${side}」側。弁護人ポン子は子どもの味方（試合中は応援の一言だけ。アドバイスは試合のあとに画面で出す）。弁護人コン太は反対側のライバル。どちらもあなたが声色を変えて演じ、名乗ってから話す。
段取り:
1. 開廷！ルールを一言で。子どもに名前を聞き「〇〇さんですね？」と確かめる。
2. お題の説明を2〜3文で（上の説明を使う）。賛成・反対の例を1つずつ言い、「ラウンド1！${side}側の〇〇さん、どう思う？」と聞く。
3. 各ラウンド: 子どもが意見を言う → 採点の知らせが届いたら1文だけ実況 → すぐコン太として反論を1つ短く → 「ラウンド2！」と次へ。アドバイスや説明は試合中にしない（白熱させる）。
4. 「試合終了」の知らせが来たときだけ「勝負あり！」と言って call_judge を呼ぶ（自分でラウンドを数えて終わらせない。採点の知らせが来るまで次へ進まない）。
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
  ronpaArmed = true;
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
    STEPS = mode === "solo" ? SOLO_STEPS : VERSUS_STEPS;
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
    arguing = false;
    rounds = 0;
    suddenDeath = false;
    ronpaArmed = false;
    breakdown = { reason: 0, example: 0, counter: 0, ronpa: 0, repeat: 0, final: 0 };
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
    speaker = new Speaker();
    onStage("judge", "これより、おうち裁判を開廷します。", { fresh: true });
    if (!resume) await sfx.fanfare(speaker.ctx);
    beat = sfx.bgm(); // 魔王魂のBGM（落ち着き→議論→白熱）
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
        systemInstruction: { parts: [{ text: `${mode === "solo" ? SOLO(topic, side, rivalInfo) : BAILIFF}\n\n${MC_STYLE}` }] },
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
          // 弁護人に切りかえるのは、せりふの最初で名乗ったときだけ（書記官が「コン太、どうぞ」と言っただけでは切りかえない）
          const head = speakingTurn.slice(0, 16);
          const id = /ポン子(です|よ|だよ)|弁護人ポン子/.test(head) ? "lawyerP" : /コン太(です|だ|だよ)|弁護人コン太/.test(head) ? "lawyerD" : "bailiff";
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
      api("/api/rival", { result: soloResult, topic: topic?.motion, best: best.text }).then((r) => (rivalInfo = { ...r, lastResult: soloResult })).catch(() => {});
    }
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
    if (v.punishment) await punishmentTime(v.punishment, v.who, penaltyImg);
    if (mode === "solo") await resultCard(soloResult, v);
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
async function punishmentTime(p, who, imgPromise) {
  $("rImg").innerHTML = "";
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
  const img = await Promise.race([imgPromise ?? Promise.resolve(null), new Promise((r) => setTimeout(() => r(null), 6000))]);
  if (img?.image) $("rImg").innerHTML = `<img src="data:image/jpeg;base64,${img.image}" alt="">`;
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
const VERSUS_STEPS = [["open", "開廷"], ["plaintiff", "原告"], ["defendant", "被告"], ["debate", "議論"], ["evidence", "証拠品"], ["last", "最後のひとこと"], ["verdict", "判決"], ["penalty", "罰ゲーム"], ["closed", "閉廷"]];
const SOLO_STEPS = [["open", "開廷"], ["topic", "お題"], ["r1", "ラウンド1"], ["r2", "ラウンド2"], ["r3", "ラウンド3"], ["verdict", "判定"], ["penalty", "罰ゲーム"], ["closed", "閉廷"]];
let STEPS = SOLO_STEPS;
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
let ronpaArmed = false;
let arguing = false, rounds = 0, best = { text: "", strength: -1 }, hints = [], soloClock, soloLeft = 180;
let rivalInfo = { level: 1, wins: 0, losses: 0, draws: 0 };
function showSoloScore() {
  const label = suddenDeath ? "サドンデス" : rounds >= 3 ? "試合終了" : rounds === 2 ? "最終ラウンド ×2" : `ラウンド ${rounds + 1}/3`;
  $("soloScore").innerHTML = `<span class="me">あなた ${soloScore.player}</span><span class="vs">-</span><span class="rival">${soloScore.rival} コン太</span><small>${label}｜コン太 Lv${rivalInfo.level}</small>`;
}
// 採点（10/16「勝敗は結構条件凝っていて欲しい」）
//  理由の強さ 0〜3（コン太は 3−強さ）／具体例 +1／コン太の反論に答えた +1／論破のあとに理由 +2／同じ理由の使い回し −1
//  最終ラウンドは2倍。3ラウンドとも上回れば「完全論破」。同点ならサドンデス（もう1ラウンド）
let breakdown = { reason: 0, example: 0, counter: 0, ronpa: 0, repeat: 0, final: 0 };
let roundWins = { player: 0, rival: 0 };
let suddenDeath = false;
async function soloPoint(r, statement) {
  if (judged || !arguing || !r.isArg) return; // 名前や返事は数えない
  const last = suddenDeath || rounds === 2; // 最終ラウンド（またはサドンデス）
  const mult = last ? 2 : 1;
  const st = Math.max(0, Math.min(3, r.strength ?? 0));
  const parts = [];
  let me = st, rival = 3 - st;
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
  ronpaArmed = false;
  if (r.repeat) {
    me -= 1;
    parts.push("使い回し−1");
    breakdown.repeat -= mult;
  }
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
  } else if (rounds >= 3) {
    end = "試合終了！「勝負あり！」と言って、すぐ call_judge を呼んでください。";
  }
  step(end.startsWith("試合終了") ? "verdict" : `r${Math.min(rounds + 1, 3)}`);
  live?.send({ clientContent: { turns: [{ role: "user", parts: [{ text: `（ラウンド${rounds}の採点: 子ども+${me}（${parts.join("・")}）、コン太+${rival}。合計 あなた${soloScore.player} - ${soloScore.rival}コン太。理由「${r.why}」。${end || `実況は1文だけで、すぐコン太の反論 → 「ラウンド${rounds + 1}！」${rounds + 1 === 3 ? "（最終ラウンド！得点2倍と言って煽る）" : ""}へ。テンポよく、白熱させて。`}）` }] }], turnComplete: true } });
}
// 3分の持ち時間（議論が始まってから）。切れたら勝負あり
function startSoloClock() {
  clearInterval(soloClock);
  soloLeft = 180;
  soloClock = setInterval(() => {
    soloLeft--;
    $("feverClock").textContent = `のこり ${Math.floor(soloLeft / 60)}:${String(soloLeft % 60).padStart(2, "0")}`;
    if (soloLeft <= 0) {
      clearInterval(soloClock);
      if (!judged) live?.send({ clientContent: { turns: [{ role: "user", parts: [{ text: "（3分たちました！時間切れ。「勝負あり！」と言って、すぐ call_judge を呼んでください）" }] }], turnComplete: true } });
    }
  }, 1000);
}
// コーチ・ポン子のひとこと（画面の右下に出す）
function coach(text) {
  $("coach").innerHTML = `<img src="img/lawyerP.png" alt=""><div><b>コーチ ポン子</b>${text}</div>`;
  $("coach").classList.remove("on");
  void $("coach").offsetWidth;
  $("coach").classList.add("on");
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

// 結果カード（ひとりで挑戦）：お題・勝ち負け・スコア・いちばん良かった一言・コーチの総評・コン太の一言
async function resultCard(result, v) {
  const rv = rivalInfo;
  const rivalLine = result === "win" ? `くっ…次は負けないぞ！（コン太 Lv${Math.min(5, (rv.level ?? 1))} にパワーアップ）` : result === "lose" ? "ふふん、ぼくの勝ち！でもいい勝負だったよ" : "引き分けか…次こそ決着をつけよう！";
  $("result").innerHTML = `<div class="card">
    <div class="rt display">${{ win: "勝訴！", lose: "敗訴…", draw: "引き分け" }[result]}</div>
    <div class="rs display">あなた ${soloScore.player} - ${soloScore.rival} コン太</div>
    <div class="rq">お題：${topic?.motion ?? ""}（あなたは${side}）</div>
    <div class="rq">内訳：理由 ${breakdown.reason}｜具体例 ${breakdown.example}｜反論に答えた ${breakdown.counter}｜論破 ${breakdown.ronpa}｜使い回し ${breakdown.repeat}｜ラウンド勝ち ${roundWins.player}/${rounds}${suddenDeath ? "｜サドンデス" : ""}</div>
    <div class="rb"><b>きょうの名言</b>「${best.text || "（また次回！）"}」</div>
    <div class="rc"><img src="img/lawyerP.png" alt=""><span><b>ポン子の作戦メモ（次はこうすると強いよ）</b>${hints.length ? hints.slice(-2).map((h) => `・${h}`).join("<br>") : "考えを自分の言葉で言えたのがすごい！"}</span></div>
    <div class="rc"><img src="img/lawyerD.png" alt=""><span><b>ライバル コン太</b>${rivalLine}</span></div>
    <div class="rp display">論破力 ${points}pt｜通算 ${rv.wins ?? 0}勝 ${rv.losses ?? 0}敗</div>
    <button id="resultClose"><span>とじる</span></button></div>`;
  $("result").classList.add("on");
  sfx.fanfare(speaker.ctx);
  $("resultClose").onclick = () => $("result").classList.remove("on");
  await new Promise((r) => setTimeout(r, 1200));
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
    $("topics").querySelectorAll(".side").forEach((b) => (b.onclick = async () => {
      mode = "solo";
      topic = chosen;
      side = b.dataset.s;
      try {
        rivalInfo = await api("/api/rival", {});
        rivalInfo.lastResult = rivalInfo.history?.at(-1)?.result;
      } catch {}
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


// 対戦モードは今は出さない（10/16「対戦はまだいらないかも」）。コードは残す
$("open").style.display = "none";
