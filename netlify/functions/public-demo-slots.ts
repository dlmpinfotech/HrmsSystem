import type { Config } from '@netlify/functions';
import { isValidDateString, istDateString } from '../../shared/slots';
import { defineHandler, HttpError } from '../lib/http';
import { slotsForDates } from '../lib/demos';

/**
 * GET /api/public/demo-slots?from=YYYY-MM-DD&days=7
 * Open demo slots per IST date. Salesperson identities are never exposed publicly.
 */
export default defineHandler(
  { name: 'public-demo-slots', methods: ['GET'], rateLimit: { max: 60, windowSec: 60 } },
  async ({ db, url }) => {
    const from = url.searchParams.get('from') ?? istDateString(new Date());
    if (!isValidDateString(from)) throw new HttpError(400, 'invalid_date');
    const days = Math.min(Math.max(Number(url.searchParams.get('days') ?? 7) || 7, 1), 14);

    const result = await slotsForDates(db, from, days);
    return {
      timezone: 'Asia/Kolkata',
      days: result.map((d) => ({
        date: d.date,
        slots: d.slots.map((s) => ({ starts_at: s.starts_at, ends_at: s.ends_at })),
      })),
    };
  },
);

export const config: Config = { path: '/api/public/demo-slots' };
