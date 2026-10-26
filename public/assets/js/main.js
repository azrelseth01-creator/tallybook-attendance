// Tallybook entry point: boot, router, title bar, cover, shortcuts.
import { config, loadConfig } from './core/config.js';
import * as store from './core/store.js';
import { fmt, today as todayIso } from './core/dates.js';
import { stepSchoolDay } from './core/stats.js';
import { bus, esc } from './core/utils.js';
import { icon } from './ui/icons.js';
import { toast } from './ui/toast.js';
import { openDialog } from './ui/modal.js';
import { initDock, apply as applyDock, openDock } from './ui/dock.js';
import * as sfx from './services/audio.js';
import * as vfx from './services/vfx.js';
import * as music from './services/music.js';
import * as sync from './services/sync.js';
import { today } from './views/today.js';
import { roster } from './views/roster.js';
import { calendar } from './views/calendar.js';
import { reports } from './views/reports.js';
import { settings } from './views/settings.js';
import { library } from './views/library.js';
import * as lock from './core/lock.js';
import * as access from './core/access.js';
import { enterClass } from './ui/classDialogs.js';
import * as loader from './ui/loader.js';

const ROUTES = [
  { id: 'today', label: 'Today', view: today, color: '#ffd84a' },
  { id: 'roster', label: 'Roster', view: roster, color: '#ff8fa3' },
  { id: 'calendar', label: 'Calendar', view: calendar, color: '#7bdff2' },
  { id: 'reports', label: 'Reports', view: reports, color: '#b2f7a0' },
  { id: 'settings', label: 'Settings', view: settings, color: '#c8a2ff' },
];
const LIBRARY = { id: 'library', label: 'Classes', view: library, color: '#ffffff' };
const $ = (s) => document.querySelector(s);
let current = null;
let firstRoute = true; // the first page after sign-in has just had its loading screen, so it does not get another

async function boot() {
  // The loading screen is already on the page (index.html), so there is no blank flash. It is the intro, and its bar
  // follows real start-up progress and clears as soon as the app is ready.
  const intro = loader.start({ intro: true, auto: false, min: 0, title: 'Tallybook', kicker: 'Class attendance register' });
  await loadConfig();
  intro.text({ title: config.appName });
  intro.progress(25);
  store.init(config.defaultMusic.map((u) => music.makeItem(u)).filter(Boolean));
  intro.text({ kicker: store.settings().schoolName || 'Class attendance register' });
  intro.progress(45);
  vfx.init();
  applySettings();
  buildRail();
  buildRuler();
  buildTitlebar();
  intro.progress(65);

  bus.on('change', onChange);
  bus.on('saved', paintSaved);
  bus.on('denied', onDenied);
  bus.on('save-error', () => toast('This browser could not save your changes (storage may be full or blocked). Download a backup from Settings.', { type: 'error', duration: 9000 }));
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('/sw.js').catch(() => {});

  // The password screen comes first. The router, shortcuts and music only start after a password is accepted.
  await Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 1200))]); // the fonts are part of the first look
  intro.progress(82);
  await restoreSession();
  intro.progress(95);
  await intro.finish(); // bar to 100%, then the loading screen fades into the password screen
  await openCover();
  paintAccess();
  initDock();
  applyDock();
  addEventListener('hashchange', route);
  addEventListener('keydown', onKey);
  // With several classes (or a locked one) you start at the library; a bare link with a hash is left alone.
  if (!location.hash || location.hash === '#') history.replaceState(null, '', startsInLibrary() ? '#/library' : '#/today');
  route();
  paintSaved();
  music.armAutoplay();
  sync.init();
}

function startsInLibrary() {
  const st = store.getState();
  return !lock.isOpen(store.cls()) || st.classes.filter((c) => !c.archived).length > 1;
}

/* ---------- settings side effects ---------- */
function applySettings() {
  const s = store.settings();
  const root = document.documentElement;
  root.dataset.desk = s.desk;
  root.dataset.paper = s.paper;
  root.dataset.density = s.density;
  root.style.setProperty('--text-scale', String(s.textScale / 100));
  sfx.configure({ on: s.sound.on, volume: s.sound.volume });
  vfx.configure({ on: s.vfx.on, confetti: s.vfx.confetti });
  const meta = document.querySelector('meta[name="theme-color"]');
  const deskColor = { navy: '#16214d', forest: '#14352f', plum: '#2f1d47', graphite: '#22252c' }[s.desk];
  if (meta) meta.content = deskColor;
  paintTitle();
}

function onChange(evt) {
  if (evt.type === 'settings') { applySettings(); if (evt.path?.startsWith('music.on') || evt.path?.startsWith('music.queue')) applyDock(); }
  else if (['class', 'import', 'classinfo'].includes(evt.type)) { applySettings(); applyDock(); }
  if (['import', 'class', 'classinfo'].includes(evt.type)) buildTitlebarClassSelect();
  if (current?.id !== 'library' && !lock.isOpen(store.cls()) && !['settings'].includes(current?.id)) { location.hash = '#/library'; return; }
  $('#tbSaved').textContent = 'Saving…';
  $('#tbUndo').disabled = !store.canUndo();
  current?.view.update?.(evt);
}

/* ---------- password screen (the cover) ---------- */
/** A tab that was already signed in keeps its access on reload. Ask the server again in case the passwords changed. */
async function restoreSession() {
  const pw = access.password();
  if (!access.getRole() || !pw) { access.clear(); return; }
  try {
    const res = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
    if (res.status === 401) access.clear(); // the password was changed: ask again
    else if (res.ok) access.signIn((await res.json()).role, pw);
  } catch { /* offline: keep what this tab already had */ }
  access.paintRole();
}

async function checkPassword(pw) {
  let res;
  try {
    res = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
  } catch {
    throw new Error('Could not reach the server to check the password. Check your internet connection and try again.');
  }
  if (res.status === 401) throw new Error('That password is not right. Try again.');
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'The password check is not available here. The site needs its /api folder (deploy it on Vercel, or run node scripts/dev.mjs).');
  if (json.role !== 'admin' && json.role !== 'viewer') throw new Error('The password check gave an unexpected answer.');
  return json.role;
}

async function openCover() {
  const s = store.settings();
  const needLogin = !access.getRole();
  if (!needLogin) return;

  const cover = $('#cover');
  $('#cvSchool').textContent = s.schoolName || '';
  $('#cvTitle').textContent = config.appName;
  $('#cvClass').textContent = needLogin ? 'Enter the password to open the book' : store.cls().name;
  $('#cvTeacher').textContent = needLogin ? '' : [s.teacherName, s.academicYear].filter(Boolean).join(' · ');
  $('#cvPinWrap').hidden = !needLogin;
  $('#cvOpen').textContent = needLogin ? 'Unlock' : 'Open the book';
  cover.hidden = false;
  (needLogin ? $('#cvPin') : $('#cvOpen')).focus();
  const pinInput = $('#cvPin');
  const reveal = $('#cvReveal');
  const caps = $('#cvCaps');
  pinInput.type = 'password';
  reveal.textContent = 'Show';
  reveal.setAttribute('aria-label', 'Show password');
  reveal.setAttribute('aria-pressed', 'false');
  caps.hidden = true;
  reveal.onclick = () => {
    const visible = pinInput.type === 'password';
    pinInput.type = visible ? 'text' : 'password';
    reveal.textContent = visible ? 'Hide' : 'Show';
    reveal.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
    reveal.setAttribute('aria-pressed', String(visible));
    pinInput.focus({ preventScroll: true });
  };
  pinInput.addEventListener('keyup', (e) => { caps.hidden = !e.getModifierState?.('CapsLock'); });

  await new Promise((resolve) => {
    $('#cvForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('#cvOpen');
      if (needLogin) {
        const pw = $('#cvPin').value;
        if (!pw) { $('#cvPin').focus(); return; }
        btn.disabled = true;
        $('#cvError').textContent = '';
        try {
          access.signIn(await checkPassword(pw), pw);
        } catch (err) {
          $('#cvError').textContent = err.message;
          sfx.play('error');
          cover.classList.remove('nope'); void cover.offsetWidth; cover.classList.add('nope');
          btn.disabled = false;
          $('#cvPin').select();
          return;
        }
        $('#cvPin').value = '';
        // Password accepted: the loading screen covers the short transition.
        await loader.cover({ kicker: config.appName, title: 'Password accepted', sub: access.isAdmin() ? 'Signed in as admin. Opening…' : 'Signed in, view only. Opening…', min: 0, keep: true });
      }
      sfx.play('page');
      paintAccess();
      $('#app').hidden = false;
      cover.hidden = true;
      if (needLogin) loader.hide();
      resolve();
    });
  });
}

/** Shows who is signed in (and the lock button), and lets the CSS hide editing controls for view only. */
function paintAccess() {
  access.paintRole();
  const role = access.getRole();
  const pill = $('#tbRole');
  pill.hidden = !role;
  pill.dataset.role = role || '';
  pill.textContent = role === 'admin' ? 'Admin' : 'View only';
  pill.title = role === 'admin' ? 'You can add and edit. Class passwords still apply.' : 'You can open and look at everything, but not change anything.';
  $('#tbLock').hidden = !role;
}

let lastDenied = 0;
function onDenied() {
  if (Date.now() - lastDenied < 1500) return; // one notice, not one per click
  lastDenied = Date.now();
  sfx.play('error');
  toast('View only: this password lets you look at everything but not change anything. Lock the book and sign in with the admin password to edit.', { type: 'error', duration: 6000 });
}

/* ---------- chrome ---------- */
function buildRail() {
  const libTab = `<a class="tab tab-lib" href="#/library" data-route="library" style="--tab:${LIBRARY.color}">${icon('grid', 22)}<span>Classes</span></a>`;
  $('#rail').innerHTML = libTab + ROUTES.map((r) => `<a class="tab" href="#/${r.id}" data-route="${r.id}" style="--tab:${r.color}">${icon(r.id === 'today' ? 'today' : r.id, 22)}<span>${r.label}</span></a>`).join('');
  $('#rail').addEventListener('click', (e) => { if (e.target.closest('.tab')) sfx.play('tab'); });
}

function buildRuler() {
  const ruler = $('#ruler');
  ruler.innerHTML = Array.from({ length: 24 }, (_, i) => `<span style="--i:${i}">${i}</span>`).join('');
}

function buildTitlebar() {
  $('#tbUndo').innerHTML = icon('undo', 18);
  $('#tbMore').innerHTML = icon('more', 18);
  $('#tbMusic').innerHTML = icon('music', 16) + '<span>Music</span>';
  $('#tbHelp').innerHTML = icon('help', 16) + '<span>Keyboard shortcuts</span>';
  $('#tbLock').innerHTML = icon('lock', 18);
  $('#tbLock').onclick = () => access.signOut();
  $('#tbUndo').onclick = doUndo;
  $('#tbMusic').onclick = () => {
    if (!(store.getSetting('music.queue') || []).length) { location.hash = '#/settings/music'; return; }
    if (!store.getSetting('music.on')) { store.setSetting('music.on', true); applyDock(); }
    openDock();
  };
  $('#tbHelp').onclick = showHelp;
  $('#tbMoreMenu').addEventListener('click', (e) => { if (e.target.closest('button')) $('#tbMoreMenu').open = false; });
  document.addEventListener('click', (e) => { if (!$('#tbMoreMenu').contains(e.target)) $('#tbMoreMenu').open = false; });
  $('#tbClass').addEventListener('change', async (e) => {
    const ok = await enterClass(e.target.value);
    if (ok) sfx.play('page'); else buildTitlebarClassSelect();
  });
  buildTitlebarClassSelect();
  paintTitle();
}

function buildTitlebarClassSelect() {
  const sel = $('#tbClass');
  const st = store.getState();
  const shown = st.classes.filter((c) => !c.archived || c.id === st.currentClassId);
  sel.hidden = shown.length < 2;
  sel.innerHTML = shown.map((c) => `<option value="${c.id}" ${c.id === st.currentClassId ? 'selected' : ''}>${esc(c.name)}${c.lock ? ' (locked)' : ''}</option>`).join('');
}

function paintTitle() {
  const s = store.settings();
  const c = store.cls();
  $('#tbFile').textContent = [c.name, s.term].filter(Boolean).join(' · ');
  if (current?.id !== 'library') document.title = `${c.name} · ${config.appName}`;
  buildTitlebarClassSelect();
}

function paintSaved() {
  $('#tbSaved').textContent = store.ui.savedAt ? `All changes saved · ${fmt.time(store.ui.savedAt)}` : 'All changes saved';
  $('#tbUndo').disabled = !store.canUndo();
}

function doUndo() {
  const label = store.undo();
  if (label) { sfx.play('clear'); toast(`Undone: ${label}.`); } else toast('Nothing to undo.');
}

/* ---------- router ---------- */
function route() {
  if (!access.getRole()) return; // nothing opens before a password is accepted
  const first = firstRoute;
  firstRoute = false;
  const [, id = 'today', sub] = location.hash.split('/');
  const r = id === 'library' ? LIBRARY : ROUTES.find((x) => x.id === id) || ROUTES[0];
  // A locked class that has not been unlocked in this tab cannot be opened by typing the address.
  if (r !== LIBRARY && r.id !== 'settings' && !lock.isOpen(store.cls())) { location.hash = '#/library'; return; }
  if (current?.id === r.id && !sub) return;
  current?.view.unmount?.();
  if (r === LIBRARY) {
    // The Classes tab: the loading screen covers the change (the shelf is built underneath it).
    if (!first) loader.cover({ kicker: config.appName, title: 'Classes', sub: 'Opening your classes…', min: 0 });
    lock.relockAll(); // coming back to the library locks every class again
    $('#app').hidden = true;
    const host = $('#library');
    host.hidden = false;
    host.replaceChildren();
    current = r;
    document.title = `Class library · ${config.appName}`;
    r.view.mount(host);
    return;
  }
  $('#library').hidden = true;
  $('#app').hidden = false;
  document.title = `${store.cls().name} · ${config.appName}`;
  const view = $('#view');
  const fresh = !current;
  current = r;
  view.replaceChildren();
  view.className = `page route-${r.id}`;
  r.view.mount(view, sub);
  document.querySelectorAll('.tab').forEach((t) => t.toggleAttribute('aria-current', t.dataset.route === r.id));
  document.querySelectorAll('.tab[aria-current]').forEach((t) => t.setAttribute('aria-current', 'page'));
  if (!fresh) {
    view.classList.add('turn');
    setTimeout(() => view.classList.remove('turn'), 420);
    view.focus({ preventScroll: true });
  }
  view.scrollTop = 0;
  document.querySelector('.sheet').scrollTop = 0;
}

/* ---------- shortcuts ---------- */
function showHelp() {
  const rows = [['1 to 5', 'Go to Today, Roster, Calendar, Reports, Settings'], ['P  A  L  E', 'Mark the focused student present, absent, late or excused'], ['Arrow keys', 'Move between students'], ['Backspace', 'Clear the focused student'], ['[  and  ]', 'Previous and next school day'], ['T', 'Jump to today'], ['/', 'Search for a student'], ['Ctrl + Z', 'Undo the last mark'], ['?', 'Show this list']];
  openDialog({ title: 'Keyboard shortcuts', body: `<dl class="keys">${rows.map(([k, d]) => `<div><dt>${k.split(/\s{2,}/).map((x) => `<kbd>${esc(x)}</kbd>`).join(' ')}</dt><dd>${d}</dd></div>`).join('')}</dl>`, actions: [{ label: 'Got it', value: true, kind: 'primary' }] });
}

function onKey(e) {
  if (!access.getRole()) return;
  const typing = /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); return doUndo(); }
  if (typing || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]')) return;
  if (e.key === '?') return showHelp();
  const n = Number(e.key);
  if (n >= 1 && n <= ROUTES.length) { location.hash = `#/${ROUTES[n - 1].id}`; return; }
  if (current?.id !== 'today') return;
  const c = store.cls();
  if (e.key === '[' || e.key === ']') { store.ui.date = stepSchoolDay(store.settings(), c, store.ui.date, e.key === ']' ? 1 : -1); sfx.play('page'); today.update(); }
  else if (e.key.toLowerCase() === 't' && !e.target.closest('.scard')) { store.ui.date = todayIso(); sfx.play('page'); today.update(); }
  else if (e.key === '/') { e.preventDefault(); document.querySelector('#tdSearch')?.focus(); }
}

boot().catch((err) => {
  console.error(err);
  loader.hide(true);
  document.body.insertAdjacentHTML('beforeend', `<div style="padding:2rem;font-family:sans-serif;color:#b00">Tallybook could not start: ${esc(err.message)}</div>`);
});
