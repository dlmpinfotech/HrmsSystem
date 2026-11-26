import { describe, expect, it } from 'vitest';
import { documentFileError, expiryState, safeFileName } from '@shared/documents';

describe('document rules', () => {
  it('allows only PDF and images up to 5 MB', () => {
    expect(documentFileError({ type: 'application/pdf', size: 1000 })).toBeNull();
    expect(documentFileError({ type: 'image/svg+xml', size: 10 })).toBe('type');
    expect(documentFileError({ type: 'image/png', size: 5 * 1024 * 1024 + 1 })).toBe('size');
    expect(documentFileError({ type: 'image/png', size: 0 })).toBe('empty');
  });

  it('makes safe storage names without path tricks', () => {
    expect(safeFileName('../../etc/pass wd.pdf')).toBe('etc_pass_wd.pdf');
    expect(safeFileName('ஆதார்.pdf')).toBe('pdf');
    expect(safeFileName('..')).toBe('file');
    expect(safeFileName('a'.repeat(200) + '.pdf').length).toBe(80);
  });

  it('flags expired and expiring documents', () => {
    expect(expiryState(null, '2026-11-26')).toBe('none');
    expect(expiryState('2026-11-25', '2026-11-26')).toBe('expired');
    expect(expiryState('2026-12-26', '2026-11-26')).toBe('soon');
    expect(expiryState('2027-03-01', '2026-11-26')).toBe('ok');
  });
});
