// Offline: no microphone, credentials, network, or billable model calls.
import assert from "node:assert/strict";
import { test } from "node:test";
import { LiveUsage } from "../public/live-usage.js";
import { Live } from "../public/live.js";

const fullUsage = {
  promptTokenCount: 120, cachedContentTokenCount: 20, responseTokenCount: 40,
  toolUsePromptTokenCount: 5, thoughtsTokenCount: 10, totalTokenCount: 175,
  promptTokensDetails: [{ modality: "TEXT", tokenCount: 20 }, { modality: "AUDIO", tokenCount: 100 }],
  cacheTokensDetails: [{ modality: "TEXT", tokenCount: 20 }],
  responseTokensDetails: [{ modality: "AUDIO", tokenCount: 40 }],
  toolUsePromptTokensDetails: [{ modality: "TEXT", tokenCount: 5 }],
};

test("keeps every documented Live counter and modality breakdown without inventing billable totals", () => {
  const usage = new LiveUsage();
  usage.observe({ usageMetadata: fullUsage });
  assert.deepEqual(usage.summary().latestReportedUsage, fullUsage);
  assert.equal(usage.summary().semantics, "reported-snapshots-not-billable-total");
  assert.equal(Object.hasOwn(usage.summary(), "totalTokens"), false);
});

test("repeated/increasing cumulative snapshots are not added; equal values in a new turn survive", () => {
  const usage = new LiveUsage();
  usage.observe({ usageMetadata: { promptTokenCount: 100, totalTokenCount: 110 } });
  usage.observe({ usageMetadata: { promptTokenCount: 100, totalTokenCount: 110 } });
  usage.observe({ usageMetadata: { promptTokenCount: 150, totalTokenCount: 170 } });
  usage.observe({ serverContent: { turnComplete: true } });
  usage.observe({ usageMetadata: { promptTokenCount: 150, totalTokenCount: 170 } });
  const s = usage.summary();
  assert.equal(s.metadataEvents, 4);
  assert.equal(s.duplicateSnapshots, 1);
  assert.equal(s.latestReportedUsage.totalTokenCount, 170);
  assert.equal(s.completedTurns, 1);
  assert.equal(s.observations.length, 4);
  assert.equal(s.observations[0].repeats, 2);
  assert.equal(s.observations[0].lastSequence, 2);
  assert.equal(s.observations.at(-1).turn, 2);
});

test("partial metadata preserves unknown/missing vs zero, and decreases are retained", () => {
  const usage = new LiveUsage();
  usage.observe({ usageMetadata: fullUsage });
  usage.observe({ usageMetadata: { promptTokenCount: 30, responseTokenCount: 0 } });
  assert.deepEqual(usage.summary().latestReportedUsage, { promptTokenCount: 30, responseTokenCount: 0 });
  assert.equal(usage.summary().observations.at(-1).counterDecreased, true);
});

test("no content, secrets, unknown field names, or arbitrary modality strings enter metrics", () => {
  const usage = new LiveUsage();
  usage.observe({
    access_token: "SECRET", sessionResumptionUpdate: { newHandle: "SECRET" },
    serverContent: { inputTranscription: { text: "PRIVATE NAME" }, modelTurn: { parts: [{ inlineData: { data: "SECRET_AUDIO" } }] } },
    usageMetadata: {
      promptTokenCount: 1, PRIVATE_FIELD: "SECRET", candidatesTokenCount: 999,
      responseTokensDetails: [{ modality: "PRIVATE NAME", tokenCount: 7, privateId: "SECRET" }],
    },
  });
  const s = usage.summary();
  assert.deepEqual(s.latestReportedUsage, { promptTokenCount: 1, responseTokensDetails: [{ modality: "UNKNOWN", tokenCount: 7 }] });
  assert.equal(s.unknownModalities, 1);
  assert.equal(s.discardedFields, 3);
  assert.doesNotMatch(JSON.stringify(s), /SECRET|PRIVATE|privateId|access_token|candidatesTokenCount|newHandle/);
});

test("malformed metadata and unknown payloads do not throw or turn missing data into zero", () => {
  const usage = new LiveUsage();
  for (const value of [null, [], "secret", 1]) usage.observe({ usageMetadata: value });
  usage.observe({ usageMetadata: {
    promptTokenCount: "123", responseTokenCount: -2, totalTokenCount: 1.5,
    thoughtsTokenCount: Infinity, cachedContentTokenCount: 2147483648,
    toolUsePromptTokensDetails: {}, promptTokensDetails: [null, { modality: "AUDIO", tokenCount: NaN }],
  } });
  assert.equal(usage.summary().metadataEvents, 5);
  assert.ok(usage.summary().discardedFields >= 12);
  assert.deepEqual(usage.summary().latestReportedUsage, { promptTokensDetails: [] });
  assert.equal(usage.observe(null), false);
  assert.equal(usage.observe({ serverContent: { turnComplete: "true" } }), false);
});

test("interruption and generation markers preserve boundaries even without metadata", () => {
  const usage = new LiveUsage();
  usage.observe({ usageMetadata: { totalTokenCount: 2 }, serverContent: { interrupted: true } });
  usage.observe({ serverContent: { turnComplete: true } });
  usage.observe({ serverContent: { generationComplete: true } });
  usage.observe({ usageMetadata: { totalTokenCount: 2 }, serverContent: { turnComplete: true } });
  assert.equal(usage.summary().completedTurns, 2);
  assert.deepEqual(usage.summary().observations.map((o) => o.turn), [1, 1, 2, 2]);
  assert.equal(usage.summary().duplicateSnapshots, 0);
});

test("bounded history exposes truncation and snapshot mutation cannot corrupt retained metrics", () => {
  const usage = new LiveUsage({ maxObservations: 2 });
  for (let i = 0; i < 4; i++) usage.observe({ usageMetadata: { totalTokenCount: i } });
  const s = usage.summary();
  assert.equal(s.droppedObservations, 2);
  assert.deepEqual(s.observations.map((o) => o.usage.totalTokenCount), [2, 3]);
  s.latestReportedUsage.totalTokenCount = 1000;
  s.observations[0].usage.totalTokenCount = 1000;
  assert.equal(usage.summary().latestReportedUsage.totalTokenCount, 3);
  assert.equal(usage.summary().observations[0].usage.totalTokenCount, 2);
  usage.close();
  assert.equal(usage.observe({ usageMetadata: { totalTokenCount: 4000 } }), false);
  assert.equal(usage.summary().closed, true);
  assert.throws(() => new LiveUsage({ maxObservations: -1 }), RangeError);
});

test("modality list is bounded without keeping malformed entries", () => {
  const usage = new LiveUsage();
  usage.observe({ usageMetadata: { promptTokensDetails: Array.from({ length: 100 }, () => ({ modality: "AUDIO", tokenCount: 1 })) } });
  assert.equal(usage.summary().latestReportedUsage.promptTokensDetails.length, 64);
  assert.equal(usage.summary().discardedFields, 36);
});

test("Live supports optional usage callbacks, isolates callback failures, and separates reconnects", async () => {
  const previousSocket = globalThis.WebSocket;
  class Socket {
    static OPEN = 1;
    readyState = 1;
    send() {}
    close() { this.onclose?.({ code: 1000 }); }
  }
  globalThis.WebSocket = Socket;
  try {
    let audio = 0, closed = 0, reports = 0;
    const live = new Live({ token: "FAKE_AUTH_SECRET", model: "test", on: {
      usage: (s) => { reports++; assert.doesNotMatch(JSON.stringify(s), /SECRET/); throw new Error("metrics failed"); },
      audio: () => audio++, closed: () => closed++,
    } });
    await live.ws.onmessage({ data: JSON.stringify({ usageMetadata: fullUsage, serverContent: { modelTurn: { parts: [{ inlineData: { data: "AAAA" } }] } } }) });
    assert.equal(audio, 1);
    assert.equal(reports, 1);
    live.close();
    assert.equal(closed, 1);
    assert.equal(live.usageSummary().closed, true);
    const next = new Live({ token: "FAKE_AUTH_SECRET", model: "test" });
    assert.equal(next.usageSummary().metadataEvents, 0);
    await next.ws.onmessage({ data: JSON.stringify({ usageMetadata: { totalTokenCount: 1 } }) });
    assert.equal(next.usageSummary().latestReportedUsage.totalTokenCount, 1);
    assert.equal(live.usageSummary().latestReportedUsage.totalTokenCount, 175);
    next.close();
  } finally { globalThis.WebSocket = previousSocket; }
});
