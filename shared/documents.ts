/** Employee document rules shared by the UI and tests (the database and storage bucket enforce them too). */
export const DOCUMENT_CATEGORIES = ['id_proof', 'address_proof', 'offer_letter', 'contract', 'certificate', 'bank', 'medical', 'other'] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;
export const DOCUMENT_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];

export function documentFileError(file: { type: string; size: number }): 'type' | 'size' | 'empty' | null {
  if (!DOCUMENT_TYPES.includes(file.type)) return 'type';
  if (file.size <= 0) return 'empty';
  if (file.size > DOCUMENT_MAX_BYTES) return 'size';
  return null;
}

/** A storage-safe file name: ASCII letters, digits, dot, dash and underscore only. */
export function safeFileName(name: string): string {
  const clean = name.normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/\.{2,}/g, '.').replace(/^[._]+/, '');
  return (clean || 'file').slice(-80);
}

/** expired · soon (within 30 days) · ok · none */
export function expiryState(expiresOn: string | null | undefined, today: string): 'expired' | 'soon' | 'ok' | 'none' {
  if (!expiresOn) return 'none';
  if (expiresOn < today) return 'expired';
  const days = Math.round((Date.parse(`${expiresOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  return days <= 30 ? 'soon' : 'ok';
}
