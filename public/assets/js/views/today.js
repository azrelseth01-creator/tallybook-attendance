// Today: the page a teacher lives on. Mark each student, see the tally grow.
import * as store from '../core/store.js';
import * as access from '../core/access.js';
import { fmt, iso, today as todayIso, weekday } from '../core/dates.js';
import { STATUS, STATUS_KEYS, activeStudents, dayStats, isNoClass, isSchoolDay, stepSchoolDay, studentStats } from '../core/stats.js';
import { esc, pct, plural, debounce } from '../core/utils.js';
import { avatar } from '../ui/avatar.js';
import { icon } from '../ui/icons.js';
import { tally } from '../ui/tally.js';
import { toast } from '../ui/toast.js';
import { confirmBox, promptBox } from '../ui/modal.js';
import { openProfile } from '../ui/profile.js';
import { feedbackFor, celebrate } from '../ui/feedback.js';
import { startRollCall } from './rollcall.js';
import * as sfx from '../services/audio.js';

const FILTERS = [['all', 'Everyone'], ['unmarked', 'Not marked'], ['P', 'Present'], ['A', 'Absent'], ['L', 'Late'], ['E', 'Excused']];
const { ui } = store;
let root = null;
let query = '';
let editSeats = false;
let off = [];

const el = (id) => root.querySelector(id);

export const today = {
  mount(r) {
    root = r;
    query = '';
    root.innerHTML = `
      <header class="doc-head">
        <div><h1>Attendance</h1><p class="hand" id="tdSub"></p></div>
        <div class="date-nav" role="group" aria-label="Choose the day">
          <button class="icon-btn" data-act="prev" aria-label="Previous school day">${icon('left', 20)}</button>
          <button class="date-btn" data-act="pick" id="tdDate" aria-label="Pick a date"></button>
          <input type="date" id="tdPicker" tabindex="-1" aria-hidden="true">
          <button class="icon-btn" data-act="next" aria-label="Next school day">${icon('right', 20)}</button>
          <button class="btn ghost" data-act="today">Today</button>
        </div>
      </header>
      <div id="tdBanner"></div>
      <section class="ledger" id="tdLedger" aria-label="Today's totals"></section>
      <div id="tdDiary"></div>
      <section class="tools" aria-label="Attendance tools">
        <div class="tools-row">
          <label class="search">${icon('search', 16)}<input id="tdSearch" type="search" placeholder="Find a student" aria-label="Find a student" autocomplete="off"></label>
          <div class="chips" id="tdFilters" role="group" aria-label="Filter students"></div>
        </div>
        <div class="tools-row">
          <div class="seg-switch" role="group" aria-label="Layout">
            <button data-mode="cards" title="Cards">${icon('grid', 16)}<span>Cards</span></button>
            <button data-mode="list" title="List">${icon('list', 16)}<span>List</span></button>
            <button data-mode="seats" title="Seating chart">${icon('seats', 16)}<span>Seats</span></button>
          </div>
          <div class="tools-acts">
            <button class="btn primary admin-only" data-act="rollcall">${icon('mic', 16)} Start roll call</button>
            <button class="btn admin-only" data-act="restpresent">${icon('check', 16)} Mark the rest present</button>
            <details class="more-wrap more-actions admin-only">
              <summary class="icon-btn" aria-label="More attendance actions" title="More attendance actions">${icon('more', 18)}</summary>
              <div class="more-menu" aria-label="More attendance actions">
                <button class="more-item admin-only" data-act="note" type="button">${icon('note', 16)} Day note</button>
                <button class="more-item admin-only" data-act="noclass" type="button">${icon('calendar', 16)} <span id="tdNoClassLbl">No class today</span></button>
                <button class="more-item admin-only" data-act="clear" type="button">${icon('trash', 16)} Clear day</button>
              </div>
            </details>
          </div>
        </div>
      </section>
      <section id="tdBody" class="roll"></section>`;

    root.addEventListener('click', onClick);
    root.addEventListener('keydown', onKey);
    el('#tdSearch').addEventListener('input', debounce((e) => { query = e.target.value.trim().toLowerCase(); paintBody(); }, 90));
    el('#tdPicker').addEventListener('change', (e) => { if (e.target.value) { ui.date = e.target.value; paint(); } });
    // seats drag and drop
    root.addEventListener('dragstart', (e) => { const s = e.target.closest('.seat[draggable="true"]'); if (s) { e.dataTransfer.setData('text/plain', s.dataset.id); e.dataTransfer.effectAllowed = 'move'; s.classList.add('drag'); } });
    root.addEventListener('dragend', (e) => e.target.closest?.('.seat')?.classList.remove('drag'));
    root.addEventListener('dragover', (e) => { const c = e.target.closest('.seat-cell'); if (c && editSeats) { e.preventDefault(); c.classList.add('over'); } });
    root.addEventListener('dragleave', (e) => e.target.closest?.('.seat-cell')?.classList.remove('over'));
    root.addEventListener('drop', (e) => {
      const c = e.target.closest('.seat-cell');
      if (!c || !editSeats) return;
      e.preventDefault();
      store.moveSeat(e.dataTransfer.getData('text/plain'), Number(c.dataset.seat));
      sfx.play('pop');
    });
    paint();
  },
  update(evt) {
    if (!root) return;
    if (evt?.type === 'settings' && !/schoolDays|weekStart|alertAbsences|lateToAbsent|excusedCounts/.test(evt.path || '')) return;
    paint();
  },
  unmount() { off.forEach((f) => f()); off = []; root = null; },
};

/* ---------- painting ---------- */
function paint() {
  if (!root) return;
  const active = document.activeElement;
  const memo = active?.closest?.('.scard') ? { id: active.closest('.scard').dataset.id, s: active.dataset.s, act: active.dataset.act, card: active.classList.contains('scard') } : null;
  paintHead();
  paintBanner();
  paintLedger();
  paintDiary();
  paintTools();
  paintBody();
  if (memo) {
    const card = root.querySelector(`.scard[data-id="${memo.id}"]`);
    const target = memo.card ? card : card?.querySelector(memo.s ? `[data-s="${memo.s}"]` : `[data-act="${memo.act}"]`);
    (target || card)?.focus({ preventScroll: true });
  }
}

function paintHead() {
  const d = ui.date;
  el('#tdSub').textContent = d === todayIso() ? `Today, ${fmt.long(d)}` : fmt.long(d);
  el('#tdDate').innerHTML = `<b>${esc(fmt.weekday(d))}</b> ${esc(fmt.short(d))}`;
  el('#tdPicker').value = d;
}

function dayState() {
  const c = store.cls();
  const set = store.settings();
  if (isNoClass(c, ui.date)) return { closed: true, kind: 'noclass', reason: c.noClass[ui.date] };
  if (!set.schoolDays.includes(weekday(ui.date)) && !ui.override.has(ui.date)) return { closed: true, kind: 'weekend' };
  return { closed: false };
}

function paintBanner() {
  const st = dayState();
  const b = el('#tdBanner');
  if (!st.closed) { b.innerHTML = ''; return; }
  b.innerHTML = st.kind === 'noclass'
    ? `<div class="callout info">${icon('calendar', 18)}<div><strong>No class: ${esc(st.reason)}.</strong> Attendance is paused for this day.</div><button class="btn ghost admin-only" data-act="noclass">Reopen this day</button></div>`
    : `<div class="callout info">${icon('calendar', 18)}<div><strong>${esc(fmt.weekday(ui.date))} is not a school day</strong> in your settings.</div><button class="btn ghost" data-act="anyway">Take attendance anyway</button></div>`;
}

function paintLedger() {
  const c = store.cls();
  const s = dayStats(c, ui.date, store.settings());
  const parts = [['P', s.P], ['A', s.A], ['L', s.L], ['E', s.E], ['U', s.unmarked]];
  const names = { P: 'Present', A: 'Absent', L: 'Late', E: 'Excused', U: 'Not marked' };
  el('#tdLedger').innerHTML = `
    <div class="ledger-bar" role="img" aria-label="${parts.map(([k, n]) => `${n} ${names[k]}`).join(', ')}">
      ${s.total ? parts.map(([k, n]) => (n ? `<i class="lb-${k}" style="flex:${n}"></i>` : '')).join('') : '<i class="lb-U" style="flex:1"></i>'}
    </div>
    <ul class="ledger-nums">
      ${parts.map(([k, n]) => `<li class="n-${k}"><b>${n}</b><span>${names[k]}</span></li>`).join('')}
      <li class="n-rate"><b>${pct(s.rate)}</b><span>Attendance today</span></li>
    </ul>`;
}

function paintDiary() {
  const note = store.cls().dayNotes[ui.date];
  el('#tdDiary').innerHTML = note ? `<aside class="sticky" aria-label="Note for this day"><p class="hand">${esc(note)}</p><button class="icon-btn admin-only" data-act="note" aria-label="Edit note">${icon('edit', 15)}</button></aside>` : '';
}

function paintTools() {
  const c = store.cls();
  const day = c.records[ui.date] || {};
  const list = activeStudents(c);
  const count = (f) => f === 'all' ? list.length : f === 'unmarked' ? list.filter((s) => !day[s.id]?.s).length : list.filter((s) => day[s.id]?.s === f).length;
  el('#tdFilters').innerHTML = FILTERS.map(([k, label]) => `<button class="chip ${k.length === 1 ? 'st-' + k : ''}" data-filter="${k}" aria-pressed="${ui.filter === k}">${label} <b>${count(k)}</b></button>`).join('');
  root.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === ui.mode)));
  el('#tdNoClassLbl').textContent = isNoClass(c, ui.date) ? 'Reopen day' : 'No class today';
}

function matches(s, day) {
  if (query && !s.name.toLowerCase().includes(query)) return false;
  const k = day[s.id]?.s;
  if (ui.filter === 'all') return true;
  if (ui.filter === 'unmarked') return !k;
  return k === ui.filter;
}

function paintBody() {
  const c = store.cls();
  const set = store.settings();
  const body = el('#tdBody');
  const students = activeStudents(c);
  body.className = `roll mode-${ui.mode}`;

  if (!students.length) {
    body.innerHTML = `<div class="empty">
      <div class="empty-art" aria-hidden="true">${icon('roster', 44)}</div>
      <h2>Your roster is empty</h2>
      <p>Add your students one by one, or paste the whole class list at once. Each student gets an icon and a running count of their absences.</p>
      <div class="empty-acts"><a class="btn primary admin-only" href="#/roster">${icon('plus', 16)} Add students</a><button class="btn admin-only" data-act="sample">Try it with a sample class</button></div></div>`;
    return;
  }
  if (dayState().closed) { body.innerHTML = ''; return; }

  const day = c.records[ui.date] || {};
  const stats = new Map(students.map((s) => [s.id, studentStats(c, s.id, set)]));
  const just = ui.lastMark && Date.now() - ui.lastMark.at < 900 ? new Set(ui.lastMark.ids) : new Set();

  if (ui.mode === 'seats') { paintSeats(body, c, students, day, stats, just); return; }

  const shown = students.map((s, i) => ({ s, i })).filter(({ s }) => matches(s, day));
  if (!shown.length) { body.innerHTML = `<div class="empty small"><p>${query ? `No student matches “${esc(query)}”.` : 'No students in this group right now.'}</p></div>`; return; }
  body.innerHTML = shown.map(({ s, i }) => card(s, i, day[s.id], stats.get(s.id), just.has(s.id), set)).join('');
}

function card(s, i, rec, stat, fresh, set) {
  const k = rec?.s;
  return `<article class="scard ${k ? 'st-' + k : ''} ${stat.flag ? 'flag' : ''} ${fresh ? 'fresh' : ''}" data-id="${s.id}" tabindex="0" style="--tint:${s.color}"
      aria-label="${esc(s.name)}, ${k ? STATUS[k].label : 'not marked'}, ${plural(stat.A, 'absence')}">
    <button class="scard-who" data-act="open" aria-label="Open ${esc(s.name)}'s profile">${avatar(s, 46)}<span class="nm"><b>${esc(s.name)}</b><small>No. ${i + 1}</small></span></button>
    <div class="scard-count">
      <span class="tally-box" title="${plural(stat.A, 'absence')}">${tally(stat.A) || '<span class="tally-zero">&mdash;</span>'}</span>
      <span class="cnt"><b>${stat.A}</b> absent${stat.L ? ` &middot; ${stat.L} late` : ''}</span>
      ${stat.flag ? `<span class="flagpill">${icon('alert', 13)} at limit</span>` : stat.watch ? '<span class="flagpill soft">near limit</span>' : ''}
    </div>
    <div class="seg" role="group" aria-label="Mark ${esc(s.name)}">
      ${STATUS_KEYS.map((q) => `<button type="button" class="seg-b b-${q}" data-s="${q}" aria-pressed="${k === q}"><kbd>${q}</kbd>${STATUS[q].label}</button>`).join('')}
    </div>
    <button class="note-btn ${rec?.n ? 'has' : ''}" data-act="rnote" ${k ? '' : 'disabled'} aria-label="${rec?.n ? 'Edit' : 'Add'} a note for ${esc(s.name)}" title="${rec?.n ? esc(rec.n) : k ? 'Add a reason or note' : 'Mark first, then add a note'}">${icon('note', 15)}</button>
    ${rec?.n ? `<p class="scard-note hand">${esc(rec.n)}</p>` : ''}
    ${k ? `<div class="stamp stamp-${k}" aria-hidden="true"><span>${STATUS[k].label}</span></div>` : ''}
  </article>`;
}

function paintSeats(body, c, students, day, stats, just) {
  store.ensureSeats();
  const cols = c.seatCols || 6;
  const max = Math.max(...students.map((s) => s.seat ?? 0), 0);
  const total = Math.ceil((max + 1) / cols) * cols + (editSeats ? cols : 0);
  const bySeat = new Map(students.map((s) => [s.seat, s]));
  let cells = '';
  for (let n = 0; n < total; n++) {
    const s = bySeat.get(n);
    if (!s) { cells += `<div class="seat-cell empty" data-seat="${n}">${editSeats ? '<span>Empty</span>' : ''}</div>`; continue; }
    const k = day[s.id]?.s;
    const stat = stats.get(s.id);
    cells += `<div class="seat-cell" data-seat="${n}"><div class="seat ${k ? 'st-' + k : ''} ${just.has(s.id) ? 'fresh' : ''} ${stat.flag ? 'flag' : ''}" data-id="${s.id}" ${editSeats ? 'draggable="true"' : ''} role="button" tabindex="0" style="--tint:${s.color}"
        aria-label="${esc(s.name)}, ${k ? STATUS[k].label : 'not marked'}">
      ${avatar(s, 40)}<b>${esc(s.name.split(' ')[0])}</b>
      <small>${k ? STATUS[k].label : access.canEdit() ? 'Tap to mark' : 'Not marked'}</small>
      ${stat.A ? `<span class="seat-n" title="${plural(stat.A, 'absence')}">${stat.A}</span>` : ''}
      <button class="seat-i" data-act="open" aria-label="Open ${esc(s.name)}'s profile">${icon('help', 13)}</button>
    </div></div>`;
  }
  body.innerHTML = `
    <div class="seat-tools">
      <div class="brush" role="radiogroup" aria-label="Mark with">
        <span>Tap a seat to mark it</span>
        ${STATUS_KEYS.map((k) => `<button class="chip st-${k}" data-brush="${k}" role="radio" aria-checked="${ui.brush === k}" aria-pressed="${ui.brush === k}">${STATUS[k].label}</button>`).join('')}
      </div>
      <div class="seat-opts">
        <label class="stepper">Columns <button data-cols="-1" aria-label="Fewer columns">${icon('minus', 14)}</button><b>${cols}</b><button data-cols="1" aria-label="More columns">${icon('plus', 14)}</button></label>
        <button class="btn ${editSeats ? 'primary' : ''}" data-act="editseats" aria-pressed="${editSeats}">${editSeats ? 'Done rearranging' : 'Rearrange seats'}</button>
      </div>
    </div>
    <div class="board">Front of the room</div>
    <div class="seatgrid ${editSeats ? 'editing' : ''}" style="--cols:${cols}">${cells}</div>`;
}

/* ---------- actions ---------- */
function setMark(sid, k, source) {
  if (!access.guard()) return; // view only: no stamp, no sound, no change
  const date = ui.date;
  const c = store.cls();
  const before = dayStats(c, date);
  const now = c.records[date]?.[sid]?.s;
  const status = now === k ? null : k;
  const stu = c.students.find((s) => s.id === sid);
  feedbackFor(status, source?.closest('.scard, .seat') || source);
  store.mark([{ date, sid, s: status }], `${stu?.name || 'Student'}: ${status ? STATUS[status].label : 'cleared'}`);
  const after = dayStats(store.cls(), date);
  if (before.unmarked > 0 && after.unmarked === 0 && after.P === after.total && after.total > 2) {
    setTimeout(() => celebrate(root.querySelector('.ledger')), 250);
    toast('Everyone is here today.');
  }
}

async function onClick(e) {
  root.querySelectorAll('.more-actions[open]').forEach((menu) => { if (!menu.contains(e.target)) menu.open = false; });
  const c = store.cls();
  const date = ui.date;
  const seg = e.target.closest('.seg-b');
  if (seg) return setMark(seg.closest('.scard').dataset.id, seg.dataset.s, seg);

  const seat = e.target.closest('.seat');
  if (seat && !e.target.closest('.seat-i') && !editSeats) return setMark(seat.dataset.id, ui.brush, seat);

  const f = e.target.closest('[data-filter]');
  if (f) { ui.filter = f.dataset.filter; sfx.play('tap'); return paint(); }
  const m = e.target.closest('[data-mode]');
  if (m) { ui.mode = m.dataset.mode; sfx.play('tab'); return paint(); }
  const br = e.target.closest('[data-brush]');
  if (br) { ui.brush = br.dataset.brush; sfx.play('tap'); return paintBody(); }
  const cols = e.target.closest('[data-cols]');
  if (cols && !access.guard()) return;
  if (cols) { store.updateClass({ seatCols: Math.min(12, Math.max(2, (c.seatCols || 6) + Number(cols.dataset.cols))) }); return; }

  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!act) return;
  e.target.closest('.more-actions')?.removeAttribute('open');
  const sid = e.target.closest('[data-id]')?.dataset.id;
  const set = store.settings();

  const WRITES = ['sample', 'editseats', 'rollcall', 'restpresent', 'clear', 'note', 'noclass', 'rnote'];
  if (WRITES.includes(act) && !access.guard()) return;
  if (act === 'open') return openProfile(sid);
  if (act === 'prev' || act === 'next') { ui.date = stepSchoolDay(set, c, ui.date, act === 'next' ? 1 : -1); sfx.play('page'); return paint(); }
  if (act === 'today') { ui.date = todayIso(); sfx.play('page'); return paint(); }
  if (act === 'pick') { const p = el('#tdPicker'); try { p.showPicker(); } catch { p.focus(); p.click(); } return; }
  if (act === 'anyway') { ui.override.add(date); return paint(); }
  if (act === 'sample') { store.addSampleClass(); toast('Sample class added. Your own classes are untouched.'); return; }
  if (act === 'editseats') { editSeats = !editSeats; return paintBody(); }
  if (act === 'rollcall') return startRollCall(date);

  if (act === 'restpresent') {
    const day = c.records[date] || {};
    const open = activeStudents(c).filter((s) => !day[s.id]?.s);
    if (!open.length) return toast('Every student is already marked.');
    store.mark(open.map((s) => ({ date, sid: s.id, s: 'P' })), 'Mark the rest present');
    sfx.play('success');
    toast(`${plural(open.length, 'student')} marked present.`, { action: { label: 'Undo', run: undoNow } });
    return;
  }
  if (act === 'clear') {
    const day = c.records[date] || {};
    const marked = activeStudents(c).filter((s) => day[s.id]?.s);
    if (!marked.length) return toast('Nothing to clear on this day.');
    const ok = await confirmBox({ title: 'Clear this day?', message: `All ${marked.length} marks for ${fmt.long(date)} will be removed. You can undo it right after.`, confirmLabel: 'Clear day', danger: true });
    if (!ok) return;
    store.mark(marked.map((s) => ({ date, sid: s.id, s: null })), 'Clear day');
    sfx.play('clear');
    toast('Day cleared.', { action: { label: 'Undo', run: undoNow } });
    return;
  }
  if (act === 'note') {
    const v = await promptBox({ title: `Note for ${fmt.mid(date)}`, label: 'Anything worth remembering about this day (assembly, field trip, substitute teacher)', value: c.dayNotes[date] || '', multiline: true });
    if (v !== null) store.setDayNote(date, v);
    return;
  }
  if (act === 'noclass') {
    if (isNoClass(c, date)) { store.setNoClass(date, null); sfx.play('pop'); return; }
    const v = await promptBox({ title: 'Mark this day as no class', label: 'Reason', value: '', placeholder: 'Holiday, teacher training, typhoon day', confirmLabel: 'Mark no class' });
    if (v !== null) { store.setNoClass(date, v || 'No class'); sfx.play('page'); }
    return;
  }
  if (act === 'rnote') {
    const rec = c.records[date]?.[sid];
    if (!rec) return;
    const stu = c.students.find((s) => s.id === sid);
    const v = await promptBox({ title: `Note for ${stu.name}`, label: `Reason or remark (${STATUS[rec.s].label.toLowerCase()} on ${fmt.short(date)})`, value: rec.n || '', placeholder: 'Fever, doctor visit, bus was late', multiline: false });
    if (v !== null) store.setNote(date, sid, v);
  }
}

function undoNow() {
  const label = store.undo();
  if (label) { sfx.play('clear'); toast(`Undone: ${label}.`); }
}

function onKey(e) {
  if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
  const cardEl = e.target.closest('.scard, .seat');
  if (!cardEl) return;
  const k = e.key.toUpperCase();
  const id = cardEl.dataset.id;
  if (STATUS_KEYS.includes(k) && e.target === cardEl) {
    e.preventDefault();
    setMark(id, k, cardEl);
    requestAnimationFrame(() => {
      const next = root.querySelector(`[data-id="${id}"]`)?.nextElementSibling || root.querySelector(`[data-id="${id}"]`);
      (next?.matches?.('.scard') ? next : root.querySelector(`.scard[data-id="${id}"]`))?.focus();
    });
  } else if ((e.key === 'Backspace' || e.key === 'Delete') && e.target === cardEl) {
    e.preventDefault();
    const now = store.cls().records[ui.date]?.[id]?.s;
    if (now) setMark(id, now, cardEl);
  } else if (['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(e.key) && e.target === cardEl && cardEl.classList.contains('scard')) {
    e.preventDefault();
    const cards = [...root.querySelectorAll('.scard')];
    const idx = cards.indexOf(cardEl);
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
    cards[Math.min(cards.length - 1, Math.max(0, idx + step))]?.focus();
  } else if ((e.key === 'Enter' || e.key === ' ') && cardEl.classList.contains('seat') && e.target === cardEl && !editSeats) {
    e.preventDefault();
    setMark(id, ui.brush, cardEl);
  }
}
