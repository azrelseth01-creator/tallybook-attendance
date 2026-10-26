// Calendar: see every school day at a glance, tap a day to look closer.
import * as store from '../core/store.js';
import * as access from '../core/access.js';
import { fmt, iso, monthGrid, monthKey, parse, today as todayIso, weekday, weekdayNames } from '../core/dates.js';
import { STATUS, activeStudents, dayStats, isNoClass } from '../core/stats.js';
import { esc, pct, plural } from '../core/utils.js';
import { avatar } from '../ui/avatar.js';
import { icon } from '../ui/icons.js';
import { openDialog, promptBox } from '../ui/modal.js';
import { openProfile } from '../ui/profile.js';
import * as sfx from '../services/audio.js';

let root = null;
let view = { y: new Date().getFullYear(), m: new Date().getMonth() };
let selected = null;

export const calendar = {
  mount(r) {
    root = r;
    const d = parse(store.ui.date);
    view = { y: d.getFullYear(), m: d.getMonth() };
    selected = store.ui.date;
    root.innerHTML = `
      <header class="doc-head">
        <div><h1>Calendar</h1><p class="hand" id="clSub"></p></div>
        <div class="date-nav">
          <button class="icon-btn" data-act="prev" aria-label="Previous month">${icon('left', 20)}</button>
          <span class="month-label" id="clMonth" aria-live="polite"></span>
          <button class="icon-btn" data-act="next" aria-label="Next month">${icon('right', 20)}</button>
          <button class="btn ghost" data-act="now">This month</button>
          <button class="btn admin-only" data-act="break">${icon('plus', 16)} Add a break</button>
        </div>
      </header>
      <div class="cal-layout">
        <section aria-label="Month"><div class="cal" id="clGrid"></div>
          <ul class="legend wide"><li><i class="dot lb-P"></i>Most present</li><li><i class="dot lb-A"></i>Absences</li><li><i class="dot lb-L"></i>Late</li><li><i class="dot lb-E"></i>Excused</li><li><i class="sw hatch"></i>No class</li></ul></section>
        <aside class="daypanel" id="clPanel" aria-live="polite"></aside>
      </div>`;
    root.addEventListener('click', onClick);
    paint();
  },
  update() { if (root) paint(); },
  unmount() { root = null; },
};

function paint() {
  const c = store.cls();
  const set = store.settings();
  const todayStr = todayIso();
  const key = `${view.y}-${String(view.m + 1).padStart(2, '0')}`;
  root.querySelector('#clMonth').textContent = fmt.month(key);
  root.querySelector('#clSub').textContent = c.name;
  const names = weekdayNames(set.weekStart, 'short');
  const cells = monthGrid(view.y, view.m, set.weekStart).map((d) => {
    const inMonth = monthKey(d) === key;
    const school = set.schoolDays.includes(weekday(d));
    const off = isNoClass(c, d);
    const s = dayStats(c, d, set);
    const has = s.marked > 0;
    const cls = ['day', inMonth ? '' : 'out', d === todayStr ? 'today' : '', d === selected ? 'sel' : '', off ? 'off' : '', !school ? 'weekend' : '', has ? 'has' : ''].join(' ');
    const bar = has ? `<span class="mini">${['P', 'L', 'E', 'A'].map((k) => (s[k] ? `<i class="lb-${k}" style="flex:${s[k]}"></i>` : '')).join('')}</span>` : '';
    return `<button class="${cls}" data-date="${d}" aria-label="${fmt.long(d)}${off ? ', no class: ' + esc(c.noClass[d]) : ''}${has ? `, ${s.A} absent, ${pct(s.rate)} attendance` : ''}" ${inMonth ? '' : 'tabindex="-1"'}>
      <span class="dn">${parse(d).getDate()}</span>
      ${off ? `<span class="off-note">${esc(c.noClass[d])}</span>` : has ? `<span class="rate">${pct(s.rate)}</span>${s.A ? `<span class="abs">${s.A} absent</span>` : '<span class="abs ok">All here</span>'}${bar}` : ''}
    </button>`;
  });
  root.querySelector('#clGrid').innerHTML = `<div class="cal-head">${names.map((n) => `<span>${n}</span>`).join('')}</div><div class="cal-body">${cells.join('')}</div>`;
  paintPanel();
}

function paintPanel() {
  const c = store.cls();
  const set = store.settings();
  const d = selected;
  const box = root.querySelector('#clPanel');
  if (!d) { box.innerHTML = '<p class="muted">Choose a day to see who was away.</p>'; return; }
  const day = c.records[d] || {};
  const s = dayStats(c, d, set);
  const group = (k) => activeStudents(c).filter((st) => day[st.id]?.s === k);
  const off = isNoClass(c, d);
  const listFor = (k) => group(k).map((st) => `<li><button class="who" data-open="${st.id}">${avatar(st, 30)}<span>${esc(st.name)}</span></button>${day[st.id].n ? `<em class="hand">${esc(day[st.id].n)}</em>` : ''}</li>`).join('');
  box.innerHTML = `
    <h2>${fmt.long(d)}</h2>
    ${off ? `<div class="callout info">${icon('calendar', 18)}<div><strong>No class:</strong> ${esc(c.noClass[d])}</div></div>` : ''}
    ${s.marked ? `<p class="panel-rate"><b>${pct(s.rate)}</b> attendance &middot; ${s.P} present, ${s.A} absent, ${s.L} late, ${s.E} excused${s.unmarked ? `, ${s.unmarked} not marked` : ''}</p>` :
      off ? '' : '<p class="muted">Nothing recorded for this day.</p>'}
    ${['A', 'L', 'E'].map((k) => (group(k).length ? `<h3><i class="dot st-${k}"></i>${STATUS[k].label} (${group(k).length})</h3><ul class="plist">${listFor(k)}</ul>` : '')).join('')}
    ${c.dayNotes[d] ? `<aside class="sticky"><p class="hand">${esc(c.dayNotes[d])}</p></aside>` : ''}
    <div class="panel-acts">
      <button class="btn primary" data-act="openday">${icon('today', 16)} ${access.canEdit() ? 'Take attendance for this day' : 'View this day'}</button>
      <button class="btn ghost admin-only" data-act="toggleoff">${off ? 'Reopen this day' : 'Mark as no class'}</button>
    </div>`;
}

async function onClick(e) {
  const c = store.cls();
  const day = e.target.closest('.day');
  if (day) { selected = day.dataset.date; const d = parse(selected); if (d.getMonth() !== view.m) view = { y: d.getFullYear(), m: d.getMonth() }; sfx.play('tap'); return paint(); }
  const open = e.target.closest('[data-open]');
  if (open) return openProfile(open.dataset.open);
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'prev' || act === 'next') {
    const d = new Date(view.y, view.m + (act === 'next' ? 1 : -1), 1);
    view = { y: d.getFullYear(), m: d.getMonth() };
    sfx.play('page');
    return paint();
  }
  if (act === 'now') { const d = new Date(); view = { y: d.getFullYear(), m: d.getMonth() }; selected = todayIso(); return paint(); }
  if (act === 'openday') { store.ui.date = selected; location.hash = '#/today'; return; }
  if ((act === 'toggleoff' || act === 'break') && !access.guard()) return;
  if (act === 'toggleoff') {
    if (isNoClass(c, selected)) { store.setNoClass(selected, null); sfx.play('pop'); return; }
    const v = await promptBox({ title: 'Mark as no class', label: 'Reason', placeholder: 'Holiday, teacher training, typhoon day', confirmLabel: 'Mark no class' });
    if (v !== null) { store.setNoClass(selected, v || 'No class'); sfx.play('page'); }
    return;
  }
  if (act === 'break') {
    const base = selected || todayIso();
    const r = await openDialog({
      title: 'Add a break or holiday',
      body: `<p class="muted">School days in this range become no-class days. Weekends are skipped automatically.</p>
        <div class="field-row"><label class="field"><span>First day</span><input type="date" id="brFrom" value="${base}"></label>
        <label class="field"><span>Last day</span><input type="date" id="brTo" value="${base}"></label></div>
        <label class="field"><span>What is it?</span><input type="text" id="brWhy" maxlength="60" placeholder="Mid-term break"></label>`,
      actions: [
        { label: 'Cancel', value: null, kind: 'ghost' },
        { label: 'Add break', kind: 'primary', run: (dlg) => {
          const from = dlg.querySelector('#brFrom').value; const to = dlg.querySelector('#brTo').value;
          if (!from || !to || to < from) return false;
          return { from, to, why: dlg.querySelector('#brWhy').value.trim() || 'Break' };
        } },
      ],
    });
    if (r) { store.setNoClassRange(r.from, r.to, r.why, store.settings().schoolDays); sfx.play('page'); }
  }
}
