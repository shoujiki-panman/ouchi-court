// Gemini Live API（WebSocket）につなぎ、マイクの声を送って、返ってくる声を鳴らす最小の部品。
// 公式ドキュメント（ai.google.dev/gemini-api/docs/live）の手順どおり: 使い捨てトークン → v1beta の Constrained エンドポイント
// → 最初に setup → 16kHz PCM の音声を realtimeInput で送る → 24kHz PCM の音声と書き起こし・道具の呼び出しを受け取る。

const WS = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";

const toBase64 = (bytes) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromBase64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

// 24kHz の PCM を、途切れないように順番に鳴らす。割り込まれたら全部止める。
export class Speaker {
  constructor(rate = 24000) {
    this.ctx = new AudioContext({ sampleRate: rate });
    // 話している声の大きさを測る（キャラの口の動きに使う）
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.connect(this.ctx.destination);
    this.wave = new Uint8Array(this.analyser.fftSize);
    this.next = 0;
    this.playing = new Set();
  }
  // WAV（判事の声）は丸ごとデコードして鳴らす
  async playWav(b64) {
    // 再生が止められている（スマホで音が許可されていない等）なら、待たずに進む
    if (this.ctx.state !== "running") await this.ctx.resume().catch(() => {});
    if (this.ctx.state !== "running") return;
    const buf = await this.ctx.decodeAudioData(fromBase64(b64).buffer);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.analyser);
    const at = Math.max(this.ctx.currentTime + 0.03, this.next);
    src.start(at);
    this.next = at + buf.duration;
    return new Promise((done) => src.addEventListener("ended", done));
  }
  play(b64, rate = 24000) {
    const bytes = fromBase64(b64);
    const pcm = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.length / 2));
    const buf = this.ctx.createBuffer(1, pcm.length, rate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.analyser);
    const at = Math.max(this.ctx.currentTime + 0.03, this.next);
    src.start(at);
    this.next = at + buf.duration;
    this.playing.add(src);
    src.onended = () => this.playing.delete(src);
    if (this.ctx.state !== "running") return Promise.resolve();
    return new Promise((done) => src.addEventListener("ended", done));
  }
  // 観客の声などの短い音（mp3）。一度読んだら覚えておく
  async clip(url, volume = 0.4) {
    this.clips ??= new Map();
    if (!this.clips.has(url)) this.clips.set(url, fetch(url).then((r) => r.arrayBuffer()).then((b) => this.ctx.decodeAudioData(b)));
    const buf = await this.clips.get(url);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = volume;
    src.connect(g).connect(this.ctx.destination);
    src.start();
  }
  // いまの声の大きさ（0〜1）
  level() {
    this.analyser.getByteTimeDomainData(this.wave);
    let sum = 0;
    for (const v of this.wave) sum += ((v - 128) / 128) ** 2;
    return Math.min(1, Math.sqrt(sum / this.wave.length) * 4);
  }
  stop() {
    for (const s of this.playing) s.stop();
    this.playing.clear();
    this.next = 0;
  }
  // 鳴らしている途中か（音が止まっている＝ブラウザが再生を許していないときは、鳴っていないとみなす）
  get busy() {
    return this.ctx.state === "running" && this.ctx.currentTime < this.next;
  }
}

// マイク → 16kHz・16bit の PCM を 100ms ごとに渡す
export async function startMic(onChunk) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const ctx = new AudioContext({ sampleRate: 16000 });
  await ctx.audioWorklet.addModule("capture-worklet.js");
  const node = new AudioWorkletNode(ctx, "capture");
  node.port.onmessage = (e) => {
    // 声の大きさ（0〜1）も一緒に渡す（ひとりで挑戦の「黙ったら番を終える」に使う）
    const pcm = new Int16Array(e.data);
    let sum = 0;
    for (let i = 0; i < pcm.length; i += 4) sum += (pcm[i] / 32768) ** 2;
    onChunk(toBase64(new Uint8Array(e.data)), Math.min(1, Math.sqrt(sum / (pcm.length / 4)) * 6));
  };
  ctx.createMediaStreamSource(stream).connect(node);
  return () => {
    stream.getTracks().forEach((t) => t.stop());
    ctx.close();
  };
}

export class Live {
  constructor({ token, model, setup, on }) {
    this.on = on;
    this.ws = new WebSocket(`${WS}?access_token=${encodeURIComponent(token)}`);
    this.ws.onopen = () => this.send({ setup: { model: `models/${model}`, ...setup } });
    this.ws.onmessage = async (e) => {
      const text = typeof e.data === "string" ? e.data : await e.data.text();
      const m = JSON.parse(text);
      if (m.setupComplete) on.ready?.();
      const sc = m.serverContent;
      for (const p of sc?.modelTurn?.parts ?? []) if (p.inlineData?.data) on.audio?.(p.inlineData.data);
      if (sc?.inputTranscription?.text) on.heard?.(sc.inputTranscription.text);
      if (sc?.outputTranscription?.text) on.said?.(sc.outputTranscription.text);
      if (sc?.interrupted) on.interrupted?.();
      if (sc?.turnComplete) on.turnComplete?.();
      if (m.toolCall?.functionCalls) on.toolCall?.(m.toolCall.functionCalls);
      if (m.goAway) on.goAway?.(m.goAway);
    };
    this.ws.onclose = (e) => on.closed?.(e);
    this.ws.onerror = () => on.error?.("接続できませんでした");
  }
  send(msg) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
  audio(b64) {
    this.send({ realtimeInput: { audio: { data: b64, mimeType: "audio/pcm;rate=16000" } } });
  }
  text(t) {
    this.send({ realtimeInput: { text: t } });
  }
  toolResponse(functionResponses) {
    this.send({ toolResponse: { functionResponses } });
  }
  close() {
    this.ws.close();
  }
}
