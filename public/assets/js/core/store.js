// The one source of truth. Everything is saved to localStorage; optional cloud sync
// (services/sync.js) mirrors the same JSON.
import { config } from './config.js';
import * as access from './access.js';
import { today } from './dates.js';
import { sampleClass } from './sample.js';
import { bus, get as getPath, set as setPath, uid } from './utils.js';
import { byName, activeStudents } from './stats.js';
import { ICONS, COLORS } from '../ui/avatar.js';

export const BOOK_COLORS = ['#233584', '#7a2a45', '#14596b', '#2f6b3f', '#5b3a8c', '#b45f12', '#3b6fd6', '#8a3b3b'];
export const GROUP_COLORS = ['#ffd84a', '#ff8fa3', '#7bdff2', '#b2f7a0', '#c8a2ff', '#ffb347'];

const KEY = 'tallybook:v1';
const VERSION = 1;

/** Session-only view state (not saved). */
export const ui = {
  date: today(),
  filter: 'all',
  mode: 'cards', // cards | list | seats
  brush: 'P',
  override: new Set(), // non-school days the teacher chose to open anyway
  lastMark: null,
  savedAt: null,
};

let state = null;
let undoStack = [];
let saveTimer = null;

export const getState = () => state;
export const settings = () => state.settings;
export const cls = () => state.classes.find((c) => c.id === state.currentClassId) || state.classes[0];

export function defaultSettings() {
  return {
    schoolName: config.schoolName,
    teacherName: config.teacherName,
    teacherPhoto: '',
    academicYear: config.academicYear,
    term: config.term,
    alertAbsences: config.alertAbsences,
    lateToAbsent: config.lateToAbsent,
    excusedCounts: false,
    schoolDays: [1, 2, 3, 4, 5],
    weekStart: 0,
    desk: 'navy',
    paper: 'ruled',
    density: 'comfy',
    textScale: 100,
    sound: { on: true, volume: 60, speakNames: false },
    vfx: { on: true, confetti: true, stamp: true },
    music: {
      on: false,
      queue: [],
      index: 0, volume: 50, loop: 'all', shuffle: false, autoplay: false, dockOpen: false,
    },
  };
}

export function newClass(name = 'My class') {
  return {
    id: uid('c'), name, subject: '', room: '', seatCols: 6, students: [], records: {}, noClass: {}, dayNotes: {},
    // library: where the class sits and how it looks
    groupId: null, color: BOOK_COLORS[(state?.classes?.length || 0) % BOOK_COLORS.length],
    favorite: false, archived: false, lastOpened: 0, lock: null,
  };
}

function seed() {
  const c = newClass(config.className || 'My class');
  return {
    v: VERSION,
    meta: { createdAt: Date.now(), updatedAt: Date.now(), pristine: true },
    settings: defaultSettings(),
    groups: [],
    classes: [c],
    currentClassId: c.id,
  };
}

function merge(base, over) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return over ?? base;
  const out = { ...base };
  for (const k of Object.keys(over || {})) {
    out[k] = k in base && typeof base[k] === 'object' && !Array.isArray(base[k]) && base[k] !== null
      ? merge(base[k], over[k]) : over[k];
  }
  return out;
}

function normalize(raw) {
  const base = seed();
  const s = {
    v: VERSION,
    meta: { ...base.meta, ...(raw.meta || {}) },
    settings: merge(base.settings, raw.settings || {}),
    groups: (Array.isArray(raw.groups) ? raw.groups : []).filter((g) => g && g.id && g.name),
    classes: Array.isArray(raw.classes) && raw.classes.length ? raw.classes : base.classes,
    currentClassId: raw.currentClassId,
  };
  s.classes = s.classes.map((c, i) => ({
    ...newClass(c.name), ...c,
    color: c.color || BOOK_COLORS[i % BOOK_COLORS.length],
    groupId: s.groups.some((g) => g.id === c.groupId) ? c.groupId : null,
    lock: c.lock && c.lock.hash && c.lock.salt ? c.lock : null,
    students: (c.students || []).map((st) => ({ active: true, icon: ICONS[0], color: COLORS[0], ...st })),
    records: c.records || {}, noClass: c.noClass || {}, dayNotes: c.dayNotes || {},
  }));
  if (!s.classes.some((c) => c.id === s.currentClassId)) s.currentClassId = s.classes[0].id;
  return s;
}

export function init(defaultQueue = []) {
  let loaded = null;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) loaded = JSON.parse(raw);
  } catch { /* corrupted: start fresh */ }
  state = loaded ? normalize(loaded) : seed();
  if (!loaded) state.settings.music.queue = defaultQueue;
  return state;
}

/* ---------- saving ---------- */
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeNow, 250);
}
export function writeNow() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    ui.savedAt = Date.now();
    bus.emit('saved', ui.savedAt);
  } catch (err) {
    bus.emit('save-error', err);
  }
}
/** Every change to the book starts with this. A view-only sign-in is refused here, whatever a screen does. */
function blocked() {
  if (access.canEdit()) return false;
  access.deny();
  return true;
}
/** Saves and tells the screens, without marking the book as edited (used for things a viewer may do, like switching class). */
function touchView(type, extra = {}) {
  persist();
  bus.emit('change', { type, ...extra });
}
function touch(type, extra = {}) {
  state.meta.updatedAt = Date.now();
  state.meta.pristine = false;
  persist();
  bus.emit('change', { type, ...extra });
}
window.addEventListener('pagehide', () => state && writeNow());

/* ---------- attendance ---------- */
/** entries: [{ date, sid, s, n? }]  where s === null clears the mark. */
export function mark(entries, label = 'Attendance') {
  if (blocked()) return;
  const c = cls();
  const patch = [];
  for (const { date, sid, s, n } of entries) {
    const day = c.records[date] || (c.records[date] = {});
    patch.push({ date, sid, prev: day[sid] ? { ...day[sid] } : null });
    if (s === null) delete day[sid];
    else day[sid] = { s, n: n ?? day[sid]?.n ?? '' };
    if (!Object.keys(day).length) delete c.records[date];
  }
  undoStack.push({ classId: c.id, patch, label });
  if (undoStack.length > 60) undoStack.shift();
  ui.lastMark = { ids: entries.map((e) => e.sid), at: Date.now() };
  touch('mark', { entries });
}

export function setNote(date, sid, n) {
  if (blocked()) return;
  const c = cls();
  const r = c.records[date]?.[sid];
  if (!r) return;
  r.n = n.trim();
  touch('note', { sid, date });
}

export function undo() {
  if (blocked()) return null;
  const last = undoStack.pop();
  if (!last) return null;
  const c = state.classes.find((x) => x.id === last.classId);
  if (!c) return null;
  for (const { date, sid, prev } of last.patch.reverse()) {
    const day = c.records[date] || (c.records[date] = {});
    if (prev) day[sid] = prev; else delete day[sid];
    if (!Object.keys(day).length) delete c.records[date];
  }
  ui.lastMark = null;
  touch('undo');
  return last.label;
}
export const canUndo = () => undoStack.length > 0;

export function setDayNote(date, text) {
  if (blocked()) return;
  const c = cls();
  if (text.trim()) c.dayNotes[date] = text.trim(); else delete c.dayNotes[date];
  touch('daynote', { date });
}
export function setNoClass(date, reason) {
  if (blocked()) return;
  const c = cls();
  if (reason === null) delete c.noClass[date]; else c.noClass[date] = reason || 'No class';
  touch('noclass', { date });
}
export function setNoClassRange(from, to, reason, schoolDays) {
  if (blocked()) return;
  const c = cls();
  let d = from;
  let n = 0;
  while (d <= to && n < 400) {
    if (schoolDays.includes(new Date(d + 'T12:00').getDay())) c.noClass[d] = reason || 'Break';
    const next = new Date(d + 'T12:00'); next.setDate(next.getDate() + 1);
    d = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
    n++;
  }
  touch('noclass');
}

/* ---------- students ---------- */
export function addStudent(data) {
  if (blocked()) return null;
  const c = cls();
  const used = new Set(c.students.map((s) => s.icon));
  const icon = data.icon || ICONS.find((i) => !used.has(i)) || ICONS[c.students.length % ICONS.length];
  const color = data.color || COLORS[c.students.length % COLORS.length];
  const s = { id: uid('s'), name: data.name.trim(), icon, color, seat: null, guardian: '', phone: '', notes: '', active: true, ...data, icon, color };
  c.students.push(s);
  touch('roster');
  return s;
}
export function addStudents(names) {
  if (blocked()) return 0;
  const c = cls();
  const have = new Set(c.students.map((s) => s.name.toLowerCase()));
  let added = 0;
  for (const raw of names) {
    const name = raw.trim().replace(/\s+/g, ' ');
    if (!name || have.has(name.toLowerCase())) continue;
    have.add(name.toLowerCase());
    const i = c.students.length;
    c.students.push({
      id: uid('s'), name, icon: ICONS[(i * 7 + 1) % ICONS.length], color: COLORS[i % COLORS.length],
      seat: null, guardian: '', phone: '', notes: '', active: true,
    });
    added++;
  }
  if (added) touch('roster');
  return added;
}
export function updateStudent(id, patch) {
  if (blocked()) return;
  const s = cls().students.find((x) => x.id === id);
  if (!s) return;
  Object.assign(s, patch);
  touch('roster', { sid: id });
}
export function removeStudent(id) {
  if (blocked()) return null;
  const c = cls();
  const idx = c.students.findIndex((s) => s.id === id);
  if (idx < 0) return null;
  const [student] = c.students.splice(idx, 1);
  const saved = {};
  for (const [date, day] of Object.entries(c.records)) {
    if (day[id]) { saved[date] = day[id]; delete day[id]; if (!Object.keys(day).length) delete c.records[date]; }
  }
  touch('roster');
  return () => {
    c.students.splice(Math.min(idx, c.students.length), 0, student);
    for (const [date, r] of Object.entries(saved)) (c.records[date] ||= {})[id] = r;
    touch('roster');
  };
}
export function reorderStudents(fromId, toId) {
  if (blocked()) return;
  const list = cls().students;
  const from = list.findIndex((s) => s.id === fromId);
  const to = list.findIndex((s) => s.id === toId);
  if (from < 0 || to < 0 || from === to) return;
  list.splice(to, 0, list.splice(from, 1)[0]);
  touch('roster');
}
export function sortStudents() {
  if (blocked()) return;
  cls().students.sort(byName);
  touch('roster');
}

/** Gives every active student a unique seat index. */
export function ensureSeats() {
  const c = cls();
  const taken = new Set();
  let changed = false;
  for (const s of activeStudents(c)) {
    if (Number.isInteger(s.seat) && s.seat >= 0 && !taken.has(s.seat)) taken.add(s.seat);
    else s.seat = null;
  }
  for (const s of activeStudents(c)) {
    if (s.seat === null) {
      let i = 0;
      while (taken.has(i)) i++;
      s.seat = i; taken.add(i); changed = true;
    }
  }
  if (changed && access.canEdit()) touch('seats'); // a viewer sees the layout but nothing is saved
}
export function moveSeat(sid, index) {
  if (blocked()) return;
  const c = cls();
  const s = c.students.find((x) => x.id === sid);
  if (!s) return;
  const other = activeStudents(c).find((x) => x.seat === index && x.id !== sid);
  if (other) other.seat = s.seat;
  s.seat = index;
  touch('seats');
}

/* ---------- classes ---------- */
/** Adds a class. It becomes the open class unless { open: false } (the library adds without opening). */
export function addClass(name, extra = {}, { open = true } = {}) {
  if (blocked()) return null;
  const c = Object.assign(newClass(name || 'New class'), extra);
  state.classes.push(c);
  if (open) { state.currentClassId = c.id; c.lastOpened = Date.now(); }
  touch('class');
  return c;
}
export function addSampleClass() {
  if (blocked()) return null;
  const c = { ...newClass(), ...sampleClass(state.settings), lastOpened: Date.now() };
  state.classes.push(c);
  state.currentClassId = c.id;
  touch('class');
  return c;
}
export function switchClass(id) {
  const target = state.classes.find((c) => c.id === id);
  if (!target) return;
  state.currentClassId = id;
  target.lastOpened = Date.now();
  undoStack = [];
  if (access.canEdit()) touch('class'); else touchView('class');
}
export function updateClass(patch) {
  if (blocked()) return;
  Object.assign(cls(), patch);
  touch('classinfo');
}
/** Change any class (not only the open one): rename, favourite, archive, move to a group, set a lock. */
export function updateClassById(id, patch) {
  if (blocked()) return;
  const c = state.classes.find((x) => x.id === id);
  if (!c) return;
  Object.assign(c, patch);
  touch('classinfo', { id });
}

/* ---------- groups (folders for classes) ---------- */
export const groups = () => state.groups;
export function addGroup(name) {
  if (blocked()) return null;
  const g = { id: uid('g'), name: name.trim().slice(0, 40) || 'New group', color: GROUP_COLORS[state.groups.length % GROUP_COLORS.length] };
  state.groups.push(g);
  touch('class');
  return g;
}
export function updateGroup(id, patch) {
  if (blocked()) return;
  const g = state.groups.find((x) => x.id === id);
  if (!g) return;
  Object.assign(g, patch);
  touch('class');
}
export function removeGroup(id) {
  if (blocked()) return;
  state.groups = state.groups.filter((g) => g.id !== id);
  for (const c of state.classes) if (c.groupId === id) c.groupId = null;
  touch('class');
}
export function removeClass(id) {
  if (blocked()) return false;
  if (state.classes.length < 2) return false;
  state.classes = state.classes.filter((c) => c.id !== id);
  if (state.currentClassId === id) state.currentClassId = (state.classes.find((c) => !c.archived) || state.classes[0]).id;
  undoStack = [];
  touch('class');
  return true;
}

/* ---------- settings ---------- */
export const getSetting = (path) => getPath(state.settings, path);
export function setSetting(path, value) {
  if (!access.canEdit()) {
    // A viewer may change how the app looks and sounds (and play music), but not the class data or rules.
    if (!access.viewerMayChange(path)) { access.deny(); return; }
    setPath(state.settings, path, value);
    touchView('settings', { path });
    return;
  }
  setPath(state.settings, path, value);
  touch('settings', { path });
}

/* ---------- backup ---------- */
export const exportJSON = () => JSON.stringify({ app: 'tallybook', ...state }, null, 2);

export function replaceState(raw, { silent = false } = {}) {
  if (!silent && blocked()) return;
  if (!raw || !Array.isArray(raw.classes)) throw new Error('That file is not a Tallybook backup.');
  state = normalize(raw);
  undoStack = [];
  if (silent) { persist(); bus.emit('change', { type: 'import' }); } else touch('import');
}
export function importJSON(text) {
  if (blocked()) return;
  let raw;
  try { raw = JSON.parse(text); } catch { throw new Error('That file is not valid JSON.'); }
  replaceState(raw);
}
export function resetAll() {
  if (blocked()) return;
  state = seed();
  state.settings.music.queue = [];
  undoStack = [];
  touch('import');
}
export const updatedAt = () => state.meta.updatedAt;
export const isPristine = () => state.meta.pristine;
