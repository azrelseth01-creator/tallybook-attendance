import * as store from '../core/store.js';
import * as access from '../core/access.js';
import { esc } from '../core/utils.js';
import { avatar, ICONS, COLORS } from './avatar.js';
import { openDialog } from './modal.js';
import { toast } from './toast.js';
import * as sfx from '../services/audio.js';
import { readImage, mountCropper } from './photo.js';

/** Add (student = null) or edit a student. Resolves to the saved student or null. */
export async function openStudentDialog(student = null) {
  if (!access.guard()) return null;
  const draft = {
    name: student?.name || '', icon: student?.icon || ICONS[Math.floor(Math.random() * ICONS.length)],
    color: student?.color || COLORS[Math.floor(Math.random() * COLORS.length)],
    photo: student?.photo || '',
  };
  const body = `
    <div class="sf">
      <div class="sf-preview" id="sfPreview">${avatar({ ...draft, name: draft.name || '?' }, 72)}</div>
      <div class="sf-photo">
        <div class="sf-photo-btns">
          <button type="button" class="btn" id="sfUpload">Upload photo</button>
          <button type="button" class="btn ghost" id="sfRemovePhoto" hidden>Remove photo</button>
          <input type="file" id="sfFile" accept="image/*" hidden>
        </div>
        <p class="muted small">Optional. Any picture up to 10 MB. It replaces the icon below.</p>
        <div id="sfCrop"></div>
      </div>
      <label class="field"><span>Full name</span>
        <input id="sfName" type="text" autocomplete="off" maxlength="60" value="${esc(draft.name)}" placeholder="e.g. Maya Santos" autofocus></label>
      <div class="field"><span>Icon</span>
        <div class="pick-grid" id="sfIcons" role="radiogroup" aria-label="Icon">
          <button type="button" class="pick pick-init" data-icon="initials" aria-label="Use initials" title="Use initials">Aa</button>
          ${ICONS.map((i) => `<button type="button" class="pick" data-icon="${i}" role="radio" aria-label="${i}">${i}</button>`).join('')}
        </div></div>
      <div class="field"><span>Sticker colour</span>
        <div class="pick-row" id="sfColors">${COLORS.map((c) => `<button type="button" class="swatch" data-color="${c}" style="--c:${c}" aria-label="Colour ${c}"></button>`).join('')}</div></div>
      <div class="field-row">
        <label class="field"><span>Parent or guardian</span><input id="sfGuardian" type="text" maxlength="60" value="${esc(student?.guardian || '')}"></label>
        <label class="field"><span>Contact number</span><input id="sfPhone" type="tel" maxlength="30" value="${esc(student?.phone || '')}"></label>
      </div>
      <label class="field"><span>Notes for you (allergies, seating needs, reminders)</span>
        <textarea id="sfNotes" rows="3" maxlength="500">${esc(student?.notes || '')}</textarea></label>
      ${student ? `<label class="check"><input type="checkbox" id="sfArchived" ${student.active === false ? 'checked' : ''}> <span>Left the class (hide from roll call, keep their records)</span></label>` : ''}
    </div>`;

  return openDialog({
    title: student ? 'Edit student' : 'Add student', body, wide: true,
    onOpen(dlg) {
      const preview = dlg.querySelector('#sfPreview');
      const nameEl = dlg.querySelector('#sfName');
      const fileEl = dlg.querySelector('#sfFile');
      const cropHost = dlg.querySelector('#sfCrop');
      const removeBtn = dlg.querySelector('#sfRemovePhoto');
      let cropper = null;
      const paint = () => {
        removeBtn.hidden = !draft.photo;
        dlg.querySelector('#sfUpload').textContent = draft.photo ? 'Change photo' : 'Upload photo';
        dlg.querySelector('#sfIcons').classList.toggle('dim', Boolean(draft.photo));
        preview.innerHTML = avatar({ ...draft, name: nameEl.value || '?' }, 72);
        dlg.querySelectorAll('#sfIcons .pick').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.icon === draft.icon)));
        dlg.querySelectorAll('#sfColors .swatch').forEach((b) => b.classList.toggle('on', b.dataset.color === draft.color));
      };
      dlg.querySelector('#sfIcons').onclick = (e) => { const b = e.target.closest('.pick'); if (b) { draft.icon = b.dataset.icon; draft.photo = ''; cropper?.destroy(); cropper = null; sfx.play('tap'); paint(); } };
      dlg.querySelector('#sfUpload').onclick = () => fileEl.click();
      removeBtn.onclick = () => { draft.photo = ''; cropper?.destroy(); cropper = null; sfx.play('tap'); paint(); };
      fileEl.onchange = async () => {
        const file = fileEl.files[0];
        fileEl.value = ''; // so choosing the same file again still fires
        if (!file) return;
        try {
          const loaded = await readImage(file);
          cropper?.destroy();
          cropper = mountCropper(cropHost, loaded, (dataUrl) => { draft.photo = dataUrl; paint(); });
          sfx.play('pop');
        } catch (err) {
          toast(err.message, { type: 'error', duration: 7000 });
          sfx.play('error');
        }
      };
      dlg.querySelector('#sfColors').onclick = (e) => { const b = e.target.closest('.swatch'); if (b) { draft.color = b.dataset.color; sfx.play('tap'); paint(); } };
      nameEl.addEventListener('input', paint);
      nameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') dlg.querySelector('.btn.primary').click(); });
      paint();
    },
    actions: [
      { label: 'Cancel', value: null, kind: 'ghost' },
      {
        label: student ? 'Save changes' : 'Add student', kind: 'primary',
        run(dlg) {
          const name = dlg.querySelector('#sfName').value.trim();
          if (!name) { toast('Type the student’s name first.', { type: 'error' }); dlg.querySelector('#sfName').focus(); return false; }
          const data = {
            name, icon: draft.icon, color: draft.color, photo: draft.photo || '',
            guardian: dlg.querySelector('#sfGuardian').value.trim(), phone: dlg.querySelector('#sfPhone').value.trim(),
            notes: dlg.querySelector('#sfNotes').value.trim(),
          };
          if (student) {
            data.active = !dlg.querySelector('#sfArchived').checked;
            store.updateStudent(student.id, data);
            return { ...student, ...data };
          }
          sfx.play('pop');
          return store.addStudent(data);
        },
      },
    ],
  });
}
