import type { Config } from '@netlify/functions';
import { z } from 'zod';
import { COMPANY_ROLES, STAFF_ROLES, type RoleKey } from '../../shared/constants';
import { inviteSchema } from '../../shared/schemas';
import { defineHandler, HttpError, assertDb } from '../lib/http';
import { isCompanyAdmin } from '../lib/auth';
import type { SupabaseClient } from '@supabase/supabase-js';

async function isCompanyHr(db: SupabaseClient, userId: string, companyId: string): Promise<boolean> {
  const { data } = await db.from('company_memberships').select('role').eq('company_id', companyId).eq('user_id', userId).maybeSingle();
  return data?.role === 'customer_admin' || data?.role === 'hr_manager';
}
import { loadInviter, sendAccessEmail, sendInvitation } from '../lib/invite';
import { audit } from '../lib/settings';

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('invite') }).merge(inviteSchema),
  z.object({ action: z.literal('set_roles'), user_id: z.string().uuid(), roles: z.array(z.enum(['super_admin', 'sales_admin', 'sales_executive', 'support_executive'])).max(4) }),
  z.object({ action: z.literal('set_active'), user_id: z.string().uuid(), is_active: z.boolean() }),
  z.object({ action: z.literal('revoke_invite'), invitation_id: z.string().uuid() }),
  z.object({ action: z.literal('send_login_link'), employee_id: z.string().uuid() }),
  z.object({ action: z.literal('remove_member'), company_id: z.string().uuid(), user_id: z.string().uuid() }),
  z.object({ action: z.literal('set_member_role'), company_id: z.string().uuid(), user_id: z.string().uuid(), role: z.enum(['customer_admin', 'hr_manager', 'customer_user', 'employee']) }),
]);

/**
 * POST /api/team — user invitations and role management.
 *  • Staff roles: Super Admin only.
 *  • Company members: Super/Sales Admin, or that company's Customer Admin (within plan user limit).
 * Emails go out through the app's own mailer (SMTP) from "<inviter> (via <company>)";
 * roles are applied by the database trigger when the invited person's account is created.
 */
export default defineHandler(
  { name: 'team', methods: ['POST'], auth: 'user', schema: actionSchema, rateLimit: { max: 30, windowSec: 600 } },
  async ({ db, body, user, roles, siteUrl }) => {
    const isSuper = roles.includes('super_admin');
    const isPlatformAdmin = isSuper || roles.includes('sales_admin');

    const requireCompanyAdmin = async (companyId: string) => {
      if (isPlatformAdmin) return;
      if (!(await isCompanyAdmin(db, user!.id, companyId))) throw new HttpError(403, 'forbidden');
    };

    // HR Managers may give employees a login (and resend it); other roles need a Company Admin.
    const requireCompanyHr = async (companyId: string) => {
      if (isPlatformAdmin) return;
      if (!(await isCompanyHr(db, user!.id, companyId))) throw new HttpError(403, 'forbidden');
    };

    const adminCount = async (companyId: string) => {
      const { count } = await db.from('company_memberships').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('role', 'customer_admin');
      return count ?? 0;
    };

    if (body.action === 'invite') {
      const staffRole = (STAFF_ROLES as string[]).includes(body.role_key);
      if (staffRole) {
        if (!isSuper) throw new HttpError(403, 'forbidden', 'Only a Super Admin can invite staff.');
        if (body.company_id) throw new HttpError(422, 'invalid_invite', 'Staff roles are not tied to a customer company.');
      } else {
        if (!body.company_id) throw new HttpError(422, 'invalid_invite', 'Choose the company for this user.');
        if (body.role_key === 'employee') await requireCompanyHr(body.company_id);
        else await requireCompanyAdmin(body.company_id);

        // Employee logins are limited by the plan's employee limit (enforced on the employees table), not the portal-user limit.
        const [{ count: members }, { count: pending }, { data: sub }] = await Promise.all([
          db.from('company_memberships').select('id', { count: 'exact', head: true }).eq('company_id', body.company_id).neq('role', 'employee'),
          db.from('user_invitations').select('id', { count: 'exact', head: true }).eq('company_id', body.company_id).eq('status', 'pending').neq('role_key', 'employee'),
          db.from('subscriptions').select('plans(user_limit)').eq('company_id', body.company_id).in('status', ['trialing', 'active', 'past_due']).maybeSingle(),
        ]);
        const plan = sub?.plans as { user_limit?: number | null } | { user_limit?: number | null }[] | null | undefined;
        const limit = (Array.isArray(plan) ? plan[0]?.user_limit : plan?.user_limit) ?? null;
        if (body.role_key !== 'employee' && limit !== null && (members ?? 0) + (pending ?? 0) >= limit) {
          throw new HttpError(409, 'user_limit_reached', `Your plan allows up to ${limit} portal users.`);
        }
      }

      const inviter = await loadInviter(db, user!.id);
      const mailInput = { email: body.email, fullName: body.full_name, companyId: body.company_id ?? null, siteUrl, inviter };
      // Access is already granted when this runs; the email is a courtesy, so a mail failure is reported, not fatal.
      const accessEmail = async () => {
        try {
          await sendAccessEmail(db, mailInput);
          return true;
        } catch (err) {
          console.error('[team] access email failed', (err as Error).message);
          return false;
        }
      };
      const { data: existing } = await db.from('profiles').select('id').eq('email', body.email).maybeSingle();
      if (existing) {
        // Existing account: grant access directly, no email needed.
        if (staffRole) {
          assertDb(await db.from('user_roles').upsert({ user_id: existing.id, role_key: body.role_key, granted_by: user!.id }).select('user_id').single(), 'grant role');
        } else {
          const { data: otherTenant } = await db.from('company_memberships').select('company_id').eq('user_id', existing.id).neq('company_id', body.company_id!).limit(1);
          if (otherTenant?.length) throw new HttpError(409, 'belongs_to_other_company', 'This user already belongs to another company.');
          // Already in this company: keep their current role (role changes go through set_member_role),
          // so e.g. adding a Company Admin as an employee never downgrades them.
          const { data: current } = await db.from('company_memberships').select('id').eq('company_id', body.company_id!).eq('user_id', existing.id).maybeSingle();
          if (current) return { ok: true, invited: false, already_member: true, emailed: await accessEmail() };
          assertDb(
            await db.from('company_memberships').upsert({ company_id: body.company_id, user_id: existing.id, role: body.role_key }, { onConflict: 'company_id,user_id' }).select('id').single(),
            'grant membership',
          );
          await db.from('user_roles').upsert({ user_id: existing.id, role_key: body.role_key, granted_by: user!.id });
        }
        await audit(db, { actor: user!.id, action: 'access_granted', entity: 'profiles', entityId: existing.id, companyId: body.company_id, metadata: { role: body.role_key } });
        return { ok: true, invited: false, emailed: await accessEmail() };
      }

      const invitation = assertDb(
        await db
          .from('user_invitations')
          .insert({ email: body.email, role_key: body.role_key, company_id: body.company_id, invited_by: user!.id })
          .select('id')
          .single(),
        'create invitation',
      );
      try {
        await sendInvitation(db, mailInput);
      } catch (err) {
        const reason = (err as Error).message ?? '';
        console.error('[team] invite failed', reason);
        await db.from('user_invitations').update({ status: 'revoked' }).eq('id', invitation.id);
        if (/rate limit/i.test(reason)) throw new HttpError(429, 'invite_rate_limited', 'Too many invitation emails were sent recently. Please try again later.');
        if (reason === 'email_not_configured') throw new HttpError(503, 'email_not_configured', 'Email (SMTP) is not set up on the server.');
        throw new HttpError(502, 'invite_failed', 'The invitation email could not be sent.');
      }
      await audit(db, { actor: user!.id, action: 'user_invited', entity: 'user_invitations', entityId: invitation.id, companyId: body.company_id, metadata: { role: body.role_key } });
      return { ok: true, invited: true };
    }

    if (body.action === 'send_login_link') {
      const { data: emp } = await db.from('employees').select('id, company_id, full_name, email, user_id, status').eq('id', body.employee_id).maybeSingle();
      if (!emp) throw new HttpError(404, 'employee_not_found');
      await requireCompanyHr(emp.company_id);
      if (!emp.email) throw new HttpError(422, 'employee_no_email', 'Add an email address for this employee first.');
      if (emp.status !== 'active') throw new HttpError(409, 'employee_not_active', 'Only active employees can sign in.');
      const inviter = await loadInviter(db, user!.id);
      const mailInput = { email: emp.email, fullName: emp.full_name, companyId: emp.company_id, siteUrl, inviter };

      const { data: profile } = await db.from('profiles').select('id').eq('email', emp.email).maybeSingle();
      if (profile) {
        const { data: other } = await db.from('company_memberships').select('company_id').eq('user_id', profile.id).neq('company_id', emp.company_id).limit(1);
        if (other?.length) throw new HttpError(409, 'belongs_to_other_company', 'This email already belongs to another company.');
        const { data: member } = await db.from('company_memberships').select('id').eq('company_id', emp.company_id).eq('user_id', profile.id).maybeSingle();
        if (!member) {
          assertDb(await db.from('company_memberships').insert({ company_id: emp.company_id, user_id: profile.id, role: 'employee' }).select('id').single(), 'grant membership');
          await db.from('user_roles').upsert({ user_id: profile.id, role_key: 'employee', granted_by: user!.id });
        }
        try {
          await sendAccessEmail(db, { ...mailInput, withPasswordLink: true });
        } catch (err) {
          console.error('[team] login link failed', (err as Error).message);
          throw new HttpError(502, 'invite_failed', 'The email could not be sent.');
        }
        await audit(db, { actor: user!.id, action: 'login_link_sent', entity: 'employees', entityId: emp.id, companyId: emp.company_id });
        return { ok: true, invited: false, emailed: true };
      }

      // No account yet: replace any older pending invite and send a fresh one.
      await db.from('user_invitations').update({ status: 'revoked' }).eq('company_id', emp.company_id).ilike('email', emp.email).eq('status', 'pending');
      const invitation = assertDb(
        await db.from('user_invitations').insert({ email: emp.email, role_key: 'employee', company_id: emp.company_id, invited_by: user!.id }).select('id').single(),
        'create invitation',
      );
      try {
        await sendInvitation(db, mailInput);
      } catch (err) {
        const reason = (err as Error).message ?? '';
        console.error('[team] login link invite failed', reason);
        await db.from('user_invitations').update({ status: 'revoked' }).eq('id', invitation.id);
        if (reason === 'email_not_configured') throw new HttpError(503, 'email_not_configured', 'Email (SMTP) is not set up on the server.');
        throw new HttpError(502, 'invite_failed', 'The email could not be sent.');
      }
      await audit(db, { actor: user!.id, action: 'user_invited', entity: 'user_invitations', entityId: invitation.id, companyId: emp.company_id, metadata: { role: 'employee' } });
      return { ok: true, invited: true };
    }

    if (body.action === 'revoke_invite') {
      const { data: inv } = await db.from('user_invitations').select('id, company_id, status').eq('id', body.invitation_id).maybeSingle();
      if (!inv || inv.status !== 'pending') throw new HttpError(404, 'invitation_not_found');
      if (inv.company_id) await requireCompanyAdmin(inv.company_id);
      else if (!isSuper) throw new HttpError(403, 'forbidden');
      await db.from('user_invitations').update({ status: 'revoked' }).eq('id', inv.id);
      return { ok: true };
    }

    if (body.action === 'set_roles') {
      if (!isSuper) throw new HttpError(403, 'forbidden');
      if (body.user_id === user!.id && !body.roles.includes('super_admin')) {
        throw new HttpError(409, 'cannot_demote_self', 'You cannot remove your own Super Admin role.');
      }
      await db.from('user_roles').delete().eq('user_id', body.user_id).in('role_key', STAFF_ROLES);
      if (body.roles.length) {
        assertDb(
          await db.from('user_roles').insert(body.roles.map((r: RoleKey) => ({ user_id: body.user_id, role_key: r, granted_by: user!.id }))).select('user_id'),
          'set roles',
        );
      }
      await audit(db, { actor: user!.id, action: 'roles_changed', entity: 'profiles', entityId: body.user_id, metadata: { roles: body.roles } });
      return { ok: true };
    }

    if (body.action === 'set_active') {
      if (!isSuper) throw new HttpError(403, 'forbidden');
      if (body.user_id === user!.id) throw new HttpError(409, 'cannot_disable_self', 'You cannot disable your own account.');
      assertDb(await db.from('profiles').update({ is_active: body.is_active }).eq('id', body.user_id).select('id').single(), 'set active');
      await audit(db, { actor: user!.id, action: body.is_active ? 'user_enabled' : 'user_disabled', entity: 'profiles', entityId: body.user_id });
      return { ok: true };
    }

    // Company member management
    await requireCompanyAdmin(body.company_id);
    const { data: membership } = await db.from('company_memberships').select('id, role').eq('company_id', body.company_id).eq('user_id', body.user_id).maybeSingle();
    if (!membership) throw new HttpError(404, 'member_not_found');
    const losingAdmin = membership.role === 'customer_admin' && (body.action === 'remove_member' || body.role !== 'customer_admin');
    if (losingAdmin && (await adminCount(body.company_id)) <= 1) {
      throw new HttpError(409, 'last_admin', 'A company must keep at least one admin.');
    }

    if (body.action === 'remove_member') {
      await db.from('company_memberships').delete().eq('id', membership.id);
      await db.from('user_roles').delete().eq('user_id', body.user_id).in('role_key', [...COMPANY_ROLES]);
      await audit(db, { actor: user!.id, action: 'member_removed', entity: 'company_memberships', entityId: body.user_id, companyId: body.company_id });
      return { ok: true };
    }

    await db.from('company_memberships').update({ role: body.role }).eq('id', membership.id);
    await db.from('user_roles').delete().eq('user_id', body.user_id).in('role_key', [...COMPANY_ROLES]);
    await db.from('user_roles').insert({ user_id: body.user_id, role_key: body.role, granted_by: user!.id });
    await audit(db, { actor: user!.id, action: 'member_role_changed', entity: 'company_memberships', entityId: body.user_id, companyId: body.company_id, metadata: { role: body.role } });
    return { ok: true };
  },
);

export const config: Config = { path: '/api/team' };
