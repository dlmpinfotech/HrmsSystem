import { useEffect, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Check, ChevronsLeft, ChevronsUpDown, Ellipsis, LogOut, Menu, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Avatar, Tooltip } from '@/components/ui/primitives';
import { LogoMark } from '@/components/shared/brand';
import { LanguageSwitcher, ThemeToggle } from '@/components/shared/widgets';
import { PageTransition } from '@/components/layout/PublicLayout';
import { personaHome, useAuth } from '@/features/auth/AuthProvider';
import { useTheme } from '@/features/branding/ThemeProvider';
import { cn, storage } from '@/lib/utils';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  /** Optional heading shown above this item (starts a new group). */
  group?: string;
  /** Show in the phone bottom bar (up to four items). */
  mobile?: boolean;
}

interface AppShellProps {
  nav: NavItem[];
  brandName: string;
  logoUrl?: string | null;
  homeTo: string;
  /** Extra controls on the right of the top bar. */
  topbarExtra?: ReactNode;
  /** Banner rendered above page content (e.g. trial / suspension notices). */
  banner?: ReactNode;
}

const COLLAPSE_KEY = 'hrms.sidebar-collapsed';

/** Ghost buttons placed on the header, which uses the sidebar colours. */
export const HEADER_BUTTON = 'text-sidebar-foreground hover:bg-sidebar-foreground/10 hover:text-sidebar-foreground';

function Brand({ name, logoUrl, to, collapsed }: { name: string; logoUrl?: string | null; to: string; collapsed?: boolean }) {
  return (
    <Link to={to} className="flex min-w-0 items-center gap-2.5 rounded-md font-bold" aria-label={name}>
      {logoUrl ? <img src={logoUrl} alt="" className="h-8 w-8 shrink-0 rounded-md object-contain" /> : <LogoMark className="shrink-0" />}
      {!collapsed && <span className="truncate">{name}</span>}
    </Link>
  );
}

function SideNav({ nav, collapsed, onNavigate }: { nav: NavItem[]; collapsed?: boolean; onNavigate?: () => void }) {
  return (
    <nav className="scroll-thin flex-1 space-y-0.5 overflow-y-auto px-2.5 py-3">
      {nav.map((item) => {
        const link = (
          <NavLink
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'group relative flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors duration-150',
                collapsed && 'justify-center px-0',
                isActive ? 'text-sidebar-foreground' : 'text-sidebar-foreground/65 hover:bg-sidebar-foreground/[0.06] hover:text-sidebar-foreground',
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <motion.span layoutId="nav-active" className="absolute inset-0 rounded-lg bg-sidebar-foreground/[0.11] shadow-[inset_0_0_0_1px_hsl(var(--sidebar-foreground)/0.06)]" transition={{ type: 'spring', stiffness: 500, damping: 40 }}>
                    <span className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-[hsl(var(--brand-accent))]" />
                  </motion.span>
                )}
                <item.icon className={cn('relative size-[18px] shrink-0 transition-transform duration-200 group-hover:scale-110', isActive && 'text-[hsl(var(--brand-accent))]')} aria-hidden />
                {collapsed ? <span className="sr-only">{item.label}</span> : <span className="relative truncate">{item.label}</span>}
              </>
            )}
          </NavLink>
        );
        return (
          <div key={item.to}>
            {item.group && !collapsed && <p className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/45">{item.group}</p>}
            {item.group && collapsed && <div className="mx-3 my-2 h-px bg-sidebar-foreground/15" />}
            {collapsed ? <Tooltip label={item.label} side="right">{link}</Tooltip> : link}
          </div>
        );
      })}
    </nav>
  );
}

/** Phone bottom bar: up to four key destinations plus "More" (opens the full menu). */
function BottomNav({ nav, onMore }: { nav: NavItem[]; onMore: () => void }) {
  const { t } = useTranslation();
  const flagged = nav.filter((n) => n.mobile);
  const items = (flagged.length >= 2 ? flagged : nav).slice(0, 4);
  const cell = 'relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium leading-tight';
  return (
    <nav aria-label={t('nav.main')} className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/90 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_-16px_hsl(var(--foreground)/0.25)] backdrop-blur-xl lg:hidden">
      <div className="mx-auto flex max-w-lg">
        {items.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => cn(cell, isActive ? 'text-primary' : 'text-muted-foreground')}>
            {({ isActive }) => (
              <>
                {isActive && <motion.span layoutId="bottom-active" className="absolute inset-x-3 top-1.5 h-8 rounded-full bg-primary/12" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
                <item.icon className="relative size-5" aria-hidden />
                <span className="relative max-w-full truncate">{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
        <button type="button" onClick={onMore} className={cn(cell, 'text-muted-foreground')} aria-label={t('nav.openMenu')}>
          <Ellipsis className="size-5" aria-hidden />
          <span>{t('nav.more')}</span>
        </button>
      </div>
    </nav>
  );
}

function UserMenu() {
  const { t } = useTranslation();
  const { profile, roles, activeMembership, signOut, isStaff, personas, persona, choosePersona } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const roleLabel = isStaff ? roles.filter((r) => !r.startsWith('customer')).map((r) => t(`role.${r}`)).join(', ') : persona ? t(`persona.kind.${persona.kind}`) : activeMembership ? t(`role.${activeMembership.role}`) : '';
  const manyCompanies = new Set(personas.map((p) => p.companyId)).size > 1;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 rounded-full p-0.5 pr-1 text-left hover:bg-sidebar-foreground/10 sm:pr-2" aria-label={t('common.accountMenu')}>
          <Avatar name={profile?.full_name || profile?.email} />
          <span className="hidden max-w-[140px] sm:block">
            <span className="block truncate text-sm font-semibold leading-tight">{profile?.full_name || profile?.email}</span>
            <span className="block truncate text-xs leading-tight opacity-70">{roleLabel}</span>
          </span>
          <ChevronsUpDown className="hidden size-3.5 opacity-70 sm:block" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-60">
        <DropdownMenuLabel className="truncate">{profile?.email}</DropdownMenuLabel>
        {personas.length > 1 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t('persona.switch')}</DropdownMenuLabel>
            {personas.map((p) => (
              <DropdownMenuItem
                key={p.key}
                onSelect={() => {
                  if (p.key === persona?.key) return;
                  choosePersona(p.key);
                  void queryClient.invalidateQueries();
                  navigate(personaHome(p), { replace: true });
                }}
              >
                <span className="min-w-0 flex-1">
                  <span className={cn('block truncate', p.key === persona?.key && 'font-semibold text-primary')}>{t(`persona.kind.${p.kind}`)}</span>
                  {manyCompanies && p.companyName && <span className="block truncate text-xs text-muted-foreground">{p.companyName}</span>}
                </span>
                {p.key === persona?.key && <Check className="size-4 text-primary" aria-label={t('persona.current')} />}
              </DropdownMenuItem>
            ))}
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/security')}>{t('mfa.title')}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate('/')}>{t('nav.website')}</DropdownMenuItem>
        <DropdownMenuItem
          destructive
          onSelect={() => {
            void signOut().then(() => navigate('/login'));
          }}
        >
          <LogOut /> {t('auth.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Authenticated application frame shared by the admin area and the customer portal.
 * Desktop: collapsible sidebar (or a top navigation bar when the company's branding
 * chooses that layout). Phones/tablets: slide-in drawer.
 */
export function AppShell({ nav, brandName, logoUrl, homeTo, topbarExtra, banner }: AppShellProps) {
  const { t } = useTranslation();
  const { branding } = useTheme();
  const location = useLocation();
  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useState(() => storage.get(COLLAPSE_KEY) === '1');
  const topbarLayout = branding?.appearance.navLayout === 'topbar';

  useEffect(() => setDrawer(false), [location.pathname]);
  const toggle = () => {
    setCollapsed((c) => {
      storage.set(COLLAPSE_KEY, c ? '0' : '1');
      return !c;
    });
  };

  return (
    <div className="app-canvas flex min-h-dvh">
      {!topbarLayout && (
        <motion.aside
          initial={false}
          animate={{ width: collapsed ? 72 : 256 }}
          transition={{ type: 'spring', stiffness: 380, damping: 36 }}
          className="sticky top-0 hidden h-dvh shrink-0 flex-col overflow-hidden border-r border-sidebar-foreground/10 bg-sidebar text-sidebar-foreground lg:flex"
          aria-label={t('nav.main')}
        >
          <div className={cn('flex h-16 shrink-0 items-center border-b border-sidebar-foreground/10 px-4', collapsed && 'justify-center px-0')}>
            <Brand name={brandName} logoUrl={logoUrl} to={homeTo} collapsed={collapsed} />
          </div>
          <SideNav nav={nav} collapsed={collapsed} />
          <div className="border-t border-sidebar-foreground/10 p-2.5">
            <button
              onClick={toggle}
              aria-label={collapsed ? t('nav.expand') : t('nav.collapse')}
              aria-expanded={!collapsed}
              className={cn('flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-sm text-sidebar-foreground/70 hover:bg-sidebar-foreground/[0.07] hover:text-sidebar-foreground', collapsed && 'justify-center px-0')}
            >
              <ChevronsLeft className={cn('size-[18px] transition-transform', collapsed && 'rotate-180')} aria-hidden />
              {!collapsed && <span>{t('nav.collapse')}</span>}
            </button>
          </div>
        </motion.aside>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-sidebar-foreground/10 bg-sidebar/95 text-sidebar-foreground shadow-[0_6px_20px_-14px_hsl(var(--foreground)/0.45)] backdrop-blur-xl">
          <div className="flex h-16 items-center gap-2 px-3 sm:px-5">
            <Dialog open={drawer} onOpenChange={setDrawer}>
              <DialogTrigger asChild>
                <Button variant="ghost" size="icon-sm" className={cn('lg:hidden', HEADER_BUTTON)} aria-label={t('nav.openMenu')}>
                  <Menu />
                </Button>
              </DialogTrigger>
              <DialogContent side="left" className="border-sidebar-foreground/10 bg-sidebar p-0 text-sidebar-foreground" closeLabel={t('common.close')}>
                <DialogTitle className="sr-only">{t('nav.menu')}</DialogTitle>
                <DialogDescription className="sr-only">{t('nav.main')}</DialogDescription>
                <div className="flex h-16 shrink-0 items-center px-4">
                  <Brand name={brandName} logoUrl={logoUrl} to={homeTo} />
                </div>
                <SideNav nav={nav} onNavigate={() => setDrawer(false)} />
              </DialogContent>
            </Dialog>

            <div className={cn('min-w-0', topbarLayout ? 'flex' : 'lg:hidden')}>
              <Brand name={brandName} logoUrl={logoUrl} to={homeTo} />
            </div>

            {topbarLayout && (
              <nav className="scroll-thin ml-4 hidden min-w-0 flex-1 items-center gap-1 overflow-x-auto lg:flex" aria-label={t('nav.main')}>
                {nav.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) => cn('inline-flex h-9 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors', isActive ? 'bg-sidebar-foreground/[0.12] text-sidebar-foreground' : 'text-sidebar-foreground/70 hover:bg-sidebar-foreground/[0.07] hover:text-sidebar-foreground')}
                  >
                    <item.icon className="size-4" aria-hidden />
                    {item.label}
                  </NavLink>
                ))}
              </nav>
            )}

            <div className="ml-auto flex items-center gap-1">
              {topbarExtra}
              <LanguageSwitcher compact className={HEADER_BUTTON} />
              <ThemeToggle className={HEADER_BUTTON} />
              <UserMenu />
            </div>
          </div>
        </header>

        {banner}
        <main id="main" className="page flex-1 pb-28 lg:pb-[var(--page-pad)]">
          <PageTransition />
        </main>
        <BottomNav nav={nav} onMore={() => setDrawer(true)} />
      </div>
    </div>
  );
}
