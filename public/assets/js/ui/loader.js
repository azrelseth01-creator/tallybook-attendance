// The loading screen (#loader in index.html).
//
// It is the intro when the book starts, and the same screen is used for the short wait when you go to the
// Classes tab, open a class, or get the password right. One progress bar, one element, one timer.
//
//   const intro = start({ intro: true, auto: false, min: 2600 });   // real progress: intro.progress(40) ... await intro.finish()
//   cover({ title: 'Classes', sub: '...', min: 900 });              // timed: the page change happens underneath
//   await cover({ ..., keep: true }); ...; hide();                  // keep the screen up until you call hide()
//
// The bar is "real progress capped by time": it never shows more than the work done, and never runs faster
// than `min` milliseconds, so even a quick change is long enough to see the bar fill.
const $ = (s) => document.querySelector(s);
const FADE = 140;
const MESSAGES = ['Sharpening pencils…', 'Ruling the pages…', 'Counting the tallies…', 'Calling the register…'];
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const SAFE_COLOR = /^(#[0-9a-f]{3,8}|var\(--[\w-]+\))$/i;

let root = null;
let run = null;
let hideTimer = 0;
window.__tbLoader = true; // lets index.html know this file loaded

const el = () => (root ||= $('#loader'));
const setInert = (on) => ['cover', 'app', 'library'].forEach((id) => { const n = document.getElementById(id); if (n) n.inert = on; });

function setText(o) {
  if (o.kicker !== undefined) $('#ldKicker').textContent = o.kicker;
  if (o.title !== undefined) $('#ldTitle').textContent = o.title;
  if (o.sub !== undefined) $('#ldSub').textContent = o.sub;
}

function paint(p, s) {
  const r = el();
  r.style.setProperty('--p', (p / 100).toFixed(4));
  $('#ldPct').textContent = String(Math.round(p));
  $('#ldBar').setAttribute('aria-valuenow', String(Math.round(p)));
  if (s.intro && !s.customSub) {
    const msg = MESSAGES[Math.min(MESSAGES.length - 1, Math.floor(p / 26))];
    if ($('#ldSub').textContent !== msg) $('#ldSub').textContent = msg;
  }
}

function stop() {
  if (!run) return;
  clearInterval(run.timer);
  clearTimeout(run.guard);
  run.resolve();
  run = null;
}

function step(s) {
  if (run !== s) return;
  const t = s.min ? Math.min(1, (Date.now() - s.start) / s.min) : 1;
  const eased = t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2; // slow, steady, then a quick last stretch
  const next = Math.min(s.target, eased * 100);
  if (next > s.shown) s.shown = next;
  paint(s.shown, s);
  if (s.shown < 100 || s.over) return;
  s.over = true;
  clearInterval(s.timer);
  clearTimeout(s.guard);
  setTimeout(() => {
    if (run !== s) return;
    if (s.keep) s.resolve(); // caller hides it later
    else hide().then(s.resolve);
  }, reduced() ? 0 : 100);
}

/** Show the loading screen. Returns { progress(n), text({title,sub,kicker}), finish(), done }. */
export function start(opts = {}) {
  const r = el();
  if (!r) return { progress() {}, text() {}, finish: () => Promise.resolve(), done: Promise.resolve() };
  stop();
  clearTimeout(hideTimer);
  const o = { title: '', sub: '', kicker: '', color: '', min: 1000, intro: false, keep: false, auto: true, ...opts };
  const s = {
    start: Date.now(), min: reduced() ? Math.min(o.min, 350) : o.min, shown: 0, target: o.auto ? 100 : 4,
    intro: o.intro, keep: o.keep, over: false, customSub: Boolean(o.sub), timer: 0, guard: 0, resolve() {},
  };
  const done = new Promise((res) => { s.resolve = res; });
  run = s;

  r.dataset.mode = o.intro ? 'intro' : 'page';
  // a class's own colour shows as the spine of the paper label (the bar stays bright so it is readable on any desk colour)
  if (o.color && SAFE_COLOR.test(o.color)) r.style.setProperty('--ld-book', o.color); else r.style.removeProperty('--ld-book');
  setText({ title: o.title, kicker: o.kicker, sub: o.sub });
  r.classList.remove('out', 'go');
  void r.offsetWidth; // restart the entrance animation
  r.classList.add('go');
  r.hidden = false;
  setInert(true);
  paint(0, s);
  s.timer = setInterval(() => step(s), 40);
  s.guard = setTimeout(() => { s.target = 100; s.min = 0; }, 20000); // never trap the user behind the bar
  return {
    progress(n) { s.target = Math.max(s.target, Math.min(100, n)); },
    text: setText,
    finish() { s.target = 100; return done; },
    done,
  };
}

/** A timed loading screen. Resolves when it has faded out (or, with keep: true, when the bar reaches 100%). */
export const cover = (opts) => start(opts).done;

/** Fade the loading screen away. `now` skips the fade. */
export function hide(now = false) {
  const r = el();
  stop();
  clearTimeout(hideTimer);
  if (!r || r.hidden) return Promise.resolve();
  r.classList.add('out');
  return new Promise((resolve) => {
    hideTimer = setTimeout(() => {
      r.hidden = true;
      r.classList.remove('out');
      setInert(false);
      // put keyboard focus back on the page that is now showing
      if (!document.activeElement || document.activeElement === document.body) {
        const lib = $('#library');
        const t = lib && !lib.hidden ? lib : $('#app') && !$('#app').hidden ? $('#view') : null;
        if (t) { if (!t.hasAttribute('tabindex')) t.tabIndex = -1; t.focus({ preventScroll: true }); }
      }
      resolve();
    }, now || reduced() ? 0 : FADE);
  });
}
