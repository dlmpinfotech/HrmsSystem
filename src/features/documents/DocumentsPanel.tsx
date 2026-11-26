import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Check, ExternalLink, FileText, FileUp, History, Trash2, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DialogBody, DialogFooter } from '@/components/ui/dialog';
import { SelectField, TextField } from '@/components/shared/Field';
import { EmptyState, ErrorState, ListSkeleton, PageSkeleton } from '@/components/shared/states';
import { ConfirmDialog, FormDialog, PageHeader, StatusBadge } from '@/components/shared/widgets';
import { EmployeeAssetsCard } from '@/features/assets/AssetsPages';
import { useAuth } from '@/features/auth/AuthProvider';
import { useMyEmployee } from '@/features/hr/api';
import { errorKey } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { sb, unwrap } from '@/lib/supabase';
import { DOCUMENT_CATEGORIES, documentFileError, expiryState, safeFileName, type DocumentCategory } from '@shared/documents';
import { istDateString } from '@shared/slots';

const BUCKET = 'employee-documents';

interface EmployeeDocument {
  id: string;
  employee_id: string;
  category: DocumentCategory;
  title: string;
  file_path: string;
  file_name: string;
  file_size: number;
  expires_on: string | null;
  version: number;
  replaces_id: string | null;
  is_current: boolean;
  status: 'pending' | 'approved' | 'rejected';
  decision_note: string | null;
  created_at: string;
}

function useDocuments(employeeId: string) {
  return useQuery({
    queryKey: ['hr', 'documents', employeeId],
    queryFn: async () => unwrap(await sb().from('employee_documents').select('*').eq('employee_id', employeeId).order('created_at', { ascending: false })) as EmployeeDocument[],
  });
}

const day = (date: string, lang: string) => formatDate(`${date.slice(0, 10)}T06:30:00Z`, lang);

function UploadDialog({ companyId, employeeId, replaces, open, onClose }: { companyId: string; employeeId: string; replaces: EmployeeDocument | null; open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState<DocumentCategory>('id_proof');
  const [title, setTitle] = useState('');
  const [expires, setExpires] = useState('');
  const [busy, setBusy] = useState(false);
  const fileError = file ? documentFileError(file) : null;
  const finalTitle = title.trim() || replaces?.title || '';
  const close = () => {
    setFile(null);
    setTitle('');
    setExpires('');
    onClose();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || fileError || finalTitle.length < 2) return;
    setBusy(true);
    const path = `${companyId}/${employeeId}/${crypto.randomUUID()}-${safeFileName(file.name)}`;
    try {
      const up = await sb().storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
      if (up.error) throw new Error(up.error.message);
      const res = await sb()
        .from('employee_documents')
        .insert({ employee_id: employeeId, category: replaces?.category ?? category, title: finalTitle, file_path: path, file_name: file.name.slice(0, 200), mime_type: file.type, file_size: file.size, expires_on: expires || null, replaces_id: replaces?.id ?? null })
        .select('status')
        .single();
      if (res.error) {
        await sb().storage.from(BUCKET).remove([path]); // don't leave an orphan file
        unwrap(res);
      }
      toast.success(res.data?.status === 'approved' ? t('docs.uploaded') : t('docs.uploadedPending'));
      await qc.invalidateQueries({ queryKey: ['hr'] });
      close();
    } catch (err) {
      toast.error(t(errorKey(err), { defaultValue: t('docs.uploadFailed') }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormDialog open={open} onOpenChange={(o) => !o && close()} title={replaces ? t('docs.newVersionOf', { title: replaces.title }) : t('docs.upload')} description={t('docs.uploadHint')}>
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
        <DialogBody className="space-y-4">
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors hover:border-primary/60 focus-within:ring-2 focus-within:ring-ring">
            <FileUp className="size-7 text-primary" aria-hidden />
            <span className="max-w-full break-all text-sm font-medium">{file?.name ?? t('docs.chooseFile')}</span>
            <span className="text-xs text-muted-foreground">{t('docs.fileRules')}</span>
            <input ref={input} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          {fileError && <p role="alert" className="text-sm font-medium text-destructive">{t(`docs.errors.${fileError}`)}</p>}
          {!replaces && (
            <SelectField label={t('docs.category')} value={category} onChange={(e) => setCategory(e.target.value as DocumentCategory)}>
              {DOCUMENT_CATEGORIES.map((c) => <option key={c} value={c}>{t(`docs.categories.${c}`)}</option>)}
            </SelectField>
          )}
          <TextField label={t('docs.titleLabel')} value={title} maxLength={120} placeholder={replaces?.title ?? t('docs.titlePlaceholder')} onChange={(e) => setTitle(e.target.value)} />
          <TextField label={t('docs.expiresOn')} type="date" hint={t('docs.expiresHint')} value={expires} onChange={(e) => setExpires(e.target.value)} />
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={close}>{t('common.cancel')}</Button>
          <Button type="submit" loading={busy} disabled={!file || Boolean(fileError) || finalTitle.length < 2}><Upload />{t('docs.upload')}</Button>
        </DialogFooter>
      </form>
    </FormDialog>
  );
}

export function DocumentsPanel({ companyId, employeeId }: { companyId: string; employeeId: string }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { isHr } = useAuth();
  const qc = useQueryClient();
  const docs = useDocuments(employeeId);
  const [uploading, setUploading] = useState<{ replaces: EmployeeDocument | null } | null>(null);
  const [deleting, setDeleting] = useState<EmployeeDocument | null>(null);
  const [showOld, setShowOld] = useState(false);
  const today = istDateString(new Date());
  const onError = (err: unknown) => toast.error(t(errorKey(err), { defaultValue: t('errors.generic') }));

  const view = async (d: EmployeeDocument) => {
    // Open the tab first (inside the click) so pop-up blockers allow it, then point it at a 60-second link.
    const tab = window.open('', '_blank');
    const { data, error } = await sb().storage.from(BUCKET).createSignedUrl(d.file_path, 60);
    if (error || !data) {
      tab?.close();
      toast.error(t('docs.openFailed'));
      return;
    }
    if (tab) {
      tab.opener = null;
      tab.location.href = data.signedUrl;
    } else window.location.assign(data.signedUrl);
  };
  const decide = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'approved' | 'rejected' }) => unwrap(await sb().from('employee_documents').update({ status }).eq('id', id).select('id').single()),
    onSuccess: async (_d, v) => {
      toast.success(v.status === 'approved' ? t('docs.approved') : t('docs.rejected'));
      await qc.invalidateQueries({ queryKey: ['hr'] });
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: async (d: EmployeeDocument) => {
      const gone = unwrap(await sb().from('employee_documents').delete().eq('id', d.id).select('id')) as unknown[];
      if (!gone.length) throw new Error('not_allowed');
      await sb().storage.from(BUCKET).remove([d.file_path]);
    },
    onSuccess: async () => {
      setDeleting(null);
      toast.success(t('docs.deleted'));
      await qc.invalidateQueries({ queryKey: ['hr'] });
    },
    onError,
  });

  const all = docs.data ?? [];
  const shown = showOld ? all : all.filter((d) => d.is_current);
  const hidden = all.length - all.filter((d) => d.is_current).length;

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle>{t('docs.title')}</CardTitle>
        <Button size="sm" onClick={() => setUploading({ replaces: null })}><Upload />{t('docs.upload')}</Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {docs.isPending ? <ListSkeleton rows={3} /> : docs.isError ? <ErrorState error={docs.error} onRetry={() => void docs.refetch()} /> : !shown.length ? <EmptyState icon={FileText} title={t('docs.none')} description={t('docs.noneBody')} /> : (
          <ul className="divide-y rounded-xl border">
            {shown.map((d) => {
              const expiry = expiryState(d.expires_on, today);
              return (
                <li key={d.id} className="flex flex-wrap items-center gap-3 px-3 py-3 text-sm sm:px-4">
                  <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><FileText className="size-5" aria-hidden /></span>
                  <div className="min-w-0 flex-1 basis-44">
                    <p className="break-words font-semibold">{d.title}{d.version > 1 ? <span className="ml-1 text-xs font-normal text-muted-foreground">v{d.version}</span> : null}</p>
                    <p className="text-xs text-muted-foreground">{t(`docs.categories.${d.category}`)} · {day(d.created_at, lang)} · {Math.max(1, Math.round(d.file_size / 1024))} KB</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <StatusBadge value={d.status} group="leaveStatus" />
                      {!d.is_current && <Badge tone="outline">{t('docs.oldVersion')}</Badge>}
                      {d.expires_on && <Badge tone={expiry === 'expired' ? 'danger' : expiry === 'soon' ? 'warning' : 'neutral'}>{expiry === 'expired' ? t('docs.expired', { date: day(d.expires_on, lang) }) : t('docs.expires', { date: day(d.expires_on, lang) })}</Badge>}
                    </div>
                    {d.decision_note && <p className="mt-1 text-xs text-muted-foreground">{d.decision_note}</p>}
                  </div>
                  <div className="flex w-full flex-wrap justify-end gap-2 sm:w-auto">
                    <Button variant="outline" size="sm" onClick={() => void view(d)}><ExternalLink />{t('docs.view')}</Button>
                    {isHr && d.status === 'pending' && (
                      <>
                        <Button size="sm" loading={decide.isPending && decide.variables?.id === d.id} onClick={() => decide.mutate({ id: d.id, status: 'approved' })}><Check />{t('leave.approve')}</Button>
                        <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate({ id: d.id, status: 'rejected' })}><X />{t('leave.reject')}</Button>
                      </>
                    )}
                    {d.is_current && d.status === 'approved' && <Button variant="ghost" size="sm" onClick={() => setUploading({ replaces: d })}><History />{t('docs.newVersion')}</Button>}
                    {(isHr || d.status !== 'approved') && <Button variant="ghost" size="icon-sm" aria-label={t('common.delete')} onClick={() => setDeleting(d)}><Trash2 /></Button>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {hidden > 0 && <Button variant="ghost" size="sm" onClick={() => setShowOld((v) => !v)}><History />{showOld ? t('docs.hideOld') : t('docs.showOld', { count: hidden })}</Button>}
      </CardContent>
      <UploadDialog companyId={companyId} employeeId={employeeId} open={Boolean(uploading)} replaces={uploading?.replaces ?? null} onClose={() => setUploading(null)} />
      <ConfirmDialog open={Boolean(deleting)} onOpenChange={(o) => !o && setDeleting(null)} title={t('common.delete')} description={t('docs.deleteConfirm', { title: deleting?.title ?? '' })} confirmLabel={t('common.delete')} destructive loading={remove.isPending} onConfirm={() => deleting && remove.mutate(deleting)} />
    </Card>
  );
}

/** An employee's own documents. */
export function MyDocumentsPage() {
  const { t } = useTranslation();
  const me = useMyEmployee();
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={t('docs.myTitle')} description={t('docs.mySubtitle')} />
      {me.isPending ? <PageSkeleton /> : me.data ? (
        <div className="space-y-5">
          <DocumentsPanel companyId={me.data.company_id} employeeId={me.data.id} />
          <EmployeeAssetsCard employeeId={me.data.id} />
        </div>
      ) : <EmptyState icon={FileText} title={t('att.noRecordTitle')} description={t('att.noRecordBody')} />}
    </div>
  );
}
