// Reports: overview charts, a printable monthly register, a watch list, and exports.
import * as store from '../core/store.js';
import { addDays, fmt, schoolDaysInMonth, today as todayIso, weekdayNames, parse } from '../core/dates.js';
import { STATUS, STATUS_KEYS, activeStudents, classStats, isNoClass, studentStats } from '../core/stats.js';
import { download, esc, pct, plural, slug, toCSV } from '../core/utils.js';
import { avatar } from '../ui/avatar.js';
import { icon } from '../ui/icons.js';
import { tally } from '../ui/tally.js';
import { toast } from '../ui/toast.js';
import { openProfile } from '../ui/profile.js';
import * as sfx from '../services/audio.js';

let root = null;
let tab = 'overview';
let range = 'all';
let month = todayIso().slice(0, 7);

const TABS = [['overview', 'Overview'], ['sheet', 'Monthly register'], ['watch', 'Watch list'], ['export', 'CSV export']];

export const reports = {
  mount(r) {
    root = r;
    root.innerHTML = `
      <header class="doc-head"><div><h1>Reports</h1><p class="hand" id="rpSub"></p></div></header>
      <div class="tabs" role="tablist" aria-label="Report type">${TABS.map(([k, l]) => `<button role="tab" data-tab="${k}" aria-selected="${k === tab}" id="tab-${k}">${l}</button>`).join('')}</div>
      <div id="rpBody" role="tabpanel"></div>`;
    root.addEventListener('click', onClick);
    root.addEventListener('change', (e) => {
      if (e.target.id === 'rpRange') { range = e.target.value; paint(); }
    });
    paint();
  },
  update() { if (root) paint(); },
  unmount() { root = null; },
};

function rangeBounds() {
  const t = todayIso();
  if (range === '30') return { from: addDays(t, -29), to: t };
  if (range === 'month') return { from: t.slice(0, 7) + '-01', to: t.slice(0, 7) + '-31' };
  return {};
}

function paint() {
  const c = store.cls();
  root.querySelector('#rpSub').textContent = `${c.name}${store.settings().term ? ' · ' + store.settings().term : ''}`;
  root.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  const body = root.querySelector('#rpBody');
  body.setAttribute('aria-labelledby', `tab-${tab}`);
  if (!activeStudents(c).length) { body.innerHTML = '<div class="empty"><h2>No data to report on yet</h2><p>Add students and mark a few days. Charts and the monthly register fill in as you go.</p><a class="btn primary" href="#/roster">Go to the roster</a></div>'; return; }
  body.innerHTML = { overview, sheet, watch, exporter }[tab]();
}

/* ---------- overview ---------- */
function overview() {
  const c = store.cls();
  const set = store.settings();
  const st = classStats(c, set, rangeBounds());
  const atLimit = st.per.filter((p) => p.flag).length;
  const days = st.days.slice(-30);
  const maxDay = Math.max(1, ...days.map((d) => d.A + d.L + d.E));
  const top = [...st.per].filter((p) => p.A || p.L).sort((a, b) => b.effective - a.effective || b.A - a.A).slice(0, 10);
  const maxTop = Math.max(1, ...top.map((p) => p.A + p.L));
  const names = weekdayNames(0, 'short');
  const wd = st.byWeekday.map((w, i) => ({ i, rate: w.marked ? w.A / w.marked : null })).filter((w) => w.rate !== null);
  const maxWd = Math.max(0.01, ...wd.map((w) => w.rate));

  if (!st.days.length) return `${rangeSelect()}<div class="empty"><h2>No marks in this range</h2><p>Take attendance on the Today page and this overview will fill in.</p></div>`;
  return `
    ${rangeSelect()}
    <div class="kpis">
      <div class="kpi"><b>${pct(st.rate, 1)}</b><span>Attendance rate</span></div>
      <div class="kpi"><b>${st.days.length}</b><span>${st.days.length === 1 ? 'Day' : 'Days'} recorded</span></div>
      <div class="kpi"><b>${st.totals.A}</b><span>Absences in total</span></div>
      <div class="kpi"><b>${st.perfectDays}</b><span>Days with everyone on time</span></div>
      <div class="kpi ${atLimit ? 'bad' : ''}"><b>${atLimit}</b><span>${atLimit === 1 ? 'Student' : 'Students'} at the absence limit</span></div>
    </div>
    <div class="charts">
      <section class="chart wide"><h2>Who was away, day by day</h2>
        <div class="cols" role="img" aria-label="Daily absences, late and excused for the last ${days.length} recorded days">
          ${days.map((d) => { const tot = d.A + d.L + d.E; return `<div class="col" title="${fmt.mid(d.date)}: ${d.A} absent, ${d.L} late, ${d.E} excused">
            <div class="stack" style="height:${(tot / maxDay) * 100}%">${['A', 'L', 'E'].map((k) => (d[k] ? `<i class="lb-${k}" style="flex:${d[k]}"></i>` : '')).join('')}</div>
            <span class="lab">${parse(d.date).getDate()}</span></div>`; }).join('')}
        </div>
        <ul class="legend"><li><i class="dot lb-A"></i>Absent</li><li><i class="dot lb-L"></i>Late</li><li><i class="dot lb-E"></i>Excused</li></ul>
      </section>
      <section class="chart"><h2>Most absences</h2>
        ${top.length ? `<ul class="hbars">${top.map((p) => `<li><button class="who" data-open="${p.student.id}">${avatar(p.student, 26)}<span>${esc(p.student.name)}</span></button>
          <div class="hbar"><i class="lb-A" style="width:${(p.A / maxTop) * 100}%"></i><i class="lb-L" style="width:${(p.L / maxTop) * 100}%"></i></div><b>${p.A}</b></li>`).join('')}</ul>
          <ul class="legend"><li><i class="dot lb-A"></i>Absent</li><li><i class="dot lb-L"></i>Late</li></ul>` : '<p class="muted">No absences or lates recorded. Wonderful.</p>'}
      </section>
      <section class="chart"><h2>Which weekday has the most absences</h2>
        ${wd.length ? `<div class="cols short" role="img" aria-label="Absence rate by weekday">${wd.map((w) => `<div class="col"><div class="stack" style="height:${Math.max(3, (w.rate / maxWd) * 82)}%"><i class="lb-A" style="flex:1"></i></div><span class="lab">${names[w.i]}</span><b class="val">${pct(w.rate, 1)}</b></div>`).join('')}</div>` : '<p class="muted">Not enough days yet.</p>'}
      </section>
      <section class="chart"><h2>How the marks add up</h2>
        <div class="ledger-bar tall" role="img" aria-label="Present ${st.totals.P}, absent ${st.totals.A}, late ${st.totals.L}, excused ${st.totals.E}">${STATUS_KEYS.map((k) => (st.totals[k] ? `<i class="lb-${k}" style="flex:${st.totals[k]}"></i>` : '')).join('')}</div>
        <ul class="ledger-nums compact">${STATUS_KEYS.map((k) => `<li class="n-${k}"><b>${st.totals[k]}</b><span>${STATUS[k].label}</span></li>`).join('')}</ul>
      </section>
    </div>`;
}
function rangeSelect() {
  return `<div class="range-row"><label class="select-inline">Show <select id="rpRange" aria-label="Date range">
    <option value="all" ${range === 'all' ? 'selected' : ''}>Everything recorded</option><option value="30" ${range === '30' ? 'selected' : ''}>Last 30 days</option><option value="month" ${range === 'month' ? 'selected' : ''}>This month</option></select></label></div>`;
}

/* ---------- monthly register ---------- */
function sheet() {
  const c = store.cls();
  const set = store.settings();
  const [y, m0] = [Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1];
  const days = schoolDaysInMonth(y, m0, set.schoolDays);
  const students = activeStudents(c);
  const mark = { P: '✓', A: 'A', L: 'L', E: 'E' };
  const head = days.map((d) => `<th class="${isNoClass(c, d) ? 'off' : ''}" title="${fmt.mid(d)}${isNoClass(c, d) ? ': ' + esc(c.noClass[d]) : ''}"><span>${parse(d).getDate()}</span><small>${fmt.wd1(d)}</small></th>`).join('');
  const rows = students.map((s, i) => {
    const stat = studentStats(c, s.id, set, { from: `${month}-01`, to: `${month}-31` });
    return `<tr><th scope="row" class="nm"><span class="no">${i + 1}</span>${esc(s.name)}</th>${days.map((d) => {
      const r = c.records[d]?.[s.id];
      return `<td class="${r ? 'st-' + r.s : ''} ${isNoClass(c, d) ? 'off' : ''}" ${r?.n ? `title="${esc(r.n)}"` : ''}>${r ? mark[r.s] : ''}</td>`;
    }).join('')}<td class="tot a">${stat.A}</td><td class="tot l">${stat.L}</td><td class="tot e">${stat.E}</td><td class="tot r">${pct(stat.rate)}</td></tr>`;
  }).join('');
  const dayRow = days.map((d) => { const day = c.records[d] || {}; return `<td>${students.filter((s) => day[s.id]?.s === 'A').length || ''}</td>`; }).join('');
  return `
    <div class="sheet-bar">
      <div class="date-nav"><button class="icon-btn" data-act="mprev" aria-label="Previous month">${icon('left', 20)}</button><span class="month-label">${fmt.month(month)}</span><button class="icon-btn" data-act="mnext" aria-label="Next month">${icon('right', 20)}</button></div>
      <button class="btn" data-act="print">${icon('print', 16)} Print this register</button>
    </div>
    <div class="print-head"><h2>${esc(set.schoolName || 'Attendance register')}</h2><p>${esc(c.name)} &middot; ${esc(set.teacherName)} &middot; ${fmt.month(month)}</p></div>
    <div class="table-wrap reg"><table class="register">
      <thead><tr><th class="nm">Student</th>${head}<th class="tot">Abs.</th><th class="tot">Late</th><th class="tot">Exc.</th><th class="tot">Rate</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><th class="nm">Absent that day</th>${dayRow}<td colspan="4"></td></tr></tfoot>
    </table></div>
    <p class="muted small">&#10003; present &middot; A absent &middot; L late &middot; E excused. Hover a mark to read its note.</p>`;
}

/* ---------- watch list ---------- */
function watch() {
  const c = store.cls();
  const set = store.settings();
  const per = activeStudents(c).map((s) => ({ s, ...studentStats(c, s.id, set) }));
  const limit = set.alertAbsences;
  const flagged = per.filter((p) => p.flag).sort((a, b) => b.effective - a.effective);
  const near = per.filter((p) => p.watch).sort((a, b) => b.effective - a.effective);
  const streaks = per.filter((p) => p.streak >= 2 && !p.flag).sort((a, b) => b.streak - a.streak);
  const perfect = per.filter((p) => p.marked >= 5 && p.A === 0 && p.L === 0 && p.E === 0);
  const item = (p) => `<li><button class="who" data-open="${p.s.id}">${avatar(p.s, 40)}<span><b>${esc(p.s.name)}</b><small>${p.s.guardian ? esc(p.s.guardian) + (p.s.phone ? ' · ' + esc(p.s.phone) : '') : 'No family contact saved'}</small></span></button>
    <span class="tally-box">${tally(p.A, { max: 15 })}</span>
    <div class="meter" role="img" aria-label="${p.effective} of ${limit} absences"><i style="width:${Math.min(100, limit ? (p.effective / limit) * 100 : 0)}%"></i></div><b class="count">${p.effective}<small>/${limit}</small></b></li>`;
  const block = (title, hint, list, kind = '') => `<section class="watch ${kind}"><h2>${title} <span class="badge">${list.length}</span></h2><p class="muted">${hint}</p>${list.length ? `<ul class="wlist">${list.map(item).join('')}</ul>` : '<p class="empty-line">Nobody here right now.</p>'}</section>`;
  return `
    ${block('At the absence limit', `Counted absences have reached ${limit}${set.lateToAbsent ? `, with every ${set.lateToAbsent} lates counting as one absence` : ''}. Time to reach out to the family.`, flagged, 'bad')}
    ${block('Getting close', `Within about ${Math.max(1, limit - Math.ceil(limit * 0.6))} absences of the limit.`, near, 'warn')}
    ${block('Absent two or more days in a row', 'A short streak is often the first sign something is wrong.', streaks)}
    <section class="watch good"><h2>Perfect attendance <span class="badge">${perfect.length}</span></h2>${perfect.length ? `<ul class="stars">${perfect.map((p) => `<li>${avatar(p.s, 34)}<span>${esc(p.s.name)}</span></li>`).join('')}</ul>` : '<p class="empty-line">Needs at least five recorded days.</p>'}</section>`;
}

/* ---------- export ---------- */
function exporter() {
  return `
    <div class="export-grid">
      <div class="card-box"><h2>Spreadsheet files</h2><p class="muted">Open these in Excel, Numbers or Google Sheets.</p>
        <button class="btn" data-exp="summary">${icon('download', 16)} Summary per student (CSV)</button>
        <button class="btn" data-exp="log">${icon('download', 16)} Every mark, one per row (CSV)</button>
        <button class="btn" data-exp="matrix">${icon('download', 16)} Monthly register, ${fmt.month(month)} (CSV)</button></div>
    </div>`;
}

function exportFile(kind) {
  const c = store.cls();
  const set = store.settings();
  const base = `${slug(c.name)}`;
  const students = activeStudents(c);
  if (kind === 'summary') {
    const rows = [['Student', 'Present', 'Absent', 'Late', 'Excused', 'Counted absences', 'Attendance %']];
    students.forEach((s) => { const t = studentStats(c, s.id, set); rows.push([s.name, t.P, t.A, t.L, t.E, t.effective, t.rate == null ? '' : (t.rate * 100).toFixed(1)]); });
    download(`${base}-summary.csv`, toCSV(rows), 'text/csv');
  } else if (kind === 'log') {
    const rows = [['Date', 'Student', 'Status', 'Note']];
    Object.keys(c.records).sort().forEach((d) => students.forEach((s) => { const r = c.records[d][s.id]; if (r?.s) rows.push([d, s.name, STATUS[r.s].label, r.n || '']); }));
    download(`${base}-all-marks.csv`, toCSV(rows), 'text/csv');
  } else if (kind === 'matrix') {
    const [y, m0] = [Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1];
    const days = schoolDaysInMonth(y, m0, set.schoolDays);
    const rows = [['Student', ...days.map((d) => parse(d).getDate()), 'Absent', 'Late', 'Excused']];
    students.forEach((s) => {
      const t = studentStats(c, s.id, set, { from: `${month}-01`, to: `${month}-31` });
      rows.push([s.name, ...days.map((d) => c.records[d]?.[s.id]?.s || (isNoClass(c, d) ? '-' : '')), t.A, t.L, t.E]);
    });
    download(`${base}-${month}.csv`, toCSV(rows), 'text/csv');
  }
  sfx.play('pop');
  toast('Download started.');
}

function onClick(e) {
  const t = e.target.closest('[data-tab]');
  if (t) { tab = t.dataset.tab; sfx.play('tab'); return paint(); }
  const o = e.target.closest('[data-open]');
  if (o) return openProfile(o.dataset.open);
  const x = e.target.closest('[data-exp]');
  if (x) return exportFile(x.dataset.exp);
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'mprev' || act === 'mnext') {
    const d = parse(`${month}-01`); d.setMonth(d.getMonth() + (act === 'mnext' ? 1 : -1));
    month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    sfx.play('page');
    return paint();
  }
  if (act === 'print') return window.print();
  if (act === 'gosheet') { tab = 'sheet'; return paint(); }
}
