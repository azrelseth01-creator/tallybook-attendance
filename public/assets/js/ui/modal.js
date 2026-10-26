// Native <dialog> wrapper: focus trap, Esc to close and backdrop click come for free.
import { esc } from '../core/utils.js';
import { icon } from './icons.js';

/**
 * openDialog({ title, body, actions: [{ label, value, kind: 'primary'|'danger'|'ghost', run(dlg) }], wide, onOpen })
 * Resolves with the clicked action's value (or whatever run() returns), or null if dismissed.
 * run() returning `false` keeps the dialog open (use it for validation).
 */
export function openDialog({ title, body, actions = [], wide = false, cls = '', onOpen }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = `dlg ${wide ? 'wide' : ''} ${cls}`;
    dlg.innerHTML = `
      <div class="dlg-in">
        <header class="dlg-h"><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-x aria-label="Close">${icon('x', 18)}</button></header>
        <div class="dlg-b">${body}</div>
        ${actions.length ? '<footer class="dlg-f"></footer>' : ''}
      </div>`;
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      dlg.classList.add('closing');
      setTimeout(() => { dlg.close(); dlg.remove(); }, 140);
      resolve(value);
    };
    const foot = dlg.querySelector('.dlg-f');
    actions.forEach((a) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `btn ${a.kind || 'ghost'}`;
      b.textContent = a.label;
      b.onclick = async () => {
        const r = a.run ? await a.run(dlg) : a.value;
        if (r === false) return;
        finish(r === undefined ? a.value : r);
      };
      foot.append(b);
    });
    dlg.querySelector('[data-x]').onclick = () => finish(null);
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
    dlg.addEventListener('mousedown', (e) => { if (e.target === dlg) finish(null); });
    document.body.append(dlg);
    dlg.showModal();
    onOpen?.(dlg, finish);
    (dlg.querySelector('[autofocus]') || dlg.querySelector('input,textarea,select'))?.focus();
  });
}

export async function confirmBox({ title, message, confirmLabel = 'Confirm', danger = false }) {
  const r = await openDialog({
    title, body: `<p class="dlg-msg">${esc(message)}</p>`,
    actions: [
      { label: 'Cancel', value: false, kind: 'ghost' },
      { label: confirmLabel, value: true, kind: danger ? 'danger' : 'primary' },
    ],
  });
  return r === true;
}

/** Ask for a line (or paragraph) of text. Resolves with the string, or null if cancelled. */
export async function promptBox({ title, label, value = '', placeholder = '', multiline = false, confirmLabel = 'Save', allowEmpty = true }) {
  const field = multiline
    ? `<textarea id="pbIn" rows="4" maxlength="600" placeholder="${esc(placeholder)}" autofocus>${esc(value)}</textarea>`
    : `<input id="pbIn" type="text" maxlength="120" value="${esc(value)}" placeholder="${esc(placeholder)}" autofocus>`;
  return openDialog({
    title,
    body: `<label class="field"><span>${esc(label)}</span>${field}</label>`,
    onOpen(dlg) {
      dlg.querySelector('#pbIn').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (!multiline || e.ctrlKey || e.metaKey)) { e.preventDefault(); dlg.querySelector('.btn.primary').click(); }
      });
    },
    actions: [
      { label: 'Cancel', value: null, kind: 'ghost' },
      { label: confirmLabel, kind: 'primary', run: (dlg) => { const v = dlg.querySelector('#pbIn').value.trim(); return !allowEmpty && !v ? false : v; } },
    ],
  });
}
