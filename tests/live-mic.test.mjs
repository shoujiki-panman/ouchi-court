// Offline browser stubs verify microphone lifetime; no real permissions or network.
import assert from "node:assert/strict";
import { test } from "node:test";
import { startMic } from "../public/live.js";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const nextTick = () => new Promise((resolve) => setImmediate(resolve));
const isAbort = (error) => error?.name === "AbortError";

function trackListeners(signal) {
  const active = new Set();
  const add = signal.addEventListener.bind(signal);
  const remove = signal.removeEventListener.bind(signal);
  signal.addEventListener = (type, listener, options) => {
    if (type === "abort") active.add(listener);
    return add(type, listener, options);
  };
  signal.removeEventListener = (type, listener, options) => {
    if (type === "abort") active.delete(listener);
    return remove(type, listener, options);
  };
  return active;
}

async function withMic(failAt, run, { pendingAt } = {}) {
  const original = Object.fromEntries(["navigator", "AudioContext", "AudioWorkletNode"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const state = { stops: 0, closes: 0, resumes: 0, disconnected: 0, chunks: 0, requests: 0, contexts: 0, pending: deferred(), waiting: deferred() };
  const fail = (at) => { if (failAt === at) throw new Error(at); };
  const wait = async (at) => {
    if (pendingAt === at) { state.waiting.resolve(); await state.pending.promise; }
  };
  const track = { stop: () => { state.stops++; } };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaDevices: { getUserMedia: async () => {
    state.requests++; await wait("permission"); fail("permission"); return { getTracks: () => [track] };
  } } } });
  globalThis.AudioContext = class {
    state = "suspended";
    constructor() { state.contexts++; fail("constructor"); }
    audioWorklet = { addModule: async () => { await wait("module"); fail("module"); } };
    createMediaStreamSource() {
      fail("source");
      return { connect: () => { fail("connect"); }, disconnect: () => { state.disconnected++; } };
    }
    async resume() { state.resumes++; await wait("resume"); fail("resume"); this.state = "running"; }
    async close() { state.closes++; this.state = "closed"; }
  };
  globalThis.AudioWorkletNode = class {
    port = {};
    constructor() { fail("node"); state.node = this; }
    disconnect() { state.disconnected++; }
  };
  try { await run(state); }
  finally {
    for (const [key, descriptor] of Object.entries(original)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

test("permission denial creates no context and has no acquired tracks to release", async () => {
  await withMic("permission", async (s) => {
    await assert.rejects(startMic(() => {}), /permission/);
    assert.equal(s.stops, 0);
    assert.equal(s.closes, 0);
  });
});

for (const failure of ["constructor", "module", "node", "source", "connect", "resume"]) {
  test(`releases acquired microphone on ${failure} failure`, async () => {
    await withMic(failure, async (s) => {
      await assert.rejects(startMic(() => s.chunks++), new RegExp(failure));
      assert.equal(s.stops, 1);
      assert.equal(s.closes, failure === "constructor" ? 0 : 1);
      if (s.node) assert.equal(s.node.port.onmessage, null);
    });
  });
}

test("successful capture resumes context, sends PCM, and stop is idempotent even with queued messages", async () => {
  await withMic(null, async (s) => {
    const stop = await startMic((audio, level) => {
      s.chunks++;
      assert.equal(typeof audio, "string");
      assert.ok(level >= 0 && level <= 1);
    });
    assert.equal(s.resumes, 1);
    const queued = s.node.port.onmessage;
    queued({ data: new Int16Array([1000, -1000, 0, 0]).buffer });
    assert.equal(s.chunks, 1);
    stop(); stop();
    queued({ data: new Int16Array([1, 2, 3, 4]).buffer });
    assert.equal(s.chunks, 1);
    assert.equal(s.stops, 1);
    assert.equal(s.closes, 1);
    assert.equal(s.disconnected, 2);
    assert.equal(s.node.port.onmessage, null);
  });
});

test("already aborted signal never requests microphone access", async () => {
  await withMic(null, async (s) => {
    const controller = new AbortController();
    const listeners = trackListeners(controller.signal);
    controller.abort();
    await assert.rejects(startMic(() => s.chunks++, { signal: controller.signal }), isAbort);
    assert.equal(s.requests, 0);
    assert.equal(s.contexts, 0);
    assert.equal(listeners.size, 0);
  });
});

test("abort during permission wait rejects immediately and stops a later granted stream", async () => {
  await withMic(null, async (s) => {
    const controller = new AbortController();
    const listeners = trackListeners(controller.signal);
    const rejected = assert.rejects(startMic(() => s.chunks++, { signal: controller.signal }), isAbort);
    await s.waiting.promise;
    controller.abort();
    await rejected; // must settle without waiting for the permission prompt
    assert.equal(s.stops, 0);
    assert.equal(listeners.size, 0);
    s.pending.resolve();
    await nextTick();
    assert.equal(s.stops, 1);
    assert.equal(s.contexts, 0);
    assert.equal(s.chunks, 0);
    controller.abort();
    assert.equal(s.stops, 1);
  }, { pendingAt: "permission" });
});

for (const pendingAt of ["module", "resume"]) {
  test(`abort during ${pendingAt} wait immediately releases tracks/context without awaiting the browser`, async () => {
    await withMic(null, async (s) => {
      const controller = new AbortController();
      const listeners = trackListeners(controller.signal);
      const rejected = assert.rejects(startMic(() => s.chunks++, { signal: controller.signal }), isAbort);
      await s.waiting.promise;
      const queued = s.node?.port.onmessage;
      controller.abort();
      assert.equal(s.stops, 1); // synchronous abort handler, before promise continuation
      assert.equal(s.closes, 1);
      assert.equal(listeners.size, 0);
      await rejected;
      s.pending.resolve();
      await nextTick();
      queued?.({ data: new Int16Array([1000, 0, 0, 0]).buffer });
      assert.equal(s.chunks, 0);
      assert.equal(s.stops, 1);
      assert.equal(s.closes, 1);
      if (s.node) assert.equal(s.node.port.onmessage, null);
      if (pendingAt === "module") assert.equal(s.node, undefined);
    }, { pendingAt });
  });
}

test("abort after initialization stops capture; repeated abort/manual stop are harmless", async () => {
  await withMic(null, async (s) => {
    const controller = new AbortController();
    const listeners = trackListeners(controller.signal);
    const stop = await startMic(() => s.chunks++, { signal: controller.signal });
    assert.equal(listeners.size, 1); // lifetime listener only; step listeners removed
    const queued = s.node.port.onmessage;
    controller.abort(); stop(); stop(); controller.abort();
    queued({ data: new Int16Array([1, 2, 3, 4]).buffer });
    assert.equal(s.stops, 1);
    assert.equal(s.closes, 1);
    assert.equal(s.chunks, 0);
    assert.equal(listeners.size, 0);
  });
});

test("manual stop removes the lifetime abort listener", async () => {
  await withMic(null, async (s) => {
    const controller = new AbortController();
    const listeners = trackListeners(controller.signal);
    const stop = await startMic(() => {}, { signal: controller.signal });
    stop();
    assert.equal(listeners.size, 0);
    controller.abort();
    assert.equal(s.stops, 1);
  });
});

for (const pendingAt of ["permission", "module", "resume"]) {
  test(`a late ${pendingAt} rejection after abort is handled`, async () => {
    await withMic(null, async (s) => {
      const controller = new AbortController();
      const listeners = trackListeners(controller.signal);
      const rejected = assert.rejects(startMic(() => {}, { signal: controller.signal }), isAbort);
      await s.waiting.promise;
      controller.abort();
      await rejected;
      s.pending.reject(new Error("late browser failure"));
      await nextTick(); // node:test also fails on an unhandled rejection
      assert.equal(listeners.size, 0);
      assert.equal(s.stops, pendingAt === "permission" ? 0 : 1);
    }, { pendingAt });
  });
}
