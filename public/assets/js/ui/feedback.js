// One place that decides what a mark "feels" like: sound + particles + shake.
import * as sfx from '../services/audio.js';
import * as vfx from '../services/vfx.js';

const COLOR = { P: '#12935b', A: '#d9384a', L: '#e98a0c', E: '#3d7be6' };

export function feedbackFor(status, el) {
  if (!status) { sfx.play('clear'); return; }
  sfx.play(status);
  if (!el) return;
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  if (status === 'A') { vfx.inkSplat(x, y, COLOR.A); vfx.shake(document.querySelector('.sheet')); }
  else if (status === 'P') vfx.sparkle(x, y, COLOR.P, 10);
  else vfx.sparkle(x, y, COLOR[status], 8);
}

export function celebrate(el) {
  sfx.play('success');
  if (!el) return vfx.confetti();
  const r = el.getBoundingClientRect();
  vfx.confetti(r.left + r.width / 2, r.top + r.height / 2);
}
