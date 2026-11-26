import { escapeHtml } from '../../shared/templates';
import { rupeesInWords } from '../../shared/payroll';

export interface PayslipRow {
  id: string;
  period: string;
  employee_code: string;
  employee_name: string;
  department: string | null;
  designation: string | null;
  days_in_month: number;
  paid_days: number | string;
  lop_days: number | string;
  basic: number | string;
  hra: number | string;
  conveyance: number | string;
  special_allowance: number | string;
  other_allowance: number | string;
  leave_encashment?: number | string;
  gross: number | string;
  pf_employee: number | string;
  esi_employee: number | string;
  professional_tax: number | string;
  tds: number | string;
  other_deduction: number | string;
  total_deductions: number | string;
  net_pay: number | string;
}

const LABELS = {
  en: {
    subject: (m: string) => `Payslip for ${m}`,
    greeting: (n: string) => `Hi ${n},`,
    intro: (m: string, c: string) => `Your payslip for ${m} from ${c} is below.`,
    earnings: 'Earnings', deductions: 'Deductions', basic: 'Basic', hra: 'HRA', conveyance: 'Conveyance', special: 'Special allowance', other: 'Other allowance', encash: 'Leave encashment',
    gross: 'Gross earnings', pf: 'Provident fund', esi: 'ESI', pt: 'Professional tax', tds: 'Income tax (TDS)', otherDed: 'Other deductions', totalDed: 'Total deductions',
    net: 'Net pay', words: 'In words', days: (paid: string, total: number, lop: string) => `Paid days ${paid} of ${total} · LOP ${lop}`,
    portal: 'You can also view and print it in the portal:', footer: 'This is a system-generated payslip.', rupees: 'Rupees', only: 'only',
  },
  ta: {
    subject: (m: string) => `${m} சம்பளச் சீட்டு`,
    greeting: (n: string) => `வணக்கம் ${n},`,
    intro: (m: string, c: string) => `${c} வழங்கும் ${m} மாத சம்பளச் சீட்டு கீழே உள்ளது.`,
    earnings: 'வருமானம்', deductions: 'பிடித்தங்கள்', basic: 'அடிப்படை', hra: 'வீட்டு வாடகைப் படி', conveyance: 'போக்குவரத்துப் படி', special: 'சிறப்புப் படி', other: 'பிற படி', encash: 'விடுப்புப் பணமாக்கல்',
    gross: 'மொத்த வருமானம்', pf: 'வருங்கால வைப்பு நிதி', esi: 'ESI', pt: 'தொழில் வரி', tds: 'வருமான வரி (TDS)', otherDed: 'பிற பிடித்தங்கள்', totalDed: 'மொத்த பிடித்தங்கள்',
    net: 'நிகர சம்பளம்', words: 'எழுத்தில்', days: (paid: string, total: number, lop: string) => `சம்பள நாட்கள் ${paid} / ${total} · ஊதியமில்லா நாட்கள் ${lop}`,
    portal: 'போர்ட்டலிலும் பார்த்து அச்சிடலாம்:', footer: 'இது கணினியால் உருவாக்கப்பட்ட சம்பளச் சீட்டு.', rupees: 'Rupees', only: 'only',
  },
};

const money = (v: number | string) => `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function monthLabel(period: string, lang: 'en' | 'ta'): string {
  return new Intl.DateTimeFormat(lang === 'ta' ? 'ta-IN' : 'en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${period.slice(0, 10)}T00:00:00Z`));
}

/** Text + inline-styled HTML payslip email (email clients do not support CSS variables). */
export function payslipEmail(p: PayslipRow, opts: { companyName: string; lang: 'en' | 'ta'; portalUrl: string; accent?: string }) {
  const L = LABELS[opts.lang];
  const month = monthLabel(p.period, opts.lang);
  const accent = /^#[0-9a-f]{6}$/i.test(opts.accent ?? '') ? opts.accent! : '#4f46e5';
  const earnings: [string, number | string][] = [
    [L.basic, p.basic], [L.hra, p.hra], [L.conveyance, p.conveyance], [L.special, p.special_allowance], [L.other, p.other_allowance], [L.encash, p.leave_encashment ?? 0],
  ];
  const deductions: [string, number | string][] = [
    [L.pf, p.pf_employee], [L.esi, p.esi_employee], [L.pt, p.professional_tax], [L.tds, p.tds], [L.otherDed, p.other_deduction],
  ];
  const nonZero = (rows: [string, number | string][]) => rows.filter(([, v]) => Number(v) !== 0);
  const words = `${L.rupees} ${rupeesInWords(Number(p.net_pay))} ${L.only}`;
  const days = L.days(String(Number(p.paid_days)), p.days_in_month, String(Number(p.lop_days)));
  const who = [p.employee_code, p.designation, p.department].filter(Boolean).join(' · ');

  const text = [
    L.greeting(p.employee_name), '', L.intro(month, opts.companyName), '', who, days, '',
    `${L.earnings}:`, ...nonZero(earnings).map(([k, v]) => `  ${k}: ${money(v)}`), `  ${L.gross}: ${money(p.gross)}`, '',
    `${L.deductions}:`, ...nonZero(deductions).map(([k, v]) => `  ${k}: ${money(v)}`), `  ${L.totalDed}: ${money(p.total_deductions)}`, '',
    `${L.net}: ${money(p.net_pay)} (${words})`, '', L.portal, opts.portalUrl, '', L.footer, opts.companyName,
  ].join('\n');

  const row = (k: string, v: number | string, bold = false) =>
    `<tr><td style="padding:6px 0;color:${bold ? '#0f172a' : '#475569'};${bold ? 'font-weight:700;' : ''}">${escapeHtml(k)}</td><td style="padding:6px 0;text-align:right;${bold ? 'font-weight:700;' : ''}font-variant-numeric:tabular-nums">${money(v)}</td></tr>`;
  const table = (title: string, rows: [string, number | string][], totalLabel: string, total: number | string) =>
    `<td style="vertical-align:top;width:50%;padding:12px"><div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#64748b;margin-bottom:6px">${escapeHtml(title)}</div><table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px">${nonZero(rows).map(([k, v]) => row(k, v)).join('')}<tr><td colspan="2" style="border-top:1px solid #e2e8f0"></td></tr>${row(totalLabel, total, true)}</table></td>`;

  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f5f6fa;font-family:Arial,'Noto Sans Tamil',sans-serif;color:#0f172a">
<div style="max-width:620px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden">
<div style="background:${accent};color:#ffffff;padding:20px 24px"><div style="font-size:18px;font-weight:700">${escapeHtml(opts.companyName)}</div><div style="opacity:.9;font-size:14px">${escapeHtml(L.subject(month))}</div></div>
<div style="padding:20px 24px;font-size:15px;line-height:1.6">
<p style="margin:0 0 8px">${escapeHtml(L.greeting(p.employee_name))}</p>
<p style="margin:0 0 16px">${escapeHtml(L.intro(month, opts.companyName))}</p>
<div style="background:#f8fafc;border-radius:8px;padding:12px 16px;font-size:14px"><strong>${escapeHtml(p.employee_name)}</strong><br/>${escapeHtml(who)}<br/><span style="color:#64748b">${escapeHtml(days)}</span></div>
<table role="presentation" style="width:100%;border-collapse:collapse;margin-top:8px"><tr>${table(L.earnings, earnings, L.gross, p.gross)}${table(L.deductions, deductions, L.totalDed, p.total_deductions)}</tr></table>
<div style="margin-top:8px;border-radius:8px;background:${accent}14;padding:14px 16px"><div style="font-size:13px;color:#475569">${escapeHtml(L.net)}</div><div style="font-size:24px;font-weight:800">${money(p.net_pay)}</div><div style="font-size:12px;color:#64748b">${escapeHtml(L.words)}: ${escapeHtml(words)}</div></div>
<p style="margin:16px 0 0;font-size:14px">${escapeHtml(L.portal)} <a href="${escapeHtml(opts.portalUrl)}" style="color:${accent}">${escapeHtml(opts.portalUrl)}</a></p>
<p style="margin:12px 0 0;font-size:12px;color:#94a3b8">${escapeHtml(L.footer)}</p>
</div></div></body></html>`;

  return { subject: `${L.subject(month)} · ${opts.companyName}`, text, html };
}
