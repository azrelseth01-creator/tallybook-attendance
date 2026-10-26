// Guided roll call: one student at a time, big buttons, keyboard friendly.
import * as store from '../core/store.js';
import * as access from '../core/access.js';
import { fmt } from '../core/dates.js';
import { STATUS, STATUS_KEYS, activeStudents, studentStats } from '../core/stats.js';
import { esc, firstName, plural } from '../core/utils.js';
import { avatar } from '../ui/avatar.js';
import { icon } from '../ui/icons.js';
import { feedbackFor, celebrate } from '../ui/feedback.js';
import { toast } from '../ui/toast.js';
import * as sfx from '../services/audio.js';

export function startRollCall(date) {
  if (!access.guard()) return;
  const c = store.cls();
  const set = store.settings();
  const list = activeStudents(c);
  if (!list.length) { toast('Add students to your roster first, then start roll call.', { type: 'error' }); return; }

  let i = Math.max(0, list.findIndex((s) => !c.records[date]?.[s.id]));
  if (list.every((s) => c.records[date]?.[s.id])) i = 0;
  let finished = false;

  const dlg = document.createElement('dialog');
  dlg.className = 'rc';
  dlg.setAttribute('aria-label', 'Roll call');
  document.body.append(dlg);

  const close = () => { sfx.stopSpeaking(); removeEventListener('keydown', onKey, true); dlg.close(); dlg.remove(); };

  function show() {
    if (i >= list.length) return summary();
    const s = list[i];
    const stat = studentStats(c, s.id, set);
    const cur = store.cls().records[date]?.[s.id]?.s;
    dlg.innerHTML = `
      <header class="rc-h">
        <button class="btn ghost" data-act="exit">${icon('x', 16)} Exit roll call</button>
        <div class="rc-prog" role="progressbar" aria-valuemin="0" aria-valuemax="${list.length}" aria-valuenow="${i}"><i style="width:${(i / list.length) * 100}%"></i></div>
        <span class="rc-count">${i + 1} of ${list.length}</span>
      </header>
      <main class="rc-main">
        <p class="hand rc-date">${fmt.long(date)}</p>
        <div class="rc-av" id="rcAv">${avatar(s, 150)}</div>
        <h2 class="rc-name">${esc(s.name)}</h2>
        <p class="rc-sub">${stat.A ? plural(stat.A, 'absence') + ' so far' : 'No absences so far'}${stat.flag ? ' &middot; at the limit' : ''}</p>
        <div class="rc-btns" role="group" aria-label="Mark ${esc(s.name)}">
          ${STATUS_KEYS.map((k) => `<button class="rc-b b-${k}" data-s="${k}" aria-pressed="${cur === k}"><kbd>${k}</kbd><span>${STATUS[k].label}</span></button>`).join('')}
        </div>
        <div class="rc-nav">
          <button class="btn ghost" data-act="back" ${i === 0 ? 'disabled' : ''}>${icon('left', 16)} Back</button>
          <button class="btn ghost" data-act="skip">Skip ${icon('right', 16)}</button>
        </div>
      </main>`;
    dlg.querySelector('.rc-b').focus({ preventScroll: true });
    if (set.sound.speakNames) sfx.speak(firstName(s.name));
  }

  function choose(k, btn) {
    const s = list[i];
    const now = store.cls().records[date]?.[s.id]?.s;
    const status = now === k ? null : k;
    store.mark([{ date, sid: s.id, s: status }], `${s.name}: ${STATUS[k].label}`);
    feedbackFor(status, dlg.querySelector('#rcAv'));
    dlg.querySelector('.rc-main')?.classList.add('flash');
    if (status === null) return show();
    setTimeout(() => { i++; show(); }, 260);
  }

  function summary() {
    finished = true;
    const day = store.cls().records[date] || {};
    const counts = { P: 0, A: 0, L: 0, E: 0 };
    list.forEach((s) => { const k = day[s.id]?.s; if (k) counts[k]++; });
    const missing = list.filter((s) => day[s.id]?.s === 'A');
    const unmarked = list.filter((s) => !day[s.id]?.s).length;
    const perfect = counts.P === list.length;
    dlg.innerHTML = `
      <main class="rc-main rc-done">
        <h2 class="rc-name">${perfect ? 'Everyone is here!' : 'Roll call finished'}</h2>
        <p class="hand rc-date">${fmt.long(date)}</p>
        <ul class="rc-sum">${STATUS_KEYS.map((k) => `<li class="n-${k}"><b>${counts[k]}</b> ${STATUS[k].label}</li>`).join('')}${unmarked ? `<li class="n-U"><b>${unmarked}</b> Not marked</li>` : ''}</ul>
        ${missing.length ? `<p class="rc-absent">Absent: ${missing.map((s) => esc(s.name)).join(', ')}</p>` : ''}
        <div class="rc-nav"><button class="btn ghost" data-act="again">Go through again</button><button class="btn primary" data-act="exit">Done</button></div>
      </main>`;
    if (perfect) celebrate(dlg.querySelector('.rc-name'));
    else sfx.play('pop');
    dlg.querySelector('.btn.primary').focus();
  }

  dlg.addEventListener('click', (e) => {
    const b = e.target.closest('[data-s]');
    if (b) return choose(b.dataset.s, b);
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'exit') close();
    if (act === 'back' && i > 0) { i--; show(); }
    if (act === 'skip') { i++; show(); }
    if (act === 'again') { i = 0; finished = false; show(); }
  });
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });

  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toUpperCase();
    if (!finished && STATUS_KEYS.includes(k)) { e.preventDefault(); e.stopPropagation(); choose(k); }
    else if (!finished && e.key === 'ArrowLeft' && i > 0) { i--; show(); }
    else if (!finished && e.key === 'ArrowRight') { i++; show(); }
  }
  addEventListener('keydown', onKey, true);

  dlg.showModal();
  sfx.play('page');
  show();
}
