// Dates are passed around as local "YYYY-MM-DD" strings so time zones never shift a school day.
const pad = (n) => String(n).padStart(2, '0');

export const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parse = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
};
export const today = () => iso(new Date());
export const addDays = (s, n) => {
  const d = parse(s);
  d.setDate(d.getDate() + n);
  return iso(d);
};
export const monthKey = (s) => s.slice(0, 7);
export const weekday = (s) => parse(s).getDay();
export const daysInMonth = (year, month0) => new Date(year, month0 + 1, 0).getDate();
export const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export const fmt = {
  long: (s) => parse(s).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
  weekday: (s) => parse(s).toLocaleDateString(undefined, { weekday: 'long' }),
  short: (s) => parse(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
  mid: (s) => parse(s).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }),
  month: (s) => parse(s + (s.length === 7 ? '-01' : '')).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
  wd1: (s) => parse(s).toLocaleDateString(undefined, { weekday: 'narrow' }),
  time: (ms) => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
};

export function weekdayNames(weekStart = 0, style = 'short') {
  // 2023-01-01 was a Sunday.
  return Array.from({ length: 7 }, (_, i) =>
    new Date(2023, 0, 1 + ((i + weekStart) % 7), 12).toLocaleDateString(undefined, { weekday: style }),
  );
}

/** 6 rows x 7 columns of dates covering a month, starting on weekStart. */
export function monthGrid(year, month0, weekStart = 0) {
  const first = new Date(year, month0, 1, 12);
  const lead = (first.getDay() - weekStart + 7) % 7;
  const start = new Date(year, month0, 1 - lead, 12);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return iso(d);
  });
}

export function schoolDaysInMonth(year, month0, schoolDays) {
  const out = [];
  for (let d = 1; d <= daysInMonth(year, month0); d++) {
    const s = `${year}-${pad(month0 + 1)}-${pad(d)}`;
    if (schoolDays.includes(weekday(s))) out.push(s);
  }
  return out;
}
