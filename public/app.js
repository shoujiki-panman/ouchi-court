// おうち裁判の画面。書記官（と弁護人）は Gemini Live がリアルタイムに聞いて進め、
// 判決は3人の判事（別々の AI）の合議を、裁判長タヌキがまとめて言い渡す。
import { Live, Speaker, startMic } from "./live.js";
import { sfx } from "./sfx.js";
import { PUNISHMENTS } from "./punishments.js";

const BAILIFF = `あなたは家庭の法廷「おうち裁判」の書記官タヌ吉です。きょうだいや家族の小さなけんかを、テレビのゲームショーのようにテンション高く、楽しく進行します。相手は5〜10歳の子どもと、その親。
登場するのは: 原告と被告（子ども）、原告側の弁護人ポン子、被告側の弁護人コン太（どちらもあなたが声色を変えて演じる。必ず「弁護人ポン子です」「弁護人コン太です」と名乗ってから話す）、証人（見ていた親など）、そして判決を出す裁判長タヌキと3人の判事（別の係。call_judge で呼ぶ）。
段取り:
1. 開廷を宣言し、原告に名前と、何があったかを聞く。
2. 原告の話が終わったら、弁護人ポン子として「つまり〇〇さんは、〜と言いたいのですね？」と一言で整理し、合っているか確かめる。
3. 被告に名前と言い分を聞く。弁護人コン太として同じように整理する。
4. 二人の話で食い違う所を1つだけ選び、どちらかの名前を呼んで、はい・いいえで答えやすい質問をする。見ていた人がいれば証人として呼んでもよい。
5. 二人に、最後に言っておきたいことを1つずつ聞く。
6. 「これより、判事たちが合議し、裁判長が判決を言い渡します」と言って call_judge を呼ぶ。判決はあなたが言わない。
7. 判決のあと、罰や仲直りがちゃんとできたかを楽しく確かめ、「これにて閉廷！」で締める。
法廷ドラマの決まり:
- 誰かが「論破！」と言ったら（または「論破」の知らせが届いたら）、盛り上げながら「おおっと、論破が出ました！」と言い、論破した人に名前と、どこがおかしいと思ったかを聞く。そのあと、論破された側にも言い分を聞く。
- 誰かが「異議あり！」と言ったら、「異議を認めます。どうぞ」と言って、その人の話を聞く。
- 証拠品が提出されたら（画像が届いたら）、何が写っているかを一言で言い、だれの言い分に関係するかを確かめる。
守ること: 次に話す人を必ず名前で呼ぶ。1回に聞くことは1つだけ。1回のせりふは2文まで。子どもが話している途中で口をはさまない。話がそれたらやさしく戻す。どちらかを悪者にしない。恥ずかしい思いをさせない。日本語で話す。`;

const CALL_JUDGE = {
  name: "call_judge",
  description: "双方の言い分と最後のひとことを聞き終えたら呼ぶ。3人の判事が合議し、裁判長タヌキが判決を言い渡す（判決の文はこの道具の結果で返る）。",
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
const CAST = {
  judge: { img: "img/judge.jpg", name: "裁判長タヌキ" },
  bailiff: { img: "img/bailiff.jpg", name: "書記官タヌ吉" },
  lawyerP: { img: "img/lawyerP.jpg", name: "弁護人ポン子" },
  lawyerD: { img: "img/lawyerD.jpg", name: "弁護人コン太" },
  witness: { img: "img/witness.jpg", name: "証言台" },
};

// 円形の法廷に席を並べる（裁判長が上、まわりに書記官・弁護人・証言台）
const SEATS = { judge: [50, 3], bailiff: [15, 14], lawyerP: [85, 14], lawyerD: [14, 44], witness: [86, 44] };
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
        $("heroImg").src = c.img;
        $("hero").classList.remove("swap");
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

// 子どもの発言を、法廷を横切って飛ばす。言い分の要（勝手に・わざと・先に 等）は金色に。タップで論破
const WEAK = /(勝手に|わざと|先に|ずっと|全部|絶対|いつも|だって|ちょっとだけ|知らなかった|してない|やってない|〇〇のせい)/g;
function flyStatement(text) {
  const t = text.trim();
  if (t.length < 4) return;
  lastStatement = t;
  heat(8);
  react("statement");
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

async function openCourt() {
  judged = false;
  adjourned = false;
  localStorage.setItem("ouchi-court-pass", pass());
  $("open").disabled = true;
  status("開廷の準備中…");
  try {
    const { token, model } = await api("/api/token");
    speaker = new Speaker();
    onStage("judge", "これより、おうち裁判を開廷します。", { fresh: true });
    await sfx.fanfare(speaker.ctx);
    beat = sfx.beat(speaker.ctx);
    heatVal = 0;
    points = 0;
    combo = 0;
    ronpaCount = objectionCount = evidenceCount = 0;
    heat(0);
    $("pts").textContent = "0";
    live = new Live({
      token,
      model,
      setup: {
        generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } } } },
        systemInstruction: { parts: [{ text: BAILIFF }] },
        tools: [{ functionDeclarations: [CALL_JUDGE] }],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        realtimeInputConfig: { automaticActivityDetection: { silenceDurationMs: 1200 } },
      },
      on: {
        ready: async () => {
          live.send({ clientContent: { turns: [{ role: "user", parts: [{ text: "開廷してください。" }] }], turnComplete: true } });
          try {
            stopMic = await startMic((b64) => !judging && live.audio(b64));
            status("開廷中：そのまま話しかけてください");
          } catch (e) {
            status(`マイクが使えません（${e.message}）。ブラウザのマイクの許可を確かめてください。`);
          }
          ["close", "objection", "evidenceBtn", "ronpa"].forEach((id) => ($(id).disabled = false));
        },
        audio: (b64) => {
          talk(true);
          speaker.play(b64);
        },
        heard: (t) => {
          if (/論破|ろんぱ/.test(t)) ronpa();
          else if (/異議あり|いぎあり/.test(t)) {
            objectionCount++;
            heat(15);
            score(50, "異議");
            shout("異議あり！");
          }
          if (who !== "witness") onStage("witness", "", { fresh: true });
          onStage("witness", t);
          note("証言台", t);
          heardTurn += t;
        },
        said: (t) => {
          if (/これにて閉廷|閉廷します|閉廷！/.test(speakingTurn + t)) adjourn();
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
          speaker.stop();
          talk(false);
        },
        turnComplete: () => {
          speakingTurn = "";
          closeNote();
          setTimeout(() => !speaker.busy && talk(false), 400);
        },
        toolCall: (calls) => calls.forEach(judge),
        goAway: () => status("まもなく接続が切れます（10分ごと）"),
        closed: () => status("閉廷しました"),
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
async function judge(call) {
  if (call.name !== "call_judge") return;
  if (judged) {
    live.toolResponse([{ id: call.id, name: call.name, response: { result: "判決はもう出ている。くり返さず、罰や仲直りを確かめて閉廷する。" } }]);
    return;
  }
  judged = true;
  judging = true;
  closeNote();
  onStage("judge", "ただいま、判事たちが合議中です……", { fresh: true });
  status("合議中…");
  beat?.stop();
  const drum = sfx.drumroll(speaker.ctx, 12);
  try {
    const names = [call.args?.plaintiff, call.args?.defendant].filter(Boolean);
    const text = `${call.args?.summary ?? ""}\n\n${record.map((r) => `${r.who}: ${r.text}`).join("\n")}`.slice(-6000);
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
    await sfx.gavel(speaker.ctx);
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
function heat(add) {
  heatVal = Math.max(0, Math.min(100, heatVal + add));
  $("heatBar").style.width = `${heatVal}%`;
  $("heat").classList.toggle("max", heatVal >= 100);
  beat?.faster(92 + heatVal * 0.7);
  if (heatVal >= 100 && add > 0) popAt("白熱！🔥", 50, 30);
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
  points += n * combo;
  $("pts").textContent = points;
  $("combo").textContent = combo > 1 ? `×${combo} COMBO` : "";
  popAt(`${label} +${n * combo}`, 30 + Math.random() * 40, 25 + Math.random() * 20);
  if (speaker) sfx.coin(speaker.ctx);
}
function react(kind = "statement") {
  const pool = { statement: ["😮", "🤔", "👀", "😂"], ronpa: ["🔥", "💥", "😱", "⚡"], verdict: ["🎉", "👏", "😂", "🎊"] }[kind];
  for (let i = 0; i < (kind === "statement" ? 3 : 8); i++) {
    const e = document.createElement("div");
    e.className = "emoji";
    e.textContent = pool[Math.floor(Math.random() * pool.length)];
    e.style.left = `${5 + Math.random() * 90}%`;
    e.style.animationDelay = `${Math.random() * 0.5}s`;
    $("stage").append(e);
    setTimeout(() => e.remove(), 2800);
  }
  if (speaker) sfx.crowd(speaker.ctx, kind === "statement" ? 0.12 : 0.3);
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

// 閉廷！：叫び＋木槌3回＋紙吹雪
let adjourned = false;
async function adjourn() {
  if (adjourned) return;
  adjourned = true;
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
  beat?.stop();
  stopMic?.();
  live?.close();
  speaker?.stop();
  hideCamera();
  $("open").disabled = false;
  ["close", "objection", "evidenceBtn", "ronpa"].forEach((id) => ($(id).disabled = true));
}

$("open").onclick = openCourt;
$("close").onclick = async () => {
  await adjourn();
  setTimeout(closeCourt, 1500);
};
$("ronpa").onclick = () => ronpa();
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
  };
}
