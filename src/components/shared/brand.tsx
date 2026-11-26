import { useEffect, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button, type ButtonProps } from '@/components/ui/button';
import { usePublicConfig } from '@/hooks/usePublicConfig';
import { trackEvent } from '@/lib/analytics';
import { env } from '@/lib/env';
import { cn } from '@/lib/utils';
import type { Language } from '@shared/constants';
import { buildWhatsAppLink, whatsAppMessage, type WhatsAppIntent } from '@shared/whatsapp';

// ── Logo ──────────────────────────────────────────────────────────────
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-8', className)} aria-hidden>
      <rect width="32" height="32" rx="9" fill="hsl(var(--primary))" />
      <path d="M9 22V10m0 6h14m0-6v12" stroke="hsl(var(--primary-foreground))" strokeWidth="3" strokeLinecap="round" fill="none" />
      <circle cx="23" cy="10" r="2.6" fill="hsl(var(--brand-accent))" />
    </svg>
  );
}

/** The logo mark drawing itself in: box pops, the "H" strokes draw, the accent dot pulses. */
export function AnimatedLogoMark({ className, loop = false }: { className?: string; loop?: boolean }) {
  return (
    <motion.svg viewBox="0 0 32 32" className={cn('size-14', className)} aria-hidden initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}>
      <rect width="32" height="32" rx="9" fill="hsl(var(--primary))" />
      <motion.path
        d="M9 22V10m0 6h14m0-6v12"
        stroke="hsl(var(--primary-foreground))"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1, delay: 0.2, ease: [0.65, 0, 0.35, 1], repeat: loop ? Infinity : 0, repeatType: 'reverse', repeatDelay: 0.6 }}
      />
      <motion.circle cx="23" cy="10" r="2.6" fill="hsl(var(--brand-accent))" initial={{ scale: 0 }} animate={{ scale: [0, 1.35, 1] }} transition={{ duration: 0.6, delay: 0.9 }} style={{ transformOrigin: '23px 10px' }} />
    </motion.svg>
  );
}

export function Logo({ to = '/', name, logoUrl, className, textClassName }: { to?: string; name?: string; logoUrl?: string | null; className?: string; textClassName?: string }) {
  const config = usePublicConfig();
  const label = name ?? config.brand.name;
  return (
    <Link to={to} className={cn('inline-flex min-w-0 items-center gap-2.5 rounded-md font-bold tracking-tight', className)} aria-label={label}>
      {logoUrl ? <img src={logoUrl} alt="" className="h-8 w-auto max-w-[140px] object-contain" /> : <LogoMark />}
      <span className={cn('truncate text-lg', textClassName)}>{label}</span>
    </Link>
  );
}

// ── WhatsApp click-to-chat ────────────────────────────────────────────
export function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn('size-5', className)} fill="currentColor" aria-hidden>
      <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.26-.46-2.4-1.48-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.6.13-.14.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.6-.91-2.2-.24-.58-.49-.5-.67-.5h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.07c.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.7.63.71.22 1.36.19 1.87.12.57-.09 1.76-.72 2-1.42.25-.7.25-1.29.18-1.42-.08-.12-.27-.2-.57-.35zM12.05 21.8h-.01a9.8 9.8 0 0 1-4.99-1.37l-.36-.21-3.71.97.99-3.62-.23-.37A9.78 9.78 0 0 1 2.24 12c0-5.4 4.4-9.8 9.81-9.8 2.62 0 5.08 1.02 6.93 2.87A9.74 9.74 0 0 1 21.85 12c0 5.4-4.4 9.8-9.8 9.8zm8.35-18.15A11.72 11.72 0 0 0 12.05.2C5.53.2.22 5.5.22 12.02c0 2.08.54 4.11 1.58 5.9L.12 24l6.23-1.63a11.8 11.8 0 0 0 5.69 1.45h.01c6.52 0 11.83-5.3 11.83-11.82 0-3.16-1.23-6.13-3.48-8.35z" />
    </svg>
  );
}

/** Builds the wa.me link for an intent, or null when no number is configured. */
export function useWhatsAppLink(intent: WhatsAppIntent, vars: Record<string, string | undefined> = {}): string | null {
  const { i18n } = useTranslation();
  const config = usePublicConfig();
  if (!config.whatsapp.click_to_chat_enabled) return null;
  const message = whatsAppMessage(intent, (i18n.language as Language) ?? 'en', { brand: config.brand.name, ...vars });
  return buildWhatsAppLink(config.whatsapp.number, message);
}

/** Opens WhatsApp with a prefilled message; the visitor presses send themselves. */
export function WhatsAppButton({ intent, vars, children, ...props }: { intent: WhatsAppIntent; vars?: Record<string, string | undefined>; children?: ReactNode } & Omit<ButtonProps, 'asChild'>) {
  const { t } = useTranslation();
  const href = useWhatsAppLink(intent, vars);
  if (!href) return null;
  return (
    <Button variant="whatsapp" asChild {...props}>
      <a href={href} target="_blank" rel="noopener noreferrer" onClick={() => trackEvent('whatsapp_click', { intent })}>
        <WhatsAppIcon />
        {children ?? t('common.whatsappUs')}
      </a>
    </Button>
  );
}

export function FloatingWhatsApp({ intent = 'product_enquiry', vars }: { intent?: WhatsAppIntent; vars?: Record<string, string | undefined> }) {
  const { t } = useTranslation();
  const href = useWhatsAppLink(intent, vars);
  if (!href) return null;
  return (
    <motion.a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t('common.whatsappChat')}
      onClick={() => trackEvent('whatsapp_click', { intent, placement: 'floating' })}
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ delay: 0.8, type: 'spring', stiffness: 260, damping: 18 }}
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.95 }}
      className="fixed bottom-5 right-4 z-40 inline-flex size-14 items-center justify-center rounded-full bg-whatsapp text-white shadow-xl shadow-black/20 sm:bottom-6 sm:right-6"
      style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
    >
      <WhatsAppIcon className="size-7" />
    </motion.a>
  );
}

// ── SEO ───────────────────────────────────────────────────────────────
function setMeta(selector: string, attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.content = content;
}

/** Per-page title, description, canonical and Open Graph tags. */
export function Seo({ title, description, noindex = false }: { title: string; description?: string; noindex?: boolean }) {
  const config = usePublicConfig();
  useEffect(() => {
    const full = `${title} | ${config.brand.name}`;
    document.title = full;
    setMeta('meta[property="og:title"]', 'property', 'og:title', full);
    if (description) {
      setMeta('meta[name="description"]', 'name', 'description', description);
      setMeta('meta[property="og:description"]', 'property', 'og:description', description);
    }
    setMeta('meta[name="robots"]', 'name', 'robots', noindex ? 'noindex,nofollow' : 'index,follow');
    const base = env.siteUrl || window.location.origin;
    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.appendChild(canonical);
    }
    canonical.href = base + window.location.pathname;
  }, [title, description, noindex, config.brand.name]);
  return null;
}
