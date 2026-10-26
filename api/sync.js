// GET  /api/sync            -> { data, updatedAt }   (data is null when nothing is saved yet)
// PUT  /api/sync { data, updatedAt }  -> { ok: true }
// Cloud copy of the class book in a private Vercel Blob store.
// Every request needs a valid Tallybook password; only admin may save.
import { roleOf, blobConfigured } from '../lib/env.js';

const PATHNAME = 'tallybook/shared-book-v1.json';
const MAX_SIZE = 900_000;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!blobConfigured()) return res.status(501).json({ error: 'Cloud sync is not configured. Connect a private Vercel Blob store to this project.' });
  const role = roleOf(req);
  if (!role) return res.status(401).json({ error: 'Wrong or missing password.' });

  try {
    if (req.method === 'GET') {
      const { get } = await import('@vercel/blob');
      const blob = await get(PATHNAME, { access: 'private', useCache: false });
      if (!blob) return res.status(200).json({ data: null, updatedAt: 0 });
      if (blob.statusCode !== 200 || !blob.stream) return res.status(502).json({ error: 'Could not read the shared class book from Blob.' });
      const saved = JSON.parse(await new Response(blob.stream).text());
      return res.status(200).json({ data: saved.data, updatedAt: saved.updatedAt || 0 });
    }

    if (req.method === 'PUT' || req.method === 'POST') {
      if (role !== 'admin') return res.status(403).json({ error: 'This password is view only, so it cannot save to the cloud.' });
      const { data, updatedAt } = req.body || {};
      if (!data || typeof data !== 'object' || !Array.isArray(data.classes)) {
        return res.status(400).json({ error: 'That does not look like a Tallybook backup.' });
      }
      const payload = JSON.stringify({ data, updatedAt: Number(updatedAt) || Date.now() });
      if (payload.length > MAX_SIZE) {
        return res.status(413).json({ error: 'The class book is too large for cloud sync (limit about 900 KB). Student photos take the most room, so remove a few photos or turn off cloud sync.' });
      }
      const { put } = await import('@vercel/blob');
      await put(PATHNAME, payload, {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json',
        cacheControlMaxAge: 60,
      });
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'Method not allowed.' });
  } catch (err) {
    return res.status(502).json({ error: err.message || 'Cloud sync failed.' });
  }
}