import type { SupabaseClient } from '@supabase/supabase-js';
import type { RoleKey } from '../../shared/constants';
import { HttpError } from './http';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  roles: RoleKey[];
}

/** True when the account has a confirmed authenticator but this (already validated) token did not pass it. */
export function needsSecondStep(token: string, factors: { status?: string }[] | undefined | null): boolean {
  if (!factors?.some((f) => f.status === 'verified')) return false;
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as { aal?: string };
    return payload.aal !== 'aal2';
  } catch {
    return true;
  }
}

/** Validates the caller's Supabase JWT and loads their roles from the database. */
export async function authenticate(req: Request, db: SupabaseClient): Promise<AuthUser> {
  const header = req.headers.get('authorization') ?? '';
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (!token) throw new HttpError(401, 'unauthenticated', 'Please sign in.');

  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'unauthenticated', 'Your session has expired. Please sign in again.');

  // The service-role client skips RLS, so enforce the second step here as the database does.
  if (needsSecondStep(token, data.user.factors)) throw new HttpError(401, 'mfa_required', 'Enter your authenticator code to continue.');

  const [{ data: profile }, { data: roleRows }] = await Promise.all([
    db.from('profiles').select('id, email, full_name, is_active').eq('id', data.user.id).maybeSingle(),
    db.from('user_roles').select('role_key').eq('user_id', data.user.id),
  ]);
  if (!profile || !profile.is_active) throw new HttpError(403, 'account_disabled', 'This account is disabled.');

  return {
    id: data.user.id,
    email: profile.email,
    fullName: profile.full_name,
    roles: (roleRows ?? []).map((r) => r.role_key as RoleKey),
  };
}

/** True when the user administers the given company (tenant). */
export async function isCompanyAdmin(db: SupabaseClient, userId: string, companyId: string): Promise<boolean> {
  const { data } = await db
    .from('company_memberships')
    .select('role')
    .eq('company_id', companyId)
    .eq('user_id', userId)
    .maybeSingle();
  return data?.role === 'customer_admin';
}

export async function isCompanyMember(db: SupabaseClient, userId: string, companyId: string): Promise<boolean> {
  const { data } = await db
    .from('company_memberships')
    .select('id')
    .eq('company_id', companyId)
    .eq('user_id', userId)
    .maybeSingle();
  return Boolean(data);
}
