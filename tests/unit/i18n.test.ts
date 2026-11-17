import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain ESM script without type declarations
import { check } from '../../scripts/check-i18n.mjs';
import i18n, { setLanguage, LANGUAGE_STORAGE_KEY } from '@/i18n';

describe('localisation', () => {
  it('has every used key in English and identical keys in Tamil', () => {
    expect(check()).toEqual([]);
  });

  it('switches language without a reload and interpolates values', async () => {
    await setLanguage('ta', false);
    expect(i18n.t('crm.count', { count: 3 })).toBe('3 லீட்கள்');
    await setLanguage('en', false);
    expect(i18n.t('crm.count', { count: 3 })).toBe('3 leads');
    expect(LANGUAGE_STORAGE_KEY).toBe('hrms.lang');
  });

  it('falls back to English for an unknown key in Tamil', async () => {
    await setLanguage('ta', false);
    expect(i18n.t('does.not.exist', { defaultValue: 'fallback' })).toBe('fallback');
    await setLanguage('en', false);
  });
});
