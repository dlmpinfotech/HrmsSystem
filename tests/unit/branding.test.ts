import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BRANDING, brandingSchema, brandingToCssVars, contrastRatio, hexToHsl, normalizeBranding, readableOn, resolveMode, sniffImageType, validateLogo,
} from '@shared/branding';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const HTML = new TextEncoder().encode('<!doctype html><html>');

describe('logo upload validation', () => {
  it('identifies real image types from magic bytes', () => {
    expect(sniffImageType(PNG)).toBe('image/png');
    expect(sniffImageType(JPG)).toBe('image/jpeg');
    expect(sniffImageType(WEBP)).toBe('image/webp');
  });

  it('rejects SVG and HTML even if renamed to .png', () => {
    expect(validateLogo({ size: 500 }, SVG)).toEqual({ ok: false, error: 'upload.badType' });
    expect(validateLogo({ size: 500 }, HTML)).toEqual({ ok: false, error: 'upload.badType' });
  });

  it('enforces the 2 MB limit and rejects empty files', () => {
    expect(validateLogo({ size: 2 * 1024 * 1024 + 1 }, PNG)).toEqual({ ok: false, error: 'upload.tooLarge' });
    expect(validateLogo({ size: 0 }, PNG)).toEqual({ ok: false, error: 'upload.empty' });
    expect(validateLogo({ size: 1000 }, PNG)).toEqual({ ok: true, mime: 'image/png', ext: 'png' });
  });
});

describe('branding model', () => {
  it('fills missing or malformed stored values with defaults', () => {
    const b = normalizeBranding({ display_name: 'Acme', colors: { primary: '#ff0000' }, appearance: { radius: 4 } });
    expect(b.colors.primary).toBe('#ff0000');
    expect(b.colors.secondary).toBe(DEFAULT_BRANDING.colors.secondary);
    expect(b.appearance.radius).toBe(4);
    expect(b.appearance.font).toBe('inter');
    expect(normalizeBranding(null, 'Fallback').display_name).toBe('Fallback');
    // Invalid colour in storage → safe defaults instead of a broken UI.
    expect(normalizeBranding({ display_name: 'X', colors: { primary: 'red' } }).colors.primary).toBe(DEFAULT_BRANDING.colors.primary);
  });

  it('validates colours as #RRGGBB (blocks CSS injection through colour fields)', () => {
    const bad = { ...DEFAULT_BRANDING, colors: { ...DEFAULT_BRANDING.colors, primary: 'red;background:url(x)' } };
    expect(brandingSchema.safeParse(bad).success).toBe(false);
    expect(brandingSchema.safeParse(DEFAULT_BRANDING).success).toBe(true);
  });

  it('converts colours to HSL tokens', () => {
    expect(hexToHsl('#ffffff')).toBe('0 0% 100%');
    expect(hexToHsl('#000000')).toBe('0 0% 0%');
    expect(hexToHsl('#ff0000')).toBe('0 100% 50%');
  });

  it('picks a readable foreground and measures contrast', () => {
    expect(readableOn('#4f46e5')).toBe('#ffffff');
    expect(readableOn('#facc15')).toBe('#0f172a');
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
  });

  it('only overrides surface colours in custom mode', () => {
    const light = brandingToCssVars(DEFAULT_BRANDING, 'light');
    expect(light['--primary']).toBeDefined();
    expect(light['--background']).toBeUndefined();
    const custom = brandingToCssVars({ ...DEFAULT_BRANDING, theme_mode: 'custom' }, 'light');
    expect(custom['--background']).toBe(hexToHsl(DEFAULT_BRANDING.colors.background));
    expect(brandingToCssVars({ ...DEFAULT_BRANDING, appearance: { ...DEFAULT_BRANDING.appearance, buttonStyle: 'pill' } }, 'light')['--btn-radius']).toBe('9999px');
  });

  it('resolves the effective theme', () => {
    expect(resolveMode({ ...DEFAULT_BRANDING, theme_mode: 'system' }, true)).toBe('dark');
    expect(resolveMode({ ...DEFAULT_BRANDING, theme_mode: 'light' }, true)).toBe('light');
    expect(resolveMode({ ...DEFAULT_BRANDING, theme_mode: 'custom', colors: { ...DEFAULT_BRANDING.colors, background: '#0b1020' } }, false)).toBe('dark');
  });
});
