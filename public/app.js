// おうち裁判の画面。書記官（と弁護人）は Gemini Live がリアルタイムに聞いて進め、
// 判決は3人の判事（別々の AI）の合議を、裁判長タヌキがまとめて言い渡す。
import { Live, Speaker, startMic } from "./live.js";
import { sfx } from "./sfx.js";

const BAILIFF = `あなたは家庭の法廷「おうち裁判」の書記官タヌ吉です。きょうだいや家族の小さなけんかを、法廷ドラマのように楽しく進行します。相手は5〜10歳の子どもと、その親。
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
- 誰かが「異議あり！」と言ったら、「異議を認めます。どうぞ」と言って、その人の話を聞く。「待った！」も同じ。
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
  judge: { face: "🦝", name: "裁判長タヌキ" },
  bailiff: { face: "📜", name: "書記官タヌ吉" },
  lawyerP: { face: "🐼", name: "弁護人ポン子" },
  lawyerD: { face: "🦊", name: "弁護人コン太" },
  witness: { face: "🧒", name: "証言台" },
};

const $ = (id) => document.getElementById(id);
const record = [];
const evidence = [];
let live, stopMic, speaker, camStream, judging = false, speakingTurn = "", who = "";

const pass = () => $("pass").value || localStorage.getItem("ouchi-court-pass") || "";
const api = async (path, body) => {
  const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json", "x-passphrase": pass() }, body: JSON.stringify(body ?? {}) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? r.status);
  return j;
};

// 舞台：立ち絵・名札・せりふの箱（1文字ずつ）
let typing = Promise.resolve();
function onStage(id, text, { fresh = false } = {}) {
  const c = CAST[id];
  if (who !== id || fresh) {
    who = id;
    $("portrait").textContent = c.face;
    $("nameplate").textContent = c.name;
    $("box").textContent = "";
    document.querySelectorAll(".cast").forEach((el) => el.classList.toggle("on", el.id === `c-${id}`));
  }
  typing = typing.then(async () => {
    for (const ch of text) {
      $("box").textContent += ch;
      $("box").scrollTop = $("box").scrollHeight;
      await new Promise((r) => setTimeout(r, 28));
    }
  });
}
const talk = (on) => $("portrait").classList.toggle("talk", on);
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
  el.classList.toggle("blue", word.startsWith("待った"));
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
}

async function openCourt() {
  localStorage.setItem("ouchi-court-pass", pass());
  $("open").disabled = true;
  status("開廷の準備中…");
  try {
    const { token, model } = await api("/api/token");
    speaker = new Speaker();
    onStage("judge", "これより、おうち裁判を開廷します。", { fresh: true });
    await sfx.fanfare(speaker.ctx);
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
          status("開廷中：そのまま話しかけてください");
          stopMic = await startMic((b64) => !judging && live.audio(b64));
          live.send({ clientContent: { turns: [{ role: "user", parts: [{ text: "開廷してください。" }] }], turnComplete: true } });
          ["close", "objection", "evidenceBtn"].forEach((id) => ($(id).disabled = false));
        },
        audio: (b64) => {
          talk(true);
          speaker.play(b64);
        },
        heard: (t) => {
          if (/異議あり|いぎあり/.test(t)) shout("異議あり！");
          else if (/待った|まった！/.test(t)) shout("待った！");
          if (who !== "witness") onStage("witness", "", { fresh: true });
          onStage("witness", t);
          note("証言台", t);
        },
        said: (t) => {
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
async function judge(call) {
  if (call.name !== "call_judge") return;
  judging = true;
  closeNote();
  onStage("judge", "ただいま、判事たちが合議中です……", { fresh: true });
  status("合議中…");
  const drum = sfx.drumroll(speaker.ctx, 12);
  try {
    const names = [call.args?.plaintiff, call.args?.defendant].filter(Boolean);
    const text = `${call.args?.summary ?? ""}\n\n${record.map((r) => `${r.who}: ${r.text}`).join("\n")}`.slice(-6000);
    const v = await api("/api/verdict", { record: text, names, evidence: evidence.map((e) => e.label) });
    for (const p of v.panel ?? []) {
      onStage("judge", `\n${p.title}：${p.vote === "draw" ? "和解" : `${p.vote}の勝ち`}（${p.reason}）`);
      await new Promise((r) => setTimeout(r, 900));
    }
    const voice = await api("/api/voice", { text: v.speech }).catch(() => null);
    drum.stop();
    await sfx.cymbal(speaker.ctx);
    stamp(v.stamp ?? "和解");
    flash();
    onStage("judge", v.speech, { fresh: true });
    talk(true);
    note("裁判長タヌキ", v.speech);
    closeNote();
    if (voice) await (voice.mimeType?.includes("wav") ? speaker.playWav(voice.audio) : speaker.play(voice.audio));
    talk(false);
    await sfx.gavel(speaker.ctx);
    live.toolResponse([
      { id: call.id, name: call.name, response: { result: `裁判長がたった今、判決を読み上げた（書記官は判決をくり返さないこと）。罰: ${v.sentence}。書記官は、罰や仲直りが今できているかを名前を呼んで楽しく確かめてから「これにて閉廷！」と締める。` } },
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
  shout("くらえ！");
  live.send({ realtimeInput: { video: { data: dataUrl.split(",")[1], mimeType: "image/jpeg" } } });
  live.send({ clientContent: { turns: [{ role: "user", parts: [{ text: `（${label}が提出されました。何が写っているか確かめてください）` }] }], turnComplete: true } });
  note("証拠品", `${label}を提出`);
}

function closeCourt() {
  stopMic?.();
  live?.close();
  speaker?.stop();
  hideCamera();
  $("open").disabled = false;
  ["close", "objection", "evidenceBtn"].forEach((id) => ($(id).disabled = true));
}

$("open").onclick = openCourt;
$("close").onclick = closeCourt;
$("objection").onclick = () => {
  shout("異議あり！");
  live?.send({ clientContent: { turns: [{ role: "user", parts: [{ text: "異議あり！" }] }], turnComplete: true } });
};
$("evidenceBtn").onclick = showCamera;
$("submitEv").onclick = submitEvidence;
$("cancelEv").onclick = hideCamera;
$("pass").value = localStorage.getItem("ouchi-court-pass") ?? "";
$("pass").oninput = () => localStorage.setItem("ouchi-court-pass", $("pass").value);
