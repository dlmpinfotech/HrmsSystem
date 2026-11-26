import { describe, expect, it } from 'vitest';
import { attritionRate, averageTenureYears, countBy, headcountByMonth, lastMonths, type WorkforceEmployee } from '@shared/workforce';

const e = (x: Partial<WorkforceEmployee>): WorkforceEmployee => ({ id: 'x', status: 'active', department: null, employment_type: 'full_time', gender: null, date_of_joining: null, exit_date: null, ...x });

describe('workforce analytics', () => {
  it('lists months across a year boundary', () => {
    expect(lastMonths('2026-02-10', 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });

  it('counts headcount, joiners and leavers per month, ignoring future exits', () => {
    const people = [
      e({ date_of_joining: '2025-01-01' }),
      e({ date_of_joining: '2026-10-15' }),
      e({ date_of_joining: '2025-01-01', exit_date: '2026-10-20', status: 'exited' }),
      e({ date_of_joining: '2025-01-01', exit_date: '2026-11-30' }),
    ];
    expect(headcountByMonth(people, ['2026-09', '2026-10', '2026-11'], '2026-11-26')).toEqual([
      { month: '2026-09', headcount: 3, joined: 0, left: 0 },
      { month: '2026-10', headcount: 3, joined: 1, left: 1 },
      { month: '2026-11', headcount: 3, joined: 0, left: 0 },
    ]);
  });

  it('works out attrition and average service', () => {
    expect(attritionRate([{ headcount: 10, left: 1 }, { headcount: 10, left: 0 }])).toBe(10);
    expect(attritionRate([{ headcount: 0, left: 0 }])).toBeNull();
    expect(averageTenureYears([e({ date_of_joining: '2024-11-26' })], '2026-11-26')).toBe(2);
    expect(averageTenureYears([e({})], '2026-11-26')).toBeNull();
  });

  it('counts by key, largest first', () => {
    expect(countBy(['a', 'b', 'b'], (x) => x)).toEqual([{ name: 'b', value: 2 }, { name: 'a', value: 1 }]);
  });
});
