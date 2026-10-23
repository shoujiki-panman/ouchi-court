// Numeric-only, in-memory observations of Gemini Live usageMetadata.
// These are reported snapshots, NOT additive billable-token counters.
// https://ai.google.dev/api/live#UsageMetadata
const COUNTERS = [
  "promptTokenCount", "cachedContentTokenCount", "responseTokenCount",
  "toolUsePromptTokenCount", "thoughtsTokenCount", "totalTokenCount",
];
const DETAILS = [
  "promptTokensDetails", "cacheTokensDetails", "responseTokensDetails", "toolUsePromptTokensDetails",
];
const MODALITIES = new Set(["MODALITY_UNSPECIFIED", "TEXT", "IMAGE", "VIDEO", "AUDIO", "DOCUMENT"]);
const FIELDS = new Set([...COUNTERS, ...DETAILS]);
const MAX_DETAILS = 64;
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isCount = (value) => Number.isInteger(value) && value >= 0 && value <= 2147483647;
const copy = (value) => JSON.parse(JSON.stringify(value));

function sanitize(raw) {
  const usage = {};
  let discarded = 0;
  let unknownModalities = 0;
  if (!isRecord(raw)) return { usage: null, discarded: 1, unknownModalities };
  for (const key of Object.keys(raw)) if (!FIELDS.has(key)) discarded++;
  for (const key of COUNTERS) {
    if (!Object.hasOwn(raw, key)) continue;
    if (isCount(raw[key])) usage[key] = raw[key];
    else discarded++;
  }
  for (const key of DETAILS) {
    if (!Object.hasOwn(raw, key)) continue;
    if (!Array.isArray(raw[key])) { discarded++; continue; }
    const details = [];
    for (const item of raw[key].slice(0, MAX_DETAILS)) {
      if (!isRecord(item) || !isCount(item.tokenCount)) { discarded++; continue; }
      for (const field of Object.keys(item)) if (field !== "modality" && field !== "tokenCount") discarded++;
      const modality = MODALITIES.has(item.modality) ? item.modality : "UNKNOWN";
      if (modality === "UNKNOWN") unknownModalities++;
      details.push({ modality, tokenCount: item.tokenCount });
    }
    discarded += Math.max(0, raw[key].length - MAX_DETAILS);
    usage[key] = details;
  }
  return { usage: Object.keys(usage).length ? usage : null, discarded, unknownModalities };
}

export class LiveUsage {
  #limit;
  #sequence = 0;
  #completedTurns = 0;
  #metadataEvents = 0;
  #duplicateSnapshots = 0;
  #discardedFields = 0;
  #unknownModalities = 0;
  #droppedObservations = 0;
  #closed = false;
  #latest = null;
  #observations = [];

  constructor({ maxObservations = 512 } = {}) {
    if (!Number.isInteger(maxObservations) || maxObservations < 1 || maxObservations > 4096) {
      throw new RangeError("maxObservations must be between 1 and 4096");
    }
    this.#limit = maxObservations;
  }

  // Call in WebSocket receive order, including messages containing only turn markers.
  // Only the allowlisted counters and booleans below can enter retained state.
  observe(message) {
    if (this.#closed || !isRecord(message)) return false;
    const sc = isRecord(message.serverContent) ? message.serverContent : {};
    const markers = {};
    for (const key of ["generationComplete", "interrupted", "turnComplete"]) {
      if (sc[key] === true) markers[key] = true;
    }
    const hasMetadata = Object.hasOwn(message, "usageMetadata");
    if (!hasMetadata && !Object.keys(markers).length) return false;
    const sequence = ++this.#sequence;
    let usage = null;
    let counterDecreased = false;
    if (hasMetadata) {
      this.#metadataEvents++;
      const clean = sanitize(message.usageMetadata);
      this.#discardedFields += clean.discarded;
      this.#unknownModalities += clean.unknownModalities;
      usage = clean.usage;
      if (usage) {
        counterDecreased = COUNTERS.some((key) => Object.hasOwn(usage, key) &&
          this.#latest && Object.hasOwn(this.#latest, key) && usage[key] < this.#latest[key]);
        // Replace rather than add cumulative snapshots; missing means unknown, not zero.
        this.#latest = usage;
      }
    }
    const observation = {
      sequence, lastSequence: sequence, turn: this.#completedTurns + 1, repeats: 1,
      ...(usage ? { usage } : {}), ...markers,
      ...(counterDecreased ? { counterDecreased: true } : {}),
      ...(hasMetadata && !usage ? { invalidMetadata: true } : {}),
    };
    const previous = this.#observations.at(-1);
    // Only collapse consecutive identical snapshots inside the same observed turn.
    // Equal counters in a later turn can represent charged context reuse, so keep them.
    if (usage && !Object.keys(markers).length && previous?.usage &&
        previous.turn === observation.turn && !previous.generationComplete &&
        !previous.interrupted && !previous.turnComplete &&
        JSON.stringify(previous.usage) === JSON.stringify(usage)) {
      previous.repeats++;
      previous.lastSequence = sequence;
      this.#duplicateSnapshots++;
    } else {
      this.#observations.push(observation);
      if (this.#observations.length > this.#limit) {
        this.#observations.shift();
        this.#droppedObservations++;
      }
    }
    if (markers.turnComplete) this.#completedTurns++;
    return true;
  }

  close() { this.#closed = true; }

  summary() {
    return copy({
      schemaVersion: 1,
      semantics: "reported-snapshots-not-billable-total",
      closed: this.#closed,
      completedTurns: this.#completedTurns,
      metadataEvents: this.#metadataEvents,
      duplicateSnapshots: this.#duplicateSnapshots,
      discardedFields: this.#discardedFields,
      unknownModalities: this.#unknownModalities,
      droppedObservations: this.#droppedObservations,
      latestReportedUsage: this.#latest,
      observations: this.#observations,
    });
  }
}
