import { describe, expect, it } from 'vitest';
import { formatPhone, isValidIndianPhone, toE164Digits } from '@shared/phone';
import { can, isStaff } from '@shared/permissions';
import { addDays, generateSlots, istDateString, istToUtc, pickSalesperson, type Availability } from '@shared/slots';
import { escapeHtml, extractVariables, missingVariables, renderTemplate, textToHtml } from '@shared/templates';
import { csvCell, toCsv } from '@/lib/csv';
import { fromIstInput, toIstInput } from '@/lib/format';
import { computeMrr, funnel, leadSummary, performanceBy, timeSeries } from '@/features/analytics/metrics';
import { looksLikeSpam } from '../../netlify/lib/rateLimit';
import { nextRetryAt, MAX_ATTEMPTS } from '../../netlify/lib/notifications';

describe('phone numbers', () => {
  it.each(['9876543210', '+91 98765 43210', '09876543210', '91-98765-43210'])('accepts %s', (p) => {
    expect(isValidIndianPhone(p)).toBe(true);
    expect(toE164Digits(p)).toBe('919876543210');
  });
  it.each(['12345', '5876543210', 'abcdefghij', ''])('rejects %s', (p) => expect(isValidIndianPhone(p)).toBe(false));
  it('formats for display', () => expect(formatPhone('9876543210')).toBe('+91 98765 43210'));
});

describe('role permissions', () => {
  it('lets sales executives work leads but not delete them or verify payments', () => {
    expect(can(['sales_executive'], 'leads.write')).toBe(true);
    expect(can(['sales_executive'], 'leads.delete')).toBe(false);
    expect(can(['sales_executive'], 'payments.verify')).toBe(false);
  });
  it('gives support executives tickets but not CRM', () => {
    expect(can(['support_executive'], 'support.manage')).toBe(true);
    expect(can(['support_executive'], 'leads.view')).toBe(false);
  });
  it('reserves team and settings for super admins', () => {
    expect(can(['sales_admin'], 'team.manage')).toBe(false);
    expect(can(['super_admin'], 'settings.manage')).toBe(true);
  });
  it('never grants staff permissions to customers', () => {
    for (const p of ['dashboard.view', 'leads.view', 'customers.view', 'payments.verify'] as const) {
      expect(can(['customer_admin', 'customer_user'], p)).toBe(false);
    }
    expect(isStaff(['customer_admin'])).toBe(false);
    expect(isStaff(['support_executive'])).toBe(true);
  });
});

describe('demo slots (Asia/Kolkata display, UTC storage)', () => {
  const rule = (id: string, weekday: number, start = '10:00', end = '12:00', mins = 45): Availability => ({ salesperson_id: id, weekday, start_time: start, end_time: end, slot_minutes: mins, is_active: true });
  // 2030-01-07 is a Monday.
  const monday = '2030-01-07';
  const longAgo = new Date('2029-01-01T00:00:00Z');

  it('converts IST wall-clock to UTC', () => {
    expect(istToUtc(monday, '10:00').toISOString()).toBe('2030-01-07T04:30:00.000Z');
    expect(istDateString(new Date('2030-01-06T19:00:00Z'))).toBe('2030-01-07');
    expect(addDays('2030-01-31', 1)).toBe('2030-02-01');
  });

  it('generates whole slots inside the window only', () => {
    const slots = generateSlots(monday, [rule('a', 1)], [], { now: longAgo });
    expect(slots.map((s) => s.starts_at)).toEqual(['2030-01-07T04:30:00.000Z', '2030-01-07T05:15:00.000Z']);
  });

  it('removes slots that overlap an existing booking for that salesperson', () => {
    const booked = [{ salesperson_id: 'a', starts_at: '2030-01-07T05:00:00Z', ends_at: '2030-01-07T05:30:00Z' }];
    expect(generateSlots(monday, [rule('a', 1)], booked, { now: longAgo })).toHaveLength(0);
  });

  it('keeps a slot open when another salesperson is free (no double booking)', () => {
    const booked = [{ salesperson_id: 'a', starts_at: '2030-01-07T04:30:00Z', ends_at: '2030-01-07T05:15:00Z' }];
    const slots = generateSlots(monday, [rule('a', 1), rule('b', 1)], booked, { now: longAgo });
    expect(slots[0]).toMatchObject({ starts_at: '2030-01-07T04:30:00.000Z', salesperson_ids: ['b'] });
    expect(slots[1].salesperson_ids.sort()).toEqual(['a', 'b']);
  });

  it('respects weekday, minimum notice and invalid dates', () => {
    expect(generateSlots(monday, [rule('a', 2)], [], { now: longAgo })).toHaveLength(0);
    const now = new Date('2030-01-07T04:00:00Z');
    expect(generateSlots(monday, [rule('a', 1)], [], { now, minLeadMinutes: 60 }).map((s) => s.starts_at)).toEqual(['2030-01-07T05:15:00.000Z']);
    expect(generateSlots('2030-02-30', [rule('a', 1)], [], { now: longAgo })).toEqual([]);
  });

  it('assigns the least-busy salesperson', () => {
    expect(pickSalesperson(['a', 'b'], { a: 3, b: 1 })).toBe('b');
    expect(pickSalesperson([], {})).toBeNull();
  });

  it('round-trips datetime-local inputs as IST', () => {
    expect(fromIstInput('2030-01-07T10:00')).toBe('2030-01-07T04:30:00.000Z');
    expect(toIstInput('2030-01-07T04:30:00.000Z')).toBe('2030-01-07T10:00');
  });
});

describe('notification templates', () => {
  it('renders variables and blanks unknown ones', () => {
    expect(renderTemplate('Hi {{ name }}, demo on {{date}}{{missing}}.', { name: 'Priya', date: '1 Jan' })).toBe('Hi Priya, demo on 1 Jan.');
    expect(extractVariables('{{a}} {{b}} {{a}}')).toEqual(['a', 'b']);
    expect(missingVariables('{{a}} {{b}}', { a: 'x' })).toEqual(['b']);
  });
  it('escapes HTML so template variables cannot inject markup', () => {
    expect(escapeHtml('<script>"x"</script>')).toBe('&lt;script&gt;&quot;x&quot;&lt;/script&gt;');
    const html = textToHtml('Hello <b>\nhttps://example.com/x', 'Brand');
    expect(html).toContain('&lt;b&gt;');
    expect(html).toContain('<a href="https://example.com/x"');
  });
  it('backs off retries and stops after the maximum', () => {
    const now = new Date('2030-01-01T00:00:00Z');
    expect(nextRetryAt(1, now)).toBe('2030-01-01T00:05:00.000Z');
    expect(nextRetryAt(2, now)).toBe('2030-01-01T00:30:00.000Z');
    expect(nextRetryAt(MAX_ATTEMPTS, now)).toBeNull();
  });
});

describe('spam protection', () => {
  it('flags honeypot and too-fast submissions', () => {
    expect(looksLikeSpam({ website: 'http://spam' })).toBe(true);
    expect(looksLikeSpam({ elapsed_ms: 300 })).toBe(true);
    expect(looksLikeSpam({ website: '', elapsed_ms: 8000 })).toBe(false);
  });
});

describe('CSV export', () => {
  it('quotes values and neutralises formula injection', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell(-5)).toBe('-5');
    expect(toCsv([{ n: 'திருநெல்வேலி' }], [{ header: 'City', value: (r) => r.n }])).toBe('City\r\nதிருநெல்வேலி');
  });
});

describe('analytics metrics', () => {
  const lead = (status: string, source = 'website', created_at = '2030-01-05T00:00:00Z') => ({ status, source, city: 'Tirunelveli', industry: null, assigned_to: null, created_at, expected_value: 1000 }) as never;

  it('computes MRR normalised to monthly from active subscriptions only', () => {
    expect(computeMrr([
      { status: 'active', amount: 1200, billing_frequency: 'monthly' },
      { status: 'active', amount: 12000, billing_frequency: 'yearly' },
      { status: 'past_due', amount: 3000, billing_frequency: 'quarterly' },
      { status: 'trialing', amount: 999, billing_frequency: 'monthly' },
    ])).toBe(1200 + 1000 + 1000);
  });

  it('summarises win rate and conversion', () => {
    const s = leadSummary([lead('won'), lead('lost'), lead('new'), lead('qualified')]);
    expect(s).toMatchObject({ total: 4, won: 1, lost: 1, open: 2, winRate: 0.5, conversion: 0.25 });
  });

  it('builds a cumulative funnel and per-source performance', () => {
    const leads = [lead('won', 'referral'), lead('demo_completed'), lead('new'), lead('lost')];
    const f = Object.fromEntries(funnel(leads).map((x) => [x.name, x.value]));
    expect(f).toMatchObject({ new: 3, demo_completed: 2, won: 1 });
    const perf = performanceBy(leads, (l) => l.source);
    expect(perf.find((p) => p.name === 'referral')).toMatchObject({ total: 1, won: 1, conversion: 1, value: 1000 });
  });

  it('zero-fills a daily time series', () => {
    const series = timeSeries([lead('new', 'x', '2030-01-02T06:00:00Z')], (l: { created_at: string }) => l.created_at, { from: new Date('2030-01-01T00:00:00Z'), to: new Date('2030-01-03T00:00:00Z') });
    expect(series.map((s) => s.value)).toEqual([0, 1, 0]);
  });
});

describe('CSV import parsing', () => {
  it('handles quotes, commas, CRLF, BOM, Tamil text and blank lines', async () => {
    const { parseCsv } = await import('@/lib/csv');
    const text = '\uFEFFemployee_code,full_name,department\r\nE1,"Raman, K",Weaving\r\n\r\nE2,"Say ""hi""",தறி\n';
    expect(parseCsv(text)).toEqual([
      ['employee_code', 'full_name', 'department'],
      ['E1', 'Raman, K', 'Weaving'],
      ['E2', 'Say "hi"', 'தறி'],
    ]);
  });
});
