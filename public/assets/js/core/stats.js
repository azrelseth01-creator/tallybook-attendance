// All the counting lives here so every view agrees on what "absences" means.
import { addDays, compare, parse, weekday } from './dates.js';

export const STATUS = {
  P: { key: 'P', label: 'Present', word: 'present' },
  A: { key: 'A', label: 'Absent', word: 'absent' },
  L: { key: 'L', label: 'Late', word: 'late' },
  E: { key: 'E', label: 'Excused', word: 'excused' },
};
export const STATUS_KEYS = ['P', 'A', 'L', 'E'];

export const activeStudents = (cls) => cls.students.filter((s) => s.active !== false);

export function isNoClass(cls, date) {
  return Boolean(cls.noClass?.[date]);
}
export function isSchoolDay(settings, cls, date) {
  return settings.schoolDays.includes(weekday(date)) && !isNoClass(cls, date);
}

/** Next/previous school day, skipping weekends and no-class days. */
export function stepSchoolDay(settings, cls, date, dir) {
  let d = date;
  for (let i = 0; i < 21; i++) {
    d = addDays(d, dir);
    if (isSchoolDay(settings, cls, d)) return d;
  }
  return addDays(date, dir);
}

export function dayStats(cls, date, settings) {
  const day = cls.records[date] || {};
  const students = activeStudents(cls);
  const out = { P: 0, A: 0, L: 0, E: 0, unmarked: 0, total: students.length, marked: 0 };
  for (const s of students) {
    const r = day[s.id];
    if (r?.s) { out[r.s]++; out.marked++; } else out.unmarked++;
  }
  // Late students still came to school. Excused counts against the rate only if the teacher chose so.
  out.rate = out.marked ? (out.marked - out.A - (settings?.excusedCounts ? out.E : 0)) / out.marked : null;
  return out;
}

function nextSchoolDayAfter(settings, cls, date) {
  let d = date;
  for (let i = 0; i < 370; i++) {
    d = addDays(d, 1);
    if (isSchoolDay(settings, cls, d)) return d;
  }
  return null;
}

export function studentStats(cls, sid, settings, { from = '0000-00-00', to = '9999-99-99' } = {}) {
  const out = { P: 0, A: 0, L: 0, E: 0, marked: 0, streak: 0, longest: 0, lastAbsent: null, history: [] };
  const dates = Object.keys(cls.records).sort(compare);
  let run = 0;
  let previousSchoolMark = null;
  for (const date of dates) {
    if (date < from) continue;
    if (date > to) break;
    const r = cls.records[date][sid];
    const schoolDay = isSchoolDay(settings, cls, date);
    if (!r?.s) {
      if (schoolDay) { run = 0; previousSchoolMark = null; }
      continue;
    }
    out[r.s]++;
    out.marked++;
    out.history.push({ date, s: r.s, n: r.n || '' });
    if (r.s === 'A' && schoolDay) {
      run = previousSchoolMark && nextSchoolDayAfter(settings, cls, previousSchoolMark) === date ? run + 1 : 1;
      out.longest = Math.max(out.longest, run);
      out.lastAbsent = date;
      previousSchoolMark = date;
    } else {
      run = 0;
      previousSchoolMark = schoolDay ? date : null;
    }
  }
  out.streak = run;
  out.counted = out.A + (settings.excusedCounts ? out.E : 0);
  out.lateEq = settings.lateToAbsent > 0 ? Math.floor(out.L / settings.lateToAbsent) : 0;
  out.effective = out.counted + out.lateEq;
  out.rate = out.marked ? (out.marked - out.counted) / out.marked : null;
  out.flag = settings.alertAbsences > 0 && out.effective >= settings.alertAbsences;
  out.watch = !out.flag && settings.alertAbsences > 0 && out.effective >= Math.ceil(settings.alertAbsences * 0.6);
  return out;
}

export function classStats(cls, settings, range) {
  const students = activeStudents(cls);
  const per = students.map((s) => ({ student: s, ...studentStats(cls, s.id, settings, range) }));
  const dates = Object.keys(cls.records).filter((d) => (!range?.from || d >= range.from) && (!range?.to || d <= range.to)).sort(compare);
  const days = dates.map((date) => ({ date, ...dayStats(cls, date, settings) })).filter((d) => d.marked > 0);
  const totals = per.reduce((t, p) => { for (const k of 'PALE') t[k] += p[k]; return t; }, { P: 0, A: 0, L: 0, E: 0 });
  const marked = totals.P + totals.A + totals.L + totals.E;
  const byWeekday = Array.from({ length: 7 }, () => ({ A: 0, marked: 0 }));
  for (const d of days) { const w = byWeekday[weekday(d.date)]; w.A += d.A; w.marked += d.marked; }
  return {
    per, days, totals, marked,
    rate: marked ? (marked - totals.A - (settings.excusedCounts ? totals.E : 0)) / marked : null,
    perfectDays: days.filter((d) => d.A === 0 && d.L === 0 && d.unmarked === 0).length,
    byWeekday,
  };
}

export const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
export const parseDate = parse;
