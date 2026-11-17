import type { Config } from '@netlify/functions';
import { supportActionSchema } from '../../shared/schemas';
import { isStaff, can } from '../../shared/permissions';
import { defineHandler, HttpError, assertDb } from '../lib/http';
import { isCompanyMember } from '../lib/auth';
import { hasWhatsAppConsent, notify } from '../lib/notifications';

/**
 * POST /api/support — create a ticket, reply, or update status/assignment.
 * Customers can only touch tickets of companies they belong to; internal notes
 * and assignment are staff-only. Replies from staff notify the ticket creator.
 */
export default defineHandler(
  { name: 'support', methods: ['POST'], auth: 'user', schema: supportActionSchema, rateLimit: { max: 60, windowSec: 300 } },
  async ({ db, body, user, roles, siteUrl }) => {
    const staff = isStaff(roles);

    if (body.action === 'create') {
      if (!staff && !(await isCompanyMember(db, user!.id, body.company_id))) throw new HttpError(403, 'forbidden');
      const ticket = assertDb(
        await db
          .from('support_tickets')
          .insert({
            company_id: body.company_id,
            created_by: user!.id,
            subject: body.subject,
            description: body.description,
            category: body.category,
            priority: body.priority,
          })
          .select('*')
          .single(),
        'create ticket',
      );
      return { ok: true, ticket };
    }

    const { data: ticket } = await db.from('support_tickets').select('*').eq('id', body.ticket_id).maybeSingle();
    if (!ticket) throw new HttpError(404, 'ticket_not_found');
    const member = staff ? false : await isCompanyMember(db, user!.id, ticket.company_id);
    if (!staff && !member) throw new HttpError(404, 'ticket_not_found'); // do not reveal other tenants' tickets

    const notifyCreator = async (status: string, message: string) => {
      if (!ticket.created_by || ticket.created_by === user!.id) return;
      const [{ data: creator }, { data: company }] = await Promise.all([
        db.from('profiles').select('full_name, email, phone, preferred_language').eq('id', ticket.created_by).maybeSingle(),
        db.from('companies').select('default_language').eq('id', ticket.company_id).maybeSingle(),
      ]);
      if (!creator) return;
      await notify(db, {
        key: 'support_ticket_update',
        email: creator.email,
        phone: creator.phone,
        whatsappConsent: await hasWhatsAppConsent(db, creator.phone),
        language: creator.preferred_language ?? company?.default_language ?? 'en',
        vars: {
          name: creator.full_name || 'there',
          ticket_number: ticket.ticket_number,
          ticket_subject: ticket.subject,
          status: status.replace(/_/g, ' '),
          message: message.slice(0, 1500),
          portal_url: `${siteUrl}/portal/support/${ticket.id}`,
        },
        companyId: ticket.company_id,
      });
    };

    if (body.action === 'reply') {
      if (body.is_internal && !staff) throw new HttpError(403, 'forbidden');
      if (!staff && ticket.status === 'closed') throw new HttpError(409, 'ticket_closed', 'This ticket is closed. Please open a new one.');
      const message = assertDb(
        await db
          .from('support_messages')
          .insert({ ticket_id: ticket.id, company_id: ticket.company_id, author_id: user!.id, body: body.body, is_internal: body.is_internal })
          .select('*')
          .single(),
        'reply ticket',
      );
      if (staff && !body.is_internal) {
        const { data: fresh } = await db.from('support_tickets').select('status').eq('id', ticket.id).single();
        await notifyCreator(fresh?.status ?? ticket.status, body.body);
      }
      return { ok: true, message };
    }

    // update
    const patch: Record<string, unknown> = {};
    if (staff) {
      if (!can(roles, 'support.manage')) throw new HttpError(403, 'forbidden');
      if (body.status) patch.status = body.status;
      if (body.priority) patch.priority = body.priority;
      if (body.assigned_to !== undefined) patch.assigned_to = body.assigned_to;
    } else {
      // Customers may only close or reopen their own company's tickets.
      if (body.status && ['resolved', 'open'].includes(body.status)) patch.status = body.status;
      else throw new HttpError(403, 'forbidden');
    }
    if (Object.keys(patch).length === 0) throw new HttpError(422, 'nothing_to_update');
    const updated = assertDb(await db.from('support_tickets').update(patch).eq('id', ticket.id).select('*').single(), 'update ticket');
    if (staff && body.status && body.status !== ticket.status) {
      await notifyCreator(body.status, `Status changed to ${body.status.replace(/_/g, ' ')}.`);
    }
    return { ok: true, ticket: updated };
  },
);

export const config: Config = { path: '/api/support' };
