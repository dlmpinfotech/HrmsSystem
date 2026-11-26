import { beforeEach, describe, expect, it, vi } from 'vitest';

const notify = vi.fn(async () => []);
vi.mock('../../netlify/lib/notifications', () => ({ notify: (...a: unknown[]) => notify(...(a as [])) }));

import { itemLines, runHrReminders, type PendingItem } from '../../netlify/lib/hrReminders';

const HOUR = 3_600_000;
// 26 Nov 2026, 10:00 IST
const NOW = Date.parse('2026-11-26T04:30:00Z');

/** Minimal chainable stand-in for the Supabase query builder: every chain resolves to the table's rows. */
function fakeDb(tables: Record<string, unknown[]>) {
  const chain = (rows: unknown[]) => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'lt', 'in', 'is', 'not', 'limit', 'order']) q[m] = () => q;
    q.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null, error: null });
    q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res);
    return q;
  };
  return { from: (t: string) => chain(tables[t] ?? []) } as never;
}

const ago = (h: number) => new Date(NOW - h * HOUR).toISOString();
const base = {
  companies: [{ name: 'Ezofis', status: 'active' }],
  company_memberships: [
    { user_id: 'u-admin', role: 'customer_admin', profiles: { full_name: 'Muthu', email: 'admin@x.in', is_active: true, preferred_language: 'en' } },
    { user_id: 'u-hr', role: 'hr_manager', profiles: { full_name: 'Dhana', email: 'hr@x.in', is_active: true, preferred_language: 'ta' } },
  ],
  employees: [{ id: 'e-mgr', user_id: 'u-mgr', full_name: 'Meena', email: 'meena@x.in', profiles: { is_active: true, preferred_language: 'en' } }],
};

beforeEach(() => notify.mockClear());

describe('HR approval reminders', () => {
  it('waits until 9 am IST', async () => {
    const early = Date.parse('2026-11-26T02:00:00Z'); // 7:30 IST
    expect(await runHrReminders(fakeDb({}), 'https://app', early)).toEqual({ digests: 0, escalations: 0 });
    expect(notify).not.toHaveBeenCalled();
  });

  it('sends a daily digest to HR, a team digest to the manager, and escalates long waits to admins', async () => {
    const db = fakeDb({
      ...base,
      leave_requests: [
        { company_id: 'c1', employee_id: 'e1', created_at: ago(30), start_date: '2026-12-01', end_date: '2026-12-02', approval_step: 1, leave_types: { name: 'Casual Leave' }, employees: { full_name: 'Ravi', reporting_manager_id: 'e-mgr' } },
        { company_id: 'c1', employee_id: 'e2', created_at: ago(80), start_date: '2026-12-05', end_date: '2026-12-05', approval_step: 2, leave_types: { name: 'Sick Leave' }, employees: { full_name: 'Kala', reporting_manager_id: null } },
      ],
    });
    const res = await runHrReminders(db, 'https://app', NOW);
    expect(res).toEqual({ digests: 3, escalations: 1 });
    const calls = notify.mock.calls.map((c) => (c as unknown as [unknown, { key: string; email: string; dedupeKey: string; vars: Record<string, string> }])[1]);
    expect(calls.map((c) => `${c.key}:${c.email}`)).toEqual([
      'hr_pending_digest:admin@x.in',
      'hr_pending_digest:hr@x.in',
      'hr_pending_digest:meena@x.in',
      'approval_escalation:admin@x.in',
    ]);
    // One email per person per day.
    expect(calls[0].dedupeKey).toBe('hr-digest:c1:u-admin:2026-11-26');
    // The manager only hears about their own team's first step; the admin only about the 80-hour wait.
    expect(calls[2].vars.count).toBe('1');
    expect(calls[3].vars.items).toContain('Kala');
    expect(calls[3].vars.items).not.toContain('Ravi');
    // Tamil HR person gets Tamil lines.
    expect(calls[1].vars.items).toContain('விடுப்பு');
  });

  it("uses the company's own time limits", async () => {
    const db = fakeDb({
      ...base,
      hr_settings: [{ company_id: 'c1', remind_after_hours: 2, escalate_after_hours: 4 }],
      comp_off_credits: [{ company_id: 'c1', employee_id: 'e1', created_at: ago(5), work_date: '2026-11-22', employees: { full_name: 'Ravi' } }],
    });
    expect(await runHrReminders(db, 'https://app', NOW)).toEqual({ digests: 2, escalations: 1 });
    const last = notify.mock.calls.at(-1) as unknown as [unknown, { vars: Record<string, string> }];
    expect(last[1].vars.hours).toBe('4');
  });

  it('formats one line per item and trims long lists', () => {
    const many: PendingItem[] = Array.from({ length: 32 }, (_, i) => ({ kind: 'comp_off', companyId: 'c', employeeId: `e${i}`, employeeName: `P${i}`, createdAt: ago(25), label: '2026-11-01', managerUserId: null }));
    const text = itemLines(many, NOW, 'en');
    expect(text.split('\n')).toHaveLength(31);
    expect(text).toContain('• Comp-off · P0 · 2026-11-01 · waiting 25 h');
    expect(text).toContain('… and 2 more');
  });
});
