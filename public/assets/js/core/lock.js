// Optional class passwords.
//
// A password is never stored. We keep a random salt and a PBKDF2-SHA-256 hash on the class. Unlocking is
// remembered for this browser tab only (sessionStorage), and every unlock is forgotten when you go back to
// the class library. This keeps classmates and passers-by out of the app. It does NOT encrypt the data that
// the browser stores on disk, and backups are not encrypted either.
import { isViewer } from './access.js';
const KEY = 'tallybook:unlocked-classes';
const ITER = 150000;
export const MIN_LENGTH = 4;
const enc = new TextEncoder();

const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));

async function derive(password, salt, iter) {
  if (!globalThis.crypto?.subtle) throw new Error('Class passwords need a secure connection (https, or localhost).');
  const key = await crypto.subtle.importKey('raw', enc.encode(String(password).normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  return toB64(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, key, 256));
}

/** Build the value saved on a class as `lock`. */
export async function makeLock(password, hint = '') {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { salt: toB64(salt), hash: await derive(password, salt, ITER), iter: ITER, hint: String(hint).trim().slice(0, 80) };
}

/* ---------- which classes are open right now ---------- */
let open = new Set();
try { open = new Set(JSON.parse(sessionStorage.getItem(KEY) || '[]')); } catch { /* private mode: fine */ }
const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify([...open])); } catch { /* ignore */ } };

export const isLocked = (c) => Boolean(c?.lock);
/** True when the class has no password, its password was entered in this tab, or you signed in as view only
 *  (the normal password opens every class, but cannot change anything). Admin still needs each class password. */
export const isOpen = (c) => !c?.lock || isViewer() || open.has(c.id);
export function markOpen(id) { open.add(id); save(); }
export function relock(id) { open.delete(id); save(); }
export function relockAll() { open.clear(); save(); }

/* ---------- checking, with a short wait after repeated mistakes ---------- */
const fails = new Map();
export const waitSeconds = (id) => Math.max(0, Math.ceil(((fails.get(id)?.until || 0) - Date.now()) / 1000));

/** Resolves { ok } or { ok: false, wait } when too many wrong tries. */
export async function attempt(c, password) {
  if (!c.lock) return { ok: true };
  const wait = waitSeconds(c.id);
  if (wait) return { ok: false, wait };
  const got = await derive(password, fromB64(c.lock.salt), c.lock.iter || ITER);
  let diff = got.length ^ c.lock.hash.length;
  for (let i = 0; i < got.length && i < c.lock.hash.length; i++) diff |= got.charCodeAt(i) ^ c.lock.hash.charCodeAt(i);
  if (diff === 0) { fails.delete(c.id); markOpen(c.id); return { ok: true }; }
  const n = (fails.get(c.id)?.n || 0) + 1;
  fails.set(c.id, { n, until: n >= 5 ? Date.now() + Math.min(300, 15 * 2 ** (n - 5)) * 1000 : 0 });
  return { ok: false, wait: waitSeconds(c.id) };
}
