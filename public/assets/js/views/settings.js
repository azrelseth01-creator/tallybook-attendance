// Settings: every general thing the teacher can change, saved the moment it changes.
import * as store from '../core/store.js';
import * as access from '../core/access.js';
import { config } from '../core/config.js';
import { weekdayNames } from '../core/dates.js';
import { bus, debounce, esc, plural } from '../core/utils.js';
import { icon } from '../ui/icons.js';
import { avatar } from '../ui/avatar.js';
import { readImage, mountCropper } from '../ui/photo.js';
import { toast } from '../ui/toast.js';
import { confirmBox, openDialog } from '../ui/modal.js';
import { toolbarHTML, bindToolbar, addFormHTML, bindAddForm, queueHTML, bindQueue } from '../ui/musicbar.js';
import { openDock } from '../ui/dock.js';
import * as sfx from '../services/audio.js';
import * as sync from '../services/sync.js';

let root = null;
let cleanups = [];

const SECTIONS = [
  ['profile', 'Your profile'], ['general', 'School details'], ['rules', 'Attendance rules'], ['look', 'Appearance'],
  ['sound', 'Sound and effects'], ['music', 'Background music'], ['data', 'Data and backup'], ['cloud', 'Privacy and cloud'],
];

const S = (path) => store.getSetting(path);
const val = (v) => esc(v ?? '');

const text = (label, path, { hint = '', placeholder = '', type = 'text' } = {}) =>
  `<label class="field"><span>${label}</span><input type="${type}" data-path="${path}" value="${val(S(path))}" placeholder="${esc(placeholder)}" maxlength="80">${hint ? `<small>${hint}</small>` : ''}</label>`;
const toggle = (label, path, hint = '') =>
  `<label class="switch"><input type="checkbox" role="switch" data-path="${path}" ${S(path) ? 'checked' : ''}><span class="sw-ui" aria-hidden="true"></span><span class="sw-text"><b>${label}</b>${hint ? `<small>${hint}</small>` : ''}</span></label>`;
const slider = (label, path, min, max, step = 1, unit = '') =>
  `<label class="field slider"><span>${label} <output data-out="${path}">${S(path)}${unit}</output></span><input type="range" data-path="${path}" data-unit="${unit}" min="${min}" max="${max}" step="${step}" value="${S(path)}"></label>`;
const number = (label, path, min, max, hint = '') =>
  `<label class="field narrow"><span>${label}</span><input type="number" data-path="${path}" min="${min}" max="${max}" value="${S(path)}" inputmode="numeric">${hint ? `<small>${hint}</small>` : ''}</label>`;
const choice = (label, path, options) =>
  `<fieldset class="field"><legend>${label}</legend><div class="choice">${options.map(([v, l, extra = '']) => `<label class="radio ${extra}"><input type="radio" name="${path}" data-path="${path}" value="${v}" ${S(path) === v ? 'checked' : ''}><span>${extra.startsWith('desk') ? `<i class="swatch-desk ${extra}"></i>` : ''}${l}</span></label>`).join('')}</div></fieldset>`;

export const settings = {
  mount(r, sub) {
    root = r;
    render();
    root.addEventListener('input', onInput);
    root.addEventListener('change', onChange);
    root.addEventListener('click', onClick);
    if (sub) setTimeout(() => root.querySelector(`#sec-${sub}`)?.scrollIntoView({ block: 'start' }), 60);
  },
  update(evt) {
    if (!root) return;
    if (['class', 'import'].includes(evt?.type)) render();
  },
  unmount() { cleanups.forEach((f) => f()); cleanups = []; root = null; },
};

function render() {
  cleanups.forEach((f) => f());
  cleanups = [];
  const days = weekdayNames(0, 'short');
  root.innerHTML = `
    <header class="doc-head"><div><h1>Settings</h1><p class="hand">Changes save as you make them.</p></div></header>
    ${access.canEdit() ? '' : `<div class="callout info">${icon('lock', 18)}<div><strong>View only.</strong> You can change how the app looks and sounds, and play music, but the class details, rules and data are locked. Lock the book and sign in with the admin password to change them.</div></div>`}
    <div class="set-layout">
      <nav class="set-nav" aria-label="Settings sections">${SECTIONS.filter(([key]) => key !== 'cloud' || config.syncEnabled).map(([k, l]) => `<button data-jump="${k}">${l}</button>`).join('')}</nav>
      <div class="set-main">

        <section id="sec-profile" class="set-sec"><h2>Your profile</h2>
          <div class="teacher-profile">
            <div class="teacher-profile-preview" id="stProfilePreview" aria-hidden="true"></div>
            <div class="teacher-profile-fields">
              <label class="field"><span>Display name</span><input id="stProfileName" data-path="teacherName" type="text" value="${val(S('teacherName'))}" maxlength="80" placeholder="Your name" autocomplete="name"></label>
              <div class="teacher-photo-actions">
                <button type="button" class="btn admin-only" id="stPhotoUpload">Upload profile photo</button>
                <button type="button" class="btn ghost admin-only" id="stPhotoRemove" hidden>Remove photo</button>
                <input type="file" id="stPhotoFile" accept="image/*" hidden>
              </div>
              <p class="muted small">Your name and picture appear in the Classes area. Photos are cropped and saved with this browser’s book.</p>
            </div>
            <div class="teacher-photo-crop" id="stPhotoCrop"></div>
          </div>
        </section>

        <section id="sec-general" class="set-sec"><h2>School details</h2>
          <div class="field-row">${text('School name', 'schoolName', { placeholder: 'Maple Grove Elementary' })}</div>
          <div class="field-row">${text('School year', 'academicYear', { placeholder: '2026-2027' })}${text('Term or quarter', 'term', { placeholder: 'Term 4' })}</div>
        </section>


        <section id="sec-rules" class="set-sec"><h2>Attendance rules</h2>
          <fieldset class="field"><legend>School days</legend><div class="day-pick">${days.map((d, i) => `<label class="day-chip"><input type="checkbox" data-day="${i}" ${S('schoolDays').includes(i) ? 'checked' : ''}><span>${d}</span></label>`).join('')}</div>
            <small>Other days are skipped when you move between dates, and counted as non-school days on the calendar.</small></fieldset>
          <div class="field-row">
            ${number('Flag a student at this many absences', 'alertAbsences', 0, 99, 'Set 0 to turn warnings off.')}
            ${number('Lates that count as one absence', 'lateToAbsent', 0, 20, 'Set 0 so lates never add up.')}
          </div>
          ${toggle('Count excused absences toward the total', 'excusedCounts', 'Off by default: excused days are shown but do not add to the absence count or lower the attendance rate.')}
          <label class="field narrow"><span>Week starts on</span><select data-path="weekStart" data-num="1"><option value="0" ${S('weekStart') === 0 ? 'selected' : ''}>Sunday</option><option value="1" ${S('weekStart') === 1 ? 'selected' : ''}>Monday</option></select></label>
        </section>

        <section id="sec-look" class="set-sec"><h2>Appearance</h2>
          ${choice('Desk colour', 'desk', [['navy', 'Navy', 'desk-navy'], ['forest', 'Forest', 'desk-forest'], ['plum', 'Plum', 'desk-plum'], ['graphite', 'Graphite', 'desk-graphite']])}
          ${choice('Paper', 'paper', [['ruled', 'Ruled'], ['grid', 'Graph'], ['plain', 'Plain']])}
          ${choice('Spacing', 'density', [['comfy', 'Comfortable'], ['compact', 'Compact']])}
          ${slider('Text size', 'textScale', 90, 125, 5, '%')}
        </section>

        <section id="sec-sound" class="set-sec"><h2>Sound and effects</h2>
          ${toggle('Sound effects', 'sound.on', 'Stamps, pen ticks and page turns. They are synthesised, so nothing downloads.')}
          ${slider('Effects volume', 'sound.volume', 0, 100, 5, '%')}
          <div class="row-acts" aria-label="Try the sounds">
            <span class="muted">Try:</span>
            ${[['present', 'Present'], ['absent', 'Absent'], ['late', 'Late'], ['excused', 'Excused'], ['success', 'Cheer'], ['page', 'Page turn']].map(([k, l]) => `<button class="btn ghost small" data-sfx="${k}">${l}</button>`).join('')}
          </div>
          ${toggle('Read each name aloud during roll call', 'sound.speakNames', 'Uses your device’s voice. Handy when you are walking around the room.')}
          ${toggle('Visual effects', 'vfx.on', 'Ink splats, sparkles and screen shake when you mark a student.')}
          ${toggle('Confetti when everyone is present', 'vfx.confetti')}
          <p class="muted small">Effects switch off automatically if your device is set to reduce motion.</p>
        </section>

        <section id="sec-music" class="set-sec"><h2>Background music</h2>
          ${toggle('Show the music player', 'music.on', 'Adds a small player at the bottom of the screen.')}
          ${toggle('Start playing on my first tap', 'music.autoplay', 'Browsers do not allow sound until you tap or press a key, so music begins on the first one.')}
          <div class="music-card" id="stMusic">
            ${toolbarHTML()}
            <div class="admin-only">${addFormHTML()}</div>
            ${queueHTML()}
            ${S('music.queue')?.length ? `<div class="row-acts"><button class="btn ghost" data-act="showplayer">${icon('music', 16)} Show the video / Spotify player</button></div>` : ''}
          </div>
          <ul class="notes small muted">
            <li>Paste links from YouTube (a video or a playlist), Spotify (a track, album or playlist) or a direct .mp3 file.</li>
            <li>YouTube and mp3 volume is controlled by the slider. Spotify has its own volume inside its player.</li>
            <li>Spotify plays full songs only when this browser is signed in to Spotify. Otherwise it plays 30 second previews.</li>
            <li>Some YouTube videos block embedding and will be skipped.</li>
          </ul>
        </section>

        <section id="sec-data" class="set-sec"><h2>Data and backup</h2>
          <p class="muted">Everything is stored in this browser on this device. Download a backup now and then, especially before clearing browser data.</p>
          <div class="row-acts">
            <button class="btn primary" data-act="export">${icon('download', 16)} Download backup</button>
            <label class="btn file-btn admin-only">${icon('upload', 16)} Restore from backup<input type="file" id="stImport" accept="application/json,.json" hidden></label>
            <button class="btn admin-only" data-act="sample">Add a sample class</button>
          </div>
          <details class="danger-zone admin-only"><summary>Reset everything</summary>
            <p>This deletes every class, student and record from this browser. Download a backup first if you might want them back.</p>
            <button class="btn danger" data-act="reset">Delete all data</button></details>
        </section>

        <section id="sec-cloud" class="set-sec" ${config.syncEnabled ? '' : 'hidden'}><h2>Privacy and cloud</h2>
          <dl class="env-list" id="stEnv"></dl>
        </section>
      </div>
    </div>`;
  paintEnv();
  cleanups.push(bindTeacherProfile());
  const musicBox = root.querySelector('#stMusic');
  cleanups.push(bindToolbar(musicBox), bindQueue(musicBox));
  bindAddForm(musicBox);
  cleanups.push(bus.on('sync', paintEnv));
  if (!access.canEdit()) {
    // look-and-sound settings stay usable; class details, rules and data are greyed out
    root.querySelectorAll('[data-path]').forEach((i) => { if (!access.viewerMayChange(i.dataset.path)) i.disabled = true; });
    root.querySelectorAll('[data-day]').forEach((i) => { i.disabled = true; });
  }
}

function paintEnv() {
  const box = root?.querySelector('#stEnv');
  if (!box) return;
  const s = sync.sync;
  const statusText = { off: 'Not set up', idle: 'Ready', syncing: 'Syncing…', ok: s.at ? `Up to date, ${new Date(s.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Up to date', error: `Problem: ${s.message}` }[s.status];
  box.innerHTML = `
    <div><dt>Defaults from environment variables</dt><dd>${config.fromEnv ? 'Loaded from your Vercel project. They fill in a brand-new book only, and your changes here take priority.' : 'Not available (the app is being served without its /api folder).'}</dd></div>
    <div><dt>Password screen</dt><dd>Always on. You are signed in as <b>${access.isAdmin() ? 'admin (can add and edit; class passwords still apply)' : 'view only (can open everything, cannot change anything)'}</b>. The two passwords are checked on the server and come from the NORMAL_PASSWORD and ADMIN_PASSWORD variables in Vercel.</dd></div>
    <div><dt>Cloud sync</dt><dd>${config.syncEnabled ? `${esc(statusText)}<div class="row-acts"><button class="btn small admin-only" data-act="syncnow">${icon('cloud', 15)} Save to cloud now</button><button class="btn ghost small" data-act="pullnow">Load from cloud</button></div>` : 'Off. Add UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in Vercel to follow your class book across devices.'}</dd></div>
    <div><dt>Where your data lives</dt><dd>In this browser${config.syncEnabled ? ', plus your private cloud database' : ''}. Nothing is sent anywhere else. The passwords keep casual visitors out of the app; they do not encrypt data stored in the browser.</dd></div>`;
}

/* ---------- binding ---------- */
const saveText = debounce((path, v) => store.setSetting(path, v), 250);

function bindTeacherProfile() {
  const name = root.querySelector('#stProfileName');
  const preview = root.querySelector('#stProfilePreview');
  const file = root.querySelector('#stPhotoFile');
  const upload = root.querySelector('#stPhotoUpload');
  const remove = root.querySelector('#stPhotoRemove');
  const cropHost = root.querySelector('#stPhotoCrop');
  let photo = S('teacherPhoto') || '';
  let cropper = null;
  const savePhoto = debounce((dataUrl) => store.setSetting('teacherPhoto', dataUrl), 250);
  const paint = () => {
    const displayName = name.value.trim() || 'Teacher';
    preview.innerHTML = avatar({ name: displayName, photo, icon: 'initials', color: '#ffd84a' }, 72);
    upload.textContent = photo ? 'Change profile photo' : 'Upload profile photo';
    remove.hidden = !photo;
  };
  name.addEventListener('input', paint);
  upload.addEventListener('click', () => file.click());
  remove.addEventListener('click', () => {
    photo = '';
    cropper?.destroy();
    cropper = null;
    savePhoto.flush('');
    paint();
  });
  file.addEventListener('change', async () => {
    const image = file.files?.[0];
    file.value = '';
    if (!image) return;
    try {
      const loaded = await readImage(image);
      cropper?.destroy();
      cropper = mountCropper(cropHost, loaded, (dataUrl) => {
        photo = dataUrl;
        savePhoto(dataUrl);
        paint();
      });
    } catch (err) {
      toast(err.message || 'That photo could not be opened.', { type: 'error', duration: 7000 });
      sfx.play('error');
    }
  });
  paint();
  return () => { cropper?.destroy(); cropper = null; savePhoto.flush(photo); };
}

function onInput(e) {
  const t = e.target;
  const path = t.dataset.path;
  if (!path) return;
  if (t.type === 'range') {
    const v = Number(t.value);
    root.querySelector(`[data-out="${path}"]`).textContent = v + (t.dataset.unit || '');
    store.setSetting(path, v);
  } else if (t.type === 'text') saveText(path, t.value);
  else if (t.type === 'number') {
    const v = Math.max(Number(t.min), Math.min(Number(t.max), parseInt(t.value || '0', 10) || 0));
    store.setSetting(path, v);
  }
}

function onChange(e) {
  const t = e.target;
  if (t.id === 'stImport') return importFile(t);
  if (t.dataset.day !== undefined) {
    const days = [...root.querySelectorAll('[data-day]:checked')].map((x) => Number(x.dataset.day));
    if (!days.length) { t.checked = true; toast('Keep at least one school day selected.', { type: 'error' }); return; }
    sfx.play('tap');
    return store.setSetting('schoolDays', days);
  }
  const path = t.dataset.path;
  if (!path) return;
  if (t.type === 'checkbox') { store.setSetting(path, t.checked); sfx.play('tap'); }
  else if (t.type === 'radio') { store.setSetting(path, t.value); sfx.play('tab'); }
  else if (t.tagName === 'SELECT') store.setSetting(path, t.dataset.num ? Number(t.value) : t.value);
}

async function onClick(e) {
  const jump = e.target.closest('[data-jump]');
  if (jump) { sfx.play('tab'); root.querySelector(`#sec-${jump.dataset.jump}`)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); return; }
  const fx = e.target.closest('[data-sfx]');
  if (fx) return sfx.play(fx.dataset.sfx);
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!act) return;
  if (['sample', 'reset'].includes(act) && !access.guard()) return;
  if (act === 'showplayer') { if (!S('music.on')) store.setSetting('music.on', true); openDock(); return; }
  if (act === 'export') { const { download } = await import('../core/utils.js'); download(`tallybook-backup-${new Date().toISOString().slice(0, 10)}.json`, store.exportJSON(), 'application/json'); toast('Backup downloaded.'); return; }
  if (act === 'sample') { store.addSampleClass(); sfx.play('success'); toast('Sample class added. Open Today to explore it.'); return; }
  if (act === 'syncnow') return sync.push();
  if (act === 'pullnow') {
    const ok = await confirmBox({ title: 'Load from the cloud?', message: 'This replaces what is in this browser with the copy saved in the cloud.', confirmLabel: 'Load from cloud' });
    if (ok) sync.pull({ force: true });
    return;
  }
  if (act === 'reset') {
    const typed = await openDialog({
      title: 'Delete all data?', body: '<p class="dlg-msg">This cannot be undone. Type <b>DELETE</b> to confirm.</p><label class="field"><input id="rsConfirm" type="text" autocomplete="off" autofocus aria-label="Type DELETE"></label>',
      actions: [{ label: 'Cancel', value: null, kind: 'ghost' }, { label: 'Delete everything', kind: 'danger', run: (d) => (d.querySelector('#rsConfirm').value.trim() === 'DELETE' ? true : false) }],
    });
    if (typed) { store.resetAll(); sfx.play('clear'); toast('All data deleted. You are starting fresh.'); }
  }
}

function importFile(input) {
  const file = input.files?.[0];
  if (!file) return;
  if (!access.guard()) { input.value = ''; return; }
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const raw = JSON.parse(reader.result);
      if (!Array.isArray(raw.classes)) throw new Error('That file is not a Tallybook backup.');
      const ok = await confirmBox({ title: 'Restore this backup?', message: `It contains ${plural(raw.classes.length, 'class', 'classes')}. Restoring replaces everything currently in this browser.`, confirmLabel: 'Restore backup', danger: true });
      if (ok) { store.importJSON(reader.result); sfx.play('success'); toast('Backup restored.'); }
    } catch (err) { toast(err.message || 'That file could not be read.', { type: 'error' }); }
    input.value = '';
  };
  reader.readAsText(file);
}
