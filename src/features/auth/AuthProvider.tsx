import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import type { RoleKey } from '@shared/constants';
import { can as canDo, isStaff as isStaffRole, type Permission } from '@shared/permissions';
import { supabase } from '@/lib/supabase';
import { storage } from '@/lib/utils';
import type { Company, CompanyMembership, Profile } from '@/types/db';

const ACTIVE_COMPANY_KEY = 'hrms.active-company';

interface AuthContextValue {
  loading: boolean;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  roles: RoleKey[];
  memberships: (CompanyMembership & { companies: Company })[];
  isStaff: boolean;
  /** The tenant the signed-in customer is currently working in. */
  activeCompany: Company | null;
  activeMembership: CompanyMembership | null;
  isCompanyAdmin: boolean;
  /** Company Admin or HR Manager in the active company. */
  isHr: boolean;
  /** Only an employee (attendance + leave), not a portal user. */
  isEmployeeOnly: boolean;
  setActiveCompany: (companyId: string) => void;
  can: (permission: Permission) => boolean;
  /** Where this user should land after signing in. */
  homePath: string;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface Identity {
  /** The user this identity was loaded for (null = nothing loaded). */
  userId: string | null;
  profile: Profile | null;
  roles: RoleKey[];
  memberships: (CompanyMembership & { companies: Company })[];
}

const EMPTY: Identity = { userId: null, profile: null, roles: [], memberships: [] };

async function loadIdentity(userId: string): Promise<Identity> {
  if (!supabase) return EMPTY;
  const [profile, roles, memberships] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
    supabase.from('user_roles').select('role_key').eq('user_id', userId),
    supabase.from('company_memberships').select('*, companies(*)').eq('user_id', userId),
  ]);
  return {
    userId,
    profile: (profile.data as Profile | null) ?? null,
    roles: ((roles.data ?? []) as { role_key: RoleKey }[]).map((r) => r.role_key),
    memberships: ((memberships.data ?? []) as (CompanyMembership & { companies: Company })[]).filter((m) => m.companies),
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [identity, setIdentity] = useState<Identity>(EMPTY);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(() => storage.get(ACTIVE_COMPANY_KEY));

  const userId = session?.user.id ?? null;

  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setSession(data.session);
      if (!data.session) setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (!next) {
        setIdentity(EMPTY);
        setLoading(false);
      }
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!userId) return;
    setIdentity(await loadIdentity(userId));
  }, [userId]);

  // Identity is keyed on the user id, so token refreshes do not refetch it.
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    setLoading(true);
    loadIdentity(userId)
      .then((next) => alive && setIdentity(next))
      .catch(() => alive && setIdentity({ ...EMPTY, userId }))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [userId]);

  const signOut = useCallback(async () => {
    await supabase?.auth.signOut();
    queryClient.clear(); // never leave one tenant's cached data for the next user
    storage.remove(ACTIVE_COMPANY_KEY);
    setActiveCompanyId(null);
  }, [queryClient]);

  const setActiveCompany = useCallback((companyId: string) => {
    storage.set(ACTIVE_COMPANY_KEY, companyId);
    setActiveCompanyId(companyId);
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const { profile, roles, memberships } = identity;
    const staff = isStaffRole(roles);
    const activeMembership = memberships.find((m) => m.company_id === activeCompanyId) ?? memberships[0] ?? null;
    const active = Boolean(profile?.is_active);
    return {
      // A fresh sign-in sets the session one render before the identity effect runs;
      // treat that gap as loading so guards never route on an empty identity.
      loading: loading || (session !== null && identity.userId !== session.user.id),
      session,
      user: session?.user ?? null,
      profile,
      roles: active ? roles : [],
      memberships: active ? memberships : [],
      isStaff: active && staff,
      activeCompany: active ? (activeMembership?.companies ?? null) : null,
      activeMembership: active ? activeMembership : null,
      isCompanyAdmin: active && activeMembership?.role === 'customer_admin',
      isHr: active && (activeMembership?.role === 'customer_admin' || activeMembership?.role === 'hr_manager'),
      isEmployeeOnly: active && !staff && activeMembership?.role === 'employee',
      setActiveCompany,
      can: (permission) => active && canDo(roles, permission),
      homePath: !session ? '/login' : active && staff ? '/admin' : active && activeMembership?.role === 'employee' ? '/portal/attendance' : active && memberships.length ? '/portal' : '/no-access',
      signOut,
      refresh,
    };
  }, [identity, loading, session, activeCompanyId, setActiveCompany, signOut, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
