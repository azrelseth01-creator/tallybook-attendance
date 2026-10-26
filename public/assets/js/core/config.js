// Values that come from Vercel environment variables via /api/config.
// If the endpoint is missing (plain static hosting) the defaults below are used.
export const config = {
  appName: 'Tallybook',
  schoolName: '',
  className: '',
  teacherName: '',
  academicYear: '',
  term: '',
  alertAbsences: 5,
  lateToAbsent: 3,
  defaultMusic: [],
  passwordRequired: true,
  syncEnabled: false,
  fromEnv: false,
};

export async function loadConfig() {
  try {
    const res = await fetch('/api/config', { cache: 'no-store' });
    if (res.ok) Object.assign(config, await res.json(), { fromEnv: true });
  } catch {
    /* offline or no API: keep defaults */
  }
  return config;
}
