import { describe, expect, it } from 'vitest';
import { attendanceRate, buildTimeline } from '@shared/hr';

describe('employee 360 timeline', () => {
  it('collects events newest first and flags upcoming dates', () => {
    const events = buildTimeline(
      {
        employee: { date_of_joining: '2030-01-03', probation_end_date: '2030-07-03', contract_end_date: null, exit_date: null },
        leave: [{ id: 'l1', created_at: '2030-02-10T20:00:00Z', status: 'approved' }], // 11 Feb in IST
        regularizations: [{ id: 'r1', created_at: '2030-03-01T05:00:00Z', status: 'pending' }],
        corrections: [{ id: 'c1', corrected_at: null }, { id: 'c2', corrected_at: '2030-03-05T05:00:00Z' }],
        assignments: [{ id: 's1', effective_from: '2030-01-06' }],
      },
      '2030-04-01',
    );
    expect(events.map((e) => e.kind)).toEqual(['probation_end', 'correction', 'regularization', 'leave', 'shift', 'joined']);
    expect(events[0].upcoming).toBe(true);
    expect(events.find((e) => e.kind === 'leave')?.date).toBe('2030-02-11');
    expect(events.filter((e) => e.upcoming)).toHaveLength(1);
  });

  it('computes attendance rate with half days counted as half', () => {
    expect(attendanceRate({ present: 8, halfDay: 2, absent: 0 })).toBe(90);
    expect(attendanceRate({ present: 0, halfDay: 0, absent: 0 })).toBeNull();
  });
});
