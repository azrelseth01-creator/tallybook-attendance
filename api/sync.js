// GET  /api/sync            -> { data, updatedAt }   (data is null when nothing is saved yet)
// PUT  /api/sync { data, updatedAt }  -> { ok: true }
// Optional cloud copy of the class book so it follows the teacher across devices.
// Needs UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (or Vercel KV's KV_REST_API_*).
// Every request must send a valid password in the x-app-password header.
// Reading needs any password; saving (PUT) needs the admin password, so a view-only sign-in can never overwrite the book.
import { roleOf, redis, redisCreds } from '../lib/env.js';

const KEY = 'tallybook:book';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!redisCreds()) return res.status(501).json({ error: 'Cloud sync is not configured.' });
  const role = roleOf(req);
  if (!role) return res.status(401).json({ error: 'Wrong or missing password.' });

  try {
    if (req.method === 'GET') {
      const raw = await redis(['GET', KEY]);
      if (!raw) return res.status(200).json({ data: null, updatedAt: 0 });
      const saved = JSON.parse(raw);
      return res.status(200).json({ data: saved.data, updatedAt: saved.updatedAt || 0 });
    }

    if (req.method === 'PUT' || req.method === 'POST') {
      if (role !== 'admin') return res.status(403).json({ error: 'This password is view only, so it cannot save to the cloud.' });
      const { data, updatedAt } = req.body || {};
      if (!data || typeof data !== 'object' || !Array.isArray(data.classes)) {
        return res.status(400).json({ error: 'That does not look like a Tallybook backup.' });
      }
      const payload = JSON.stringify({ data, updatedAt: Number(updatedAt) || Date.now() });
      if (payload.length > 900_000) {
        return res.status(413).json({ error: 'The class book is too large for cloud sync (limit about 900 KB). Student photos take the most room, so remove a few photos or turn off cloud sync.' });
      }
      await redis(['SET', KEY, payload]);
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'Method not allowed.' });
  } catch (err) {
    return res.status(502).json({ error: err.message || 'Cloud sync failed.' });
  }
}
