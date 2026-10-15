// おうち裁判の画面。書記官（と弁護人）は Gemini Live がリアルタイムに聞いて進め、判決だけは別の AI（タヌキ判事）が出す。
import { Live, Speaker, startMic } from "./live.js";
import { sfx } from "./sfx.js";

const BAILIFF = `あなたは家庭の法廷「おうち裁判」の書記官タヌ吉です。きょうだいや家族の小さなけんかを、法廷ごっことして楽しく進行します。相手は5〜10歳の子どもと、その親。
登場するのは: 原告と被告（子ども）、原告側の弁護人ポン子、被告側の弁護人コン太（どちらもあなたが声色を変えて演じる。名乗ってから話す）、証人（見ていた親など）、そして判決を出すタヌキ判事（別の係。call_judge で呼ぶ）。
段取り:
1. 開廷を宣言し、原告に名前と、何があったかを聞く。
2. 原告の話が終わったら、弁護人ポン子として「つまり〇〇さんは、〜と言いたいのですね？」と一言で整理し、合っているか確かめる。
3. 被告に名前と言い分を聞く。弁護人コン太として同じように整理する。
4. 二人の話で食い違う所を1つだけ選び、どちらかの名前を呼んで、はい・いいえで答えやすい質問をする。見ていた人がいれば証人として呼んでもよい。
5. 二人に、最後に言っておきたいことを1つずつ聞く。
6. 「これより、タヌキ判事が判決を言い渡します」と言って call_judge を呼ぶ。判決はあなたが言わない。
7. 判事の判決のあと、罰や仲直りがちゃんとできたかを楽しく確かめ、「これにて閉廷！」で締める。
守ること: 次に話す人を必ず名前で呼ぶ。1回に聞くことは1つだけ。1回のせりふは2文まで。子どもが話している途中で口をはさまない。話がそれたらやさしく戻す。どちらかを悪者にしない。恥ずかしい思いをさせない。日本語で話す。`;

const CALL_JUDGE = {
  name: "call_judge",
  description: "双方の言い分と最後のひとことを聞き終えたら呼ぶ。タヌキ判事が判例を調べて判決を言い渡す（判決の文はこの道具の結果で返る）。",
  parameters: {
    type: "OBJECT",
    properties: {
      plaintiff: { type: "STRING", description: "原告の名前" },
      defendant: { type: "STRING", description: "被告の名前" },
      summary: { type: "STRING", description: "争点と双方の言い分を3文で" },
    },
    required: ["plaintiff", "defendant", "summary"],
  },
  behavior: "BLOCKING",
};

const $ = (id) => document.getElementById(id);
const log = [];
let live, stopMic, speaker, judging = false;

const pass = () => localStorage.getItem("ouchi-court-pass") ?? "";
const api = async (path, body) => {
  const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json", "x-passphrase": pass() }, body: JSON.stringify(body ?? {}) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? r.status);
  return j;
};

function bubble(who, text, cls) {
  let last = $("log").lastElementChild;
  if (!last || last.dataset.who !== who || last.dataset.closed) {
    last = document.createElement("div");
    last.className = `bubble ${cls}`;
    last.dataset.who = who;
    last.innerHTML = `<b>${who}</b><span></span>`;
    $("log").append(last);
    log.push({ who, text: "" });
  }
  last.querySelector("span").textContent += text;
  log[log.length - 1].text += text;
  last.scrollIntoView({ block: "end" });
}
const closeBubble = () => {
  const last = $("log").lastElementChild;
  if (last) last.dataset.closed = "1";
};
const status = (t) => ($("status").textContent = t);
const cast = (id) => document.querySelectorAll(".cast").forEach((c) => c.classList.toggle("on", c.id === id));

async function openCourt() {
  $("open").disabled = true;
  status("開廷の準備中…");
  try {
    const { token, model } = await api("/api/token");
    speaker = new Speaker();
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
          status("開廷中：話しかけてください");
          stopMic = await startMic((b64) => !judging && live.audio(b64));
          live.send({ clientContent: { turns: [{ role: "user", parts: [{ text: "開廷してください。" }] }], turnComplete: true } });
          $("close").disabled = false;
        },
        audio: (b64) => {
          cast("bailiff");
          speaker.play(b64);
        },
        heard: (t) => bubble("みんな", t, "child"),
        said: (t) => bubble("書記官タヌ吉", t, "bailiff"),
        interrupted: () => speaker.stop(),
        turnComplete: closeBubble,
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

// タヌキ判事の出番：判例を調べて判決を考え、判事の声で読み上げてから、書記官に結果を返す
async function judge(call) {
  if (call.name !== "call_judge") return;
  judging = true;
  closeBubble();
  cast("judge");
  status("タヌキ判事が審議中…");
  const drum = sfx.drumroll(speaker.ctx, 6);
  try {
    const record = log.map((l) => `${l.who}: ${l.text}`).join("\n").slice(-6000);
    const names = [call.args?.plaintiff, call.args?.defendant].filter(Boolean);
    const v = await api("/api/verdict", { record: `${call.args?.summary ?? ""}\n\n${record}`, names });
    const voice = await api("/api/voice", { text: v.speech }).catch(() => null);
    drum.stop();
    await sfx.cymbal(speaker.ctx);
    bubble("タヌキ判事", v.speech, "judge");
    closeBubble();
    if (voice) await (voice.mimeType?.includes("wav") ? speaker.playWav(voice.audio) : speaker.play(voice.audio, Number(/rate=(\d+)/.exec(voice.mimeType)?.[1] ?? 24000)));
    await sfx.gavel(speaker.ctx);
    live.toolResponse([{ id: call.id, name: call.name, response: { result: `判事がたった今、判決を読み上げた（書記官は判決をくり返さないこと）。罰: ${v.sentence}。書記官は、罰や仲直りが今できているかを名前を呼んで楽しく確かめてから「これにて閉廷！」と締める。` } }]);
  } catch (e) {
    drum.stop();
    status(`判事が来られませんでした: ${e.message}`);
    live.toolResponse([{ id: call.id, name: call.name, response: { result: "判事が不在。書記官が代わりに、二人に仲直りの握手をすすめて閉廷する。" } }]);
  } finally {
    judging = false;
    cast("bailiff");
    status("開廷中");
  }
}

function closeCourt() {
  stopMic?.();
  live?.close();
  speaker?.stop();
  $("open").disabled = false;
  $("close").disabled = true;
}

$("open").onclick = openCourt;
$("close").onclick = closeCourt;
$("pass").value = pass();
$("pass").onchange = () => localStorage.setItem("ouchi-court-pass", $("pass").value);
