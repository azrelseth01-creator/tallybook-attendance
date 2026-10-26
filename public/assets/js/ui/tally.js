// Hand-drawn tally marks: four strokes and a slash, like a teacher counting on the board.
const GROUP_W = 26;

export function tally(n, { max = 20 } = {}) {
  if (!n) return '';
  const shown = Math.min(n, max);
  const groups = Math.ceil(shown / 5);
  const w = groups * GROUP_W;
  let body = '';
  let left = shown;
  for (let g = 0; g < groups; g++) {
    const x0 = g * GROUP_W;
    const strokes = Math.min(left, 5);
    const verticals = Math.min(strokes, 4);
    for (let i = 0; i < verticals; i++) {
      const wob = ((g * 7 + i * 3) % 5) * 0.35 - 0.7; // tiny deterministic wobble
      const x = x0 + 4 + i * 5;
      body += `<path d="M${x + wob} 3 L${x - wob} 17"/>`;
    }
    if (strokes === 5) body += `<path d="M${x0 + 1} 14.5 L${x0 + 22} 5.5"/>`;
    left -= strokes;
  }
  const extra = n > max ? `<text x="${w + 4}" y="15" class="tally-more">+${n - max}</text>` : '';
  const total = w + (n > max ? 26 : 0);
  return `<svg class="tally" viewBox="0 0 ${total} 20" width="${total}" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">${body}${extra}</svg>`;
}
