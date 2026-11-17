import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Circle, CircleDot } from 'lucide-react';
import type { TFunction } from 'i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ListSkeleton } from '@/components/shared/states';
import { StatusBadge } from '@/components/shared/widgets';
import { useAuth } from '@/features/auth/AuthProvider';
import { errorKey } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { sb, unwrap } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import type { OnboardingTask } from '@/types/db';

const toastError = (t: TFunction) => (err: unknown) => toast.error(t(errorKey(err), { defaultValue: t('errors.generic') }));

// ── Onboarding checklist (staff + customer admins can tick) ───────────
export function OnboardingChecklist({ companyId, editable }: { companyId: string; editable: boolean }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ['onboarding', companyId],
    queryFn: async () => unwrap(await sb().from('onboarding_tasks').select('*').eq('company_id', companyId).order('sort_order')) as OnboardingTask[],
  });
  const update = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: OnboardingTask['status'] }) =>
      unwrap(await sb().from('onboarding_tasks').update({ status, completed_at: status === 'done' ? new Date().toISOString() : null, completed_by: status === 'done' ? user?.id : null }).eq('id', id).select('id').single()),
    onSettled: () => qc.invalidateQueries({ queryKey: ['onboarding', companyId] }),
    onError: toastError(t),
  });
  if (query.isPending) return <ListSkeleton rows={4} />;
  const tasks = query.data ?? [];
  const done = tasks.filter((x) => x.status === 'done' || x.status === 'skipped').length;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const next: Record<OnboardingTask['status'], OnboardingTask['status']> = { pending: 'in_progress', in_progress: 'done', done: 'pending', skipped: 'pending' };

  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1.5 flex justify-between text-sm"><span className="font-medium">{t('onboarding.progress')}</span><span className="tabular text-muted-foreground">{done}/{tasks.length}</span></div>
        <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><div className="h-full rounded-full bg-success transition-[width] duration-700" style={{ width: `${pct}%` }} /></div>
      </div>
      <ul className="divide-y rounded-xl border">
        {tasks.map((task) => {
          const Icon = task.status === 'done' ? CheckCircle2 : task.status === 'in_progress' ? CircleDot : Circle;
          return (
            <li key={task.id} className="flex items-center gap-3 px-3 py-2.5">
              <button disabled={!editable} onClick={() => update.mutate({ id: task.id, status: next[task.status] })} className="inline-flex size-9 shrink-0 items-center justify-center rounded-full hover:bg-muted disabled:pointer-events-none" aria-label={t('onboarding.toggle', { title: task.title })}>
                <Icon className={cn('size-5', task.status === 'done' ? 'text-success' : task.status === 'in_progress' ? 'text-primary' : 'text-muted-foreground')} />
              </button>
              <div className="min-w-0 flex-1">
                <p className={cn('text-sm font-medium', task.status === 'done' && 'text-muted-foreground line-through')}>{t(`onboarding.tasks.${task.sort_order}`, { defaultValue: task.title })}</p>
                {task.description && <p className="text-xs text-muted-foreground">{t(`onboarding.taskDesc.${task.sort_order}`, { defaultValue: task.description })}</p>}
              </div>
              {task.completed_at ? <span className="text-xs text-muted-foreground">{formatDate(task.completed_at, i18n.language)}</span> : <StatusBadge value={task.status} group="onboardingStatus" />}
              {editable && task.status !== 'done' && task.status !== 'skipped' && (
                <Button variant="ghost" size="sm" onClick={() => update.mutate({ id: task.id, status: 'skipped' })}>{t('onboarding.skip')}</Button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
