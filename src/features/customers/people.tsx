import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, KeyRound, Mail, MoreVertical, Phone, ShieldCheck, Trash2, UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Avatar } from '@/components/ui/primitives';
import { CheckField, RadioGroupField, TextField } from '@/components/shared/Field';
import { EmptyState, ListSkeleton } from '@/components/shared/states';
import { ConfirmDialog, PageHeader } from '@/components/shared/widgets';
import { useAuth } from '@/features/auth/AuthProvider';
import { api, ApiError, errorKey } from '@/lib/api';
import { sb, unwrap } from '@/lib/supabase';
import type { CompanyMembership, CustomerContact, Profile, UserInvitation } from '@/types/db';
import type { CompanyRole } from '@shared/constants';
import { formatPhone, toE164Digits } from '@shared/phone';
import { companyPersonSchema, type CompanyPersonInput } from '@shared/schemas';

/** A person at a customer company: contact details, portal access, or both. */
export interface PersonRow {
  key: string;
  name: string;
  designation: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
  contactId: string | null;
  member: { userId: string; role: CompanyRole } | null;
  invite: { id: string; role: string } | null;
}

type MemberRow = CompanyMembership & { profiles: Pick<Profile, 'id' | 'full_name' | 'email' | 'is_active'> | null };

/** Merges contacts, portal members and pending invitations into one list, matched by email. */
export function mergePeople(contacts: CustomerContact[], members: MemberRow[], invites: UserInvitation[]): PersonRow[] {
  const rows: PersonRow[] = [];
  const byEmail = new Map<string, PersonRow>();
  const norm = (e: string | null | undefined) => (e ? e.trim().toLowerCase() : '');

  for (const c of contacts) {
    const row: PersonRow = { key: `c:${c.id}`, name: c.name, designation: c.designation, email: c.email, phone: c.phone, isPrimary: c.is_primary, contactId: c.id, member: null, invite: null };
    rows.push(row);
    if (norm(c.email)) byEmail.set(norm(c.email), row);
  }
  for (const m of members) {
    const email = norm(m.profiles?.email);
    const existing = email ? byEmail.get(email) : undefined;
    const member = { userId: m.user_id, role: m.role };
    if (existing) existing.member = member;
    else {
      const row: PersonRow = { key: `m:${m.user_id}`, name: m.profiles?.full_name || m.profiles?.email || '—', designation: null, email: m.profiles?.email ?? null, phone: null, isPrimary: false, contactId: null, member, invite: null };
      rows.push(row);
      if (email) byEmail.set(email, row);
    }
  }
  for (const i of invites) {
    const existing = byEmail.get(norm(i.email));
    const invite = { id: i.id, role: i.role_key };
    if (existing) {
      if (!existing.member) existing.invite = invite;
    } else rows.push({ key: `i:${i.id}`, name: i.email, designation: null, email: i.email, phone: null, isPrimary: false, contactId: null, member: null, invite });
  }
  return rows.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.name.localeCompare(b.name));
}

function usePeople(companyId: string, includeInvites: boolean) {
  return useQuery({
    queryKey: ['people', companyId, includeInvites],
    queryFn: async () => {
      const [contacts, members, invites] = await Promise.all([
        sb().from('customer_contacts').select('*').eq('company_id', companyId),
        sb().from('company_memberships').select('*, profiles(id, full_name, email, is_active)').eq('company_id', companyId),
        includeInvites ? sb().from('user_invitations').select('*').eq('company_id', companyId).eq('status', 'pending') : Promise.resolve({ data: [], error: null }),
      ]);
      return mergePeople(unwrap(contacts) as CustomerContact[], unwrap(members) as unknown as MemberRow[], unwrap(invites) as UserInvitation[]);
    },
  });
}

/** Combined "Users" tab: everyone at the company, with portal access shown per person. */
export function CompanyPeople({ companyId, editable, addPath }: { companyId: string; editable: boolean; addPath: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { user } = useAuth();
  const query = usePeople(companyId, editable);
  const [confirm, setConfirm] = useState<{ kind: 'remove_access' | 'delete_contact'; row: PersonRow } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['people', companyId] });
  const onError = (err: unknown) => toast.error(t(errorKey(err), { defaultValue: t('errors.generic') }));

  const team = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<{ invited?: boolean }>('/team', { method: 'POST', body }),
    onSuccess: async (res) => {
      toast.success(res?.invited ? t('team.invited') : t('common.saved'));
      setConfirm(null);
      await refresh();
    },
    onError,
  });
  const deleteContact = useMutation({
    mutationFn: async (id: string) => unwrap(await sb().from('customer_contacts').delete().eq('id', id).select('id')),
    onSuccess: async () => {
      setConfirm(null);
      await refresh();
    },
    onError,
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t('people.subtitle')}</p>
        {editable && (
          <Button asChild size="sm" className="ml-auto">
            <Link to={addPath}><UserPlus />{t('people.add')}</Link>
          </Button>
        )}
      </div>

      {query.isPending ? (
        <ListSkeleton rows={3} />
      ) : !query.data?.length ? (
        <EmptyState icon={Users} title={t('people.empty')} />
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {query.data.map((row) => {
            const self = row.member?.userId === user?.id;
            const canDelete = editable && row.contactId && !row.isPrimary;
            const canGrant = editable && !row.member && !row.invite && Boolean(row.email);
            return (
              <li key={row.key} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Avatar name={row.name} />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="flex flex-wrap items-center gap-2 font-semibold">
                    {row.name}
                    {row.isPrimary && <Badge tone="primary">{t('contacts.primary')}</Badge>}
                    {self && <Badge tone="outline">{t('people.you')}</Badge>}
                  </p>
                  {row.designation && <p className="text-muted-foreground">{row.designation}</p>}
                  <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-muted-foreground">
                    {row.email && <a href={`mailto:${row.email}`} className="inline-flex min-w-0 items-center gap-1 hover:text-foreground"><Mail className="size-3.5 shrink-0" aria-hidden /><span className="truncate">{row.email}</span></a>}
                    {row.phone && <a href={`tel:${row.phone}`} className="inline-flex items-center gap-1 hover:text-foreground"><Phone className="size-3.5" aria-hidden />{formatPhone(row.phone)}</a>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {row.member ? (
                    <Badge tone={row.member.role === 'customer_admin' ? 'primary' : row.member.role === 'hr_manager' ? 'success' : 'info'}><ShieldCheck className="size-3" aria-hidden />{t(`role.${row.member.role}`)}</Badge>
                  ) : row.invite ? (
                    <Badge tone="warning"><Mail className="size-3" aria-hidden />{t('people.invitePending')}</Badge>
                  ) : (
                    <Badge tone="outline">{t('people.noAccess')}</Badge>
                  )}
                  {editable && !self && (row.member || row.invite || canDelete || canGrant) && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={t('people.actions', { name: row.name })}><MoreVertical /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        {row.member && (
                          <>
                            <DropdownMenuLabel>{t('team.role')}</DropdownMenuLabel>
                            {(['customer_admin', 'hr_manager', 'customer_user', 'employee'] as const).map((r) => (
                              <DropdownMenuItem key={r} disabled={row.member!.role === r} onSelect={() => team.mutate({ action: 'set_member_role', company_id: companyId, user_id: row.member!.userId, role: r })}>
                                <KeyRound />{t(`role.${r}`)}
                              </DropdownMenuItem>
                            ))}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem destructive onSelect={() => setConfirm({ kind: 'remove_access', row })}>{t('people.removeAccess')}</DropdownMenuItem>
                          </>
                        )}
                        {canGrant && (
                          <>
                            <DropdownMenuLabel>{t('people.portalAccess')}</DropdownMenuLabel>
                            {(['customer_user', 'hr_manager', 'customer_admin'] as const).map((r) => (
                              <DropdownMenuItem key={r} onSelect={() => team.mutate({ action: 'invite', email: row.email, full_name: row.name, role_key: r, company_id: companyId })}>
                                <Mail />{t('people.inviteAs', { role: t(`role.${r}`) })}
                              </DropdownMenuItem>
                            ))}
                          </>
                        )}
                        {row.invite && <DropdownMenuItem onSelect={() => team.mutate({ action: 'revoke_invite', invitation_id: row.invite!.id })}>{t('team.revoke')}</DropdownMenuItem>}
                        {canDelete && (
                          <>
                            {(row.member || row.invite) && <DropdownMenuSeparator />}
                            <DropdownMenuItem destructive onSelect={() => setConfirm({ kind: 'delete_contact', row })}><Trash2 />{t('people.deleteContact')}</DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={Boolean(confirm)}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm?.kind === 'remove_access' ? t('people.removeAccess') : t('people.deleteContact')}
        description={confirm?.kind === 'remove_access' ? t('team.removeConfirm') : t('people.deleteConfirm', { name: confirm?.row.name })}
        confirmLabel={confirm?.kind === 'remove_access' ? t('people.removeAccess') : t('common.delete')}
        destructive
        loading={team.isPending || deleteContact.isPending}
        onConfirm={() => {
          if (!confirm) return;
          if (confirm.kind === 'remove_access') team.mutate({ action: 'remove_member', company_id: companyId, user_id: confirm.row.member!.userId });
          else deleteContact.mutate(confirm.row.contactId!);
        }}
      />
    </div>
  );
}

/** Full-page "Add user" form: contact details plus optional portal invitation. */
function AddPersonForm({ companyId, backTo }: { companyId: string; backTo: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { register, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm<CompanyPersonInput>({
    resolver: zodResolver(companyPersonSchema) as never,
    defaultValues: { name: '', designation: '', email: '', phone: '', is_primary: false, whatsapp_opt_in: false, portal_access: true, role: 'customer_user' },
  });
  const portalAccess = watch('portal_access');

  const onSubmit = async (raw: CompanyPersonInput) => {
    const v = companyPersonSchema.parse(raw);
    try {
      if (v.is_primary) await sb().from('customer_contacts').update({ is_primary: false }).eq('company_id', companyId);
      unwrap(
        await sb()
          .from('customer_contacts')
          .insert({ company_id: companyId, name: v.name, designation: v.designation ?? null, email: v.email ?? null, phone: v.phone ? toE164Digits(v.phone) ?? v.phone : null, is_primary: v.is_primary, whatsapp_opt_in: v.whatsapp_opt_in })
          .select('id')
          .single(),
      );
    } catch (err) {
      toast.error(t(errorKey(err), { defaultValue: t('errors.generic') }));
      return;
    }

    if (v.portal_access && v.email) {
      try {
        const res = await api<{ invited?: boolean }>('/team', { method: 'POST', body: { action: 'invite', email: v.email, full_name: v.name, role_key: v.role, company_id: companyId } });
        toast.success(res.invited ? t('people.savedInvited', { email: v.email }) : t('people.savedAccess'));
      } catch (err) {
        const reason = err instanceof ApiError ? t(`errors.${err.code}`, { defaultValue: err.message }) : t('errors.generic');
        toast.error(t('people.inviteFailed', { reason }), { duration: 8000 });
      }
    } else {
      toast.success(t('people.saved'));
    }
    await qc.invalidateQueries({ queryKey: ['people', companyId] });
    navigate(backTo);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit as never)} noValidate className="space-y-5">
      <Card>
        <CardHeader><CardTitle>{t('people.contactDetails')}</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <TextField label={t('contacts.name')} required autoComplete="off" error={errors.name?.message} {...register('name')} />
          <TextField label={t('contacts.designation')} placeholder={t('people.designationPlaceholder')} error={errors.designation?.message} {...register('designation')} />
          <TextField label={t('form.email')} type="email" inputMode="email" required={portalAccess} error={errors.email?.message} {...register('email')} />
          <TextField label={t('form.phone')} type="tel" inputMode="tel" placeholder="98765 43210" error={errors.phone?.message} {...register('phone')} />
          <div className="space-y-2 sm:col-span-2">
            <CheckField label={t('contacts.makePrimary')} {...register('is_primary')} />
            <CheckField label={t('form.whatsappOptIn')} {...register('whatsapp_opt_in')} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('people.access')}</CardTitle>
          <p className="text-sm text-muted-foreground">{t('people.accessHint')}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <CheckField label={t('people.portalAccess')} {...register('portal_access')} />
          {portalAccess && (
            <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}>
              <RadioGroupField
                label={t('team.role')}
                inputProps={register('role')}
                options={(['customer_user', 'hr_manager', 'customer_admin'] as const).map((r) => ({ value: r, label: t(`role.${r}`), hint: t(`roleHint.${r}`) }))}
              />
            </motion.div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" asChild><Link to={backTo}>{t('common.cancel')}</Link></Button>
        <Button type="submit" loading={isSubmitting}><UserPlus />{portalAccess ? t('people.saveAndInvite') : t('people.save')}</Button>
      </div>
    </form>
  );
}

/** /portal/company/users/new — for the signed-in company admin. */
export function PortalAddPersonPage() {
  const { t } = useTranslation();
  const { activeCompany } = useAuth();
  const backTo = '/portal/company?tab=users';
  if (!activeCompany) return null;
  return (
    <div className="mx-auto max-w-3xl">
      <Button variant="ghost" size="sm" asChild className="mb-3 -ml-2"><Link to={backTo}><ArrowLeft />{t('people.back')}</Link></Button>
      <PageHeader title={t('people.newTitle')} description={t('people.newSubtitle', { company: activeCompany.name })} />
      <AddPersonForm companyId={activeCompany.id} backTo={backTo} />
    </div>
  );
}

/** /admin/customers/:id/users/new — staff adding a person to a customer company. */
export function AdminAddPersonPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const company = useQuery({ queryKey: ['customer-name', id], queryFn: async () => unwrap(await sb().from('companies').select('name').eq('id', id).single()) as { name: string } });
  const backTo = `/admin/customers/${id}?tab=users`;
  return (
    <div className="mx-auto max-w-3xl">
      <Button variant="ghost" size="sm" asChild className="mb-3 -ml-2"><Link to={backTo}><ArrowLeft />{t('people.back')}</Link></Button>
      <PageHeader title={t('people.newTitle')} description={t('people.newSubtitle', { company: company.data?.name ?? '' })} />
      <AddPersonForm companyId={id} backTo={backTo} />
    </div>
  );
}
