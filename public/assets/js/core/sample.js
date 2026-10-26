// A believable demo class so the book is fun to explore before real names go in.
import { addDays, iso, weekday } from './dates.js';
import { ICONS, COLORS } from '../ui/avatar.js';
import { rng, uid } from './utils.js';

const NAMES = [
  'Mia Santos', 'Noah Tan', 'Aisha Rahman', 'Lucas Lim', 'Chloe Reyes', 'Ethan Wong', 'Sofia Cruz',
  'Daniel Ong', 'Zara Khan', 'Miguel Garcia', 'Hana Sato', 'Ivan Petrov', 'Emma Dela Cruz', 'Jayden Lee',
  'Priya Nair', 'Liam Bautista', 'Olivia Chen', 'Kai Mendoza', 'Nur Aisyah', 'Theo Ramos',
];

export function sampleClass(settings, name = 'Sample class: Grade 5 Sunflower') {
  const rand = rng(2026);
  const students = NAMES.map((n, i) => ({
    id: uid('s'), name: n, icon: ICONS[(i * 5 + 2) % ICONS.length], color: COLORS[i % COLORS.length],
    seat: i, guardian: '', phone: '', notes: '', active: true,
  }));
  // A few students with a real attendance story, the rest mostly present.
  const absentOdds = { 3: 0.22, 8: 0.14, 13: 0.1, 16: 0.12 };
  const lateOdds = { 5: 0.2, 11: 0.15, 17: 0.12 };
  const records = {};
  let d = addDays(iso(new Date()), -1);
  let made = 0;
  const reasons = ['Fever', 'Family trip', 'Doctor visit', 'Overslept', 'Bus was late', 'Stomach ache'];
  while (made < 34) {
    if (settings.schoolDays.includes(weekday(d))) {
      const day = {};
      students.forEach((s, i) => {
        const r = rand();
        const pa = absentOdds[i] ?? 0.025;
        const pl = lateOdds[i] ?? 0.03;
        if (r < pa) day[s.id] = { s: rand() < 0.3 ? 'E' : 'A', n: rand() < 0.5 ? reasons[Math.floor(rand() * reasons.length)] : '' };
        else if (r < pa + pl) day[s.id] = { s: 'L', n: '' };
        else day[s.id] = { s: 'P', n: '' };
      });
      records[d] = day;
      made++;
    }
    d = addDays(d, -1);
  }
  return {
    id: uid('c'), name, subject: 'Homeroom', room: 'Room 12', seatCols: 5,
    students, records, noClass: {}, dayNotes: {},
  };
}
