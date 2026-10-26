// Roster: type names in by hand, paste a whole list, reorder, edit, archive.
import * as store from '../core/store.js';
import * as access from '../core/access.js';
import { activeStudents, byName, studentStats } from '../core/stats.js';
import { esc, pct, plural } from '../core/utils.js';
import { avatar } from '../ui/avatar.js';
import { icon } from '../ui/icons.js';
import { tally } from '../ui/tally.js';
import { toast } from '../ui/toast.js';
import { confirmBox, openDialog } from '../ui/modal.js';
import { openProfile } from '../ui/profile.js';
import { openStudentDialog } from '../ui/studentForm.js';
import * as sfx from '../services/audio.js';

let root = null;
let sort = 'roster';
let showArchived = false;
let query = '';

export const roster = {
  mount(r) {
    root = r;
    query = '';
    root.innerHTML = `
      <header class="doc-head"><div><h1>Class roster</h1><p class="hand" id="rsSub"></p></div></header>
      <section class="quick-add" aria-label="Add students">
        <form id="rsForm" class="admin-only" autocomplete="off">
          <label class="sr-only" for="rsName">Student name</label>
          <input id="rsName" type="text" maxlength="60" placeholder="Type a student's name and press Enter" required>
          <button class="btn primary" type="submit">${icon('plus', 16)} Add student</button>
        </form>
        <div class="quick-acts">
          <button class="btn admin-only" data-act="paste">${icon('list', 16)} Paste a class list</button>
          <label class="search roster-search">${icon('search', 16)}<input id="rsSearch" type="search" placeholder="Find a student" aria-label="Find a student" autocomplete="off"></label>
          <details class="more-wrap more-actions">
            <summary class="btn ghost small more-trigger">More ${icon('more', 15)}</summary>
            <div class="more-menu" aria-label="More roster options">
              <button class="more-item admin-only" data-act="sortaz" type="button">Set saved roster order A to Z</button>
              <label class="more-select"><span>Sort view</span><select id="rsSort" aria-label="Sort the roster"><option value="roster">Roster order</option><option value="name-az">Name: A to Z</option><option value="name-za">Name: Z to A</option><option value="male-female">Gender: Male to female</option><option value="female-male">Gender: Female to male</option><option value="absences">Most absences</option><option value="rate">Lowest attendance</option></select></label>
            </div>
          </details>
        </div>
      </section>
      <div id="rsTable"></div>`;
    root.querySelector('#rsForm').addEventListener('submit', (e) => {
      e.preventDefault();
      if (!access.guard()) return;
      const input = root.querySelector('#rsName');
      const name = input.value.trim();
      if (!name) return;
      if (store.cls().students.some((s) => s.name.toLowerCase() === name.toLowerCase())) { toast(`${name} is already on the roster.`, { type: 'error' }); sfx.play('error'); return; }
      store.addStudent({ name });
      sfx.play('pop');
      input.value = '';
      input.focus();
    });
    root.querySelector('#rsSort').value = sort;
    root.querySelector('#rsSort').addEventListener('change', (e) => { sort = e.target.value; paint(); });
    root.addEventListener('input', (e) => { if (e.target.id === 'rsSearch') { query = e.target.value.trim().toLowerCase(); paint(); } });
    root.addEventListener('click', onClick);
    bindDrag();
    paint();
  },
  update() { if (root) paint(); },
  unmount() { root = null; },
};

function applySort(items) {
  const rows = [...items];
  if (sort === 'name-az') rows.sort((a, b) => byName(a.s, b.s));
  if (sort === 'name-za') rows.sort((a, b) => byName(b.s, a.s));
  if (sort === 'male-female' || sort === 'female-male') {
    const first = sort === 'male-female' ? 'male' : 'female';
    const second = first === 'male' ? 'female' : 'male';
    const order = { [first]: 0, [second]: 1 };
    rows.sort((a, b) => (order[String(a.s.gender || '').toLowerCase()] ?? 2) - (order[String(b.s.gender || '').toLowerCase()] ?? 2) || byName(a.s, b.s));
  }
  if (sort === 'absences') rows.sort((a, b) => b.st.effective - a.st.effective);
  if (sort === 'rate') rows.sort((a, b) => (a.st.rate ?? 2) - (b.st.rate ?? 2));
  return rows;
}

function paint() {
  const c = store.cls();
  const set = store.settings();
  const all = c.students.map((s, i) => ({ s, i, st: studentStats(c, s.id, set) }));
  const active = all.filter((x) => x.s.active !== false);
  const archived = all.filter((x) => x.s.active === false);
  root.querySelector('#rsSub').textContent = `${c.name}: ${plural(active.length, 'student')}${archived.length ? `, ${archived.length} archived` : ''}`;
  const rows = applySort(active);
  const filteredRows = rows.filter(({ s }) => String(s.name).toLowerCase().includes(query));
  const filteredArchived = applySort(archived).filter(({ s }) => String(s.name).toLowerCase().includes(query));
  const box = root.querySelector('#rsTable');
  if (!c.students.length) {
    box.innerHTML = `<div class="empty"><div class="empty-art" aria-hidden="true">${icon('roster', 44)}</div><h2>No students yet</h2><p>Type a name above and press Enter. To add a whole class at once, choose Paste a class list and put one name on each line.</p></div>`;
    return;
  }
  if (query && !filteredRows.length && filteredArchived.length && !showArchived) { box.innerHTML = `<div class="empty small"><h2>No active student matches</h2><p><button class="link-btn" data-act="archived">Show ${filteredArchived.length} archived matches</button></p></div>`; return; }
  if (query && !filteredRows.length && !filteredArchived.length) { box.innerHTML = `<div class="empty small"><h2>No student matches</h2><p>Try another name or clear the search.</p></div>`; return; }
  box.innerHTML = `
    <div class="table-wrap"><table class="rtable">
      <thead><tr><th class="c-no">No.</th><th>Student</th><th class="c-n">Absent</th><th class="c-n">Late</th><th class="c-n">Excused</th><th class="c-n">Attendance</th><th class="c-acts admin-only"><span class="sr-only">Actions</span></th></tr></thead>
      <tbody>${filteredRows.map(({ s, i, st }, n) => row(s, sort === 'roster' ? i : n, st)).join('')}</tbody>
    </table></div>
    ${archived.length ? `<button class="link-btn" data-act="archived" aria-expanded="${showArchived}">${showArchived ? 'Hide' : 'Show'} ${archived.length} archived ${archived.length === 1 ? 'student' : 'students'}</button>
      ${showArchived ? `<div class="table-wrap"><table class="rtable archived"><tbody>${filteredArchived.map(({ s, st }, n) => row(s, n, st, true)).join('')}</tbody></table></div>` : ''}` : ''}
    ${sort === 'roster' ? '<p class="muted small admin-only">Drag the handle to change the order students appear in on the Today page.</p>' : ''}`;
}

function row(s, i, st, archived = false) {
  return `<tr data-id="${s.id}" ${!archived && sort === 'roster' && access.canEdit() ? 'draggable="true"' : ''} class="${st.flag ? 'flag' : ''}">
    <td class="c-no"><span class="grip" aria-hidden="true">&#8942;&#8942;</span>${archived ? '' : i + 1}</td>
    <td><button class="who" data-act="open">${avatar(s, 36)}<span><b>${esc(s.name)}</b>${s.guardian ? `<small>${esc(s.guardian)}</small>` : ''}</span></button></td>
    <td class="c-n"><span class="cell-tally">${tally(st.A, { max: 10 })}</span><b>${st.A}</b></td>
    <td class="c-n">${st.L}</td><td class="c-n">${st.E}</td>
    <td class="c-n">${pct(st.rate)}</td>
    <td class="c-acts admin-only">
      <button class="icon-btn" data-act="edit" aria-label="Edit ${esc(s.name)}">${icon('edit', 16)}</button>
      <button class="icon-btn" data-act="delete" aria-label="Remove ${esc(s.name)}">${icon('trash', 16)}</button>
    </td></tr>`;
}

async function onClick(e) {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!act) return;
  e.target.closest('.more-actions')?.removeAttribute('open');
  const sid = e.target.closest('[data-id]')?.dataset.id;
  const c = store.cls();
  const student = c.students.find((s) => s.id === sid);
  if (act === 'open' && student) return openProfile(sid);
  if (['edit', 'sortaz', 'delete', 'paste'].includes(act) && !access.guard()) return;
  if (act === 'edit' && student) return openStudentDialog(student);
  if (act === 'archived') { showArchived = !showArchived; return paint(); }
  if (act === 'sortaz') { sort = 'roster'; root.querySelector('#rsSort').value = sort; store.sortStudents(); sfx.play('page'); toast('Roster order set to A to Z.'); return; }
  if (act === 'delete' && student) {
    const ok = await confirmBox({ title: `Remove ${student.name}?`, message: 'Their attendance history is removed too. To keep it, choose Edit and tick "Left the class" instead. You can undo right after.', confirmLabel: 'Remove student', danger: true });
    if (!ok) return;
    const restore = store.removeStudent(sid);
    sfx.play('clear');
    toast(`${student.name} removed.`, { action: { label: 'Undo', run: () => { restore(); sfx.play('pop'); } } });
    return;
  }
  if (act === 'paste') {
    const result = await openDialog({
      title: 'Paste a class list',
      body: `<label class="field"><span>One student per line. Names that are already on the roster are skipped.</span>
        <textarea id="pasteBox" rows="10" placeholder="Maya Santos&#10;Noah Tan&#10;Aisha Rahman" autofocus></textarea></label><p class="muted small" id="pasteCount">0 names</p>`,
      onOpen(dlg) {
        const box = dlg.querySelector('#pasteBox');
        box.addEventListener('input', () => { const n = box.value.split(/\r?\n/).filter((l) => l.trim()).length; dlg.querySelector('#pasteCount').textContent = plural(n, 'name'); });
      },
      actions: [
        { label: 'Cancel', value: null, kind: 'ghost' },
        { label: 'Add to roster', kind: 'primary', run: (dlg) => dlg.querySelector('#pasteBox').value.split(/\r?\n/).map((l) => l.replace(/^[\s\d.)\-*•]+/, '').trim()).filter(Boolean) },
      ],
    });
    if (result) {
      const n = store.addStudents(result);
      sfx.play(n ? 'success' : 'error');
      toast(n ? `${plural(n, 'student')} added.` : 'Nobody new to add. Those names are already on the roster.', { type: n ? 'info' : 'error' });
    }
  }
}

function bindDrag() {
  let dragId = null;
  root.addEventListener('dragstart', (e) => { const tr = e.target.closest('tr[draggable]'); if (!tr) return; dragId = tr.dataset.id; tr.classList.add('drag'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId); });
  root.addEventListener('dragend', (e) => e.target.closest?.('tr')?.classList.remove('drag'));
  root.addEventListener('dragover', (e) => { if (dragId && e.target.closest('tr[draggable]')) e.preventDefault(); });
  root.addEventListener('drop', (e) => {
    const tr = e.target.closest('tr[draggable]');
    if (!tr || !dragId) return;
    e.preventDefault();
    store.reorderStudents(dragId, tr.dataset.id);
    sfx.play('tap');
    dragId = null;
  });
}
