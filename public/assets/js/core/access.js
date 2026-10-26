// Who is using the book right now.
//   admin  -> can add and edit classes, students and attendance. Class passwords still apply.
//   viewer -> can open and look at everything (class passwords are skipped) but cannot change anything.
// The passwords themselves are checked on the server (/api/auth). This module only remembers the answer for
// this browser tab. It keeps casual visitors from clicking around; it is not encryption of the saved data.
import { bus } from './utils.js';

const ROLE_KEY = 'tallybook:role';
const PW_KEY = 'tallybook:pw';

let role = null;
try {
  const saved = sessionStorage.getItem(ROLE_KEY);
  role = saved === 'admin' || saved === 'viewer' ? saved : null;
} catch { /* private mode: you will just sign in again */ }

export const getRole = () => role;
export const isAdmin = () => role === 'admin';
export const isViewer = () => role === 'viewer';
export const canEdit = () => role === 'admin';
export function password() { try { return sessionStorage.getItem(PW_KEY) || ''; } catch { return ''; } }

/** Settings a view-only person may still change: how the app looks and sounds, not the class data. */
const VIEWER_PREFS = /^(desk|paper|density|textScale|sound\.|vfx\.|music\.(?!queue$))/;
export const viewerMayChange = (path) => VIEWER_PREFS.test(String(path));

/** Lets CSS hide editing controls: html[data-role="viewer"] .admin-only { display: none } */
export function paintRole() { document.documentElement.dataset.role = role || 'locked'; }

export function signIn(newRole, pw) {
  role = newRole;
  try { sessionStorage.setItem(ROLE_KEY, newRole); sessionStorage.setItem(PW_KEY, pw); } catch { /* ignore */ }
  paintRole();
}

export function clear() {
  role = null;
  try { sessionStorage.removeItem(ROLE_KEY); sessionStorage.removeItem(PW_KEY); } catch { /* ignore */ }
  paintRole();
}

/** Lock the book: forget the password and every unlocked class, then return to the password screen. */
export function signOut() {
  clear();
  try {
    sessionStorage.removeItem('tallybook:unlocked-classes');
  } catch { /* ignore */ }
  location.hash = '';
  location.reload();
}

/** Tell the app that something was refused because this sign-in is view only. Always returns false. */
export function deny() { bus.emit('denied'); return false; }
/** True when editing is allowed; otherwise shows the "view only" notice and returns false. */
export const guard = () => (canEdit() ? true : deny());
