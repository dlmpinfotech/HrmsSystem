import { describe, expect, it } from 'vitest';
import { calendarGrid, displayDate, displayMonth, displayTime, outOfRange, parseDate, parseTime, shiftDays, toTimeValue } from '@shared/pickers';

describe('date and time pickers', () => {
  it('builds six Sunday-first weeks for a month', () => {
    const grid = calendarGrid(2026, 11); // 1 Nov 2026 is a Sunday
    expect(grid).toHaveLength(42);
    expect(grid[0]).toBe('2026-11-01');
    expect(grid[41]).toBe('2026-12-12');
    expect(calendarGrid(2026, 10)[0]).toBe('2026-09-27');
  });

  it('rejects impossible dates and steps across months and leap days', () => {
    expect(parseDate('2026-02-30')).toBeNull();
    expect(parseDate('')).toBeNull();
    expect(shiftDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(shiftDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('respects min and max for days, months and years', () => {
    expect(outOfRange('2026-11-10', '2026-11-11')).toBe(true);
    expect(outOfRange('2026-11-11', '2026-11-11', '2026-11-30')).toBe(false);
    expect(outOfRange('2026-10', '2026-11-11')).toBe(true);
    expect(outOfRange('2026-11', '2026-11-11')).toBe(false);
    expect(outOfRange('2027', undefined, '2026-11-26')).toBe(true);
  });

  it('converts between 24-hour values and AM / PM', () => {
    expect(parseTime('00:05')).toEqual({ hour: 12, minute: 5, pm: false });
    expect(parseTime('12:00:00')).toEqual({ hour: 12, minute: 0, pm: true });
    expect(toTimeValue({ hour: 12, minute: 0, pm: false })).toBe('00:00');
    expect(toTimeValue({ hour: 6, minute: 30, pm: true })).toBe('18:30');
    expect(parseTime('25:00')).toBeNull();
    expect(displayTime('18:30')).toBe('06:30 PM');
  });

  it('shows dates like 13-Nov-2026', () => {
    expect(displayDate('2026-11-13', 'en')).toBe('13-Nov-2026');
    expect(displayDate('2026-09-05', 'en')).toBe('05-Sep-2026');
    expect(displayMonth('2026-11', 'en')).toBe('November 2026');
    expect(displayDate('', 'en')).toBe('');
  });
});
