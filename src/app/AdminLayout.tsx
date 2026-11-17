import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { BarChart3, Bell, Building2, CalendarDays, CreditCard, LayoutDashboard, LifeBuoy, MessageCircle, Settings, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/primitives';
import { AppShell, HEADER_BUTTON, type NavItem } from '@/components/layout/AppShell';
import { cn } from '@/lib/utils';
import { useAuth } from '@/features/auth/AuthProvider';
import { usePublicConfig } from '@/hooks/usePublicConfig';
import { sb } from '@/lib/supabase';
import type { Permission } from '@shared/permissions';

/** Follow-ups due within the next hour, shown as a badge on the bell. */
function FollowUpBell() {
  const { t } = useTranslation();
  const { user, can } = useAuth();
  const due = useQuery({
    queryKey: ['followups-due', user?.id],
    enabled: can('leads.view'),
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      const { count } = await sb()
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .eq('assigned_to', user!.id)
        .lte('next_follow_up_at', new Date(Date.now() + 3_600_000).toISOString())
        .not('status', 'in', '(won,lost)');
      return count ?? 0;
    },
  });
  if (!can('leads.view')) return null;
  const count = due.data ?? 0;
  return (
    <Tooltip label={t('nav.followUpsDue', { count })}>
      <Button variant="ghost" size="icon-sm" asChild aria-label={t('nav.followUpsDue', { count })} className={cn('relative', HEADER_BUTTON)}>
        <Link to="/admin/leads?assigned=me">
          <Bell />
          {count > 0 && <span className="absolute -right-0.5 -top-0.5 inline-flex min-w-[18px] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">{count > 99 ? '99+' : count}</span>}
        </Link>
      </Button>
    </Tooltip>
  );
}

export function AdminLayout() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const config = usePublicConfig();
  const all: (NavItem & { permission: Permission })[] = [
    { to: '/admin', label: t('nav.dashboard'), icon: LayoutDashboard, end: true, permission: 'dashboard.view' },
    { to: '/admin/leads', label: t('nav.leads'), icon: Users, permission: 'leads.view', group: t('nav.groupSales') },
    { to: '/admin/demos', label: t('nav.demos'), icon: CalendarDays, permission: 'demos.view' },
    { to: '/admin/customers', label: t('nav.customers'), icon: Building2, permission: 'customers.view', group: t('nav.groupCustomers') },
    { to: '/admin/subscriptions', label: t('nav.subscriptions'), icon: CreditCard, permission: 'subscriptions.view' },
    { to: '/admin/support', label: t('nav.support'), icon: LifeBuoy, permission: 'support.view' },
    { to: '/admin/whatsapp', label: 'WhatsApp', icon: MessageCircle, permission: 'whatsapp.view', group: t('nav.groupComms') },
    { to: '/admin/notifications', label: t('nav.notifications'), icon: Bell, permission: 'notifications.view' },
    { to: '/admin/reports', label: t('nav.reports'), icon: BarChart3, permission: 'reports.view', group: t('nav.groupInsights') },
    { to: '/admin/settings', label: t('nav.settings'), icon: Settings, permission: 'content.manage' },
  ];
  const nav = all.filter((n) => can(n.permission) || (n.to === '/admin/settings' && (can('settings.manage') || can('leads.assign'))));
  // Keep group headings on the first visible item of each group.
  let lastGroup: string | undefined;
  const withGroups = nav.map((n) => {
    const group = all.slice(0, all.indexOf(n) + 1).reverse().find((x) => x.group)?.group;
    const item = { ...n, group: group !== lastGroup ? group : undefined };
    lastGroup = group;
    return item;
  });
  return <AppShell nav={withGroups} brandName={config.brand.name} homeTo="/admin" topbarExtra={<FollowUpBell />} />;
}
