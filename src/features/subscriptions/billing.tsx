import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { BadgeCheck, CreditCard, FilePlus2, Printer, Receipt, XCircle } from 'lucide-react';
import type { TFunction } from 'i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DialogBody, DialogFooter } from '@/components/ui/dialog';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { CheckField, SelectField, TextField, TextareaField } from '@/components/shared/Field';
import { EmptyState, ListSkeleton } from '@/components/shared/states';
import { ConfirmDialog, FormDialog, InfoRow, StatusBadge } from '@/components/shared/widgets';
import { addPeriod, periodAmount } from '@/features/subscriptions/plans';
import { api, errorKey } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/format';
import { sb, unwrap } from '@/lib/supabase';
import type { Invoice, Payment, Plan, Subscription } from '@/types/db';
import { BILLING_FREQUENCIES, GST_RATE, PAYMENT_METHODS } from '@shared/constants';

const err = (t: TFunction) => (e: unknown) => toast.error(t(errorKey(e), { defaultValue: t('errors.generic') }));

export function useCompanySubscription(companyId: string) {
  return useQuery({
    queryKey: ['subscription', companyId],
    queryFn: async () => {
      const rows = unwrap(await sb().from('subscriptions').select('*, plans(*)').eq('company_id', companyId).order('created_at', { ascending: false }).limit(10)) as Subscription[];
      return { current: rows.find((s) => ['trialing', 'active', 'past_due'].includes(s.status)) ?? rows[0] ?? null, history: rows };
    },
  });
}

export function useAllPlans() {
  return useQuery({ queryKey: ['plans-all'], queryFn: async () => unwrap(await sb().from('plans').select('*').order('sort_order')) as Plan[] });
}

export function useBilling(companyId: string) {
  return useQuery({
    queryKey: ['billing', companyId],
    queryFn: async () => {
      const [invoices, payments] = await Promise.all([
        sb().from('invoices').select('*').eq('company_id', companyId).order('issued_at', { ascending: false }),
        sb().from('payments').select('*, invoices(invoice_number)').eq('company_id', companyId).order('created_at', { ascending: false }),
      ]);
      return { invoices: unwrap(invoices) as Invoice[], payments: unwrap(payments) as unknown as Payment[] };
    },
  });
}

function useInvalidateBilling(companyId: string) {
  const qc = useQueryClient();
  return () =>
    Promise.all(['billing', 'subscription', 'customer', 'subscriptions-admin', 'payments-admin', 'dashboard', 'customers'].map((k) => qc.invalidateQueries({ queryKey: k === 'billing' || k === 'subscription' || k === 'customer' ? [k, companyId] : [k] })));
}

// ── Subscription card ─────────────────────────────────────────────────
export function SubscriptionPanel({ companyId, manage }: { companyId: string; manage: boolean }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const query = useCompanySubscription(companyId);
  const plans = useAllPlans();
  const invalidate = useInvalidateBilling(companyId);
  const [editOpen, setEditOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [form, setForm] = useState({ plan_id: '', billing_frequency: 'monthly', amount: '' });

  const save = useMutation({
    mutationFn: async () => {
      const sub = query.data?.current;
      const patch = { plan_id: form.plan_id, billing_frequency: form.billing_frequency, amount: Number(form.amount) };
      if (sub && ['trialing', 'active', 'past_due'].includes(sub.status)) return unwrap(await sb().from('subscriptions').update(patch).eq('id', sub.id).select('id').single());
      // No live subscription: start a new one awaiting its first verified payment.
      return unwrap(await sb().from('subscriptions').insert({ ...patch, company_id: companyId, status: 'past_due' }).select('id').single());
    },
    onSuccess: async () => {
      toast.success(t('common.saved'));
      setEditOpen(false);
      await invalidate();
    },
    onError: err(t),
  });
  const cancel = useMutation({
    mutationFn: async (immediately: boolean) => {
      const sub = query.data!.current!;
      return unwrap(await sb().from('subscriptions').update(immediately ? { status: 'cancelled', cancelled_at: new Date().toISOString() } : { cancel_at_period_end: true }).eq('id', sub.id).select('id').single());
    },
    onSuccess: async () => {
      setCancelOpen(false);
      await invalidate();
    },
    onError: err(t),
  });
  const resume = useMutation({
    mutationFn: async () => unwrap(await sb().from('subscriptions').update({ cancel_at_period_end: false }).eq('id', query.data!.current!.id).select('id').single()),
    onSuccess: invalidate,
    onError: err(t),
  });

  if (query.isPending) return <ListSkeleton rows={3} />;
  const sub = query.data?.current;
  const openEdit = () => {
    setForm({ plan_id: sub?.plan_id ?? plans.data?.[0]?.id ?? '', billing_frequency: sub?.billing_frequency ?? 'monthly', amount: String(sub?.amount ?? '') });
    setEditOpen(true);
  };
  const onPlanChange = (planId: string, frequency = form.billing_frequency) => {
    const plan = plans.data?.find((p) => p.id === planId);
    setForm({ plan_id: planId, billing_frequency: frequency, amount: plan ? String(periodAmount(plan, frequency as 'monthly')) : form.amount });
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2"><CreditCard className="size-4 text-primary" aria-hidden />{t('subs.subscription')}</CardTitle>
        {sub && <StatusBadge value={sub.status} />}
      </CardHeader>
      <CardContent>
        {!sub ? (
          <EmptyState title={t('subs.none')} action={manage ? <Button size="sm" onClick={openEdit}>{t('subs.create')}</Button> : undefined} />
        ) : (
          <>
            <dl className="divide-y">
              <InfoRow label={t('subs.plan')}>{sub.plans?.name}</InfoRow>
              <InfoRow label={t('subs.billing')}>{t(`billing.${sub.billing_frequency}`)}</InfoRow>
              <InfoRow label={t('subs.amount')}>{formatCurrency(sub.amount, lang)} <span className="text-xs font-normal text-muted-foreground">{t('pricing.plusGst')}</span></InfoRow>
              {sub.status === 'trialing' && <InfoRow label={t('subs.trialEnds')}>{formatDate(sub.trial_end, lang)}</InfoRow>}
              {sub.current_period_end && <InfoRow label={sub.cancel_at_period_end ? t('subs.endsOn') : t('subs.renewsOn')}>{formatDate(sub.current_period_end, lang)}</InfoRow>}
              <InfoRow label={t('subs.employeeLimit')}>{sub.plans?.employee_limit ?? t('subs.unlimited')}</InfoRow>
              <InfoRow label={t('subs.userLimit')}>{sub.plans?.user_limit ?? t('subs.unlimited')}</InfoRow>
            </dl>
            {sub.cancel_at_period_end && <p className="mt-3 rounded-lg bg-warning/10 p-3 text-sm text-warning">{t('subs.cancelScheduled')}</p>}
            {manage && (
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={openEdit}>{t('subs.change')}</Button>
                {['trialing', 'active', 'past_due'].includes(sub.status) && !sub.cancel_at_period_end && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setCancelOpen(true)}>{t('subs.cancel')}</Button>}
                {sub.cancel_at_period_end && <Button size="sm" variant="outline" loading={resume.isPending} onClick={() => resume.mutate()}>{t('subs.resume')}</Button>}
                {['cancelled', 'expired'].includes(sub.status) && <Button size="sm" onClick={openEdit}>{t('subs.create')}</Button>}
              </div>
            )}
          </>
        )}
      </CardContent>
      <FormDialog open={editOpen} onOpenChange={setEditOpen} title={sub ? t('subs.change') : t('subs.create')} description={t('subs.changeHint')} size="sm">
        <DialogBody className="space-y-3">
          <SelectField label={t('subs.plan')} value={form.plan_id} onChange={(e) => onPlanChange(e.target.value)}>
            {plans.data?.filter((p) => p.is_active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </SelectField>
          <SelectField label={t('subs.billing')} value={form.billing_frequency} onChange={(e) => onPlanChange(form.plan_id, e.target.value)}>
            {BILLING_FREQUENCIES.map((f) => <option key={f} value={f}>{t(`billing.${f}`)}</option>)}
          </SelectField>
          <TextField label={t('subs.amountPerPeriod')} type="number" min={0} value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} hint={t('subs.amountHint')} />
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => setEditOpen(false)}>{t('common.cancel')}</Button>
          <Button loading={save.isPending} disabled={!form.plan_id || form.amount === ''} onClick={() => save.mutate()}>{t('common.save')}</Button>
        </DialogFooter>
      </FormDialog>
      <FormDialog open={cancelOpen} onOpenChange={setCancelOpen} title={t('subs.cancel')} description={t('subs.cancelHint')} size="sm">
        <DialogFooter className="border-t-0">
          <Button variant="outline" loading={cancel.isPending} onClick={() => cancel.mutate(false)}>{t('subs.cancelAtEnd')}</Button>
          <Button variant="destructive" loading={cancel.isPending} onClick={() => cancel.mutate(true)}>{t('subs.cancelNow')}</Button>
        </DialogFooter>
      </FormDialog>
    </Card>
  );
}

// ── Invoice print view (browser "Save as PDF") ────────────────────────
export function printInvoice(inv: Invoice, companyName: string, brand: string) {
  const w = window.open('', '_blank', 'noopener,width=800,height=900');
  if (!w) return;
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  const money = (n: number) => formatCurrency(n, 'en');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(inv.invoice_number)}</title>
<style>body{font-family:Arial,'Noto Sans Tamil',sans-serif;color:#0f172a;padding:40px;max-width:720px;margin:auto}h1{margin:0;color:#4f46e5}table{width:100%;border-collapse:collapse;margin-top:24px}td,th{padding:10px;border-bottom:1px solid #e2e8f0;text-align:left}.r{text-align:right}.muted{color:#64748b;font-size:13px}</style></head><body>
<h1>${esc(brand)}</h1><p class="muted">Tax invoice</p>
<p><strong>${esc(inv.invoice_number)}</strong><br/><span class="muted">Issued ${esc(formatDate(inv.issued_at))}${inv.due_at ? ` · Due ${esc(formatDate(inv.due_at))}` : ''}</span></p>
<p>Billed to:<br/><strong>${esc(companyName)}</strong></p>
<table><thead><tr><th>Description</th><th class="r">Amount</th></tr></thead><tbody>
<tr><td>${esc(inv.description ?? 'Subscription')}${inv.period_start && inv.period_end ? `<br/><span class="muted">${esc(formatDate(inv.period_start))} – ${esc(formatDate(inv.period_end))}</span>` : ''}</td><td class="r">${money(inv.amount)}</td></tr>
<tr><td class="r">GST</td><td class="r">${money(inv.tax_amount)}</td></tr>
<tr><td class="r"><strong>Total</strong></td><td class="r"><strong>${money(inv.total)}</strong></td></tr>
</tbody></table><p class="muted" style="margin-top:24px">Status: ${esc(inv.status.toUpperCase())}</p>
<script>window.onload=function(){window.print()}</script></body></html>`);
  w.document.close();
}

// ── Invoices + payments ───────────────────────────────────────────────
export function BillingPanel({ companyId, companyName, manage, brand }: { companyId: string; companyName: string; manage: boolean; brand: string }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const query = useBilling(companyId);
  const subQuery = useCompanySubscription(companyId);
  const invalidate = useInvalidateBilling(companyId);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState<string | null | false>(false);
  const [verifyTarget, setVerifyTarget] = useState<Payment | null>(null);
  const [inv, setInv] = useState({ description: '', amount: '', apply_gst: true, due_in_days: '7', link_subscription: true });
  const [pay, setPay] = useState({ amount: '', method: 'bank_transfer', reference: '', paid_on: new Date().toISOString().slice(0, 10), notes: '' });

  const createInvoice = useMutation({
    mutationFn: async () => {
      const amount = Number(inv.amount);
      const tax = inv.apply_gst ? Math.round(amount * GST_RATE * 100) / 100 : 0;
      const sub = inv.link_subscription ? subQuery.data?.current : null;
      const periodStart = sub ? new Date(Math.max(Date.now(), sub.current_period_end ? new Date(sub.current_period_end).getTime() : 0, sub.trial_end && sub.status === 'trialing' ? new Date(sub.trial_end).getTime() : 0)) : null;
      return unwrap(
        await sb().from('invoices').insert({
          company_id: companyId,
          subscription_id: sub?.id ?? null,
          description: inv.description || (sub ? `${sub.plans?.name ?? ''} plan — ${t(`billing.${sub.billing_frequency}`)}` : null),
          amount,
          tax_amount: tax,
          total: amount + tax,
          status: 'issued',
          due_at: new Date(Date.now() + Number(inv.due_in_days) * 86_400_000).toISOString(),
          period_start: periodStart?.toISOString() ?? null,
          period_end: sub && periodStart ? addPeriod(periodStart, sub.billing_frequency).toISOString() : null,
        }).select('id').single(),
      );
    },
    onSuccess: async () => {
      toast.success(t('billing.invoiceCreated'));
      setInvoiceOpen(false);
      await invalidate();
    },
    onError: err(t),
  });
  const voidInvoice = useMutation({ mutationFn: async (id: string) => unwrap(await sb().from('invoices').update({ status: 'void' }).eq('id', id).select('id').single()), onSuccess: invalidate, onError: err(t) });
  const paymentAction = useMutation({
    mutationFn: (body: Record<string, unknown>) => api('/admin/payments', { method: 'POST', body }),
    onSuccess: async () => {
      toast.success(t('common.saved'));
      setPaymentOpen(false);
      setVerifyTarget(null);
      await invalidate();
    },
    onError: err(t),
  });

  const openInvoice = () => {
    const sub = subQuery.data?.current;
    setInv({ description: '', amount: String(sub?.amount ?? ''), apply_gst: true, due_in_days: '7', link_subscription: Boolean(sub) });
    setInvoiceOpen(true);
  };
  const openPayment = (invoice?: Invoice) => {
    setPay({ amount: invoice ? String(invoice.total) : '', method: 'bank_transfer', reference: '', paid_on: new Date().toISOString().slice(0, 10), notes: '' });
    setPaymentOpen(invoice?.id ?? null);
  };

  if (query.isPending) return <ListSkeleton rows={4} />;
  const { invoices = [], payments = [] } = query.data ?? {};

  const invoiceCols: Column<Invoice>[] = [
    { key: 'no', header: t('billing.invoice'), primary: true, cell: (i) => <span className="font-semibold">{i.invoice_number}</span> },
    { key: 'issued', header: t('billing.issued'), cell: (i) => formatDate(i.issued_at, lang) },
    { key: 'due', header: t('billing.due'), cell: (i) => formatDate(i.due_at, lang) },
    { key: 'total', header: t('billing.total'), align: 'right', cell: (i) => formatCurrency(i.total, lang) },
    { key: 'status', header: t('crm.status'), cell: (i) => <StatusBadge value={i.status} /> },
    {
      key: 'actions', header: '', cell: (i) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="icon-sm" aria-label={t('billing.print')} onClick={() => printInvoice(i, companyName, brand)}><Printer /></Button>
          {manage && ['issued', 'overdue'].includes(i.status) && <Button variant="ghost" size="sm" onClick={() => openPayment(i)}>{t('billing.recordPayment')}</Button>}
          {manage && ['issued', 'overdue', 'draft'].includes(i.status) && <Button variant="ghost" size="icon-sm" aria-label={t('billing.void')} onClick={() => voidInvoice.mutate(i.id)}><XCircle /></Button>}
        </div>
      ),
    },
  ];
  const paymentCols: Column<Payment>[] = [
    { key: 'date', header: t('billing.paidOn'), primary: true, cell: (p) => formatDate(p.paid_on ?? p.created_at, lang) },
    { key: 'amount', header: t('subs.amount'), align: 'right', cell: (p) => formatCurrency(p.amount, lang) },
    { key: 'method', header: t('billing.method'), cell: (p) => t(`paymentMethod.${p.method}`) },
    { key: 'ref', header: t('billing.reference'), cell: (p) => p.reference ?? '—' },
    { key: 'invoice', header: t('billing.invoice'), cell: (p) => p.invoices?.invoice_number ?? '—' },
    { key: 'status', header: t('crm.status'), cell: (p) => <StatusBadge value={p.status} /> },
    {
      key: 'actions', header: '', cell: (p) =>
        manage && p.status === 'pending' ? (
          <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            <Button variant="outline" size="sm" onClick={() => setVerifyTarget(p)}><BadgeCheck />{t('billing.verify')}</Button>
            <Button variant="ghost" size="sm" onClick={() => paymentAction.mutate({ action: 'reject', payment_id: p.id })}>{t('billing.reject')}</Button>
          </div>
        ) : null,
    },
  ];

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2"><Receipt className="size-4 text-primary" aria-hidden />{t('billing.invoices')}</CardTitle>
          {manage && <Button size="sm" variant="outline" onClick={openInvoice}><FilePlus2 />{t('billing.newInvoice')}</Button>}
        </CardHeader>
        <CardContent>{invoices.length ? <DataTable caption={t('billing.invoices')} columns={invoiceCols} rows={invoices} rowKey={(i) => i.id} /> : <EmptyState title={t('billing.noInvoices')} />}</CardContent>
      </Card>
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>{t('billing.payments')}</CardTitle>
          {manage && <Button size="sm" variant="outline" onClick={() => openPayment()}>{t('billing.recordPayment')}</Button>}
        </CardHeader>
        <CardContent>
          {payments.length ? <DataTable caption={t('billing.payments')} columns={paymentCols} rows={payments} rowKey={(p) => p.id} /> : <EmptyState title={t('billing.noPayments')} />}
          <p className="mt-3 text-xs text-muted-foreground">{t('billing.verifyNote')}</p>
        </CardContent>
      </Card>

      <FormDialog open={invoiceOpen} onOpenChange={setInvoiceOpen} title={t('billing.newInvoice')} size="sm">
        <DialogBody className="space-y-3">
          <TextField label={t('billing.description')} value={inv.description} onChange={(e) => setInv((v) => ({ ...v, description: e.target.value }))} placeholder={t('billing.descriptionHint')} />
          <TextField label={t('billing.amountExGst')} type="number" min={0} value={inv.amount} onChange={(e) => setInv((v) => ({ ...v, amount: e.target.value }))} />
          <TextField label={t('billing.dueInDays')} type="number" min={0} max={90} value={inv.due_in_days} onChange={(e) => setInv((v) => ({ ...v, due_in_days: e.target.value }))} />
          <CheckField label={t('billing.applyGst', { rate: GST_RATE * 100 })} checked={inv.apply_gst} onChange={(e) => setInv((v) => ({ ...v, apply_gst: e.target.checked }))} />
          {subQuery.data?.current && <CheckField label={t('billing.linkSubscription')} checked={inv.link_subscription} onChange={(e) => setInv((v) => ({ ...v, link_subscription: e.target.checked }))} />}
          {inv.amount && <p className="rounded-lg bg-muted p-3 text-sm">{t('billing.total')}: <strong>{formatCurrency(Number(inv.amount) * (inv.apply_gst ? 1 + GST_RATE : 1), lang)}</strong></p>}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => setInvoiceOpen(false)}>{t('common.cancel')}</Button>
          <Button disabled={!inv.amount} loading={createInvoice.isPending} onClick={() => createInvoice.mutate()}>{t('billing.issue')}</Button>
        </DialogFooter>
      </FormDialog>

      <FormDialog open={paymentOpen !== false} onOpenChange={(o) => !o && setPaymentOpen(false)} title={t('billing.recordPayment')} description={t('billing.recordHint')} size="sm">
        <DialogBody className="space-y-3">
          <TextField label={t('subs.amount')} type="number" min={0} value={pay.amount} onChange={(e) => setPay((v) => ({ ...v, amount: e.target.value }))} />
          <SelectField label={t('billing.method')} value={pay.method} onChange={(e) => setPay((v) => ({ ...v, method: e.target.value }))}>
            {PAYMENT_METHODS.filter((m) => m !== 'razorpay').map((m) => <option key={m} value={m}>{t(`paymentMethod.${m}`)}</option>)}
          </SelectField>
          <TextField label={t('billing.reference')} value={pay.reference} onChange={(e) => setPay((v) => ({ ...v, reference: e.target.value }))} hint={t('billing.referenceHint')} />
          <TextField label={t('billing.paidOn')} type="date" value={pay.paid_on} onChange={(e) => setPay((v) => ({ ...v, paid_on: e.target.value }))} />
          <TextareaField label={t('billing.notes')} rows={2} value={pay.notes} onChange={(e) => setPay((v) => ({ ...v, notes: e.target.value }))} />
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => setPaymentOpen(false)}>{t('common.cancel')}</Button>
          <Button disabled={!pay.amount || Number(pay.amount) <= 0} loading={paymentAction.isPending} onClick={() => paymentAction.mutate({ action: 'record', company_id: companyId, invoice_id: paymentOpen || null, ...pay, amount: Number(pay.amount), reference: pay.reference || undefined, notes: pay.notes || undefined })}>{t('billing.savePending')}</Button>
        </DialogFooter>
      </FormDialog>

      <ConfirmDialog
        open={Boolean(verifyTarget)}
        onOpenChange={(o) => !o && setVerifyTarget(null)}
        title={t('billing.verifyTitle')}
        description={verifyTarget ? t('billing.verifyBody', { amount: formatCurrency(verifyTarget.amount, lang), reference: verifyTarget.reference ?? '—' }) : undefined}
        confirmLabel={t('billing.verify')}
        loading={paymentAction.isPending}
        onConfirm={() => verifyTarget && paymentAction.mutate({ action: 'verify', payment_id: verifyTarget.id })}
      />
    </div>
  );
}
