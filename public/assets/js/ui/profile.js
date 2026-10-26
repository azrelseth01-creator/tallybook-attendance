// The student profile: a drawer that slides in from the right.
import * as store from '../core/store.js';
import * as access from '../core/access.js';
import { addDays, fmt, iso, weekday } from '../core/dates.js';
import { STATUS, studentStats } from '../core/stats.js';
import { bus, esc, pct, plural } from '../core/utils.js';
import { avatar } from './avatar.js';
import { icon } from './icons.js';
import { tally } from './tally.js';
import { confirmBox } from './modal.js';
import { openStudentDialog } from './studentForm.js';
import { toast } from './toast.js';
import * as sfx from '../services/audio.js';

let open = null;

export function openProfile(sid) {
  closeProfile(true);
  const root = document.createElement('div');
  root.className = 'drawer-wrap';
  root.innerHTML = '<div class="drawer-scrim" data-close></div><aside class="drawer" role="dialog" aria-modal="true" aria-label="Student profile"></aside>';
  document.body.append(root);
  const panel = root.querySelector('.drawer');
  const unsub = bus.on('change', () => render());
  const onKey = (e) => { if (e.key === 'Escape') closeProfile(); };
  addEventListener('keydown', onKey);
  root.addEventListener('click', async (e) => {
    if (e.target.closest('[data-close]')) return closeProfile();
    const act = e.target.closest('[data-act]')?.dataset.act;
    const student = store.cls().students.find((s) => s.id === sid);
    if (!student) return;
    if ((act === 'edit' || act === 'delete') && !access.guard()) return;
    if (act === 'edit') { await openStudentDialog(student); }
    if (act === 'delete') {
      const ok = await confirmBox({ title: `Remove ${student.name}?`, message: 'Their attendance history is removed too. You can undo this right after.', confirmLabel: 'Remove student', danger: true });
      if (!ok) return;
      const restore = store.removeStudent(sid);
      closeProfile();
      toast(`${student.name} removed.`, { action: { label: 'Undo', run: () => { restore(); sfx.play('pop'); } } });
    }
  });

  function render() {
    const c = store.cls();
    const st = c.students.find((s) => s.id === sid);
    if (!st) return closeProfile();
    const set = store.settings();
    const stat = studentStats(c, sid, set);
    const alertLine = stat.flag
      ? `<div class="callout bad">${icon('alert', 18)}<div><strong>${plural(stat.effective, 'absence')} counted.</strong> That reaches the limit of ${set.alertAbsences}.${st.guardian || st.phone ? ` Contact ${esc(st.guardian || 'the family')}${st.phone ? ` on <a href="tel:${esc(st.phone)}">${esc(st.phone)}</a>` : ''}.` : (access.canEdit() ? ' Add a guardian contact by choosing Edit.' : '')}</div></div>`
      : stat.watch
        ? `<div class="callout warn">${icon('alert', 18)}<div><strong>${plural(stat.effective, 'absence')} counted.</strong> ${set.alertAbsences - stat.effective} more reaches the limit of ${set.alertAbsences}.</div></div>` : '';
    panel.innerHTML = `
      <header class="drawer-h">
        ${avatar(st, 64)}
        <div class="drawer-who"><h2>${esc(st.name)}</h2>
          <p class="hand">${st.active === false ? 'Left the class' : esc(c.name)}</p></div>
        <button class="icon-btn" data-close aria-label="Close profile">${icon('x', 20)}</button>
      </header>
      <div class="drawer-b">
        ${alertLine}
        <div class="big-tally"><div class="tally-wrap">${tally(stat.A, { max: 30 }) || '<span class="muted hand">No absences yet</span>'}</div>
          <p><strong>${stat.A}</strong> ${stat.A === 1 ? 'day' : 'days'} absent</p></div>
        <dl class="stat-grid">
          <div><dt>Late</dt><dd>${stat.L}</dd></div>
          <div><dt>Excused</dt><dd>${stat.E}</dd></div>
          <div><dt>Present</dt><dd>${stat.P}</dd></div>
          <div><dt>Attendance</dt><dd>${pct(stat.rate)}</dd></div>
          <div><dt>Absent in a row</dt><dd>${stat.streak}</dd></div>
          <div><dt>Longest run</dt><dd>${stat.longest}</dd></div>
        </dl>
        ${st.lateEq || stat.lateEq ? `<p class="muted small">${plural(stat.L, 'late')} count as ${plural(stat.lateEq, 'extra absence')} (every ${set.lateToAbsent} lates = 1 absence).</p>` : ''}
        <h3>Last 14 weeks</h3>
        ${heat(c, sid, set)}
        <div class="legend">${['P', 'A', 'L', 'E'].map((k) => `<span><i class="dot st-${k}"></i>${STATUS[k].label}</span>`).join('')}</div>
        ${st.guardian || st.phone ? `<h3>Family contact</h3><p>${esc(st.guardian || '')}${st.phone ? ` &middot; <a href="tel:${esc(st.phone)}">${esc(st.phone)}</a>` : ''}</p>` : ''}
        ${st.notes ? `<h3>Notes</h3><p class="note-text">${esc(st.notes)}</p>` : ''}
        <h3>History</h3>
        ${stat.history.length ? `<ul class="history">${[...stat.history].reverse().slice(0, 40).map((h) => `
          <li><span class="chip st-${h.s}">${STATUS[h.s].label}</span><span>${fmt.mid(h.date)}</span>${h.n ? `<em class="hand">${esc(h.n)}</em>` : ''}</li>`).join('')}</ul>` : '<p class="muted">Nothing recorded yet. Marks from the Today page appear here.</p>'}
      </div>
      <footer class="drawer-f admin-only">
        <button class="btn ghost" data-act="edit">${icon('edit', 16)} Edit</button>
        <button class="btn danger-ghost" data-act="delete">${icon('trash', 16)} Remove</button>
      </footer>`;
  }

  render();
  requestAnimationFrame(() => root.classList.add('on'));
  panel.querySelector('[data-close]')?.focus();
  open = { root, unsub, onKey };
}

export function closeProfile(immediate = false) {
  if (!open) return;
  const { root, unsub, onKey } = open;
  open = null;
  unsub();
  removeEventListener('keydown', onKey);
  root.classList.remove('on');
  if (immediate) root.remove(); else setTimeout(() => root.remove(), 220);
}

function heat(c, sid, set) {
  const weeks = 14;
  const todayIso = iso(new Date());
  const lead = (weekday(todayIso) - set.weekStart + 7) % 7;
  const start = addDays(todayIso, -lead - (weeks - 1) * 7);
  let cells = '';
  for (let col = 0; col < weeks; col++) {
    for (let row = 0; row < 7; row++) {
      const d = addDays(start, col * 7 + row);
      const r = c.records[d]?.[sid];
      const cls = d > todayIso ? 'future' : r?.s ? `st-${r.s}` : c.noClass[d] ? 'off' : !set.schoolDays.includes(weekday(d)) ? 'weekend' : '';
      cells += `<i class="hm ${cls}" style="grid-column:${col + 1};grid-row:${row + 1}" title="${fmt.mid(d)}${r?.s ? ': ' + STATUS[r.s].label : ''}"></i>`;
    }
  }
  return `<div class="heat" role="img" aria-label="Attendance over the last ${weeks} weeks" style="--weeks:${weeks}">${cells}</div>`;
}
