import { storage } from './utils';

/** Google Analytics 4 — loaded only after the visitor accepts analytics cookies. */
const CONSENT_KEY = 'hrms.analytics-consent';
let loadedId: string | null = null;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

export type ConsentChoice = 'granted' | 'denied' | null;

export function getAnalyticsConsent(): ConsentChoice {
  const v = storage.get(CONSENT_KEY);
  return v === 'granted' || v === 'denied' ? v : null;
}

export function setAnalyticsConsent(choice: Exclude<ConsentChoice, null>) {
  storage.set(CONSENT_KEY, choice);
}

export function initAnalytics(measurementId: string | null | undefined) {
  if (!measurementId || loadedId === measurementId || getAnalyticsConsent() !== 'granted') return;
  if (!/^G-[A-Z0-9]+$/.test(measurementId)) return;
  loadedId = measurementId;
  window.dataLayer = window.dataLayer ?? [];
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
  };
  window.gtag('js', new Date());
  window.gtag('config', measurementId, { anonymize_ip: true, send_page_view: false });
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  document.head.appendChild(script);
}

export function trackPageView(path: string) {
  if (loadedId && window.gtag) window.gtag('event', 'page_view', { page_path: path });
}

export function trackEvent(name: string, params: Record<string, string | number | boolean> = {}) {
  if (loadedId && window.gtag) window.gtag('event', name, params);
}

/** UTM parameters captured on first landing and attached to lead forms. */
const UTM_KEY = 'hrms.utm';
export function captureUtm() {
  try {
    const params = new URLSearchParams(window.location.search);
    const utm: Record<string, string> = {};
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']) {
      const v = params.get(key);
      if (v) utm[key] = v.slice(0, 200);
    }
    if (Object.keys(utm).length) window.sessionStorage.setItem(UTM_KEY, JSON.stringify(utm));
  } catch {
    /* ignore */
  }
}

export function getUtm(): Record<string, string> | undefined {
  try {
    const raw = window.sessionStorage.getItem(UTM_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : undefined;
  } catch {
    return undefined;
  }
}
