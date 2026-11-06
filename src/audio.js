// Cały dźwięk jest syntezowany w Web Audio, bez plików. Startuje po pierwszym kliknięciu.
export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  start() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = (this.ctx = new Ctx());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // Szum płynu, którego jasność rośnie z prędkością.
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    this.flowFilter = ctx.createBiquadFilter();
    this.flowFilter.type = 'lowpass';
    this.flowFilter.frequency.value = 300;
    this.flowGain = ctx.createGain();
    this.flowGain.gain.value = 0.12;
    src.connect(this.flowFilter).connect(this.flowGain).connect(this.master);
    src.start();

    this.nextBeat = ctx.currentTime + 0.5;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.8;
  }

  update(speedNorm, boosting, tense) {
    const ctx = this.ctx;
    if (!ctx) return;
    this.flowFilter.frequency.setTargetAtTime(220 + speedNorm * 700 + (boosting ? 1200 : 0), ctx.currentTime, 0.12);
    this.flowGain.gain.setTargetAtTime(0.07 + speedNorm * 0.1 + (boosting ? 0.09 : 0), ctx.currentTime, 0.12);
    // Bicie serca przyspiesza, gdy jesteś blisko jaja lub leukocyta.
    const interval = tense ? 0.56 : 0.92;
    while (this.nextBeat < ctx.currentTime + 0.1) {
      this.thump(this.nextBeat, 0.42);
      this.thump(this.nextBeat + 0.2, 0.26);
      this.nextBeat += interval;
    }
  }

  thump(at, vol) {
    const { ctx } = this;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(70, at);
    o.frequency.exponentialRampToValueAtTime(34, at + 0.16);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(vol, at + 0.015);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.24);
    o.connect(g).connect(this.master);
    o.start(at);
    o.stop(at + 0.26);
  }

  tone(freq, dur, type = 'sine', vol = 0.2, slide = 1, delay = 0) {
    if (!this.ctx) return;
    const { ctx } = this;
    const at = ctx.currentTime + delay;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, at);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), at + dur);
    g.gain.setValueAtTime(vol, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + dur);
    o.connect(g).connect(this.master);
    o.start(at);
    o.stop(at + dur + 0.02);
  }

  burst(dur, freq, vol = 0.3, q = 1) {
    if (!this.ctx) return;
    const { ctx } = this;
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = this.noise;
    s.loop = true;
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start();
    s.stop(ctx.currentTime + dur + 0.02);
  }

  pickup() { this.tone(620, 0.1, 'triangle', 0.16, 1.5); this.tone(940, 0.15, 'triangle', 0.13, 1.25, 0.06); }
  hyper() { [520, 660, 830, 1040].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.15, 1.1, i * 0.05)); }
  hit() { this.tone(150, 0.2, 'sine', 0.42, 0.4); this.burst(0.12, 700, 0.2); }
  wall() { this.burst(0.1, 300, 0.14, 0.6); }
  splat() { this.burst(0.35, 480, 0.34, 0.7); this.tone(210, 0.3, 'sine', 0.2, 0.45); }
  eaten() { this.tone(120, 0.7, 'sawtooth', 0.2, 0.35); this.burst(0.7, 240, 0.3, 0.8); }
  virus() { this.tone(330, 0.35, 'square', 0.08, 0.6); this.burst(0.2, 1500, 0.14, 2); }
  beep(high) { this.tone(high ? 880 : 440, high ? 0.5 : 0.18, 'triangle', 0.24); }
  win() { [262, 330, 392, 523, 659, 784].forEach((f, i) => this.tone(f, 1.6, 'sine', 0.13, 1, i * 0.1)); this.burst(1.4, 2400, 0.1, 0.4); }
  lose() { [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.8, 'triangle', 0.13, 0.98, i * 0.2)); }
  harden() { this.tone(1800, 1.2, 'sine', 0.07, 0.4); this.burst(0.9, 3200, 0.07, 3); }
}
