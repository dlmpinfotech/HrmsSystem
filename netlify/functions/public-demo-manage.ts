import type { Config } from '@netlify/functions';
import { manageBookingSchema } from '../../shared/schemas';
import { defineHandler, HttpError } from '../lib/http';
import { demoVars, rankSalespeople, resolveSlot, type BookingRow } from '../lib/demos';
import { hasWhatsAppConsent, notify } from '../lib/notifications';

const MAX_RESCHEDULES = 3;

async function loadBooking(db: Parameters<typeof resolveSlot>[0], token: string): Promise<BookingRow> {
  if (!/^[a-f0-9]{32,128}$/i.test(token)) throw new HttpError(404, 'booking_not_found');
  const { data } = await db.from('demo_bookings').select('*').eq('manage_token', token).maybeSingle();
  if (!data) throw new HttpError(404, 'booking_not_found', 'This booking link is not valid.');
  return data as BookingRow;
}

/**
 * GET  /api/public/demo-bookings/manage?token=…          → booking summary (+ open slots)
 * POST /api/public/demo-bookings/manage {action, token}  → reschedule | cancel
 * The unguessable manage token (sent only to the booker) is the credential.
 */
export default defineHandler(
  { name: 'public-demo-manage', methods: ['GET', 'POST'], rateLimit: { max: 30, windowSec: 300 } },
  async ({ db, req, url, body, siteUrl }) => {
    if (req.method === 'GET') {
      const booking = await loadBooking(db, url.searchParams.get('token') ?? '');
      return {
        booking: {
          status: booking.status,
          starts_at: booking.starts_at,
          ends_at: booking.ends_at,
          company_name: booking.company_name,
          contact_name: booking.contact_name,
          mode: booking.mode,
          meeting_url: booking.status === 'scheduled' ? booking.meeting_url : null,
          can_reschedule: booking.status === 'scheduled' && booking.reschedule_count < MAX_RESCHEDULES && new Date(booking.starts_at) > new Date(),
          can_cancel: booking.status === 'scheduled' && new Date(booking.starts_at) > new Date(),
        },
      };
    }

    const input = manageBookingSchema.parse(body);
    const booking = await loadBooking(db, input.token);
    if (booking.status !== 'scheduled') throw new HttpError(409, 'booking_closed', 'This booking can no longer be changed.');
    if (new Date(booking.starts_at) <= new Date()) throw new HttpError(409, 'booking_closed', 'This demo has already started.');
    const consent = await hasWhatsAppConsent(db, booking.phone);

    if (input.action === 'cancel') {
      await db.from('demo_bookings').update({ status: 'cancelled', cancelled_reason: input.reason ?? 'Cancelled by customer' }).eq('id', booking.id);
      if (booking.lead_id) {
        await db.from('lead_activities').insert({ lead_id: booking.lead_id, type: 'system', body: `Demo cancelled by customer${input.reason ? `: ${input.reason}` : ''}` });
      }
      await notify(db, {
        key: 'demo_cancelled',
        channels: ['email'],
        email: booking.email,
        language: booking.language,
        vars: demoVars(booking, siteUrl),
        leadId: booking.lead_id,
        dedupeKey: `demo-cancel:${booking.id}`,
      });
      return { ok: true, status: 'cancelled' };
    }

    if (booking.reschedule_count >= MAX_RESCHEDULES) {
      throw new HttpError(409, 'reschedule_limit', 'This booking has been rescheduled too many times. Please contact us.');
    }
    const slot = await resolveSlot(db, input.starts_at, booking.id);
    // Keep the same salesperson when they are free; otherwise hand over to the least busy one.
    const ranked = await rankSalespeople(db, slot.salesperson_ids);
    const candidates = booking.salesperson_id && ranked.includes(booking.salesperson_id)
      ? [booking.salesperson_id, ...ranked.filter((id) => id !== booking.salesperson_id)]
      : ranked;

    let updated: BookingRow | null = null;
    for (const salespersonId of candidates) {
      const { data, error } = await db
        .from('demo_bookings')
        .update({
          starts_at: slot.starts_at,
          ends_at: slot.ends_at,
          salesperson_id: salespersonId,
          reschedule_count: booking.reschedule_count + 1,
          reminder_24h_at: null,
          reminder_1h_at: null,
        })
        .eq('id', booking.id)
        .eq('status', 'scheduled')
        .select('*')
        .single();
      if (!error && data) {
        updated = data as BookingRow;
        break;
      }
      if (error && error.code !== '23505') throw new HttpError(500, 'database_error', 'Could not reschedule the booking.');
    }
    if (!updated) throw new HttpError(409, 'slot_unavailable', 'That time was just taken. Please choose another slot.');

    if (updated.lead_id) {
      await db.from('lead_activities').insert({ lead_id: updated.lead_id, type: 'system', body: 'Demo rescheduled by customer', metadata: { starts_at: updated.starts_at } });
      await db.from('leads').update({ next_follow_up_at: updated.starts_at }).eq('id', updated.lead_id);
    }
    await notify(db, {
      key: 'demo_rescheduled',
      channels: ['email'],
      email: updated.email,
      phone: updated.phone,
      whatsappConsent: consent,
      language: updated.language,
      vars: demoVars(updated, siteUrl),
      leadId: updated.lead_id,
      dedupeKey: `demo-resched:${updated.id}:${updated.reschedule_count}`,
    });
    return { ok: true, status: 'scheduled', starts_at: updated.starts_at, ends_at: updated.ends_at };
  },
);

export const config: Config = { path: '/api/public/demo-bookings/manage' };
