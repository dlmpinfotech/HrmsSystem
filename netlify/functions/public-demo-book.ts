import type { Config } from '@netlify/functions';
import { demoBookingSchema } from '../../shared/schemas';
import { defineHandler, HttpError } from '../lib/http';
import { demoVars, rankSalespeople, resolveSlot, type BookingRow } from '../lib/demos';
import { upsertPublicLead } from '../lib/leads';
import { notify } from '../lib/notifications';
import { looksLikeSpam } from '../lib/rateLimit';
import { getDemoSettings } from '../lib/settings';

/** POST /api/public/demo-bookings — books a demo into a verified open slot. */
export default defineHandler(
  { name: 'public-demo-book', methods: ['POST'], schema: demoBookingSchema, rateLimit: { max: 5, windowSec: 600 } },
  async ({ db, body, ipHash, siteUrl }) => {
    if (looksLikeSpam(body)) return { ok: true, booking: null };

    // The slot must be one we currently offer — clients cannot invent times.
    const slot = await resolveSlot(db, body.starts_at);
    const candidates = await rankSalespeople(db, slot.salesperson_ids);
    const settings = await getDemoSettings(db);

    const { leadId, assignedTo } = await upsertPublicLead(
      db,
      {
        company_name: body.company_name,
        contact_person: body.contact_name,
        phone: body.phone,
        email: body.email,
        city: body.city,
        employee_count: body.employee_count,
        message: body.notes,
        source: 'demo_booking',
        consent: body.consent,
        whatsapp_opt_in: body.whatsapp_opt_in,
        utm: body.utm,
      },
      ipHash,
    );

    // Try each available salesperson; the unique index + overlap trigger make
    // concurrent requests for the same slot fail cleanly instead of double-booking.
    let booking: BookingRow | null = null;
    for (const salespersonId of candidates) {
      const { data, error } = await db
        .from('demo_bookings')
        .insert({
          lead_id: leadId,
          salesperson_id: salespersonId,
          starts_at: slot.starts_at,
          ends_at: slot.ends_at,
          contact_name: body.contact_name,
          company_name: body.company_name,
          email: body.email,
          phone: body.phone,
          language: body.language,
          mode: body.mode,
          notes: body.notes ?? null,
          meeting_url: body.mode === 'online' ? settings.default_meeting_url || null : null,
        })
        .select('*')
        .single();
      if (!error && data) {
        booking = data as BookingRow;
        break;
      }
      if (error && error.code !== '23505') {
        console.error('[public-demo-book] insert failed', error.message);
        throw new HttpError(500, 'database_error', 'Could not save the booking.');
      }
    }
    if (!booking) throw new HttpError(409, 'slot_unavailable', 'That time was just taken. Please choose another slot.');

    const leadPatch: Record<string, unknown> = { next_follow_up_at: booking.starts_at };
    if (!assignedTo) leadPatch.assigned_to = booking.salesperson_id;
    await db.from('leads').update(leadPatch).eq('id', leadId);
    await db.from('leads').update({ status: 'demo_scheduled' }).eq('id', leadId).in('status', ['new', 'contacted', 'qualified']);

    await notify(db, {
      key: 'demo_confirmation',
      email: booking.email,
      phone: booking.phone,
      whatsappConsent: body.whatsapp_opt_in,
      language: body.language,
      vars: demoVars(booking, siteUrl),
      leadId,
      dedupeKey: `demo-confirm:${booking.id}`,
    });

    return {
      ok: true,
      booking: { starts_at: booking.starts_at, ends_at: booking.ends_at, manage_token: booking.manage_token, mode: booking.mode },
    };
  },
);

export const config: Config = { path: '/api/public/demo-bookings' };
