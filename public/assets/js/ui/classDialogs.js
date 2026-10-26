// Dialogs for classes: unlock, create, edit details, password, move to a group.
import * as store from '../core/store.js';
import * as lock from '../core/lock.js';
import * as access from '../core/access.js';
import { esc } from '../core/utils.js';
import { openDialog } from './modal.js';
import { toast } from './toast.js';
import * as sfx from '../services/audio.js';
import * as loader from './loader.js';

const find = (id) => store.getState().classes.find((c) => c.id === id);
const shake = (dlg) => { const box = dlg.querySelector('.dlg-in'); box.classList.remove('nope'); void box.offsetWidth; box.classList.add('nope'); };
const say = (dlg, id, msg) => { const el = dlg.querySelector(id); if (el) el.textContent = msg; };
const swatches = (colors, current) => colors.map((c) => `<button type="button" class="swatch ${c === current ? 'on' : ''}" data-color="${c}" style="--c:${c}" aria-label="Book colour ${c}"></button>`).join('');

/** Asks for the password if the class is locked. Resolves true when it is (or already was) open. */
export async function promptUnlock(c) {
  if (lock.isOpen(c)) return true;
  const hint = c.lock.hint ? `<p class="muted small">Hint: ${esc(c.lock.hint)}</p>` : '';
  const ok = await openDialog({
    title: 'This class is locked',
    body: `<p class="dlg-msg"><b>${esc(c.name)}</b> has a password.</p>
      <label class="field"><span>Password</span><input id="ulPw" type="password" autocomplete="off" autofocus></label>${hint}
      <p class="form-error" id="ulErr" role="alert"></p>`,
    onOpen(dlg) { dlg.querySelector('#ulPw').addEventListener('keydown', (e) => { if (e.key === 'Enter') dlg.querySelector('.btn.primary').click(); }); },
    actions: [
      { label: 'Cancel', value: null, kind: 'ghost' },
      {
        label: 'Unlock', kind: 'primary',
        async run(dlg) {
          const input = dlg.querySelector('#ulPw');
          if (!input.value) { input.focus(); return false; }
          try {
            const r = await lock.attempt(c, input.value);
            if (r.ok) { sfx.play('success'); return true; }
            say(dlg, '#ulErr', r.wait ? `Too many wrong tries. Wait ${r.wait} seconds and try again.` : 'That is not the password.');
          } catch (err) { say(dlg, '#ulErr', err.message); }
          sfx.play('error'); shake(dlg); input.select();
          return false;
        },
      },
    ],
  });
  return ok === true;
}

/** Makes `id` the open class, asking for its password first when it has one. */
export async function enterClass(id) {
  const c = find(id);
  if (!c) return false;
  if (!(await promptUnlock(c))) return false;
  // Opening a class: the loading screen covers the change, in the class's own colour.
  loader.cover({ kicker: 'Opening class', title: c.name, sub: 'Finding your roster and tallies…', color: c.color, min: 0 });
  store.switchClass(id);
  return true;
}

/** New class, or edit one. Resolves to the class, or null if cancelled. */
export async function classFormDialog({ cls = null, groupId = null } = {}) {
  if (!access.guard()) return null;
  const draft = { color: cls?.color || store.BOOK_COLORS[store.getState().classes.length % store.BOOK_COLORS.length] };
  const groups = store.groups();
  const startGroup = cls ? cls.groupId : groupId;
  const body = `
    <label class="field"><span>Class name</span><input id="cfName" type="text" maxlength="60" value="${esc(cls?.name || '')}" placeholder="Grade 5 - Sunflower" autofocus></label>
    <div class="field-row">
      <label class="field"><span>Subject</span><input id="cfSubject" type="text" maxlength="60" value="${esc(cls?.subject || '')}" placeholder="Homeroom, Science"></label>
      <label class="field"><span>Room</span><input id="cfRoom" type="text" maxlength="30" value="${esc(cls?.room || '')}" placeholder="Room 12"></label>
    </div>
    <div class="field-row">
      <label class="field"><span>Group</span><select id="cfGroup"><option value="">No group</option>${groups.map((g) => `<option value="${g.id}" ${g.id === startGroup ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select></label>
      <label class="field"><span>Or start a new group</span><input id="cfNewGroup" type="text" maxlength="40" placeholder="e.g. Grade 5"></label>
    </div>
    <div class="field"><span>Book colour</span><div class="pick-row" id="cfColors">${swatches(store.BOOK_COLORS, draft.color)}</div></div>
    ${cls ? '' : `<details class="pw-box"><summary>Add a password (optional)</summary>
      <div class="field-row">
        <label class="field"><span>Password</span><input id="cfPw" type="password" autocomplete="new-password" placeholder="At least ${lock.MIN_LENGTH} characters"></label>
        <label class="field"><span>Type it again</span><input id="cfPw2" type="password" autocomplete="new-password"></label>
      </div>
      <label class="field"><span>Hint (shown on the lock screen)</span><input id="cfHint" type="text" maxlength="80" placeholder="Something only you would know"></label>
      <p class="muted small">Keeps others out of this class in the app. It does not encrypt the data stored in the browser or in backups.</p></details>`}
    <p class="form-error" id="cfErr" role="alert"></p>`;

  return openDialog({
    title: cls ? 'Edit class details' : 'Create a class', body, wide: true,
    onOpen(dlg) {
      dlg.querySelector('#cfColors').onclick = (e) => {
        const b = e.target.closest('.swatch');
        if (!b) return;
        draft.color = b.dataset.color; sfx.play('tap');
        dlg.querySelectorAll('#cfColors .swatch').forEach((x) => x.classList.toggle('on', x === b));
      };
      dlg.querySelector('#cfName').addEventListener('keydown', (e) => { if (e.key === 'Enter') dlg.querySelector('.btn.primary').click(); });
    },
    actions: [
      { label: 'Cancel', value: null, kind: 'ghost' },
      {
        label: cls ? 'Save changes' : 'Create class', kind: 'primary',
        async run(dlg) {
          const name = dlg.querySelector('#cfName').value.trim();
          if (!name) { say(dlg, '#cfErr', 'Give the class a name first.'); dlg.querySelector('#cfName').focus(); return false; }
          let newLock = null;
          if (!cls) {
            const pw = dlg.querySelector('#cfPw').value;
            const pw2 = dlg.querySelector('#cfPw2').value;
            if (pw || pw2) {
              if (pw.length < lock.MIN_LENGTH) { say(dlg, '#cfErr', `Use at least ${lock.MIN_LENGTH} characters for the password.`); dlg.querySelector('details').open = true; return false; }
              if (pw !== pw2) { say(dlg, '#cfErr', 'The two passwords do not match.'); dlg.querySelector('details').open = true; return false; }
              try { newLock = await lock.makeLock(pw, dlg.querySelector('#cfHint').value); } catch (err) { say(dlg, '#cfErr', err.message); return false; }
            }
          }
          const fresh = dlg.querySelector('#cfNewGroup').value.trim();
          const gid = fresh ? store.addGroup(fresh).id : dlg.querySelector('#cfGroup').value || null;
          const data = { subject: dlg.querySelector('#cfSubject').value.trim(), room: dlg.querySelector('#cfRoom').value.trim(), color: draft.color, groupId: gid };
          if (cls) { store.updateClassById(cls.id, { name, ...data }); return find(cls.id); }
          const made = store.addClass(name, { ...data, lock: newLock }, { open: false });
          if (newLock) lock.markOpen(made.id); // you just typed it: no need to ask again until you leave the library
          sfx.play('pop');
          return made;
        },
      },
    ],
  });
}

/** Set, change or remove a class password. Resolves true when something changed. */
export async function passwordDialog(c) {
  if (!access.guard()) return false;
  const locked = lock.isLocked(c);
  const body = `
    ${locked ? `<label class="field"><span>Current password</span><input id="pwOld" type="password" autocomplete="off" autofocus></label>` : '<p class="dlg-msg">Anyone opening this class from the library will need the password.</p>'}
    <div class="field-row">
      <label class="field"><span>${locked ? 'New password' : 'Password'}</span><input id="pwNew" type="password" autocomplete="new-password" placeholder="At least ${lock.MIN_LENGTH} characters" ${locked ? '' : 'autofocus'}></label>
      <label class="field"><span>Type it again</span><input id="pwNew2" type="password" autocomplete="new-password"></label>
    </div>
    <label class="field"><span>Hint (shown on the lock screen)</span><input id="pwHint" type="text" maxlength="80" value="${esc(c.lock?.hint || '')}" placeholder="Something only you would know"></label>
    <p class="muted small">There is no way to recover a forgotten password, so keep a backup from Settings. The password keeps others out of the app; it does not encrypt what the browser stores or what a backup file contains.</p>
    <p class="form-error" id="pwErr" role="alert"></p>`;

  const actions = [{ label: 'Cancel', value: null, kind: 'ghost' }];
  const checkOld = async (dlg) => {
    if (!locked) return true;
    const old = dlg.querySelector('#pwOld');
    if (!old.value) { say(dlg, '#pwErr', 'Type the current password first.'); old.focus(); return false; }
    const r = await lock.attempt(c, old.value).catch((err) => ({ ok: false, error: err.message }));
    if (r.ok) return true;
    say(dlg, '#pwErr', r.error || (r.wait ? `Too many wrong tries. Wait ${r.wait} seconds.` : 'The current password is not right.'));
    sfx.play('error'); shake(dlg); old.select();
    return false;
  };
  if (locked) {
    actions.push({
      label: 'Remove password', kind: 'danger',
      async run(dlg) {
        if (!(await checkOld(dlg))) return false;
        store.updateClassById(c.id, { lock: null });
        lock.relock(c.id);
        toast(`Password removed from ${c.name}.`);
        return true;
      },
    });
  }
  actions.push({
    label: locked ? 'Change password' : 'Set password', kind: 'primary',
    async run(dlg) {
      if (!(await checkOld(dlg))) return false;
      const pw = dlg.querySelector('#pwNew').value;
      if (locked && !pw) { // only the hint changed
        store.updateClassById(c.id, { lock: { ...c.lock, hint: dlg.querySelector('#pwHint').value.trim().slice(0, 80) } });
        toast('Hint updated.');
        return true;
      }
      if (pw.length < lock.MIN_LENGTH) { say(dlg, '#pwErr', `Use at least ${lock.MIN_LENGTH} characters.`); dlg.querySelector('#pwNew').focus(); return false; }
      if (pw !== dlg.querySelector('#pwNew2').value) { say(dlg, '#pwErr', 'The two passwords do not match.'); return false; }
      try { store.updateClassById(c.id, { lock: await lock.makeLock(pw, dlg.querySelector('#pwHint').value) }); } catch (err) { say(dlg, '#pwErr', err.message); return false; }
      lock.markOpen(c.id);
      sfx.play('success');
      toast(locked ? 'Password changed.' : `${c.name} now has a password.`);
      return true;
    },
  });
  const done = await openDialog({ title: locked ? 'Class password' : 'Add a class password', body, actions });
  return done === true;
}

/** Pick a group (or none) for a class. Resolves true when saved. */
export async function moveToGroupDialog(c) {
  if (!access.guard()) return false;
  const groups = store.groups();
  const done = await openDialog({
    title: `Move ${c.name}`,
    body: `<label class="field"><span>Group</span><select id="mgSel" autofocus><option value="">No group</option>${groups.map((g) => `<option value="${g.id}" ${g.id === c.groupId ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select></label>
      <label class="field"><span>Or start a new group</span><input id="mgNew" type="text" maxlength="40" placeholder="e.g. Science classes"></label>`,
    actions: [
      { label: 'Cancel', value: null, kind: 'ghost' },
      { label: 'Move', kind: 'primary', run(dlg) { const fresh = dlg.querySelector('#mgNew').value.trim(); store.updateClassById(c.id, { groupId: fresh ? store.addGroup(fresh).id : dlg.querySelector('#mgSel').value || null }); return true; } },
    ],
  });
  return done === true;
}
