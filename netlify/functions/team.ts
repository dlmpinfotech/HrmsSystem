import type { Config } from '@netlify/functions';
import { z } from 'zod';
import { COMPANY_ROLES, STAFF_ROLES, type RoleKey } from '../../shared/constants';
import { inviteSchema } from '../../shared/schemas';
import { defineHandler, HttpError, assertDb } from '../lib/http';
import { isCompanyAdmin } from '../lib/auth';
import { sendInvitation } from '../lib/invite';
import { audit } from '../lib/settings';

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('invite') }).merge(inviteSchema),
  z.object({ action: z.literal('set_roles'), user_id: z.string().uuid(), roles: z.array(z.enum(['super_admin', 'sales_admin', 'sales_executive', 'support_executive'])).max(4) }),
  z.object({ action: z.literal('set_active'), user_id: z.string().uuid(), is_active: z.boolean() }),
  z.object({ action: z.literal('revoke_invite'), invitation_id: z.string().uuid() }),
  z.object({ action: z.literal('remove_member'), company_id: z.string().uuid(), user_id: z.string().uuid() }),
  z.object({ action: z.literal('set_member_role'), company_id: z.string().uuid(), user_id: z.string().uuid(), role: z.enum(['customer_admin', 'hr_manager', 'customer_user', 'employee']) }),
]);

/**
 * POST /api/team — user invitations and role management.
 *  • Staff roles: Super Admin only.
 *  • Company members: Super/Sales Admin, or that company's Customer Admin (within plan user limit).
 * Invitations are emailed by Supabase Auth; roles are applied by the database
 * trigger when the invited person's account is created.
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
        await requireCompanyAdmin(body.company_id);

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
          if (current) return { ok: true, invited: false, already_member: true };
          assertDb(
            await db.from('company_memberships').upsert({ company_id: body.company_id, user_id: existing.id, role: body.role_key }, { onConflict: 'company_id,user_id' }).select('id').single(),
            'grant membership',
          );
          await db.from('user_roles').upsert({ user_id: existing.id, role_key: body.role_key, granted_by: user!.id });
        }
        await audit(db, { actor: user!.id, action: 'access_granted', entity: 'profiles', entityId: existing.id, companyId: body.company_id, metadata: { role: body.role_key } });
        return { ok: true, invited: false };
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
        await sendInvitation(db, { email: body.email, fullName: body.full_name, companyId: body.company_id, redirectTo: `${siteUrl}/reset-password?invite=1` });
      } catch (err) {
        const reason = (err as Error).message ?? '';
        console.error('[team] invite failed', reason);
        await db.from('user_invitations').update({ status: 'revoked' }).eq('id', invitation.id);
        if (/rate limit/i.test(reason)) throw new HttpError(429, 'invite_rate_limited', 'Too many invitation emails were sent recently. Please try again later.');
        throw new HttpError(502, 'invite_failed', 'The invitation email could not be sent.');
      }
      await audit(db, { actor: user!.id, action: 'user_invited', entity: 'user_invitations', entityId: invitation.id, companyId: body.company_id, metadata: { role: body.role_key } });
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
