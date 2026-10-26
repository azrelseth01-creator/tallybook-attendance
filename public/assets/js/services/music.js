// Background music. Paste a YouTube, Spotify or direct audio link and it joins the queue.
//  - YouTube: the official IFrame Player API (full control, including volume)
//  - Spotify: the official iFrame API (play/pause; Spotify controls its own volume,
//             and plays full tracks only when the browser is signed in to Spotify)
//  - Direct .mp3 / .ogg / .wav links: a plain <audio> element
import * as store from '../core/store.js';
import { bus, uid } from '../core/utils.js';
import { toast } from '../ui/toast.js';

const AUDIO_RE = /\.(mp3|ogg|oga|wav|m4a|aac|flac|opus)(\?|#|$)/i;
let yt = null;
let sp = null;
let ytApi = null;
let spApi = null;
let audioEl = null;
let spEnded = false;
let suppressEnd = false;
const now = { playing: false, loading: false, type: null, title: '', pos: null };
let errorRun = 0; // consecutive playback errors, so an all-blocked queue cannot loop forever
let shuffleBag = [];
let shuffleKey = '';
let shuffleHistory = [];

export const state = () => ({ ...now, index: store.getSetting('music.index'), queue: store.getSetting('music.queue') });
const emit = () => bus.emit('music', state());

/* ---------- link parsing ---------- */
export function parseLink(raw) {
  const input = String(raw || '').trim();
  if (!input) return null;
  const uri = input.match(/^spotify:(track|album|playlist|episode|show|artist):([A-Za-z0-9]+)$/);
  if (uri) return { type: 'spotify', kind: uri[1], ref: uri[2], url: `https://open.spotify.com/${uri[1]}/${uri[2]}` };

  let u;
  try { u = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`); } catch { return null; }
  const host = u.hostname.replace(/^(www|m|music)\./, '');

  if (host === 'youtu.be') {
    // A share link from inside a playlist looks like youtu.be/VIDEO?list=PLAYLIST: use the whole playlist.
    const list = u.searchParams.get('list');
    if (list && !list.startsWith('RD')) return { type: 'youtube', kind: 'playlist', ref: list, url: input };
    const ref = u.pathname.split('/')[1];
    return ref ? { type: 'youtube', kind: 'video', ref, url: input } : null;
  }
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const list = u.searchParams.get('list');
    const v = u.searchParams.get('v');
    const seg = u.pathname.split('/').filter(Boolean);
    if (list && !list.startsWith('RD')) return { type: 'youtube', kind: 'playlist', ref: list, url: input };
    if (v) return { type: 'youtube', kind: 'video', ref: v, url: input };
    if (['shorts', 'embed', 'live', 'v'].includes(seg[0]) && seg[1]) return { type: 'youtube', kind: 'video', ref: seg[1], url: input };
    return null;
  }
  if (host === 'open.spotify.com') {
    let seg = u.pathname.split('/').filter((s) => s && !/^intl-/.test(s));
    if (seg[0] === 'user' && seg[2] === 'playlist') seg = seg.slice(2); // old style: /user/NAME/playlist/ID
    const [kind, ref] = seg;
    if (['track', 'album', 'playlist', 'episode', 'show', 'artist'].includes(kind) && ref) {
      return { type: 'spotify', kind, ref, url: `https://open.spotify.com/${kind}/${ref}` };
    }
    return null;
  }
  if (AUDIO_RE.test(u.pathname)) return { type: 'audio', kind: 'file', ref: u.href, url: u.href };
  return null;
}

async function lookupTitle(item) {
  try {
    let endpoint;
    if (item.type === 'spotify') endpoint = `https://open.spotify.com/oembed?url=${encodeURIComponent(item.url)}`;
    else if (item.type === 'youtube') {
      const url = item.kind === 'playlist' ? `https://www.youtube.com/playlist?list=${item.ref}` : `https://www.youtube.com/watch?v=${item.ref}`;
      endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    } else return;
    const res = await fetch(endpoint);
    if (!res.ok) return;
    const { title } = await res.json();
    if (title) setTitle(item.id, title);
  } catch { /* offline or blocked: the placeholder title stays */ }
}

function placeholderTitle(p) {
  const names = { video: 'YouTube video', playlist: 'YouTube playlist', track: 'Spotify track', album: 'Spotify album', playlist_s: 'Spotify playlist', episode: 'Spotify episode', show: 'Spotify show', artist: 'Spotify artist', file: 'Audio file' };
  if (p.type === 'spotify' && p.kind === 'playlist') return names.playlist_s;
  return names[p.kind] || 'Track';
}

function setTitle(id, title) {
  const q = store.getSetting('music.queue');
  const it = q.find((x) => x.id === id);
  if (!it || it.title === title) return;
  it.title = title;
  store.setSetting('music.queue', q);
  emit();
}

/* ---------- queue ---------- */
/** Pure: build a queue item from a link without touching the store. */
export function makeItem(raw) {
  const p = parseLink(raw);
  return p ? { id: uid('m'), ...p, title: placeholderTitle(p) } : null;
}

export function add(raw) {
  const p = parseLink(raw);
  if (!p) return { ok: false, error: 'That link is not from YouTube or Spotify, and is not an audio file (.mp3, .ogg, .wav). You can paste a video, a playlist or an album.' };
  const queue = [...store.getSetting('music.queue')];
  if (queue.some((q) => q.type === p.type && q.ref === p.ref)) return { ok: false, error: 'That one is already in the queue.' };
  const item = { id: uid('m'), ...p, title: placeholderTitle(p) };
  queue.push(item);
  store.setSetting('music.queue', queue);
  lookupTitle(item);
  emit();
  return { ok: true, item };
}
export function remove(i) {
  const queue = [...store.getSetting('music.queue')];
  const idx = store.getSetting('music.index');
  const wasCurrent = i === idx && now.playing;
  queue.splice(i, 1);
  store.setSetting('music.queue', queue);
  if (i < idx) store.setSetting('music.index', idx - 1);
  if (wasCurrent) { stopAll(); now.title = ''; }
  emit();
}
export function move(i, dir) {
  const queue = [...store.getSetting('music.queue')];
  const j = i + dir;
  if (j < 0 || j >= queue.length) return;
  [queue[i], queue[j]] = [queue[j], queue[i]];
  const idx = store.getSetting('music.index');
  if (idx === i) store.setSetting('music.index', j); else if (idx === j) store.setSetting('music.index', i);
  store.setSetting('music.queue', queue);
  emit();
}

function queueSignature(queue) { return queue.map((item) => item.id).join('|'); }

function rebuildShuffleBag(currentIndex, resetHistory = true) {
  const queue = store.getSetting('music.queue') || [];
  const anchor = queue.length ? Math.max(0, Math.min(queue.length - 1, Number(currentIndex) || 0)) : -1;
  shuffleKey = queueSignature(queue);
  shuffleBag = Array.from({ length: queue.length }, (_, i) => i).filter((i) => i !== anchor);
  for (let i = shuffleBag.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffleBag[i], shuffleBag[j]] = [shuffleBag[j], shuffleBag[i]];
  }
  if (resetHistory) shuffleHistory = anchor < 0 ? [] : [anchor];
}

function ensureShuffleBag(currentIndex) {
  const queue = store.getSetting('music.queue') || [];
  if (shuffleKey !== queueSignature(queue)) rebuildShuffleBag(currentIndex, true);
}

function setNativePlaylistShuffle(enabled) {
  try { if (current()?.kind === 'playlist') yt?.setShuffle?.(Boolean(enabled)); } catch { /* not ready */ }
}

export function toggleShuffle() {
  const enabled = !store.getSetting('music.shuffle');
  store.setSetting('music.shuffle', enabled);
  if (enabled) rebuildShuffleBag(store.getSetting('music.index'), true);
  else { shuffleBag = []; shuffleKey = ''; shuffleHistory = []; }
  setNativePlaylistShuffle(enabled);
  emit();
}

export function cycleLoop() {
  const order = ['all', 'one', 'off'];
  const currentMode = store.getSetting('music.loop');
  store.setSetting('music.loop', order[(order.indexOf(currentMode) + 1) % order.length]);
  emit();
}

/* ---------- engines ---------- */
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true; s.onload = resolve; s.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.append(s);
  });
}
function loadYT() {
  return (ytApi ||= new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve();
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(); };
    loadScript('https://www.youtube.com/iframe_api').catch((e) => { ytApi = null; reject(e); });
  }));
}
function loadSP() {
  return (spApi ||= new Promise((resolve, reject) => {
    window.onSpotifyIframeApiReady = (api) => resolve(api);
    loadScript('https://open.spotify.com/embed/iframe-api/v1').catch((e) => { spApi = null; reject(e); });
  }));
}

function stopAll() {
  suppressEnd = true;
  try { yt?.pauseVideo?.(); } catch { /* not ready */ }
  try { sp?.pause?.(); } catch { /* not ready */ }
  audioEl?.pause();
  now.playing = false;
  setTimeout(() => { suppressEnd = false; }, 400);
}

function showHost(type) {
  document.getElementById('musicDock')?.setAttribute('data-engine', type || '');
}

async function startItem(item) {
  stopAll();
  showHost(item.type);
  now.type = item.type;
  now.title = item.title;
  now.pos = null;
  now.loading = true;
  emit();
  try {
    if (item.type === 'youtube') await playYT(item);
    else if (item.type === 'spotify') await playSP(item);
    else playAudio(item);
  } catch (err) {
    now.loading = false;
    now.playing = false;
    emit();
    toast(`Could not start the music: ${err.message || 'the player did not load'}. Check your connection and try again.`, { type: 'error' });
  }
}

async function playYT(item) {
  await loadYT();
  const vol = store.getSetting('music.volume');
  if (!yt) {
    await new Promise((resolve) => {
      yt = new window.YT.Player('ytHost', {
        width: '100%', height: '100%',
        playerVars: { playsinline: 1, rel: 0, origin: location.origin },
        events: {
          onReady: resolve,
          onStateChange: onYTState,
          onError: onYTError,
        },
      });
    });
  }
  yt.setVolume(vol);
  if (item.kind === 'playlist') {
    yt.loadPlaylist({ list: item.ref, listType: 'playlist', index: 0 });
    try { yt.setShuffle(Boolean(store.getSetting('music.shuffle'))); } catch { /* older player */ }
  }
  else yt.loadVideoById(item.ref);
}

function ytPlaylistPos() {
  try {
    const list = yt.getPlaylist?.() || [];
    const i = yt.getPlaylistIndex?.();
    return list.length && i >= 0 ? { i, n: list.length } : null;
  } catch { return null; }
}

function onYTError() {
  const item = current();
  if (++errorRun > 6) {
    errorRun = 0; now.playing = false; now.loading = false; emit();
    toast('Several tracks in a row would not play, so the music has stopped. Try a different link.', { type: 'error' });
    return;
  }
  // Inside a playlist, skip just the one video that is blocked and keep the rest going.
  const pos = item?.kind === 'playlist' ? ytPlaylistPos() : null;
  if (pos && pos.i < pos.n - 1) {
    toast('YouTube would not play one video in the playlist (its owner may block embedding). Skipping to the next one.', { type: 'error' });
    yt.nextVideo();
    return;
  }
  toast('YouTube would not play that one (the owner may block embedding, or the playlist is private). Skipping to the next track.', { type: 'error' });
  next(true);
}

function onYTState(e) {
  const S = window.YT.PlayerState;
  if (e.data === S.PLAYING) {
    errorRun = 0;
    now.playing = true; now.loading = false;
    now.pos = current()?.kind === 'playlist' ? ytPlaylistPos() : null;
    const t = yt.getVideoData?.().title;
    const item = current();
    if (t && item) { now.title = t; if (item.kind === 'video' && item.title !== t) setTitle(item.id, t); }
    emit();
  } else if (e.data === S.PAUSED) { now.playing = false; emit(); }
  else if (e.data === S.BUFFERING) { now.loading = true; emit(); }
  else if (e.data === S.ENDED && !suppressEnd) {
    const item = current();
    if (item?.kind === 'playlist') {
      const list = yt.getPlaylist?.() || [];
      if (yt.getPlaylistIndex() < list.length - 1) return; // YouTube moves on by itself
    }
    onEnded();
  }
}

async function playSP(item) {
  const api = await loadSP();
  const uri = `spotify:${item.kind}:${item.ref}`;
  spEnded = false;
  if (!sp) {
    await new Promise((resolve) => {
      api.createController(document.getElementById('spHost'), { uri, width: '100%', height: item.kind === 'track' || item.kind === 'episode' ? 80 : 152 }, (ctrl) => {
        sp = ctrl;
        ctrl.addListener('ready', () => { ctrl.play(); resolve(); });
        ctrl.addListener('playback_update', onSPUpdate);
      });
    });
  } else {
    sp.loadUri(uri);
    sp.play();
  }
}
function onSPUpdate(e) {
  const d = e.data || {};
  const was = `${now.playing}${now.loading}`;
  now.playing = !d.isPaused;
  now.loading = Boolean(d.isBuffering);
  const item = current();
  const finite = item && ['track', 'episode'].includes(item.kind);
  if (finite && d.duration > 0 && d.position >= d.duration - 400 && !spEnded && !suppressEnd) { spEnded = true; onEnded(); return; }
  if (d.position < 1000) spEnded = false;
  if (was !== `${now.playing}${now.loading}`) emit();
}

function playAudio(item) {
  if (!audioEl) {
    audioEl = new Audio();
    audioEl.addEventListener('play', () => { now.playing = true; now.loading = false; emit(); });
    audioEl.addEventListener('pause', () => { now.playing = false; emit(); });
    audioEl.addEventListener('ended', () => { if (!suppressEnd) onEnded(); });
    audioEl.addEventListener('error', () => { toast('That audio file would not play. Check the link.', { type: 'error' }); now.loading = false; emit(); });
  }
  audioEl.src = item.ref;
  audioEl.volume = store.getSetting('music.volume') / 100;
  audioEl.play().catch(() => { now.loading = false; emit(); });
}

/* ---------- transport ---------- */
const current = () => store.getSetting('music.queue')[store.getSetting('music.index')];

export async function play(i, { shuffleAdvance = false, fromHistory = false } = {}) {
  const queue = store.getSetting('music.queue');
  if (!queue.length) return;
  const previousIndex = store.getSetting('music.index');
  const idx = Math.min(Math.max(i ?? previousIndex, 0), queue.length - 1);
  if (store.getSetting('music.shuffle')) {
    ensureShuffleBag(previousIndex);
    if (shuffleAdvance) {
      if (shuffleHistory[shuffleHistory.length - 1] !== idx) shuffleHistory.push(idx);
    } else if (!fromHistory && idx !== previousIndex) rebuildShuffleBag(idx, true);
    else if (!shuffleHistory.length) rebuildShuffleBag(idx, true);
  }
  store.setSetting('music.index', idx);
  await startItem(queue[idx]);
}

export async function toggle() {
  const item = current();
  if (!item) return;
  if (!now.type || now.title === '') return play();
  if (now.playing) {
    if (item.type === 'youtube') yt?.pauseVideo();
    else if (item.type === 'spotify') sp?.pause();
    else audioEl?.pause();
    now.playing = false;
    emit();
  } else if (item.type === 'youtube' && yt) yt.playVideo();
  else if (item.type === 'spotify' && sp) sp.resume();
  else if (item.type === 'audio' && audioEl?.src) audioEl.play();
  else await play();
}

/** True when the playing item is a YouTube playlist: Next / Previous then move between its videos. */
function inPlaylist() {
  const item = current();
  return Boolean(item && item.type === 'youtube' && item.kind === 'playlist' && yt && now.type === 'youtube' && (now.playing || now.loading));
}

export function next(auto = false) {
  const queue = store.getSetting('music.queue');
  if (!queue.length) return;
  if (!auto && inPlaylist()) {
    const pos = ytPlaylistPos();
    if (pos && pos.i < pos.n - 1) { yt.nextVideo(); return; }
  }
  const idx = store.getSetting('music.index');
  const shuffled = Boolean(store.getSetting('music.shuffle') && queue.length > 1);
  let n;
  if (shuffled) {
    ensureShuffleBag(idx);
    if (!shuffleBag.length) {
      if (auto && store.getSetting('music.loop') === 'off') { now.playing = false; now.loading = false; emit(); return; }
      rebuildShuffleBag(idx, true);
    }
    n = shuffleBag.shift();
  } else n = idx + 1;
  if (n >= queue.length) {
    if (auto && store.getSetting('music.loop') === 'off') { now.playing = false; now.loading = false; emit(); return; }
    n = 0;
  }
  return play(n, { shuffleAdvance: shuffled });
}
export function prev() {
  const queue = store.getSetting('music.queue');
  if (!queue.length) return;
  if (inPlaylist()) {
    const pos = ytPlaylistPos();
    if (pos && pos.i > 0) { yt.previousVideo(); return; }
  }
  const idx = store.getSetting('music.index');
  if (store.getSetting('music.shuffle')) {
    ensureShuffleBag(idx);
    if (shuffleHistory.length > 1) {
      const currentIndex = shuffleHistory.pop();
      const previousIndex = shuffleHistory[shuffleHistory.length - 1];
      shuffleBag.unshift(currentIndex);
      return play(previousIndex, { fromHistory: true });
    }
    return play(idx); // restart the first item in this shuffle cycle
  }
  return play(idx - 1 < 0 ? queue.length - 1 : idx - 1);
}
function onEnded() {
  if (store.getSetting('music.loop') === 'one') return play();
  return next(true);
}



export function setVolume(v) {
  store.setSetting('music.volume', v);
  try { yt?.setVolume?.(v); } catch { /* not ready */ }
  if (audioEl) audioEl.volume = v / 100;
  emit();
}

/** Browsers block sound until the person interacts, so "autoplay" waits for the first tap. */
export function armAutoplay() {
  if (!store.getSetting('music.on') || !store.getSetting('music.autoplay') || !store.getSetting('music.queue').length) return;
  const go = () => { removeEventListener('pointerdown', go, true); removeEventListener('keydown', go, true); if (!now.playing) play(); };
  addEventListener('pointerdown', go, true);
  addEventListener('keydown', go, true);
}
