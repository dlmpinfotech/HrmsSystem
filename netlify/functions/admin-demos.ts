import type { Config } from '@netlify/functions';
import { adminDemoActionSchema } from '../../shared/schemas';
import { defineHandler, HttpError, assertDb } from '../lib/http';
import { demoVars, type BookingRow } from '../lib/demos';
import { hasWhatsAppConsent, notify } from '../lib/notifications';
import { audit } from '../lib/settings';

/** POST /api/admin/demos — staff actions on demo bookings (create, reschedule, cancel, complete). */
export default defineHandler(
  { name: 'admin-demos', methods: ['POST'], permission: 'demos.manage', schema: adminDemoActionSchema },
  async ({ db, body, user, roles, siteUrl }) => {
    const isAdmin = roles.includes('super_admin') || roles.includes('sales_admin');

    const loadBooking = async (id: string): Promise<BookingRow> => {
      const { data } = await db.from('demo_bookings').select('*').eq('id', id).maybeSingle();
      if (!data) throw new HttpError(404, 'booking_not_found');
      if (!isAdmin && data.salesperson_id !== user!.id) throw new HttpError(403, 'forbidden', 'You can only manage your own demos.');
      return data as BookingRow;
    };

    if (body.action === 'create') {
      const { data: lead } = await db.from('leads').select('*').eq('id', body.lead_id).maybeSingle();
      if (!lead) throw new HttpError(404, 'lead_not_found');
      if (!isAdmin && lead.assigned_to && lead.assigned_to !== user!.id) throw new HttpError(403, 'forbidden');
      if (!isAdmin && body.salesperson_id !== user!.id) throw new HttpError(403, 'forbidden', 'You can only schedule demos for yourself.');
      if (new Date(body.starts_at) <= new Date()) throw new HttpError(422, 'slot_in_past', 'Choose a time in the future.');

      const endsAt = new Date(new Date(body.starts_at).getTime() + body.duration_minutes * 60_000).toISOString();
      const { data, error } = await db
        .from('demo_bookings')
        .insert({
          lead_id: lead.id,
          salesperson_id: body.salesperson_id,
          starts_at: body.starts_at,
          ends_at: endsAt,
          contact_name: lead.contact_person,
          company_name: lead.company_name,
          email: lead.email,
          phone: lead.phone,
          mode: body.mode,
          meeting_url: body.meeting_url ?? null,
          notes: body.notes ?? null,
          created_by: user!.id,
        })
        .select('*')
        .single();
      if (error?.code === '23505') throw new HttpError(409, 'slot_unavailable', 'This salesperson already has a demo at that time.');
      const booking = assertDb({ data, error }, 'create demo') as BookingRow;

      await db.from('leads').update({ status: 'demo_scheduled' }).eq('id', lead.id).in('status', ['new', 'contacted', 'qualified']);
      await db.from('leads').update({ next_follow_up_at: booking.starts_at }).eq('id', lead.id);
      if (body.notify) {
        await notify(db, {
          key: 'demo_confirmation',
          email: booking.email,
          phone: booking.phone,
          whatsappConsent: await hasWhatsAppConsent(db, booking.phone),
          language: booking.language,
          vars: demoVars(booking, siteUrl),
          leadId: lead.id,
          dedupeKey: `demo-confirm:${booking.id}`,
        });
      }
      await audit(db, { actor: user!.id, action: 'demo_created', entity: 'demo_bookings', entityId: booking.id });
      return { ok: true, booking };
    }

    const booking = await loadBooking(body.booking_id);

    if (body.action === 'reschedule') {
      if (booking.status !== 'scheduled') throw new HttpError(409, 'booking_closed', 'Only scheduled demos can be rescheduled.');
      if (new Date(body.starts_at) <= new Date()) throw new HttpError(422, 'slot_in_past', 'Choose a time in the future.');
      const duration = new Date(booking.ends_at).getTime() - new Date(booking.starts_at).getTime();
      const { data, error } = await db
        .from('demo_bookings')
        .update({
          starts_at: body.starts_at,
          ends_at: new Date(new Date(body.starts_at).getTime() + duration).toISOString(),
          reschedule_count: booking.reschedule_count + 1,
          reminder_24h_at: null,
          reminder_1h_at: null,
        })
        .eq('id', booking.id)
        .select('*')
        .single();
      if (error?.code === '23505') throw new HttpError(409, 'slot_unavailable', 'This salesperson already has a demo at that time.');
      const updated = assertDb({ data, error }, 'reschedule demo') as BookingRow;
      if (updated.lead_id) await db.from('leads').update({ next_follow_up_at: updated.starts_at }).eq('id', updated.lead_id);
      if (body.notify) {
        await notify(db, {
          key: 'demo_rescheduled',
          channels: ['email'],
          email: updated.email,
          language: updated.language,
          vars: demoVars(updated, siteUrl),
          leadId: updated.lead_id,
          dedupeKey: `demo-resched:${updated.id}:${updated.reschedule_count}`,
        });
      }
      return { ok: true, booking: updated };
    }

    if (body.action === 'cancel') {
      if (booking.status !== 'scheduled') throw new HttpError(409, 'booking_closed', 'Only scheduled demos can be cancelled.');
      assertDb(
        await db.from('demo_bookings').update({ status: 'cancelled', cancelled_reason: body.reason ?? null }).eq('id', booking.id).select('id').single(),
        'cancel demo',
      );
      if (body.notify) {
        await notify(db, {
          key: 'demo_cancelled',
          channels: ['email'],
          email: booking.email,
          language: booking.language,
          vars: demoVars(booking, siteUrl),
          leadId: booking.lead_id,
          dedupeKey: `demo-cancel:${booking.id}`,
        });
      }
      return { ok: true };
    }

    // complete / no-show + feedback and follow-up tracking
    if (!['scheduled', 'completed', 'no_show'].includes(booking.status)) throw new HttpError(409, 'booking_closed');
    assertDb(
      await db
        .from('demo_bookings')
        .update({
          status: body.status,
          outcome: body.outcome ?? null,
          feedback_rating: body.feedback_rating ?? null,
          feedback_notes: body.feedback_notes ?? null,
          follow_up_at: body.follow_up_at,
        })
        .eq('id', booking.id)
        .select('id')
        .single(),
      'complete demo',
    );
    if (booking.lead_id) {
      if (body.status === 'completed') {
        await db.from('leads').update({ status: 'demo_completed' }).eq('id', booking.lead_id).in('status', ['new', 'contacted', 'qualified', 'demo_scheduled']);
      }
      if (body.follow_up_at) await db.from('leads').update({ next_follow_up_at: body.follow_up_at }).eq('id', booking.lead_id);
      await db.from('lead_activities').insert({
        lead_id: booking.lead_id,
        type: 'meeting',
        body: `Demo ${body.status === 'completed' ? 'completed' : 'marked as no-show'}${body.feedback_notes ? ` — ${body.feedback_notes}` : ''}`,
        metadata: { outcome: body.outcome ?? null, rating: body.feedback_rating ?? null },
        created_by: user!.id,
      });
    }
    return { ok: true };
  },
);

export const config: Config = { path: '/api/admin/demos' };
