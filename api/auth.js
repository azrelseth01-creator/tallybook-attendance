// POST /api/auth  { password }  ->  { ok: true, role: 'admin' | 'viewer' }   or 401 { ok: false }
// Checks the password on the server so the passwords never ship to the browser.
import { passwordConfigError, roleFor } from '../lib/env.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false });

  const configError = passwordConfigError();
  if (configError) return res.status(503).json({ ok: false, error: configError });

  const role = roleFor(req.body?.password);
  if (!role) {
    await new Promise((r) => setTimeout(r, 600)); // slow down guessing
    return res.status(401).json({ ok: false });
  }
  res.status(200).json({ ok: true, role });
}
