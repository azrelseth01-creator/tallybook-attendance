// Optional cloud copy of the class book through /api/sync (Upstash Redis behind it).
// Last write wins. A brand-new empty book never overwrites an existing cloud copy.
import { config } from '../core/config.js';
import * as access from '../core/access.js';
import * as store from '../core/store.js';
import { bus, debounce } from '../core/utils.js';
import { toast } from '../ui/toast.js';

export const sync = { status: config.syncEnabled ? 'idle' : 'off', message: '', at: null };
let ready = false;

function set(status, message = '') {
  sync.status = status;
  sync.message = message;
  if (status === 'ok') sync.at = Date.now();
  bus.emit('sync', { ...sync });
}

function headers() {
  const h = { 'Content-Type': 'application/json' };
  const pw = access.password();
  if (pw) h['x-app-password'] = pw;
  return h;
}

async function request(method, body) {
  const res = await fetch('/api/sync', { method, headers: headers(), body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Cloud sync failed (${res.status}).`);
  return json;
}

export async function push() {
  if (!config.syncEnabled) return;
  if (!access.canEdit()) return access.deny(); // view only: reading from the cloud is fine, saving is not
  set('syncing');
  try {
    const data = JSON.parse(store.exportJSON());
    await request('PUT', { data, updatedAt: store.updatedAt() });
    set('ok');
  } catch (err) { set('error', err.message); }
}

export async function pull({ force = false } = {}) {
  if (!config.syncEnabled) return;
  set('syncing');
  try {
    const remote = await request('GET');
    if (remote.data && (force || store.isPristine() || remote.updatedAt > store.updatedAt())) {
      store.replaceState(remote.data, { silent: true });
      set('ok');
      toast('Loaded the latest class book from the cloud.');
      return 'loaded';
    }
    if (store.updatedAt() > (remote.updatedAt || 0) && access.canEdit()) await push(); else set('ok');
  } catch (err) { set('error', err.message); }
}

export async function init() {
  if (!config.syncEnabled) return;
  await pull();
  ready = true;
  const queuePush = debounce(() => push(), 3000);
  bus.on('saved', () => { if (ready && access.canEdit() && !store.isPristine()) queuePush(); });
}
