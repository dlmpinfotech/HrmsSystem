import type { Config } from '@netlify/functions';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { defineHandler, HttpError } from '../lib/http';
import { azureConfigured, createUploadSas } from '../lib/azureBlob';

const schema = z.object({
  filename: z.string().trim().min(1).max(200),
  content_type: z.enum(['video/mp4', 'video/webm']),
  size: z.number().int().positive().max(1024 * 1024 * 1024),
});

/**
 * GET  /api/videos/upload — whether Azure Blob video hosting is configured
 * POST /api/videos/upload — short-lived SAS URL for a direct browser upload (content managers only)
 */
export default defineHandler({ name: 'videos', methods: ['GET', 'POST'], permission: 'content.manage', noDb: false }, async ({ req, body }) => {
  if (req.method === 'GET') return { configured: azureConfigured() };
  if (!azureConfigured()) throw new HttpError(503, 'not_configured', 'Azure Blob Storage is not configured.');
  const input = schema.parse(body);
  const ext = input.content_type === 'video/webm' ? 'webm' : 'mp4';
  const { uploadUrl, publicUrl } = createUploadSas(`${new Date().getFullYear()}/${randomUUID()}.${ext}`, input.content_type);
  return { upload_url: uploadUrl, public_url: publicUrl, headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': input.content_type } };
});

export const config: Config = { path: '/api/videos/upload' };
