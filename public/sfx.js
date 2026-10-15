// 法廷の効果音を、ブラウザの中で音から作る（素材ファイルを配らないため）。
// 開廷のファンファーレ・審議中のドラムロール・判決のシンバル・木槌。

const noise = (ctx, seconds) => {
  const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
};

function hit(ctx, at, { freq = 800, type = "lowpass", decay = 0.12, gain = 0.6 } = {}, dest = ctx.destination) {
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx, decay + 0.05);
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, at);
  g.gain.exponentialRampToValueAtTime(0.001, at + decay);
  src.connect(f).connect(g).connect(dest);
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
  // 異議あり！の「ジャン！」（低い和音を短く強く）
  async objection(ctx) {
    const t = ctx.currentTime + 0.02;
    [196, 247, 294, 392].forEach((hz) => {
      const o = ctx.createOscillator();
      o.type = "square";
      o.frequency.value = hz;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.12, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.55);
    });
    hit(ctx, t, { freq: 3000, type: "highpass", decay: 0.3, gain: 0.4 });
    await wait(0.5);
  },
  // ずっと鳴る法廷ビート（tempo を上げると速くなる）。止めるまで続く
  beat(ctx) {
    // 音量のつまみを1つ通す。人が話す番は小さくする（マイクが拾うと、AI が「まだ話している」と思って返事をしなくなる 10/15）
    const master = ctx.createGain();
    let lvl = 0; // 最初は無音。盛り上がったら上げる
    master.gain.value = 0;
    master.connect(ctx.destination);
    let bpm = 92, on = true, n = 0;
    const loop = () => {
      if (!on) return;
      const t = ctx.currentTime + 0.02;
      hit(ctx, t, { freq: 140, type: "lowpass", decay: 0.18, gain: n % 4 === 0 ? 0.5 : 0.28 }, master);
      if (n % 2 === 1) hit(ctx, t, { freq: 4000, type: "highpass", decay: 0.05, gain: 0.12 }, master);
      const o = ctx.createOscillator();
      o.type = "triangle";
      o.frequency.value = [55, 55, 58.27, 51.91][Math.floor(n / 4) % 4];
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.09, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      o.connect(g).connect(master);
      o.start(t);
      o.stop(t + 0.25);
      n++;
      setTimeout(loop, 60000 / bpm / 2);
    };
    loop();
    return {
      stop: () => (on = false),
      faster: (to) => (bpm = Math.min(170, to)),
      loud: (yes) => master.gain.setTargetAtTime((yes ? 1 : 0.06) * lvl, ctx.currentTime, 0.15),
      level: (v) => {
        lvl = v;
        master.gain.setTargetAtTime(0.06 * lvl, ctx.currentTime, 0.4);
      },
      get bpm() { return bpm; },
    };
  },
  // 観客のどよめき（ざわっ）
  crowd(ctx, gain = 0.25) {
    const t = ctx.currentTime + 0.01;
    const src = ctx.createBufferSource();
    src.buffer = noise(ctx, 1.2);
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 900;
    f.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    src.connect(f).connect(g).connect(ctx.destination);
    src.start(t);
  },
  // 点数が入った「ピロン」
  coin(ctx) {
    const t = ctx.currentTime + 0.01;
    [988, 1319].forEach((hz, i) => {
      const o = ctx.createOscillator();
      o.type = "square";
      o.frequency.value = hz;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.08, t + i * 0.07);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.07 + 0.12);
      o.connect(g).connect(ctx.destination);
      o.start(t + i * 0.07);
      o.stop(t + i * 0.07 + 0.14);
    });
  },
  // 法廷のBGM（魔王魂の曲）：盛り上がりで 落ち着き→議論→白熱 を切りかえる。人が話す番は小さく（マイクが拾うと返事が止まる）
  bgm() {
    const tracks = { calm: new Audio("bgm/calm.mp3"), debate: new Audio("bgm/debate.mp3"), hot: new Audio("bgm/hot.mp3") };
    for (const a of Object.values(tracks)) {
      a.loop = true;
      a.volume = 0;
      a.preload = "auto";
    }
    let now = null, loud = false, on = true, timer;
    const target = () => (loud ? 0.32 : 0.08);
    const fade = () => {
      clearInterval(timer);
      timer = setInterval(() => {
        let done = true;
        for (const [k, a] of Object.entries(tracks)) {
          const goal = on && k === now ? target() : 0;
          const v = a.volume + Math.sign(goal - a.volume) * 0.02;
          a.volume = Math.abs(goal - a.volume) < 0.02 ? goal : Math.min(1, Math.max(0, v));
          if (a.volume === 0 && k !== now && !a.paused) a.pause();
          if (a.volume !== goal) done = false;
        }
        if (done) clearInterval(timer);
      }, 60);
    };
    const play = (k) => {
      if (k === now) return;
      now = k;
      tracks[k].play().catch(() => {});
      fade();
    };
    play("calm");
    return {
      stop: () => {
        on = false;
        fade();
      },
      faster: () => {},
      level: (v) => play(v >= 1 ? "hot" : v >= 0.5 ? "debate" : "calm"),
      loud: (yes) => {
        loud = yes;
        fade();
      },
      get track() { return now; },
    };
  },
  // ルーレットの「カッ」
  tick(ctx) {
    hit(ctx, ctx.currentTime + 0.01, { freq: 2500, type: "bandpass", decay: 0.03, gain: 0.35 });
  },
  async cymbal(ctx) {
    hit(ctx, ctx.currentTime + 0.02, { freq: 6000, type: "highpass", decay: 1.2, gain: 0.5 });
    await wait(0.8);
  },
};
