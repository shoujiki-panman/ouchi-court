// 法廷の効果音を、ブラウザの中で音から作る（素材ファイルを配らないため）。
// 開廷のファンファーレ・審議中のドラムロール・判決のシンバル・木槌。

const noise = (ctx, seconds) => {
  const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
};

function hit(ctx, at, { freq = 800, type = "lowpass", decay = 0.12, gain = 0.6 } = {}) {
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx, decay + 0.05);
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, at);
  g.gain.exponentialRampToValueAtTime(0.001, at + decay);
  src.connect(f).connect(g).connect(ctx.destination);
  src.start(at);
  return src;
}

const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));

export const sfx = {
  // 木槌を2回
  async gavel(ctx) {
    const t = ctx.currentTime + 0.05;
    hit(ctx, t, { freq: 600, decay: 0.15, gain: 0.9 });
    hit(ctx, t + 0.35, { freq: 600, decay: 0.15, gain: 0.9 });
    await wait(0.6);
  },
  // 開廷のラッパ（ド・ミ・ソ・ド）
  async fanfare(ctx) {
    if (ctx.state === "suspended") await ctx.resume();
    const t = ctx.currentTime + 0.05;
    [523, 659, 784, 1047].forEach((hz, i) => {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = hz;
      const g = ctx.createGain();
      const at = t + i * 0.18;
      const len = i === 3 ? 0.6 : 0.16;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.15, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + len);
      o.connect(g).connect(ctx.destination);
      o.start(at);
      o.stop(at + len + 0.05);
    });
    await wait(1.2);
    await this.gavel(ctx);
  },
  // 審議中のドラムロール（止めるまで続く。最長 seconds 秒）
  drumroll(ctx, seconds = 6) {
    const srcs = [];
    const t = ctx.currentTime + 0.05;
    for (let i = 0; i < seconds * 16; i++) srcs.push(hit(ctx, t + i / 16, { freq: 1800, type: "bandpass", decay: 0.06, gain: 0.25 + 0.2 * (i / (seconds * 16)) }));
    return { stop: () => srcs.forEach((s) => { try { s.stop(); } catch {} }) };
  },
  async cymbal(ctx) {
    hit(ctx, ctx.currentTime + 0.02, { freq: 6000, type: "highpass", decay: 1.2, gain: 0.5 });
    await wait(0.8);
  },
};
