// Simpele geluiden met WebAudio (geen geluidsbestanden nodig)
export class Sfx {
  constructor() { this.ctx = null; this.muted = false; }

  init() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    try {
      const C = window.AudioContext || window.webkitAudioContext;
      this.ctx = new C();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
      // motor
      this.osc = this.ctx.createOscillator();
      this.osc.type = 'sawtooth';
      this.filt = this.ctx.createBiquadFilter();
      this.filt.type = 'lowpass';
      this.filt.frequency.value = 500;
      this.eg = this.ctx.createGain();
      this.eg.gain.value = 0;
      this.osc.connect(this.filt).connect(this.eg).connect(this.master);
      this.osc.start();
    } catch { this.ctx = null; }
  }

  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.5; }

  engine(speed01, on) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.osc.frequency.setTargetAtTime(45 + speed01 * 120, t, 0.05);
    this.filt.frequency.setTargetAtTime(350 + speed01 * 900, t, 0.05);
    this.eg.gain.setTargetAtTime(on ? 0.05 : 0, t, 0.15);
  }

  beep(freq, dur = 0.15, type = 'square', vol = 0.12, slide = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  noise(dur = 0.3, vol = 0.25, freq = 800) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const s = this.ctx.createBufferSource(); s.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq;
    const g = this.ctx.createGain(); g.gain.value = vol;
    s.connect(f).connect(g).connect(this.master);
    s.start(t);
  }

  pickup() { this.beep(660, 0.08, 'triangle', 0.12); setTimeout(() => this.beep(990, 0.1, 'triangle', 0.12), 70); }
  boost() { this.noise(0.45, 0.3, 1400); this.beep(300, 0.35, 'sawtooth', 0.06, 500); }
  hit() { this.noise(0.5, 0.4, 500); this.beep(400, 0.5, 'square', 0.08, -300); }
  bump() { this.noise(0.12, 0.2, 200); }
  fanfare() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.beep(f, 0.22, 'square', 0.1), i * 140)); }
}
