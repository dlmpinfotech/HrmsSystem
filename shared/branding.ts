import { z } from 'zod';

/** Company branding model + conversion to the CSS variables that drive the whole UI. */

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'validation.color');

export const brandColorsSchema = z.object({
  primary: hex,
  secondary: hex,
  accent: hex,
  background: hex,
  surface: hex,
  text: hex,
  sidebar: hex,
  button: hex,
  buttonText: hex,
});
export type BrandColors = z.infer<typeof brandColorsSchema>;

export const SIDEBAR_STYLES = ['solid', 'subtle', 'brand'] as const;
export const NAV_LAYOUTS = ['sidebar', 'topbar'] as const;
export const BUTTON_STYLES = ['rounded', 'pill', 'square'] as const;
export const FONTS = ['inter', 'poppins', 'noto', 'system'] as const;
export const ANIMATION_PREFS = ['full', 'reduced', 'off'] as const;
export const THEME_MODES = ['light', 'dark', 'system', 'custom'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export const appearanceSchema = z.object({
  sidebarStyle: z.enum(SIDEBAR_STYLES),
  navLayout: z.enum(NAV_LAYOUTS),
  radius: z.number().min(0).max(24),
  buttonStyle: z.enum(BUTTON_STYLES),
  font: z.enum(FONTS),
  compact: z.boolean(),
  animations: z.enum(ANIMATION_PREFS),
});
export type Appearance = z.infer<typeof appearanceSchema>;

export const brandingSchema = z.object({
  display_name: z.string().trim().min(2, 'validation.min2').max(80, 'validation.tooLong'),
  tagline: z.string().trim().max(140, 'validation.tooLong').optional().or(z.literal('')),
  logo_path: z.string().nullable(),
  logo_light_path: z.string().nullable(),
  logo_dark_path: z.string().nullable(),
  favicon_path: z.string().nullable(),
  theme_mode: z.enum(THEME_MODES),
  colors: brandColorsSchema,
  appearance: appearanceSchema,
  default_language: z.enum(['en', 'ta']),
});
export type Branding = z.infer<typeof brandingSchema>;

export const DEFAULT_COLORS: BrandColors = {
  primary: '#4f46e5',
  secondary: '#0ea5e9',
  accent: '#f59e0b',
  background: '#f8fafc',
  surface: '#ffffff',
  text: '#0f172a',
  sidebar: '#0f172a',
  button: '#4f46e5',
  buttonText: '#ffffff',
};

export const DEFAULT_APPEARANCE: Appearance = {
  sidebarStyle: 'solid',
  navLayout: 'sidebar',
  radius: 12,
  buttonStyle: 'rounded',
  font: 'inter',
  compact: false,
  animations: 'full',
};

export const DEFAULT_BRANDING: Branding = {
  display_name: 'My Company',
  tagline: '',
  logo_path: null,
  logo_light_path: null,
  logo_dark_path: null,
  favicon_path: null,
  theme_mode: 'system',
  colors: DEFAULT_COLORS,
  appearance: DEFAULT_APPEARANCE,
  default_language: 'en',
};

/** Merges a stored (possibly partial / older) row with defaults so the UI never sees gaps. */
export function normalizeBranding(row: Partial<Record<keyof Branding, unknown>> | null | undefined, fallbackName?: string): Branding {
  const colors = { ...DEFAULT_COLORS, ...((row?.colors as Partial<BrandColors>) ?? {}) };
  const appearance = { ...DEFAULT_APPEARANCE, ...((row?.appearance as Partial<Appearance>) ?? {}) };
  const candidate = {
    display_name: (row?.display_name as string) || fallbackName || DEFAULT_BRANDING.display_name,
    tagline: (row?.tagline as string) ?? '',
    logo_path: (row?.logo_path as string) ?? null,
    logo_light_path: (row?.logo_light_path as string) ?? null,
    logo_dark_path: (row?.logo_dark_path as string) ?? null,
    favicon_path: (row?.favicon_path as string) ?? null,
    theme_mode: (row?.theme_mode as ThemeMode) ?? 'system',
    colors,
    appearance,
    default_language: (row?.default_language as 'en' | 'ta') ?? 'en',
  };
  const parsed = brandingSchema.safeParse(candidate);
  return parsed.success ? parsed.data : { ...DEFAULT_BRANDING, display_name: candidate.display_name };
}

// ── Colour maths ──────────────────────────────────────────────────────
export function hexToRgb(value: string): [number, number, number] {
  const h = value.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function rgbToHex([r, g, b]: [number, number, number]): string {
  return '#' + [r, g, b].map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('');
}

/** "h s% l%" — the format our Tailwind tokens expect inside hsl(var(--token)). */
export function hexToHsl(value: string): string {
  const [r, g, b] = hexToRgb(value).map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

/** WCAG relative luminance (0 = black, 1 = white). */
export function luminance(value: string): number {
  const [r, g, b] = hexToRgb(value).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Black or white — whichever is more legible on the given colour. */
export function readableOn(value: string): string {
  return contrastRatio(value, '#ffffff') >= contrastRatio(value, '#0f172a') ? '#ffffff' : '#0f172a';
}

export function mix(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return rgbToHex([ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t]);
}

const FONT_STACKS: Record<Appearance['font'], string> = {
  inter: "'Inter', 'Noto Sans Tamil', system-ui, sans-serif",
  poppins: "'Poppins', 'Noto Sans Tamil', system-ui, sans-serif",
  noto: "'Noto Sans Tamil', 'Inter', system-ui, sans-serif",
  system: "system-ui, -apple-system, 'Segoe UI', 'Noto Sans Tamil', sans-serif",
};

/**
 * CSS custom properties for a branding config. Applied to <html> for the live app
 * and to the preview container in the Branding Studio (so the preview is the real thing).
 * In light/dark/system mode only brand colours are overridden; "custom" also drives
 * background, surface and text.
 */
export function brandingToCssVars(branding: Branding, resolved: 'light' | 'dark'): Record<string, string> {
  const { colors, appearance, theme_mode } = branding;
  const vars: Record<string, string> = {
    '--primary': hexToHsl(colors.primary),
    '--primary-foreground': hexToHsl(readableOn(colors.primary)),
    '--ring': hexToHsl(colors.primary),
    '--brand-secondary': hexToHsl(colors.secondary),
    '--brand-accent': hexToHsl(colors.accent),
    '--button': hexToHsl(colors.button),
    '--button-foreground': hexToHsl(colors.buttonText),
    '--radius': `${appearance.radius}px`,
    '--btn-radius': appearance.buttonStyle === 'pill' ? '9999px' : appearance.buttonStyle === 'square' ? '2px' : `${Math.max(appearance.radius - 2, 0)}px`,
    '--font-sans': FONT_STACKS[appearance.font],
    '--font-display': appearance.font === 'inter' ? `'Plus Jakarta Sans', ${FONT_STACKS.inter}` : FONT_STACKS[appearance.font],
  };

  if (theme_mode === 'custom') {
    const { background, surface, text } = colors;
    Object.assign(vars, {
      '--background': hexToHsl(background),
      '--foreground': hexToHsl(text),
      '--card': hexToHsl(surface),
      '--card-foreground': hexToHsl(text),
      '--popover': hexToHsl(surface),
      '--popover-foreground': hexToHsl(text),
      '--muted': hexToHsl(mix(background, text, 0.06)),
      '--muted-foreground': hexToHsl(mix(text, background, 0.38)),
      '--secondary': hexToHsl(mix(background, text, 0.08)),
      '--secondary-foreground': hexToHsl(text),
      '--accent': hexToHsl(mix(surface, colors.primary, 0.12)),
      '--accent-foreground': hexToHsl(text),
      '--border': hexToHsl(mix(background, text, 0.14)),
      '--input': hexToHsl(mix(background, text, 0.18)),
    });
  }

  if (appearance.sidebarStyle === 'solid') {
    vars['--sidebar'] = hexToHsl(colors.sidebar);
    vars['--sidebar-foreground'] = hexToHsl(readableOn(colors.sidebar));
  } else if (appearance.sidebarStyle === 'brand') {
    vars['--sidebar'] = hexToHsl(colors.primary);
    vars['--sidebar-foreground'] = hexToHsl(readableOn(colors.primary));
  } else if (theme_mode === 'custom') {
    vars['--sidebar'] = hexToHsl(colors.surface);
    vars['--sidebar-foreground'] = hexToHsl(colors.text);
  } else {
    vars['--sidebar'] = resolved === 'dark' ? '224 40% 9%' : '0 0% 100%';
    vars['--sidebar-foreground'] = resolved === 'dark' ? '210 40% 96%' : '222 47% 11%';
  }
  return vars;
}

/** Which light/dark base palette a branding config resolves to. */
export function resolveMode(branding: Pick<Branding, 'theme_mode' | 'colors'>, systemDark: boolean): 'light' | 'dark' {
  if (branding.theme_mode === 'light') return 'light';
  if (branding.theme_mode === 'dark') return 'dark';
  if (branding.theme_mode === 'custom') return luminance(branding.colors.background) < 0.35 ? 'dark' : 'light';
  return systemDark ? 'dark' : 'light';
}

// ── Logo upload validation (client + server share these rules) ────────
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const LOGO_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/x-icon', 'image/vnd.microsoft.icon'] as const;

/** Identifies the real file type from its first bytes — never trust the extension or the browser's MIME. */
export function sniffImageType(bytes: Uint8Array): (typeof LOGO_MIME_TYPES)[number] | null {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  if (b.length >= 4 && b[0] === 0x00 && b[1] === 0x00 && b[2] === 0x01 && b[3] === 0x00) return 'image/x-icon';
  return null;
}

export type LogoValidationError = 'upload.tooLarge' | 'upload.badType' | 'upload.empty';

export function validateLogo(file: { size: number }, header: Uint8Array): { ok: true; mime: string; ext: string } | { ok: false; error: LogoValidationError } {
  if (file.size === 0) return { ok: false, error: 'upload.empty' };
  if (file.size > LOGO_MAX_BYTES) return { ok: false, error: 'upload.tooLarge' };
  const mime = sniffImageType(header);
  if (!mime) return { ok: false, error: 'upload.badType' };
  const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico' }[mime];
  return { ok: true, mime, ext };
}
