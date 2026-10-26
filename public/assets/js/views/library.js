// The class library: every class book on one shelf, outside any single class.
// Search, filter, favourite, archive, sort into groups, and open a class (asking for its password if it has one).
import * as store from '../core/store.js';
import * as lock from '../core/lock.js';
import * as access from '../core/access.js';
import { config } from '../core/config.js';
import { today, fmt } from '../core/dates.js';
import { dayStats, activeStudents, STATUS } from '../core/stats.js';
import { avatar } from '../ui/avatar.js';
import { esc, plural } from '../core/utils.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { confirmBox, promptBox } from '../ui/modal.js';
import { classFormDialog, enterClass, moveToGroupDialog, passwordDialog, promptUnlock } from '../ui/classDialogs.js';
import * as sfx from '../services/audio.js';

let root = null;
let menuEl = null;
const ui = { view: 'all', q: '', subject: '', sort: 'recent', preview: null };

const groupOf = (c) => store.groups().find((g) => g.id === c.groupId) || null;
const find = (id) => store.getState().classes.find((c) => c.id === id);
const studentCount = (c) => c.students.filter((s) => s.active !== false).length;

function lastOpenedText(ms) {
  if (!ms) return 'Not opened yet';
  const days = Math.round((new Date(new Date().toDateString()) - new Date(new Date(ms).toDateString())) / 86400000);
  if (days <= 0) return 'Opened today';
  if (days === 1) return 'Opened yesterday';
  if (days < 7) return `Opened ${days} days ago`;
  return `Opened ${new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
}

export const library = {
  mount(host) {
    root = host;
    const s = store.settings();
    root.innerHTML = `
      <div class="lib-shell">
        <aside class="lib-side" aria-label="Library">
          <div class="lib-brand"><span class="lib-logo">${icon('book', 24)}</span><b>${esc(config.appName)}</b></div>
          <p class="lib-eyebrow">Workspace</p>
          <nav class="lib-nav" id="libNav" aria-label="Class lists"></nav>
          <p class="lib-eyebrow lib-eyebrow-row">Groups <button class="icon-btn admin-only" data-act="newgroup" aria-label="New group" title="New group">${icon('plus', 16)}</button></p>
          <nav class="lib-nav" id="libGroups" aria-label="Groups"></nav>
          <div class="lib-side-foot">
            <a class="lib-nav-item" href="#/settings">${icon('settings', 18)}<span>Settings</span></a>
            <p class="lib-saved" id="libSaved"></p>
          </div>
        </aside>
        <section class="lib-main">
          <header class="lib-top">
            <p class="lib-crumb">${esc(config.appName)} <i></i> Class library</p>
            <div class="lib-right">
              <div class="lib-session">
                <span class="role-pill" data-role="${access.getRole() || ''}" title="${access.isAdmin() ? 'You can add and edit. Class passwords still apply.' : 'You can open and look at everything, but not change anything.'}">${access.isAdmin() ? 'Admin' : 'View only'}</span>
                <button class="btn ghost small" data-act="logout" title="Lock the book (sign out)">${icon('lock', 14)} Lock</button>
              </div>
              <a class="lib-user" href="#/settings/profile" title="Edit your profile"><span>${esc(s.teacherName || 'Teacher')}</span>${avatar({ name: s.teacherName || 'Teacher', photo: s.teacherPhoto || '', icon: 'initials', color: '#fff1c9' }, 38)}</a>
            </div>
          </header>
          <div class="lib-cols">
          <div class="lib-body">
            <div class="lib-head"><h1 id="libTitle"></h1><p class="hand" id="libSub"></p></div>
            <div class="lib-tools">
              <label class="lib-search">${icon('search', 18)}<span class="sr-only">Search classes</span><input id="libQ" type="search" placeholder="Search classes..." autocomplete="off"></label>
              <details class="more-wrap more-actions">
                <summary class="btn ghost small more-trigger">Filter and sort ${icon('more', 15)}</summary>
                <div class="more-menu" aria-label="Filter and sort classes">
                  <label class="more-select"><span>Subject</span><select id="libSubject" aria-label="Filter by subject"></select></label>
                  <label class="more-select"><span>Sort classes</span><select id="libSort" aria-label="Sort classes"><option value="recent">Recently opened</option><option value="name">Name A to Z</option><option value="students">Most students</option></select></label>
                </div>
              </details>
              <button class="btn primary admin-only" data-act="create">${icon('plus', 16)} Create class</button>
            </div>
            <div class="lib-count"><h2>Your books <span class="badge" id="libN"></span></h2><span class="muted small">${access.canEdit() ? 'Click a book to open it. Drag one onto a group to move it.' : 'Click a book to open it. Locked classes open for you without a password.'}</span></div>
            <div id="libGrid"></div>
          </div>
          <aside class="lib-preview" id="libPreview" aria-label="Class preview"></aside>
          </div>
        </section>
      </div>`;
    root.querySelector('#libSort').value = ui.sort;
    root.querySelector('#libQ').value = ui.q;
    root.addEventListener('click', onClick);
    root.addEventListener('pointerover', onHover);
    root.addEventListener('focusin', onHover);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onInput);
    bindDrag();
    paint();
    root.querySelector('#libQ').focus({ preventScroll: true });
  },
  update() { if (root) paint(); },
  unmount() { closeMenu(); root = null; },
};

/* ---------- what is shown ---------- */
function visible() {
  const all = store.getState().classes;
  let list;
  if (ui.view === 'archived') list = all.filter((c) => c.archived);
  else if (ui.view === 'fav') list = all.filter((c) => c.favorite && !c.archived);
  else if (ui.view.startsWith('g:')) list = all.filter((c) => c.groupId === ui.view.slice(2) && !c.archived);
  else list = all.filter((c) => !c.archived);
  return list;
}

function filtered(list) {
  const q = ui.q.trim().toLowerCase();
  let out = list.filter((c) => {
    if (ui.subject && (c.subject || '') !== ui.subject) return false;
    if (!q) return true;
    return [c.name, c.subject, c.room, groupOf(c)?.name].some((t) => String(t || '').toLowerCase().includes(q));
  });
  const by = {
    recent: (a, b) => (b.lastOpened || 0) - (a.lastOpened || 0),
    name: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
    students: (a, b) => studentCount(b) - studentCount(a),
  }[ui.sort];
  out = [...out].sort(by);
  return out;
}

function paint() {
  if (!root) return;
  paintGrid();
  paintPreview();
}

function paintGrid() {
  const st = store.getState();
  const groups = store.groups();
  if (ui.view.startsWith('g:') && !groups.some((g) => g.id === ui.view.slice(2))) ui.view = 'all';
  const active = st.classes.filter((c) => !c.archived);

  const navItem = (view, ic, label, n, extra = '') => `<button class="lib-nav-item ${ui.view === view ? 'on' : ''}" data-view="${view}" data-drop="${view}" ${ui.view === view ? 'aria-current="true"' : ''}>${extra || icon(ic, 18)}<span>${esc(label)}</span><em>${n}</em></button>`;
  root.querySelector('#libNav').innerHTML =
    navItem('all', 'grid', 'My classes', active.length) +
    navItem('fav', 'star', 'Favorites', active.filter((c) => c.favorite).length) +
    navItem('archived', 'archive', 'Archived', st.classes.length - active.length);
  root.querySelector('#libGroups').innerHTML = groups.length
    ? groups.map((g) => navItem(`g:${g.id}`, 'folder', g.name, active.filter((c) => c.groupId === g.id).length, `<i class="lib-dot" style="--c:${g.color}"></i>`)).join('')
    : '<p class="lib-empty-groups">Groups are folders for your classes, like a grade or a subject.</p>';

  const g = ui.view.startsWith('g:') ? groups.find((x) => x.id === ui.view.slice(2)) : null;
  root.querySelector('#libTitle').textContent = { all: 'My classes', fav: 'Favorites', archived: 'Archived' }[ui.view] || g?.name || 'My classes';
  root.querySelector('#libSub').textContent = { all: 'Every class has its own attendance book.', fav: 'The books you open most.', archived: 'Put away. Open one to look, or restore it.' }[ui.view] || 'Classes in this group.';

  const base = visible();
  const subjects = [...new Set(base.map((c) => (c.subject || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  if (ui.subject && !subjects.includes(ui.subject)) ui.subject = '';
  const sel = root.querySelector('#libSubject');
  sel.innerHTML = `<option value="">All subjects</option>${subjects.map((s) => `<option value="${esc(s)}" ${s === ui.subject ? 'selected' : ''}>${esc(s)}</option>`).join('')}`;

  const list = filtered(base);
  root.querySelector('#libN').textContent = list.length;
  const grid = root.querySelector('#libGrid');
  const canCreate = ui.view === 'all' || ui.view.startsWith('g:');
  const tile = canCreate ? `<button class="book-new admin-only" data-act="create"><span>${icon('plus', 26)}</span><b>Create a class</b><small>Start a fresh attendance book</small></button>` : '';

  if (!list.length && !canCreate) {
    grid.innerHTML = `<div class="empty small"><h2>${ui.view === 'fav' ? 'No favorites yet' : 'Nothing here'}</h2><p class="muted">${ui.view === 'fav' ? 'Open the ⋯ menu on a class and choose Add to favorites.' : 'Archived classes appear here.'}</p></div>`;
    return;
  }
  if (!list.length && (ui.q || ui.subject)) {
    grid.innerHTML = `<div class="empty small"><h2>No class matches</h2><p class="muted">Try a different word, or clear the filters.</p><button class="btn" data-act="clear">Clear search</button></div>`;
    return;
  }

  const sectioned = ui.view === 'all' && groups.length > 0;
  if (!sectioned) { grid.innerHTML = `<div class="book-grid">${list.map(card).join('')}${tile}</div>`; return; }

  const sections = [...groups.map((gr) => ({ gr, items: list.filter((c) => c.groupId === gr.id) })), { gr: null, items: list.filter((c) => !c.groupId) }]
    .filter((sec) => sec.items.length || (!ui.q && !ui.subject && sec.gr));
  grid.innerHTML = sections.map((sec) => `
    <section class="lib-section">
      <h3 class="lib-section-h">${sec.gr ? `<i class="lib-dot" style="--c:${sec.gr.color}"></i>${esc(sec.gr.name)}` : 'Not in a group'}<span class="badge">${sec.items.length}</span>
        ${sec.gr ? `<button class="icon-btn admin-only" data-act="groupmenu" data-gid="${sec.gr.id}" aria-label="Options for group ${esc(sec.gr.name)}" aria-haspopup="menu">${icon('more', 18)}</button>` : ''}</h3>
      ${sec.items.length ? `<div class="book-grid">${sec.items.map(card).join('')}</div>` : '<p class="muted small lib-empty-sec">No classes here yet. Drag one in, or use a class\'s ⋯ menu.</p>'}
    </section>`).join('') + `<div class="book-grid book-grid-end">${tile}</div>`;
}

function card(c) {
  const open = lock.isOpen(c);
  const locked = lock.isLocked(c);
  const cur = store.getState().currentClassId === c.id;
  const g = groupOf(c);
  const sub = [c.subject, c.room].filter(Boolean).join(' · ') || 'No subject or room yet';
  let stats;
  if (locked && !open) {
    stats = `<div class="bc-locked">${icon('lock', 18)}<span>Locked. Enter the password to open.</span></div>`;
  } else {
    const d = dayStats(c, today(), store.settings());
    stats = `<div class="bc-stats"><p class="bc-n"><b>${studentCount(c)}</b> ${studentCount(c) === 1 ? 'student' : 'students'}</p>
      <p class="bc-today muted">${d.marked ? `<span><i class="dot st-P"></i>${d.P + d.L} present</span>${d.A ? `<span><i class="dot st-A"></i>${d.A} absent</span>` : ''}` : 'Not marked today'}</p></div>`;
  }
  return `<article class="book-card ${cur ? 'current' : ''} ${locked ? 'locked' : ''} ${c.archived ? 'archived' : ''}" data-id="${c.id}" ${access.canEdit() ? 'draggable="true"' : ''} style="--book:${esc(c.color || store.BOOK_COLORS[0])}">
    <div class="bc-top">
      <span class="bc-icon" aria-hidden="true">${icon('book', 22)}</span>
      <div class="bc-titles"><small class="bc-eyebrow">${esc(g?.name || 'No group')}</small><h3><button class="bc-name" data-act="open">${esc(c.name)}</button></h3></div>
      <span class="bc-flags">${c.favorite ? `<span class="bc-fav" title="Favorite" role="img" aria-label="Favorite">${icon('star', 16)}</span>` : ''}${locked ? `<span title="Has a password" role="img" aria-label="Has a password">${icon(open ? 'unlock' : 'lock', 16)}</span>` : ''}</span>
      <button class="icon-btn admin-only" data-act="menu" aria-haspopup="menu" aria-label="Options for ${esc(c.name)}">${icon('more', 18)}</button>
    </div>
    <p class="bc-sub muted">${esc(sub)}</p>
    ${stats}
    <div class="bc-foot"><span class="muted small">${cur ? 'Open now' : lastOpenedText(c.lastOpened)}</span><span class="bc-cta" aria-hidden="true">Open class ${icon('right', 16)}</span></div>
  </article>`;
}

/* ---------- actions ---------- */
async function openClass(id) {
  if (!(await enterClass(id))) return;
  sfx.play('page');
  location.hash = '#/today';
}

async function createClass() {
  if (!access.guard()) return;
  const made = await classFormDialog({ groupId: ui.view.startsWith('g:') ? ui.view.slice(2) : null });
  if (!made) return;
  toast(`${made.name} added to your library.`, { action: { label: 'Open it', run: () => openClass(made.id) } });
}

async function classAction(id, act) {
  const c = find(id);
  if (!c) return;
  if (act !== 'open' && !access.guard()) return; // everything but opening a class is an edit
  const needOpen = ['edit', 'password', 'delete'].includes(act);
  if (needOpen && !(await promptUnlock(c))) return;
  if (act === 'open') return openClass(id);
  if (act === 'edit') { await classFormDialog({ cls: c }); return; }
  if (act === 'fav') { store.updateClassById(id, { favorite: !c.favorite }); sfx.play('tap'); return; }
  if (act === 'archive') {
    store.updateClassById(id, { archived: !c.archived });
    sfx.play('tap');
    toast(c.archived ? `${c.name} restored.` : `${c.name} archived.`, { action: { label: 'Undo', run: () => store.updateClassById(id, { archived: c.archived }) } });
    return;
  }
  if (act === 'group') { await moveToGroupDialog(c); return; }
  if (act === 'password') { await passwordDialog(c); return; }
  if (act === 'delete') {
    if (store.getState().classes.length < 2) { toast('You need at least one class, so this one cannot be deleted.', { type: 'error' }); return; }
    const ok = await confirmBox({ title: `Delete ${c.name}?`, message: `Its ${plural(studentCount(c), 'student')} and all attendance records will be removed for good. Download a backup from Settings first if you might need them.`, confirmLabel: 'Delete class', danger: true });
    if (ok) { store.removeClass(id); lock.relock(id); sfx.play('clear'); toast('Class deleted.'); }
  }
}

async function groupAction(gid, act) {
  if (!access.guard()) return;
  const g = store.groups().find((x) => x.id === gid);
  if (!g) return;
  if (act === 'rename') {
    const name = await promptBox({ title: 'Rename group', label: 'Group name', value: g.name, confirmLabel: 'Rename', allowEmpty: false });
    if (name) store.updateGroup(gid, { name: name.slice(0, 40) });
  }
  if (act === 'deletegroup') {
    const ok = await confirmBox({ title: `Delete the group ${g.name}?`, message: 'The classes in it are kept. They just become ungrouped.', confirmLabel: 'Delete group', danger: true });
    if (ok) { store.removeGroup(gid); sfx.play('clear'); }
  }
}

async function newGroup() {
  if (!access.guard()) return;
  const name = await promptBox({ title: 'New group', label: 'Group name', placeholder: 'Grade 5, Science, Mondays...', confirmLabel: 'Create group', allowEmpty: false });
  if (!name) return;
  const g = store.addGroup(name);
  ui.view = `g:${g.id}`;
  sfx.play('pop');
  paint();
}

/* ---------- popup menu ---------- */
function closeMenu() {
  if (!menuEl) return;
  menuEl.remove();
  menuEl = null;
  removeEventListener('pointerdown', onAway, true);
  removeEventListener('keydown', onMenuKey, true);
  removeEventListener('resize', closeMenu);
}
const onAway = (e) => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); };
const onMenuKey = (e) => {
  if (e.key === 'Escape') { e.stopPropagation(); const b = menuEl?.dataset.from && root?.querySelector(`[data-menu-from="${menuEl.dataset.from}"]`); closeMenu(); b?.focus(); }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const items = [...menuEl.querySelectorAll('button')];
    const i = items.indexOf(document.activeElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
    e.preventDefault();
  }
};

function openMenu(btn, items) {
  closeMenu();
  const key = String(Math.random());
  btn.dataset.menuFrom = key;
  menuEl = document.createElement('div');
  menuEl.className = 'menu';
  menuEl.setAttribute('role', 'menu');
  menuEl.dataset.from = key;
  menuEl.innerHTML = items.map((it) => it === '-' ? '<hr>' : `<button role="menuitem" class="${it.danger ? 'danger' : ''}" data-m="${it.act}">${icon(it.icon, 16)}<span>${esc(it.label)}</span></button>`).join('');
  document.body.append(menuEl);
  const r = btn.getBoundingClientRect();
  const w = menuEl.offsetWidth;
  const h = menuEl.offsetHeight;
  menuEl.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.right - w))}px`;
  menuEl.style.top = `${r.bottom + h + 8 > innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4}px`;
  addEventListener('pointerdown', onAway, true);
  addEventListener('keydown', onMenuKey, true);
  addEventListener('resize', closeMenu);
  menuEl.querySelector('button')?.focus();
  return menuEl;
}

function classMenu(btn, id) {
  const c = find(id);
  const m = openMenu(btn, [
    { act: 'open', icon: 'book', label: 'Open class' },
    { act: 'edit', icon: 'edit', label: 'Edit details' },
    { act: 'fav', icon: 'star', label: c.favorite ? 'Remove from favorites' : 'Add to favorites' },
    { act: 'group', icon: 'folder', label: 'Move to a group...' },
    { act: 'password', icon: 'lock', label: lock.isLocked(c) ? 'Change or remove password' : 'Add a password' },
    '-',
    { act: 'archive', icon: 'archive', label: c.archived ? 'Restore from archive' : 'Archive' },
    { act: 'delete', icon: 'trash', label: 'Delete class', danger: true },
  ]);
  m.addEventListener('click', (e) => { const a = e.target.closest('[data-m]')?.dataset.m; if (!a) return; closeMenu(); classAction(id, a); });
}

function groupMenu(btn, gid) {
  const m = openMenu(btn, [{ act: 'rename', icon: 'edit', label: 'Rename group' }, { act: 'deletegroup', icon: 'trash', label: 'Delete group', danger: true }]);
  m.addEventListener('click', (e) => { const a = e.target.closest('[data-m]')?.dataset.m; if (!a) return; closeMenu(); groupAction(gid, a); });
}

/* ---------- events ---------- */
function onClick(e) {
  root.querySelectorAll('.more-actions[open]').forEach((menu) => { if (!menu.contains(e.target)) menu.open = false; });
  const nav = e.target.closest('[data-view]');
  if (nav) { ui.view = nav.dataset.view; sfx.play('tab'); paint(); return; }
  const actEl = e.target.closest('[data-act]');
  const act = actEl?.dataset.act;
  const cardEl = e.target.closest('.book-card');
  if (act === 'logout') return access.signOut();
  if (act === 'open' && actEl.dataset.id) return openClass(actEl.dataset.id);
  if (act === 'create') return createClass();
  if (act === 'newgroup') return newGroup();
  if (act === 'clear') { ui.q = ''; ui.subject = ''; root.querySelector('#libQ').value = ''; return paint(); }
  if (act === 'groupmenu') return groupMenu(actEl, actEl.dataset.gid);
  if (act === 'menu' && cardEl) return classMenu(actEl, cardEl.dataset.id);
  if (cardEl) return openClass(cardEl.dataset.id); // anywhere else on the card, or its name button
}

function onHover(e) {
  const id = e.target.closest?.('.book-card')?.dataset.id;
  if (id && id !== ui.preview) { ui.preview = id; paintPreview(); }
}

function onInput(e) {
  if (e.target.id === 'libQ') { ui.q = e.target.value; paint(); }
  else if (e.target.id === 'libSubject') { ui.subject = e.target.value; paint(); }
  else if (e.target.id === 'libSort') { ui.sort = e.target.value; paint(); }
}

/** Drag a book onto a group, My classes, Favorites or Archived in the sidebar. */
function bindDrag() {
  let dragId = null;
  root.addEventListener('dragstart', (e) => {
    const c = e.target.closest?.('.book-card');
    if (!c) return;
    dragId = c.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
    c.classList.add('dragging');
    closeMenu();
  });
  root.addEventListener('dragend', () => { dragId = null; root.querySelectorAll('.dragging, .drop').forEach((x) => x.classList.remove('dragging', 'drop')); });
  root.addEventListener('dragover', (e) => { const t = e.target.closest('[data-drop]'); if (dragId && t) { e.preventDefault(); t.classList.add('drop'); } });
  root.addEventListener('dragleave', (e) => e.target.closest?.('[data-drop]')?.classList.remove('drop'));
  root.addEventListener('drop', (e) => {
    const t = e.target.closest('[data-drop]');
    if (!dragId || !t) return;
    e.preventDefault();
    if (!access.guard()) return;
    const v = t.dataset.drop;
    const id = dragId;
    const c = find(id);
    if (!c) return;
    if (v === 'all') store.updateClassById(id, { groupId: null, archived: false });
    else if (v === 'fav') store.updateClassById(id, { favorite: true, archived: false });
    else if (v === 'archived') store.updateClassById(id, { archived: true });
    else if (v.startsWith('g:')) store.updateClassById(id, { groupId: v.slice(2), archived: false });
    sfx.play('pop');
    toast(`${c.name} moved.`);
  });
}

/* ---------- the preview panel: a small look inside the class under the pointer ---------- */
function previewClass() {
  const st = store.getState();
  return find(ui.preview) || find(st.currentClassId) || st.classes.find((c) => !c.archived) || st.classes[0];
}

function paintPreview() {
  const box = root?.querySelector('#libPreview');
  if (!box) return;
  const c = previewClass();
  if (!c) { box.innerHTML = ''; return; }
  const cur = store.getState().currentClassId === c.id;
  const head = `<div class="pv-label"><span>${ui.preview && !cur ? 'Preview' : 'Opened class'}</span>${cur ? '<span class="pv-pill"><i></i>Active</span>' : ''}</div>`;
  const sub = [c.subject, c.room].filter(Boolean).join(' · ');
  if (lock.isLocked(c) && !lock.isOpen(c)) {
    box.innerHTML = `${head}<div class="pv-book" style="--book:${esc(c.color || store.BOOK_COLORS[0])}"><div class="pv-sheet pv-locked">
      <span class="pv-lockic">${icon('lock', 30)}</span><h3>${esc(c.name)}</h3><p class="muted">This class has a password. Open it to see inside.</p>
      <button class="btn primary" data-act="open" data-id="${c.id}">Unlock and open</button></div></div>`;
    return;
  }
  const set = store.settings();
  const date = today();
  const d = dayStats(c, date, set);
  const students = activeStudents(c);
  const rec = c.records[date] || {};
  const pct = (n) => (d.total ? (n / d.total) * 100 : 0);
  const shown = students.slice(0, 4);
  box.innerHTML = `${head}
    <div class="pv-book" style="--book:${esc(c.color || store.BOOK_COLORS[0])}">
      <div class="pv-sheet">
        <header class="pv-head"><span class="pv-ic">${icon('book', 18)}</span><div><b>${esc(c.name)}</b><small>${esc(sub || (set.term || 'Attendance book'))}</small></div></header>
        <p class="pv-eyebrow">Today</p>
        <h3 class="pv-date">${esc(fmt.long(date).replace(/,? \d{4}$/, ''))}</h3>
        <div class="pv-card">
          <p class="pv-eyebrow">Today's attendance</p>
          <div class="pv-bar" role="img" aria-label="${d.P + d.L} present, ${d.A} absent, ${d.E} excused, ${d.unmarked} not marked">
            <i class="st-P" style="width:${pct(d.P + d.L)}%"></i><i class="st-A" style="width:${pct(d.A)}%"></i><i class="st-E" style="width:${pct(d.E)}%"></i></div>
          <p class="pv-legend"><span><i class="dot st-P"></i>${d.P + d.L} present</span><span><i class="dot st-A"></i>${d.A} absent</span>${d.E ? `<span><i class="dot st-E"></i>${d.E} excused</span>` : ''}${d.unmarked ? `<span class="muted">${d.unmarked} not marked</span>` : ''}</p>
        </div>
        <p class="pv-eyebrow pv-students">Students <span>${plural(students.length, 'student')}</span></p>
        ${shown.length ? `<ul class="pv-list">${shown.map((s) => { const k = rec[s.id]?.s; return `<li>${avatar(s, 30)}<span class="pv-name">${esc(s.name)}</span>${k ? `<em class="chip st-${k}">${STATUS[k].label}</em>` : '<em class="pv-none">Not marked</em>'}</li>`; }).join('')}</ul>
          ${students.length > shown.length ? `<p class="muted small pv-more">and ${students.length - shown.length} more</p>` : ''}` : '<p class="muted small">No students yet. Add them on the Roster page.</p>'}
        <button class="btn primary pv-open" data-act="open" data-id="${c.id}">Open full class ${icon('right', 16)}</button>
      </div>
    </div>
    <p class="muted small pv-foot">Inside each book: Today, Roster, Calendar, Reports, Settings</p>`;
}
