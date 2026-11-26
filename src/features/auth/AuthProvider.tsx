import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import type { RoleKey } from '@shared/constants';
import { can as canDo, isStaff as isStaffRole, type Permission } from '@shared/permissions';
import { supabase } from '@/lib/supabase';
import { storage } from '@/lib/utils';
import type { Company, CompanyMembership, Profile } from '@/types/db';

const ACTIVE_COMPANY_KEY = 'hrms.active-company';
const PERSONA_KEY = 'hrms.persona';

/**
 * One login can be several "account types" — e.g. Company Admin, HR Manager and an
 * employee of the same company. The chosen type only narrows what the UI shows;
 * the database still decides what the login may actually do.
 */
export type PersonaKind = 'staff' | 'admin' | 'hr' | 'member' | 'employee';
export interface Persona {
  key: string;
  kind: PersonaKind;
  companyId: string | null;
  companyName: string | null;
  employeeCode: string | null;
}
const PERSONA_ROLE: Record<Exclude<PersonaKind, 'staff'>, CompanyMembership['role']> = { admin: 'customer_admin', hr: 'hr_manager', member: 'customer_user', employee: 'employee' };

export function personaHome(p: Persona): string {
  if (p.kind === 'staff') return '/admin';
  if (p.kind === 'employee') return '/portal/attendance';
  return '/portal';
}

interface LinkedEmployee {
  id: string;
  company_id: string;
  employee_code: string;
}

export function buildPersonas(staff: boolean, memberships: (Pick<CompanyMembership, 'company_id' | 'role'> & { companies: Pick<Company, 'name'> })[], employees: Pick<LinkedEmployee, 'company_id' | 'employee_code'>[]): Persona[] {
  const out: Persona[] = [];
  if (staff) out.push({ key: 'staff', kind: 'staff', companyId: null, companyName: null, employeeCode: null });
  for (const m of memberships) {
    const emp = employees.find((e) => e.company_id === m.company_id);
    const kinds: PersonaKind[] = m.role === 'customer_admin' ? ['admin', 'hr'] : m.role === 'hr_manager' ? ['hr'] : m.role === 'customer_user' ? ['member'] : ['employee'];
    if (m.role !== 'employee' && emp) kinds.push('employee');
    for (const kind of kinds) {
      out.push({ key: `${kind}:${m.company_id}`, kind, companyId: m.company_id, companyName: m.companies.name, employeeCode: kind === 'employee' ? emp?.employee_code ?? null : null });
    }
  }
  return out;
}

interface PersonaPick {
  userId: string;
  key: string;
}

function readPick(): PersonaPick | null {
  const raw = storage.get(PERSONA_KEY);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<PersonaPick>;
    return v.userId && v.key ? { userId: v.userId, key: v.key } : null;
  } catch {
    return null;
  }
}

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
  /** Membership in the active company, with the role of the chosen account type. */
  activeMembership: CompanyMembership | null;
  isCompanyAdmin: boolean;
  /** Company Admin or HR Manager in the active company. */
  isHr: boolean;
  /** Only an employee (attendance + leave), not a portal user. */
  isEmployeeOnly: boolean;
  setActiveCompany: (companyId: string) => void;
  /** Every account type this login can use (more than one → asked after sign-in). */
  personas: Persona[];
  persona: Persona | null;
  choosePersona: (key: string) => void;
  can: (permission: Permission) => boolean;
  /** Where this user should land after signing in. */
  homePath: string;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Signed in with a password but the authenticator code is still needed. */
  mfaPending: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface Identity {
  /** The user this identity was loaded for (null = nothing loaded). */
  userId: string | null;
  profile: Profile | null;
  roles: RoleKey[];
  memberships: (CompanyMembership & { companies: Company })[];
  employees: LinkedEmployee[];
  mfaPending: boolean;
}

const EMPTY: Identity = { userId: null, profile: null, roles: [], memberships: [], employees: [], mfaPending: false };

async function loadIdentity(userId: string): Promise<Identity> {
  if (!supabase) return EMPTY;
  // With two-step sign-in on, the database returns nothing until the code is entered.
  const { data: level } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (level?.nextLevel === 'aal2' && level.currentLevel !== 'aal2') return { ...EMPTY, userId, mfaPending: true };
  const [profile, roles, memberships, employees] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
    supabase.from('user_roles').select('role_key').eq('user_id', userId),
    supabase.from('company_memberships').select('*, companies(*)').eq('user_id', userId),
    supabase.from('employees').select('id, company_id, employee_code').eq('user_id', userId).eq('status', 'active'),
  ]);
  return {
    userId,
    profile: (profile.data as Profile | null) ?? null,
    roles: ((roles.data ?? []) as { role_key: RoleKey }[]).map((r) => r.role_key),
    memberships: ((memberships.data ?? []) as (CompanyMembership & { companies: Company })[]).filter((m) => m.companies),
    employees: employees.error ? [] : ((employees.data ?? []) as LinkedEmployee[]),
    mfaPending: false,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [identity, setIdentity] = useState<Identity>(EMPTY);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(() => storage.get(ACTIVE_COMPANY_KEY));
  const [pick, setPick] = useState<PersonaPick | null>(readPick);

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

  // The account-type choice lasts until sign-out: signed out → forget it, so the next sign-in asks again.
  useEffect(() => {
    if (loading || userId) return;
    storage.remove(PERSONA_KEY);
    setPick(null);
  }, [userId, loading]);

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
    storage.remove(PERSONA_KEY);
    setActiveCompanyId(null);
    setPick(null);
  }, [queryClient]);

  const personas = useMemo(
    () => buildPersonas(isStaffRole(identity.roles), identity.profile?.is_active ? identity.memberships : [], identity.employees),
    [identity],
  );

  const choosePersona = useCallback(
    (key: string) => {
      const p = personas.find((x) => x.key === key);
      if (!p || !userId) return;
      storage.set(PERSONA_KEY, JSON.stringify({ userId, key }));
      setPick({ userId, key });
      if (p.companyId) {
        storage.set(ACTIVE_COMPANY_KEY, p.companyId);
        setActiveCompanyId(p.companyId);
      }
    },
    [personas, userId],
  );

  const setActiveCompany = useCallback(
    (companyId: string) => {
      const first = personas.find((p) => p.companyId === companyId);
      if (first) choosePersona(first.key);
      else {
        storage.set(ACTIVE_COMPANY_KEY, companyId);
        setActiveCompanyId(companyId);
      }
    },
    [personas, choosePersona],
  );

  const value = useMemo<AuthContextValue>(() => {
    const { profile, roles, memberships } = identity;
    const staff = isStaffRole(roles);
    const active = Boolean(profile?.is_active);
    // One account type → use it; several → the saved choice, or none yet (ask).
    const persona = personas.length === 1 ? personas[0] : personas.find((p) => pick?.userId === session?.user.id && p.key === pick?.key) ?? null;
    const needsChoice = Boolean(session) && active && personas.length > 1 && !persona;
    const effStaff = active && staff && (persona?.kind === 'staff' || (!persona && !needsChoice));
    const baseMembership = !persona
      ? memberships.find((m) => m.company_id === activeCompanyId) ?? memberships[0] ?? null
      : persona.kind === 'staff'
        ? null
        : memberships.find((m) => m.company_id === persona.companyId) ?? null;
    const role = persona && persona.kind !== 'staff' ? PERSONA_ROLE[persona.kind] : baseMembership?.role;
    const activeMembership = active && !needsChoice && baseMembership && role ? { ...baseMembership, role } : null;
    return {
      // A fresh sign-in sets the session one render before the identity effect runs;
      // treat that gap as loading so guards never route on an empty identity.
      loading: loading || (session !== null && identity.userId !== session.user.id),
      session,
      user: session?.user ?? null,
      profile,
      roles: active ? roles : [],
      memberships: active ? memberships : [],
      isStaff: effStaff,
      activeCompany: activeMembership?.companies ?? null,
      activeMembership,
      isCompanyAdmin: activeMembership?.role === 'customer_admin',
      isHr: activeMembership?.role === 'customer_admin' || activeMembership?.role === 'hr_manager',
      isEmployeeOnly: !effStaff && activeMembership?.role === 'employee',
      setActiveCompany,
      personas: active ? personas : [],
      persona: active ? persona : null,
      choosePersona,
      can: (permission) => effStaff && canDo(roles, permission),
      mfaPending: Boolean(session) && identity.mfaPending,
      homePath: !session
        ? '/login'
        : identity.mfaPending
          ? '/mfa'
          : needsChoice
          ? '/choose-account'
          : effStaff
            ? '/admin'
            : activeMembership?.role === 'employee'
              ? '/portal/attendance'
              : activeMembership
                ? '/portal'
                : '/no-access',
      signOut,
      refresh,
    };
  }, [identity, loading, session, activeCompanyId, personas, pick, setActiveCompany, choosePersona, signOut, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
