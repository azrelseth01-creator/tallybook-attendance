// Sound effects are synthesised with the Web Audio API, so there are no audio files to
// host or download. Each effect is a few oscillators and bursts of noise.
let ctx = null;
let master = null;
let enabled = true;
let volume = 0.6;

export function configure({ on, volume: v }) {
  enabled = on;
  volume = Math.max(0, Math.min(1, v / 100));
  if (master) master.gain.value = volume;
}

function ac() {
  if (!ctx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    ctx = new Ctx();
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone({ f = 440, to, t = 0, d = 0.12, type = 'sine', g = 0.3 }) {
  const c = ac();
  const at = c.currentTime + t;
  const o = c.createOscillator();
  const gain = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, at);
  if (to) o.frequency.exponentialRampToValueAtTime(to, at + d);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(g, at + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + d);
  o.connect(gain).connect(master);
  o.start(at);
  o.stop(at + d + 0.02);
}

function noise({ t = 0, d = 0.1, g = 0.2, type = 'lowpass', from = 1000, to, q = 0.8 }) {
  const c = ac();
  const at = c.currentTime + t;
  const len = Math.max(1, Math.floor(c.sampleRate * d));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const filter = c.createBiquadFilter();
  filter.type = type;
  filter.Q.value = q;
  filter.frequency.setValueAtTime(from, at);
  if (to) filter.frequency.exponentialRampToValueAtTime(to, at + d);
  const gain = c.createGain();
  gain.gain.setValueAtTime(g, at);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + d);
  src.connect(filter).connect(gain).connect(master);
  src.start(at);
}

const FX = {
  tap() { tone({ f: 1300, d: 0.035, g: 0.1, type: 'triangle' }); },
  tab() { tone({ f: 900, to: 1200, d: 0.05, g: 0.08, type: 'triangle' }); noise({ d: 0.05, g: 0.05, type: 'highpass', from: 3000 }); },
  present() {
    tone({ f: 880, d: 0.1, g: 0.22, type: 'triangle' });
    tone({ f: 1320, t: 0.07, d: 0.16, g: 0.2, type: 'triangle' });
  },
  absent() {
    // a rubber stamp hitting a desk: low thump + paper slap
    tone({ f: 190, to: 42, d: 0.32, g: 0.75 });
    noise({ d: 0.07, g: 0.45, type: 'lowpass', from: 1400, to: 300 });
    noise({ d: 0.04, g: 0.25, type: 'highpass', from: 2500 });
  },
  late() {
    tone({ f: 660, d: 0.12, g: 0.16, type: 'square' });
    tone({ f: 494, t: 0.11, d: 0.2, g: 0.16, type: 'square' });
  },
  excused() { noise({ d: 0.26, g: 0.2, type: 'bandpass', from: 500, to: 2600, q: 1.4 }); tone({ f: 740, t: 0.2, d: 0.14, g: 0.12, type: 'sine' }); },
  clear() { tone({ f: 420, to: 220, d: 0.09, g: 0.14, type: 'triangle' }); },
  pop() { tone({ f: 520, to: 980, d: 0.08, g: 0.18 }); },
  page() { noise({ d: 0.26, g: 0.16, type: 'bandpass', from: 400, to: 1900, q: 0.9 }); },
  error() { tone({ f: 170, d: 0.2, g: 0.22, type: 'sawtooth' }); },
  success() {
    [523, 659, 784, 1047].forEach((f, i) => tone({ f, t: i * 0.09, d: 0.3, g: 0.2, type: 'triangle' }));
    noise({ t: 0.3, d: 0.4, g: 0.05, type: 'highpass', from: 5000 });
  },
};
FX.P = FX.present; FX.A = FX.absent; FX.L = FX.late; FX.E = FX.excused;

export function play(name) {
  if (!enabled || !FX[name]) return;
  try { if (ac()) FX[name](); } catch { /* audio blocked: stay silent */ }
}

export function speak(text) {
  if (!enabled || !('speechSynthesis' in window)) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.95;
    u.volume = volume;
    speechSynthesis.speak(u);
  } catch { /* ignore */ }
}
export function stopSpeaking() { try { speechSynthesis?.cancel(); } catch { /* ignore */ } }
