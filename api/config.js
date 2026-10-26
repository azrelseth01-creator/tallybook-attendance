// GET /api/config
// Public, non-secret settings that come from Vercel environment variables.
// The browser uses them to seed a brand-new class book. Secrets (passwords and Blob credentials)
// are never returned; only whether storage is configured.
import { int, text, list, blobConfigured } from '../lib/env.js';

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    appName: text(process.env.APP_NAME, 'Tallybook'),
    schoolName: text(process.env.SCHOOL_NAME, ''),
    className: text(process.env.CLASS_NAME, ''),
    teacherName: text(process.env.TEACHER_NAME, ''),
    academicYear: text(process.env.ACADEMIC_YEAR, ''),
    term: text(process.env.TERM_NAME, ''),
    alertAbsences: int(process.env.ABSENCE_ALERT_THRESHOLD, 5),
    lateToAbsent: int(process.env.LATE_TO_ABSENCE, 3),
    defaultMusic: list(process.env.DEFAULT_MUSIC_URLS),
    passwordRequired: true,
    syncEnabled: Boolean(blobConfigured()),
  });
}