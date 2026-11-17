import { createHmac } from 'node:crypto';

/**
 * Optional Azure Blob Storage adapter for large product videos.
 * Issues a short-lived, single-blob, write-only SAS URL so the browser uploads
 * directly to Azure; the account key never leaves the server.
 * NOTE: not exercised against a live Azure account in this repository's tests.
 */
const SAS_VERSION = '2021-08-06';

export function azureConfigured(): boolean {
  return Boolean(process.env.AZURE_STORAGE_ACCOUNT && process.env.AZURE_STORAGE_KEY);
}

const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

export function createUploadSas(blobName: string, contentType: string, minutes = 30): { uploadUrl: string; publicUrl: string } {
  const account = process.env.AZURE_STORAGE_ACCOUNT;
  const key = process.env.AZURE_STORAGE_KEY;
  const container = process.env.AZURE_STORAGE_CONTAINER ?? 'videos';
  if (!account || !key) throw new Error('azure_not_configured');

  const start = iso(new Date(Date.now() - 5 * 60_000));
  const expiry = iso(new Date(Date.now() + minutes * 60_000));
  const permissions = 'cw';
  const resource = `/blob/${account}/${container}/${blobName}`;

  // Service SAS string-to-sign for version 2020-12-06 and later (16 fields).
  const stringToSign = [
    permissions, start, expiry, resource,
    '', // signedIdentifier
    '', // signedIP
    'https', SAS_VERSION, 'b',
    '', // snapshot time
    '', // encryption scope
    '', '', '', '', // cache-control, content-disposition, content-encoding, content-language
    contentType,
  ].join('\n');

  const signature = createHmac('sha256', Buffer.from(key, 'base64')).update(stringToSign, 'utf8').digest('base64');
  const query = new URLSearchParams({ sv: SAS_VERSION, spr: 'https', st: start, se: expiry, sr: 'b', sp: permissions, rsct: contentType, sig: signature });
  const base = `https://${account}.blob.core.windows.net/${container}/${blobName.split('/').map(encodeURIComponent).join('/')}`;
  return { uploadUrl: `${base}?${query.toString()}`, publicUrl: base };
}
