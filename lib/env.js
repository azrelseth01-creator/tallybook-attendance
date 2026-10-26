// Shared helpers for the serverless functions in /api.
// Everything the app reads from environment variables goes through here.
import { timingSafeEqual } from 'node:crypto';

export const int = (value, fallback) => {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};

export const text = (value, fallback = '') =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback;

/** "a, b\nc" -> ["a","b","c"] */
export const list = (value) =>
  String(value || '')
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * The two sign-in passwords. They are checked here, on the server, and never sent to the browser.
 * Both must be set in the environment; there are deliberately no public default credentials.
 *   normal -> "viewer": can open everything (even password-protected classes) but cannot change anything.
 *   admin  -> can add and edit classes, students and attendance. Class passwords still apply to admin.
 */
export function passwordConfigError() {
  const normal = text(process.env.NORMAL_PASSWORD);
  const admin = text(process.env.ADMIN_PASSWORD);
  if (!normal || !admin) return 'Sign-in is not configured. Set NORMAL_PASSWORD and ADMIN_PASSWORD in your deployment environment.';
  if (safeEqual(normal, admin)) return 'Sign-in is not configured. NORMAL_PASSWORD and ADMIN_PASSWORD must be different.';
  return '';
}

/** 'admin', 'viewer' or null for a password that matches neither. */
export function roleFor(given) {
  if (passwordConfigError()) return null;
  const normal = text(process.env.NORMAL_PASSWORD);
  const admin = text(process.env.ADMIN_PASSWORD);
  const g = String(given ?? '');
  const isAdmin = safeEqual(g, admin); // both are always compared, so timing does not hint which one was close
  const isViewer = safeEqual(g, normal);
  return isAdmin ? 'admin' : isViewer ? 'viewer' : null;
}

/** The role of whoever sent this request (they send their password in the x-app-password header). */
export const roleOf = (req) => roleFor(req.headers['x-app-password'] || '');

/** Upstash Redis (or Vercel KV, which is Upstash underneath) REST credentials. */
export function redisCreds() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}

export async function redis(command) {
  const creds = redisCreds();
  if (!creds) throw new Error('Cloud sync is not configured');
  const res = await fetch(creds.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  if (!res.ok) throw new Error(`Redis responded ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json.result;
}
