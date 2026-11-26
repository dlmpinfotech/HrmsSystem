/** Workforce analytics calculations (pure, from data HR can already read). Dates are IST 'YYYY-MM-DD'. */

export interface WorkforceEmployee {
  id: string;
  status: string;
  department: string | null;
  employment_type: string;
  gender: string | null;
  date_of_joining: string | null;
  exit_date: string | null;
}

/** The last n months ending with the month of `today`, oldest first, as 'YYYY-MM'. */
export function lastMonths(today: string, n: number): string[] {
  const [y, m] = today.split('-').map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (n - 1 - i), 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

const monthEnd = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};

/** Employed on a date: joined on or before it, and not left before it. Without a joining date they count as already there. */
export function employedOn(e: WorkforceEmployee, date: string): boolean {
  if (e.date_of_joining && e.date_of_joining > date) return false;
  if (e.exit_date && e.exit_date < date) return false;
  return !(e.status === 'exited' && !e.exit_date);
}

export function headcountByMonth(employees: WorkforceEmployee[], months: string[], today: string) {
  return months.map((month) => {
    const end = monthEnd(month) > today ? today : monthEnd(month);
    return {
      month,
      headcount: employees.filter((e) => employedOn(e, end)).length,
      joined: employees.filter((e) => e.date_of_joining?.startsWith(month)).length,
      left: employees.filter((e) => e.exit_date?.startsWith(month) && e.exit_date <= today).length,
    };
  });
}

/** Leavers as a percentage of average headcount over the months given; null when nobody was employed. */
export function attritionRate(rows: { headcount: number; left: number }[]): number | null {
  if (!rows.length) return null;
  const average = rows.reduce((s, r) => s + r.headcount, 0) / rows.length;
  if (average === 0) return null;
  return Math.round((rows.reduce((s, r) => s + r.left, 0) / average) * 1000) / 10;
}

/** Count by a key, largest first. */
export function countBy<T>(items: T[], key: (item: T) => string): { name: string; value: number }[] {
  const m = new Map<string, number>();
  for (const i of items) m.set(key(i), (m.get(key(i)) ?? 0) + 1);
  return [...m.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
}

/** Average length of service in years for people employed today. */
export function averageTenureYears(employees: WorkforceEmployee[], today: string): number | null {
  const spans = employees.filter((e) => e.date_of_joining && employedOn(e, today)).map((e) => (Date.parse(today) - Date.parse(e.date_of_joining!)) / (365.25 * 86_400_000));
  return spans.length ? Math.round((spans.reduce((s, v) => s + v, 0) / spans.length) * 10) / 10 : null;
}
