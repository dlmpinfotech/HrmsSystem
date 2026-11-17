import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { MotionConfig } from 'motion/react';
import { brandingToCssVars, resolveMode, type Branding } from '@shared/branding';
import { publicAssetUrl } from '@/lib/supabase';
import { storage } from '@/lib/utils';

export type ThemeChoice = 'light' | 'dark' | 'system';
export const THEME_STORAGE_KEY = 'hrms.theme';
const DEFAULT_FAVICON = '/favicon.svg';

interface ThemeContextValue {
  /** The user's own preference (persisted). */
  theme: ThemeChoice;
  setTheme: (theme: ThemeChoice) => void;
  /** What is actually rendered right now. */
  resolved: 'light' | 'dark';
  /** Active company branding, when inside a customer workspace. */
  branding: Branding | null;
  setBranding: (branding: Branding | null) => void;
  /** True when the company's custom theme fixes the palette (the toggle is disabled). */
  themeLocked: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredTheme(): ThemeChoice | null {
  const v = storage.get(THEME_STORAGE_KEY);
  return v === 'light' || v === 'dark' || v === 'system' ? v : null;
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Writes the CSS variables for a branding config onto an element; returns the keys it set. */
export function applyBrandingVars(el: HTMLElement, branding: Branding, resolved: 'light' | 'dark'): string[] {
  const vars = brandingToCssVars(branding, resolved);
  for (const [key, value] of Object.entries(vars)) el.style.setProperty(key, value);
  return Object.keys(vars);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeChoice>(() => readStoredTheme() ?? 'system');
  const [userChose, setUserChose] = useState(() => readStoredTheme() !== null);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);
  const [branding, setBranding] = useState<Branding | null>(null);
  const appliedKeys = useRef<string[]>([]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const setTheme = useCallback((next: ThemeChoice) => {
    storage.set(THEME_STORAGE_KEY, next);
    setUserChose(true);
    setThemeState(next);
  }, []);

  const themeLocked = branding?.theme_mode === 'custom';

  const resolved = useMemo<'light' | 'dark'>(() => {
    const userResolved = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
    if (!branding) return userResolved;
    if (branding.theme_mode === 'custom') return resolveMode(branding, systemDark);
    // The company sets the default; an explicit personal choice wins for light/dark.
    return userChose ? userResolved : resolveMode(branding, systemDark);
  }, [theme, systemDark, branding, userChose]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', resolved === 'dark');
    root.style.colorScheme = resolved;

    for (const key of appliedKeys.current) root.style.removeProperty(key);
    appliedKeys.current = branding ? applyBrandingVars(root, branding, resolved) : [];

    if (branding?.appearance.compact) root.dataset.density = 'compact';
    else delete root.dataset.density;
    if (branding && branding.appearance.animations !== 'full') root.dataset.motion = branding.appearance.animations;
    else delete root.dataset.motion;

    const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (favicon) {
      const custom = publicAssetUrl(branding?.favicon_path);
      favicon.href = custom ?? DEFAULT_FAVICON;
      favicon.type = custom ? '' : 'image/svg+xml';
    }
  }, [resolved, branding]);

  const value = useMemo(
    () => ({ theme, setTheme, resolved, branding, setBranding, themeLocked }),
    [theme, setTheme, resolved, branding, themeLocked],
  );

  // 'user' honours the OS reduced-motion setting; a company can force it further.
  const reducedMotion = branding && branding.appearance.animations !== 'full' ? 'always' : 'user';

  return (
    <ThemeContext.Provider value={value}>
      <MotionConfig reducedMotion={reducedMotion}>{children}</MotionConfig>
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
