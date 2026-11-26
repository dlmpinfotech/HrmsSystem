import { Suspense, useEffect, useState } from 'react';
import { AnimatePresence, motion, useScroll, useSpring } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Mail, MapPin, Menu, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { FloatingWhatsApp, Logo, WhatsAppButton } from '@/components/shared/brand';
import { PageSkeleton } from '@/components/shared/states';
import { LanguageSwitcher, ThemeToggle } from '@/components/shared/widgets';
import { useAuth } from '@/features/auth/AuthProvider';
import { usePublicConfig } from '@/hooks/usePublicConfig';
import { captureUtm, getAnalyticsConsent, initAnalytics, setAnalyticsConsent, trackPageView } from '@/lib/analytics';
import { cn } from '@/lib/utils';
import { formatPhone } from '@shared/phone';

const NAV = [
  { to: '/features', key: 'nav.features' },
  { to: '/solutions', key: 'nav.solutions' },
  { to: '/pricing', key: 'nav.pricing' },
  { to: '/videos', key: 'nav.videos' },
  { to: '/about', key: 'nav.about' },
  { to: '/contact', key: 'nav.contact' },
];

function Navbar() {
  const { t } = useTranslation();
  const { session, homePath } = useAuth();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const location = useLocation();

  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className={cn('sticky top-0 z-40 transition-[background-color,box-shadow,border-color] duration-200', scrolled ? 'border-b bg-background/85 shadow-sm backdrop-blur-xl' : 'border-b border-transparent bg-background/0')}>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:shadow">
        {t('common.skipToContent')}
      </a>
      <div className="container flex h-16 items-center justify-between gap-3">
        <Logo />
        <nav className="hidden items-center gap-1 lg:flex" aria-label={t('nav.main')}>
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => cn('rounded-md px-3 py-2 text-sm font-medium transition-colors hover:text-foreground', isActive ? 'text-primary' : 'text-muted-foreground')}
            >
              {t(item.key)}
            </NavLink>
          ))}
        </nav>
        <div className="flex items-center gap-1">
          <LanguageSwitcher compact />
          <ThemeToggle />
          <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex">
            <Link to={session ? homePath : '/login'}>{session ? t('nav.dashboard') : t('nav.login')}</Link>
          </Button>
          <Button size="sm" asChild className="hidden md:inline-flex">
            <Link to="/book-demo">{t('cta.bookDemo')}</Link>
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="icon-sm" className="lg:hidden" aria-label={t('nav.openMenu')}>
                <Menu />
              </Button>
            </DialogTrigger>
            <DialogContent side="right" size="sm" className="max-w-xs" closeLabel={t('common.close')}>
              <DialogTitle className="px-5 pt-5">{t('nav.menu')}</DialogTitle>
              <DialogDescription className="sr-only">{t('nav.main')}</DialogDescription>
              <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3" aria-label={t('nav.main')}>
                {NAV.map((item, i) => (
                  <motion.div key={item.to} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.04 * i }}>
                    <NavLink to={item.to} className={({ isActive }) => cn('flex min-h-11 items-center rounded-lg px-3 text-base font-medium', isActive ? 'bg-primary/10 text-primary' : 'hover:bg-muted')}>
                      {t(item.key)}
                    </NavLink>
                  </motion.div>
                ))}
                <NavLink to="/faq" className="flex min-h-11 items-center rounded-lg px-3 text-base font-medium hover:bg-muted">{t('nav.faq')}</NavLink>
              </nav>
              <div className="safe-bottom space-y-2 border-t p-4">
                <Button asChild className="w-full"><Link to="/book-demo">{t('cta.bookDemo')}</Link></Button>
                <Button asChild variant="outline" className="w-full"><Link to="/free-trial">{t('cta.startTrial')}</Link></Button>
                <Button asChild variant="ghost" className="w-full"><Link to={session ? homePath : '/login'}>{session ? t('nav.dashboard') : t('nav.login')}</Link></Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </header>
  );
}

function Footer() {
  const { t } = useTranslation();
  const config = usePublicConfig();
  const groups = [
    { title: t('footer.product'), links: [['/features', 'nav.features'], ['/solutions', 'nav.solutions'], ['/pricing', 'nav.pricing'], ['/videos', 'nav.videos']] },
    { title: t('footer.company'), links: [['/about', 'nav.about'], ['/contact', 'nav.contact'], ['/faq', 'nav.faq']] },
    { title: t('footer.getStarted'), links: [['/book-demo', 'cta.bookDemo'], ['/free-trial', 'cta.startTrial'], ['/login', 'nav.login']] },
    { title: t('footer.legal'), links: [['/privacy', 'nav.privacy'], ['/terms', 'nav.terms']] },
  ];
  return (
    <footer className="border-t bg-card">
      <div className="container grid gap-10 py-12 lg:grid-cols-[1.4fr_2fr]">
        <div className="space-y-4">
          <Logo />
          <p className="max-w-sm text-sm text-muted-foreground">{t('footer.tagline')}</p>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-start gap-2"><MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />{config.brand.address}</li>
            {config.brand.support_phone && (
              <li className="flex items-center gap-2"><Phone className="size-4 shrink-0" aria-hidden /><a className="hover:text-foreground" href={`tel:${config.brand.support_phone}`}>{formatPhone(config.brand.support_phone)}</a></li>
            )}
            {config.brand.support_email && (
              <li className="flex items-center gap-2"><Mail className="size-4 shrink-0" aria-hidden /><a className="hover:text-foreground" href={`mailto:${config.brand.support_email}`}>{config.brand.support_email}</a></li>
            )}
          </ul>
          <WhatsAppButton intent="product_enquiry" size="sm" />
        </div>
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          {groups.map((g) => (
            <nav key={g.title} aria-label={g.title}>
              <p className="mb-3 text-sm font-semibold">{g.title}</p>
              <ul className="space-y-2">
                {g.links.map(([to, key]) => (
                  <li key={to}><Link to={to} className="text-sm text-muted-foreground transition-colors hover:text-foreground">{t(key)}</Link></li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
      </div>
      <div className="border-t">
        <div className="container flex flex-col gap-1 py-5 text-xs text-muted-foreground sm:flex-row sm:justify-between">
          <p>© {new Date().getFullYear()} {config.brand.name}. {t('footer.rights')}</p>
          <p>{t('footer.serving')}</p>
        </div>
      </div>
    </footer>
  );
}

function CookieConsent({ measurementId }: { measurementId: string }) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(() => Boolean(measurementId) && getAnalyticsConsent() === null);
  useEffect(() => setVisible(Boolean(measurementId) && getAnalyticsConsent() === null), [measurementId]);
  const decide = (choice: 'granted' | 'denied') => {
    setAnalyticsConsent(choice);
    setVisible(false);
    if (choice === 'granted') initAnalytics(measurementId);
  };
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          role="region"
          aria-label={t('cookie.title')}
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          className="glass fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-2xl flex-col gap-3 rounded-xl p-4 shadow-xl sm:flex-row sm:items-center"
        >
          <p className="flex-1 text-sm">{t('cookie.message')} <Link to="/privacy" className="font-medium text-primary underline-offset-4 hover:underline">{t('nav.privacy')}</Link></p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => decide('denied')}>{t('cookie.decline')}</Button>
            <Button size="sm" onClick={() => decide('granted')}>{t('cookie.accept')}</Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Fades each page in. There is deliberately no exit animation: waiting for the old page
 * to fade out (AnimatePresence mode="wait") could stall — e.g. while a lazily loaded page
 * suspends or the tab is in the background — and leave the content area blank.
 * The Suspense boundary keeps the layout visible and shows a placeholder while a page loads.
 */
export function PageTransition() {
  const location = useLocation();
  return (
    <motion.div key={location.pathname} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}>
      <Suspense fallback={<PageSkeleton />}>
        <Outlet />
      </Suspense>
    </motion.div>
  );
}

export function PublicLayout() {
  const location = useLocation();
  const config = usePublicConfig();
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 140, damping: 26 });
  const gaId = config.analytics.ga4_measurement_id;

  useEffect(() => captureUtm(), []);
  useEffect(() => initAnalytics(gaId), [gaId]);
  useEffect(() => {
    window.scrollTo({ top: 0 });
    trackPageView(location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-dvh flex-col">
      <motion.div className="fixed inset-x-0 top-0 z-50 h-0.5 origin-left bg-primary" style={{ scaleX: progress }} aria-hidden />
      <Navbar />
      <main id="main" className="flex-1">
        <PageTransition />
      </main>
      <Footer />
      <FloatingWhatsApp />
      <CookieConsent measurementId={gaId} />
    </div>
  );
}
