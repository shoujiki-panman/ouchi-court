// Offline Web Audio/fetch/timer stubs: no audio device, network, or billable API.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Speaker } from "../public/live.js";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const pcm = Buffer.from(new Int16Array(2400).buffer).toString("base64");
const wav = "AAAA";

async function withAudio(run) {
  const keys = ["AudioContext", "fetch", "setTimeout", "clearTimeout"];
  const original = Object.fromEntries(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const s = { sources: [], gains: [], contexts: [], timers: new Map(), timerId: 0, fetchCalls: [], decodes: 0, resumes: 0, closes: 0 };
  const fail = (at) => { if (s.failAt === at) throw new Error(at); };
  class Node {
    disconnects = 0;
    connect(target) { fail(this.kind + ".connect"); this.target = target; return target; }
    disconnect() { this.disconnects++; fail(this.kind + ".disconnect"); }
  }
  class Source extends Node {
    kind = "source";
    playbackRate = { value: 1 };
    listeners = new Set();
    starts = [];
    stops = 0;
    addEventListener(type, listener) { assert.equal(type, "ended"); this.listeners.add(listener); }
    removeEventListener(type, listener) { this.listeners.delete(listener); }
    start(...args) { fail("start"); this.starts.push(args); }
    stop() { this.stops++; fail("stop"); this.end(); }
    end() { for (const listener of [...this.listeners]) listener(); }
  }
  globalThis.AudioContext = class {
    state = "running";
    currentTime = 10;
    destination = {};
    constructor() { s.contexts.push(this); }
    createAnalyser() {
      fail("analyser");
      const analyser = new Node();
      analyser.kind = "analyser";
      analyser.getByteTimeDomainData = (array) => array.fill(128);
      s.analyser = analyser;
      return analyser;
    }
    createBuffer(channels, length, rate) {
      fail("buffer");
      return { duration: length / rate, getChannelData: () => new Float32Array(length) };
    }
    createBufferSource() { fail("source"); const source = new Source(); s.sources.push(source); return source; }
    createGain() { fail("gain"); const gain = new Node(); gain.kind = "gain"; gain.gain = { value: 1 }; s.gains.push(gain); return gain; }
    decodeAudioData() { s.decodes++; fail("decode"); return s.decode ? s.decode() : Promise.resolve({ duration: 0.2 }); }
    resume() {
      s.resumes++; fail("resume");
      return Promise.resolve(s.resume?.()).then(() => { if (this.state !== "closed") this.state = "running"; });
    }
    close() { s.closes++; this.state = "closed"; fail("close"); return Promise.resolve(); }
  };
  globalThis.fetch = (url, options) => {
    s.fetchCalls.push({ url, options }); fail("fetch");
    return s.fetch ? s.fetch(url, options) : Promise.resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) });
  };
  globalThis.setTimeout = (fn, delay) => { const id = ++s.timerId; s.timers.set(id, { fn, delay }); return id; };
  globalThis.clearTimeout = (id) => s.timers.delete(id);
  s.fireTimers = () => {
    for (const [id, timer] of [...s.timers]) { s.timers.delete(id); timer.fn(); }
  };
  try { await run(s); }
  finally {
    for (const [key, descriptor] of Object.entries(original)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

test("stop ends PCM, WAV and crowd clips, clears waiters/timers, and permits fresh playback", async () => {
  await withAudio(async (s) => {
    const speaker = new Speaker();
    const p1 = speaker.play(pcm);
    const p2 = speaker.playWav(wav);
    await speaker.clip("crowd/test.mp3", 0.6);
    await flush();
    assert.equal(speaker.playing.size, 3);
    assert.equal(s.gains[0].gain.value, 0.6);
    assert.equal(speaker.busy, true);
    speaker.stop();
    await Promise.all([p1, p2]);
    assert.equal(speaker.playing.size, 0);
    assert.equal(speaker._finishes.size, 0);
    assert.equal(speaker._pending.size, 0);
    assert.equal(s.timers.size, 0);
    assert.equal(speaker.busy, false);
    assert.equal(speaker.next, 0);
    for (const source of s.sources) {
      assert.equal(source.stops, 1);
      assert.equal(source.disconnects, 1);
      assert.equal(source.listeners.size, 0);
    }
    assert.equal(s.gains[0].disconnects, 1);
    speaker.stop();
    assert.ok(s.sources.every((source) => source.stops === 1));
    const fresh = speaker.play(pcm);
    assert.equal(s.sources.length, 4);
    assert.equal(s.sources[3].starts.length, 1);
    speaker.stop(); await fresh;
    await speaker.dispose();
  });
});

test("PCM preserves pitch rate, queued timing and busy; crowd clips do not extend speech busy", async () => {
  await withAudio(async (s) => {
    const speaker = new Speaker();
    speaker.rate = 2;
    const first = speaker.play(pcm);
    assert.equal(s.sources[0].playbackRate.value, 2);
    const next = speaker.next;
    const second = speaker.play(pcm);
    assert.equal(s.sources[1].starts[0][0], next);
    assert.ok(Math.abs(speaker.next - next - 0.05) < 1e-9);
    const speechEnd = speaker.next;
    await speaker.clip("crowd/test.mp3");
    assert.equal(speaker.next, speechEnd);
    assert.deepEqual(s.sources[2].starts[0], []);
    speaker.ctx.currentTime = speechEnd + 1;
    assert.equal(speaker.busy, false);
    speaker.stop(); await Promise.all([first, second]);
    await speaker.clip("crowd/test.mp3");
    assert.equal(s.fetchCalls.length, 1); // completed buffer survives stop
    assert.equal(speaker.busy, false);
    await speaker.dispose();
  });
});

test("natural ended and fallback timeout each release sources, listeners, gains and timers", async () => {
  await withAudio(async (s) => {
    const speaker = new Speaker();
    const first = speaker.play(pcm);
    s.sources[0].end();
    await first;
    assert.equal(s.sources[0].disconnects, 1);
    assert.equal(s.sources[0].stops, 0);
    assert.equal(s.sources[0].listeners.size, 0);
    assert.equal(s.timers.size, 0);
    await speaker.clip("crowd/test.mp3");
    s.sources[1].end();
    assert.equal(s.gains[0].disconnects, 1);
    const last = speaker.playWav(wav);
    await flush();
    s.fireTimers();
    await last;
    assert.equal(s.sources[2].stops, 1);
    assert.equal(s.sources[2].disconnects, 1);
    assert.equal(speaker.playing.size, 0);
    assert.equal(s.timers.size, 0);
    await speaker.dispose();
  });
});

test("stop during WAV decode resolves immediately and blocks late decoded audio", async () => {
  await withAudio(async (s) => {
    const decoded = deferred(); s.decode = () => decoded.promise;
    const speaker = new Speaker();
    const waiting = speaker.playWav(wav);
    speaker.stop();
    await waiting; // decode is deliberately still pending
    decoded.resolve({ duration: 1 }); await flush();
    assert.equal(s.sources.length, 0);
    s.decode = undefined;
    const fresh = speaker.playWav(wav); await flush();
    assert.equal(s.sources.length, 1);
    speaker.stop(); await fresh; await speaker.dispose();
  });
});

for (const stage of ["fetch", "body", "decode"]) {
  test(`stop during clip ${stage} blocks later playback and aborts its pending fetch`, async () => {
    await withAudio(async (s) => {
      const waiting = deferred();
      if (stage === "fetch") s.fetch = () => waiting.promise;
      if (stage === "body") s.fetch = async () => ({ ok: true, arrayBuffer: () => waiting.promise });
      if (stage === "decode") s.decode = () => waiting.promise;
      const speaker = new Speaker();
      const clip = speaker.clip("crowd/old.mp3");
      await flush();
      speaker.stop(); await clip;
      assert.equal(s.fetchCalls[0].options.signal.aborted, true);
      waiting.resolve(stage === "fetch" ? { ok: true, arrayBuffer: async () => new ArrayBuffer(4) }
        : stage === "body" ? new ArrayBuffer(4) : { duration: 1 });
      await flush();
      assert.equal(s.sources.length, 0);
      assert.equal(speaker.clips.size, 0);
      assert.equal(speaker._pending.size, 0);
      await speaker.dispose();
    });
  });
}

test("stop during pending resume clears its timer; a late resume cannot start WAV playback", async () => {
  await withAudio(async (s) => {
    const resuming = deferred(); s.resume = () => resuming.promise;
    const speaker = new Speaker(); speaker.ctx.state = "suspended";
    const wavPlay = speaker.playWav(wav);
    assert.equal(s.timers.size, 1);
    speaker.stop(); await wavPlay;
    assert.equal(s.timers.size, 0);
    resuming.resolve(); await flush();
    assert.equal(s.decodes, 0);
    assert.equal(s.sources.length, 0);
    await speaker.dispose();
  });
});

test("resume timeout completes WAV request without leaking timer or pending waiter", async () => {
  await withAudio(async (s) => {
    const resuming = deferred(); s.resume = () => resuming.promise;
    const speaker = new Speaker(); speaker.ctx.state = "suspended";
    const wavPlay = speaker.playWav(wav);
    assert.equal([...s.timers.values()][0].delay, 500);
    s.fireTimers(); await wavPlay;
    assert.equal(speaker._pending.size, 0);
    assert.equal(s.timers.size, 0);
    resuming.reject(new Error("late resume failure")); await flush();
    assert.equal(s.sources.length, 0);
    await speaker.dispose();
  });
});

test("dispose releases all active sources/analyser/context exactly once and permanently prevents playback", async () => {
  await withAudio(async (s) => {
    const speaker = new Speaker();
    const pcmPlay = speaker.play(pcm);
    const wavPlay = speaker.playWav(wav); await flush();
    await speaker.clip("crowd/test.mp3");
    const closing = speaker.dispose();
    assert.equal(speaker.dispose(), closing);
    await closing; await Promise.all([pcmPlay, wavPlay]);
    assert.equal(s.closes, 1);
    assert.equal(s.analyser.disconnects, 1);
    assert.equal(speaker.clips.size, 0);
    assert.ok(s.sources.every((source) => source.stops === 1 && source.disconnects === 1));
    await speaker.play(pcm); await speaker.playWav(wav); await speaker.clip("crowd/new.mp3");
    assert.equal(s.sources.length, 3);
    assert.equal(s.fetchCalls.length, 1);
    assert.equal(speaker.level(), 0);
    assert.equal(speaker.busy, false);
    assert.equal(s.timers.size, 0);
  });
});

test("dispose while decoding or fetching settles waiters and ignores later success/failure", async () => {
  await withAudio(async (s) => {
    const decoded = deferred(), fetched = deferred();
    s.decode = () => decoded.promise; s.fetch = () => fetched.promise;
    const speaker = new Speaker();
    const wavPlay = speaker.playWav(wav), clip = speaker.clip("crowd/test.mp3");
    await speaker.dispose(); await Promise.all([wavPlay, clip]);
    decoded.resolve({ duration: 1 }); fetched.reject(new Error("late fetch failure")); await flush();
    assert.equal(s.sources.length, 0);
    assert.equal(s.closes, 1);
    assert.equal(speaker._pending.size, 0);
    assert.equal(s.timers.size, 0);
  });
});

for (const failure of ["buffer", "source", "source.connect", "start"]) {
  test(`PCM ${failure} failure cleans partial resources without rejecting an unawaited caller`, async () => {
    await withAudio(async (s) => {
      const speaker = new Speaker(); s.failAt = failure;
      await speaker.play(pcm);
      assert.equal(speaker.playing.size, 0);
      assert.equal(speaker._finishes.size, 0);
      assert.equal(s.timers.size, 0);
      assert.ok(s.sources.every((source) => source.disconnects === 1));
      await speaker.dispose();
    });
  });
}

for (const failure of ["fetch", "decode", "gain", "gain.connect"]) {
  test(`clip ${failure} failure is handled and partial gain/source nodes are released`, async () => {
    await withAudio(async (s) => {
      const speaker = new Speaker(); s.failAt = failure;
      await speaker.clip("crowd/test.mp3");
      assert.equal(speaker.playing.size, 0);
      assert.equal(s.timers.size, 0);
      assert.ok(s.sources.every((source) => source.disconnects === 1));
      assert.ok(s.gains.every((gain) => gain.disconnects === 1));
      await speaker.dispose();
    });
  });
}

test("failed clip fetch can retry, and concurrent clip calls share a successful fetch", async () => {
  await withAudio(async (s) => {
    const speaker = new Speaker();
    s.fetch = async () => ({ ok: false });
    await speaker.clip("crowd/test.mp3");
    assert.equal(speaker.clips.size, 0);
    s.fetch = undefined;
    await Promise.all([speaker.clip("crowd/test.mp3"), speaker.clip("crowd/test.mp3")]);
    assert.equal(s.fetchCalls.length, 2);
    assert.equal(s.sources.length, 2);
    await speaker.dispose();
  });
});

test("source stop failure does not prevent cleanup of the other sources or dispose", async () => {
  await withAudio(async (s) => {
    const speaker = new Speaker();
    const first = speaker.play(pcm), second = speaker.play(pcm);
    s.failAt = "stop";
    await speaker.dispose(); await Promise.all([first, second]);
    assert.equal(speaker.playing.size, 0);
    assert.ok(s.sources.every((source) => source.disconnects === 1));
    assert.equal(s.closes, 1);
    assert.equal(s.timers.size, 0);
  });
});

test("analyser setup failure closes the newly created context", async () => {
  await withAudio(async (s) => {
    s.failAt = "analyser.connect";
    assert.throws(() => new Speaker(), /analyser.connect/);
    assert.equal(s.closes, 1);
    assert.equal(s.analyser.disconnects, 1);
  });
});

test("context close failure is handled and never retried by repeated dispose", async () => {
  await withAudio(async (s) => {
    const speaker = new Speaker(); s.failAt = "close";
    await speaker.dispose(); await speaker.dispose();
    assert.equal(s.closes, 1);
  });
});
