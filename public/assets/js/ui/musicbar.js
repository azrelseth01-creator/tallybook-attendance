// Reusable music toolbar + queue. Used by the floating dock and by Settings.
import * as store from '../core/store.js';
import * as music from '../services/music.js';
import * as sfx from '../services/audio.js';
import { bus, esc } from '../core/utils.js';
import { icon } from './icons.js';
import { toast } from './toast.js';

export function toolbarHTML({ compact = false } = {}) {
  return `
  <div class="mbar ${compact ? 'compact' : ''}" data-mbar>
    <div class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
    <div class="mbar-title"><span data-title>Nothing playing</span><small data-sub></small></div>
    <div class="mbar-btns">
      <button class="icon-btn" data-m="shuffle" aria-label="Shuffle" aria-pressed="false" title="Shuffle">${icon('shuffle', 17)}</button>
      <button class="icon-btn" data-m="prev" aria-label="Previous track" title="Previous">${icon('prev', 18)}</button>
      <button class="play-btn" data-m="toggle" aria-label="Play">${icon('play', 20)}</button>
      <button class="icon-btn" data-m="next" aria-label="Next track" title="Next">${icon('next', 18)}</button>
      <button class="icon-btn" data-m="loop" aria-label="Repeat" title="Repeat">${icon('repeat', 17)}<b class="loop-one">1</b></button>
    </div>
    <label class="mbar-vol" title="Volume">${icon('volume', 17)}<input type="range" min="0" max="100" data-vol aria-label="Music volume"></label>
  </div>`;
}

export function bindToolbar(root) {
  const bar = root.querySelector('[data-mbar]');
  const $ = (s) => bar.querySelector(s);
  const paint = () => {
    const s = music.state();
    const item = s.queue[s.index];
    $('[data-title]').textContent = s.queue.length ? (s.title || item?.title || 'Ready to play') : 'Add a link to begin';
    const src = item ? ({ youtube: 'YouTube', spotify: 'Spotify', audio: 'Audio file' }[item.type] || '') : '';
    $('[data-sub]').textContent = s.pos ? `${src} playlist \u00b7 video ${s.pos.i + 1} of ${s.pos.n}` : src;
    const t = $('[data-m="toggle"]');
    t.innerHTML = s.loading ? '<span class="spin"></span>' : icon(s.playing ? 'pause' : 'play', 20);
    t.setAttribute('aria-label', s.playing ? 'Pause' : 'Play');
    bar.classList.toggle('playing', s.playing);
    const sh = store.getSetting('music.shuffle');
    const lp = store.getSetting('music.loop');
    $('[data-m="shuffle"]').setAttribute('aria-pressed', String(sh));
    const lb = $('[data-m="loop"]');
    lb.setAttribute('aria-pressed', String(lp !== 'off'));
    lb.dataset.mode = lp;
    lb.setAttribute('aria-label', lp === 'one' ? 'Repeat one track' : lp === 'all' ? 'Repeat the queue' : 'Repeat off');
    const vol = $('[data-vol]');
    vol.value = store.getSetting('music.volume');
    const sp = item?.type === 'spotify';
    vol.disabled = sp;
    vol.parentElement.title = sp ? 'Spotify has its own volume control inside the player' : 'Volume';
  };
  bar.addEventListener('click', (e) => {
    const m = e.target.closest('[data-m]')?.dataset.m;
    if (!m) return;
    sfx.play('tap');
    if (m === 'toggle') music.toggle();
    if (m === 'next') music.next();
    if (m === 'prev') music.prev();
    if (m === 'shuffle') { store.setSetting('music.shuffle', !store.getSetting('music.shuffle')); music.syncShuffle(); paint(); }
    if (m === 'loop') { const order = ['all', 'one', 'off']; store.setSetting('music.loop', order[(order.indexOf(store.getSetting('music.loop')) + 1) % 3]); paint(); }
  });
  $('[data-vol]').addEventListener('input', (e) => music.setVolume(Number(e.target.value)));
  const off = bus.on('music', paint);
  paint();
  return () => off();
}

export function addFormHTML() {
  return `<form class="music-add" data-madd autocomplete="off">
    <label class="sr-only" for="musicLink">Music link</label>
    <input id="musicLink" type="url" inputmode="url" placeholder="Paste a video, playlist, album or .mp3 link" required>
    <button class="btn primary" type="submit">${icon('plus', 16)} Add to queue</button>
  </form>`;
}
export function bindAddForm(root) {
  root.querySelector('[data-madd]').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = e.target.querySelector('input');
    const r = music.add(input.value);
    if (!r.ok) { toast(r.error, { type: 'error' }); sfx.play('error'); return; }
    sfx.play('pop');
    input.value = '';
    if (store.getSetting('music.queue').length === 1) music.play(0);
  });
}

export function queueHTML() {
  return '<ol class="mqueue" data-mqueue></ol>';
}
export function bindQueue(root) {
  const list = root.querySelector('[data-mqueue]');
  const paint = () => {
    const { queue, index, playing } = music.state();
    list.innerHTML = queue.length ? queue.map((q, i) => `
      <li class="${i === index ? 'now' : ''}" data-i="${i}">
        <button class="mq-play" data-q="play" aria-label="Play ${esc(q.title)}">${i === index && playing ? icon('pause', 15) : icon('play', 15)}</button>
        <span class="mq-title">${esc(q.title)}<small>${{ youtube: 'YouTube', spotify: 'Spotify', audio: 'Audio file' }[q.type]} &middot; ${q.kind}</small></span>
        <span class="mq-acts">
          <button class="icon-btn" data-q="up" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>${icon('expand', 15)}</button>
          <button class="icon-btn" data-q="down" aria-label="Move down" ${i === queue.length - 1 ? 'disabled' : ''}>${icon('collapse', 15)}</button>
          <button class="icon-btn" data-q="remove" aria-label="Remove from queue">${icon('trash', 15)}</button>
        </span>
      </li>`).join('') : '<li class="mq-empty">The queue is empty. Paste a link above to add your first track.</li>';
  };
  list.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-q]');
    if (!btn) return;
    const i = Number(btn.closest('li').dataset.i);
    sfx.play('tap');
    if (btn.dataset.q === 'play') { const s = music.state(); (i === s.index && (s.playing || s.title)) ? music.toggle() : music.play(i); }
    if (btn.dataset.q === 'up') music.move(i, -1);
    if (btn.dataset.q === 'down') music.move(i, 1);
    if (btn.dataset.q === 'remove') music.remove(i);
  });
  const off = bus.on('music', paint);
  paint();
  return () => off();
}
