export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const uid = (p = 'id') => `${p}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;
export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
export const pct = (n, digits = 0) => (n == null ? '–' : `${(n * 100).toFixed(digits)}%`);

export function debounce(fn, ms = 200) {
  let t;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.flush = (...args) => { clearTimeout(t); fn(...args); };
  return wrapped;
}

export const initials = (name) =>
  String(name || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() || '').join('') || '?';

export const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';

export function download(filename, content, mime = 'text/plain') {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export const csvCell = (v) => {
  const raw = String(v ?? '');
  const s = /^[\s\uFEFF]*[=+\-@]/.test(raw) ? "'" + raw : raw;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
export const toCSV = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n');

export const slug = (s) => String(s || 'class').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'class';

/** Tiny seeded PRNG so the sample class looks the same every time. */
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
export function set(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => (o[k] ??= {}), obj);
  target[last] = value;
}

export const bus = (() => {
  const map = new Map();
  return {
    on(evt, fn) { (map.get(evt) || map.set(evt, new Set()).get(evt)).add(fn); return () => map.get(evt)?.delete(fn); },
    emit(evt, data) { map.get(evt)?.forEach((fn) => fn(data)); },
  };
})();
