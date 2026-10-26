// Visual effects on one full-screen canvas: confetti, sparkles and ink splats.
// The canvas only animates while particles exist, so it costs nothing at rest.
let canvas, g, raf = null;
let enabled = true;
let confettiOn = true;
const parts = [];
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function init() {
  canvas = document.getElementById('vfx');
  g = canvas.getContext('2d');
  const size = () => {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  size();
  addEventListener('resize', size);
}
export function configure({ on, confetti }) { enabled = on; confettiOn = confetti; }
const ok = () => enabled && !reduced() && g;

const PALETTE = ['#ffd84a', '#ff8fa3', '#7bdff2', '#b2f7a0', '#c8a2ff', '#ffb347', '#2b4bd6', '#12935b'];

export function confetti(x = innerWidth / 2, y = innerHeight * 0.35, count = 120) {
  if (!ok() || !confettiOn) return;
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = 4 + Math.random() * 9;
    parts.push({
      kind: 'confetti', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 6, g: 0.28, drag: 0.985,
      w: 6 + Math.random() * 6, h: 3 + Math.random() * 5, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
      life: 110 + Math.random() * 60, age: 0, color: PALETTE[(Math.random() * PALETTE.length) | 0],
    });
  }
  run();
}

export function sparkle(x, y, color = '#12935b', count = 14) {
  if (!ok()) return;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + Math.random() * 0.4;
    const v = 1.5 + Math.random() * 3.5;
    parts.push({ kind: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 0.05, drag: 0.93, r: 2 + Math.random() * 2.5, life: 28 + Math.random() * 14, age: 0, color });
  }
  run();
}

export function inkSplat(x, y, color = '#d9384a') {
  if (!ok()) return;
  parts.push({ kind: 'ring', x, y, r: 6, vr: 7, life: 22, age: 0, color });
  for (let i = 0; i < 16; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = 2 + Math.random() * 7;
    parts.push({ kind: 'blob', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, drag: 0.86, r: 1.5 + Math.random() * 4.5, life: 34 + Math.random() * 18, age: 0, color });
  }
  run();
}

export function shake(el) {
  if (!enabled || reduced() || !el) return;
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
  setTimeout(() => el.classList.remove('shake'), 380);
}

function run() { if (!raf) raf = requestAnimationFrame(tick); }

function tick() {
  g.clearRect(0, 0, innerWidth, innerHeight);
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.age++;
    const t = p.age / p.life;
    if (t >= 1) { parts.splice(i, 1); continue; }
    g.globalAlpha = p.kind === 'confetti' ? Math.min(1, (1 - t) * 3) : 1 - t;
    g.fillStyle = g.strokeStyle = p.color;
    if (p.kind === 'ring') {
      p.r += p.vr; p.vr *= 0.88;
      g.lineWidth = 4 * (1 - t);
      g.beginPath(); g.arc(p.x, p.y, p.r, 0, 6.283); g.stroke();
      continue;
    }
    p.vx *= p.drag; p.vy = p.vy * p.drag + (p.g || 0);
    p.x += p.vx; p.y += p.vy;
    if (p.kind === 'confetti') {
      p.rot += p.vr;
      g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.scale(1, Math.cos(p.age * 0.3));
      g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); g.restore();
    } else {
      g.beginPath(); g.arc(p.x, p.y, p.r * (1 - t * 0.5), 0, 6.283); g.fill();
    }
  }
  g.globalAlpha = 1;
  raf = parts.length ? requestAnimationFrame(tick) : null;
  if (!parts.length) g.clearRect(0, 0, innerWidth, innerHeight);
}
