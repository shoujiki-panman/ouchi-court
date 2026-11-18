// Gemini Live API（WebSocket）につなぎ、マイクの声を送って、返ってくる声を鳴らす最小の部品。
// 公式ドキュメント（ai.google.dev/gemini-api/docs/live）の手順どおり: 使い捨てトークン → v1beta の Constrained エンドポイント
// → 最初に setup → 16kHz PCM の音声を realtimeInput で送る → 24kHz PCM の音声と書き起こし・道具の呼び出しを受け取る。
import { LiveUsage } from "./live-usage.js";

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
    this.next = 0;
    this.playing = new Set();
    this._finishes = new Map();
    this._pending = new Set();
    this.clips = new Map();
    this._generation = 0;
    this.disposed = false;
    // 声の高さ（コン太・ポン子は速く高くして、書記官と別人に聞こえるようにする 10/16）
    this.rate = 1;
    try {
      // 話している声の大きさを測る（キャラの口の動きに使う）
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.connect(this.ctx.destination);
      this.wave = new Uint8Array(this.analyser.fftSize);
    } catch (error) {
      this.dispose();
      throw error;
    }
  }
  _active(generation) {
    return !this.disposed && generation === this._generation;
  }
  // stop/dispose で直ちに待機を終了する。元の Promise の後着・失敗も処理済みにする。
  _wait(promise, generation, timeoutMs) {
    return new Promise((resolve) => {
      let done = false, timer;
      const finish = (value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this._pending.delete(cancel);
        resolve(value);
      };
      const cancel = () => finish(null);
      this._pending.add(cancel);
      Promise.resolve(promise).then(
        (value) => finish(this._active(generation) ? value : null),
        cancel,
      );
      if (timeoutMs !== undefined) timer = setTimeout(cancel, timeoutMs);
      if (!this._active(generation)) cancel();
    });
  }
  // 全形式の音源を同じ終了処理へ登録する。clip は next / busy に含めない。
  _playBuffer(buf, { queued = true, playbackRate = 1, volume } = {}) {
    if (this.disposed) return Promise.resolve();
    let src, gain, timer, finished = false, resolve;
    const completion = new Promise((done) => { resolve = done; });
    const finish = (stopSource = false) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (src) {
        src.removeEventListener("ended", ended);
        this.playing.delete(src);
        this._finishes.delete(src);
        if (stopSource) { try { src.stop(); } catch { /* not started / already ended */ } }
        try { src.disconnect(); } catch { /* already disconnected */ }
      }
      try { gain?.disconnect(); } catch { /* already disconnected */ }
      resolve();
    };
    const ended = () => finish();
    try {
      src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = playbackRate;
      if (volume === undefined) src.connect(this.analyser);
      else {
        gain = this.ctx.createGain();
        gain.gain.value = volume;
        src.connect(gain);
        gain.connect(this.ctx.destination);
      }
      src.addEventListener("ended", ended);
      this.playing.add(src);
      this._finishes.set(src, finish);
      const at = queued ? Math.max(this.ctx.currentTime + 0.03, this.next) : this.ctx.currentTime;
      const len = buf.duration / playbackRate;
      if (queued) src.start(at);
      else src.start();
      if (!finished) {
        if (queued) this.next = at + len;
        // バックグラウンド等で ended が来ない場合も音源・タイマーを残さない。
        timer = setTimeout(() => finish(true), (Math.max(0, at - this.ctx.currentTime) + len + 1) * 1000);
      }
    } catch {
      // 音声が利用不可でもゲームを継続する。途中まで作った音源は必ず解放。
      finish(true);
    }
    return this.ctx.state === "running" ? completion : Promise.resolve();
  }
  // WAV（判事の声）は丸ごとデコードして鳴らす
  async playWav(b64) {
    const generation = this._generation;
    if (!this._active(generation)) return;
    try {
      // 再生許可が返らない場合は 0.5 秒で見切る。stop なら待たずに終了。
      if (this.ctx.state !== "running") await this._wait(this.ctx.resume(), generation, 500);
      if (!this._active(generation) || this.ctx.state !== "running") return;
      const buf = await this._wait(this.ctx.decodeAudioData(fromBase64(b64).buffer), generation);
      if (!buf || !this._active(generation)) return;
      return this._playBuffer(buf);
    } catch { /* decode / resume failure must not leave an unhandled rejection */ }
  }
  play(b64, rate = 24000) {
    if (this.disposed) return Promise.resolve();
    try {
      const bytes = fromBase64(b64);
      const pcm = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.length / 2));
      const buf = this.ctx.createBuffer(1, pcm.length, rate);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
      return this._playBuffer(buf, { playbackRate: this.rate });
    } catch { return Promise.resolve(); }
  }
  // 観客の声などの短い音（mp3）。取得済みの音声は stop 後も再利用できる。
  async clip(url, volume = 0.4) {
    const generation = this._generation;
    if (!this._active(generation)) return;
    let entry = this.clips.get(url);
    if (!entry) {
      entry = { controller: new AbortController(), buffer: null };
      this.clips.set(url, entry);
      entry.promise = (async () => {
        try {
          const response = await fetch(url, { signal: entry.controller.signal });
          if (!this._active(generation) || !response.ok) return null;
          const bytes = await response.arrayBuffer();
          if (!this._active(generation)) return null;
          const buffer = await this.ctx.decodeAudioData(bytes);
          if (!this._active(generation)) return null;
          entry.buffer = buffer;
          return buffer;
        } catch { return null; }
        finally {
          // 失敗した取得をキャッシュし続けず、次の呼出しでは再試行できる。
          if (!entry.buffer && this.clips.get(url) === entry) this.clips.delete(url);
        }
      })();
    }
    const buf = entry.buffer ?? await this._wait(entry.promise, generation);
    if (!buf || !this._active(generation)) return;
    this._playBuffer(buf, { queued: false, volume });
  }
  // いまの声の大きさ（0〜1）
  level() {
    if (this.disposed) return 0;
    this.analyser.getByteTimeDomainData(this.wave);
    let sum = 0;
    for (const v of this.wave) sum += ((v - 128) / 128) ** 2;
    return Math.min(1, Math.sqrt(sum / this.wave.length) * 4);
  }
  stop() {
    this._generation++;
    for (const cancel of [...this._pending]) cancel();
    for (const finish of [...this._finishes.values()]) finish(true);
    for (const [url, entry] of this.clips) {
      if (!entry.buffer) {
        entry.controller.abort();
        this.clips.delete(url);
      }
    }
    this.next = 0;
  }
  // 裁判終了時の永久解放。stop と異なり、これ以降の再生は受け付けない。
  dispose() {
    if (this.disposed) return this._disposePromise ?? Promise.resolve();
    this.disposed = true;
    this.stop();
    this.clips.clear();
    try { this.analyser?.disconnect(); } catch { /* already disconnected */ }
    try { this._disposePromise = Promise.resolve(this.ctx.close()).catch(() => {}); }
    catch { this._disposePromise = Promise.resolve(); }
    return this._disposePromise;
  }
  // 鳴らしている途中か（音が止まっている＝ブラウザが再生を許していないときは、鳴っていないとみなす）
  get busy() {
    return !this.disposed && this.ctx.state === "running" && this.ctx.currentTime < this.next;
  }
}

const micAbortError = () => new DOMException("Microphone initialization aborted", "AbortError");

// Native permission / worklet / resume promises cannot all be cancelled, but callers
// must be able to leave immediately. Keep rejection handlers on the underlying work.
function awaitMicStep(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", abort);
    const abort = () => { cleanup(); reject(micAbortError()); };
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(promise).then(
      (value) => { cleanup(); signal.aborted ? reject(micAbortError()) : resolve(value); },
      (error) => { cleanup(); reject(error); },
    );
    if (signal.aborted) abort();
  });
}

// マイク → 16kHz・16bit の PCM を 100ms ごとに渡す
export async function startMic(onChunk, { signal } = {}) {
  if (signal?.aborted) throw micAbortError();
  let stream, ctx, node, source;
  let stopped = false;
  const stopTracks = (mediaStream) => {
    for (const track of mediaStream.getTracks()) {
      try { track.stop(); } catch { /* still release the other tracks and context */ }
    }
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    signal?.removeEventListener("abort", stop);
    if (node) node.port.onmessage = null;
    try { source?.disconnect(); } catch { /* already disconnected */ }
    try { node?.disconnect(); } catch { /* already disconnected */ }
    if (stream) stopTracks(stream);
    try { ctx?.close().catch(() => {}); } catch { /* already closed */ }
  };
  const checkActive = () => { if (stopped || signal?.aborted) throw micAbortError(); };
  signal?.addEventListener("abort", stop, { once: true });
  try {
    const acquiring = Promise.resolve(navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })).then((acquired) => {
      // getUserMedia's permission dialog is not cancellable. Release a late grant
      // even when startMic has already rejected and the court no longer exists.
      if (stopped || signal?.aborted) {
        stopTracks(acquired);
        throw micAbortError();
      }
      stream = acquired;
      return acquired;
    });
    await awaitMicStep(acquiring, signal);
    checkActive();
    ctx = new AudioContext({ sampleRate: 16000 });
    await awaitMicStep(ctx.audioWorklet.addModule("capture-worklet.js"), signal);
    checkActive();
    node = new AudioWorkletNode(ctx, "capture");
    node.port.onmessage = (e) => {
      if (stopped) return;
      // 声の大きさ（0〜1）も一緒に渡す（ひとりで挑戦の「黙ったら番を終える」に使う）
      const pcm = new Int16Array(e.data);
      let sum = 0;
      for (let i = 0; i < pcm.length; i += 4) sum += (pcm[i] / 32768) ** 2;
      onChunk(toBase64(new Uint8Array(e.data)), Math.min(1, Math.sqrt(sum / (pcm.length / 4)) * 6));
    };
    source = ctx.createMediaStreamSource(stream);
    source.connect(node);
    if (ctx.state === "suspended") await awaitMicStep(ctx.resume(), signal);
    checkActive();
    return stop;
  } catch (error) {
    stop();
    throw error;
  }
}

export class Live {
  constructor({ token, model, setup, on = {} }) {
    this.on = on;
    this.usage = new LiveUsage();
    const notifyUsage = () => {
      if (typeof on.usage !== "function") return;
      // Optional instrumentation must never interrupt speech or the game.
      try { Promise.resolve(on.usage(this.usageSummary())).catch(() => {}); } catch { /* optional callback */ }
    };
    this.ws = new WebSocket(`${WS}?access_token=${encodeURIComponent(token)}`);
    // Decode binary JSON synchronously too, preserving metadata/turn receive order.
    this.ws.binaryType = "arraybuffer";
    this.ws.onopen = () => this.send({ setup: { model: `models/${model}`, ...setup } });
    this.ws.onmessage = async (e) => {
      const text = typeof e.data === "string" ? e.data
        : e.data instanceof ArrayBuffer ? new TextDecoder().decode(e.data) : await e.data.text();
      const m = JSON.parse(text);
      if (this.usage.observe(m)) notifyUsage();
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
    this.ws.onclose = (e) => {
      this.usage.close();
      notifyUsage();
      on.closed?.(e);
    };
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
  usageSummary() { return this.usage.summary(); }
  close() {
    this.ws.close();
  }
}
