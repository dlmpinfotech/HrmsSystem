import { useQuery } from '@tanstack/react-query';
import { sb, unwrap } from '@/lib/supabase';
import type { RoleKey } from '@shared/constants';

export interface StaffMember {
  id: string;
  full_name: string;
  email: string;
  is_active: boolean;
  roles: RoleKey[];
}

/** Platform team members (for assignment dropdowns and the Team page). */
export function useStaff() {
  return useQuery({
    queryKey: ['staff'],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<StaffMember[]> => {
      const rows = unwrap(
        await sb()
          .from('user_roles')
          .select('role_key, profiles!user_roles_user_id_fkey(id, full_name, email, is_active)')
          .in('role_key', ['super_admin', 'sales_admin', 'sales_executive', 'support_executive']),
      ) as unknown as { role_key: RoleKey; profiles: { id: string; full_name: string; email: string; is_active: boolean } | null }[];
      const map = new Map<string, StaffMember>();
      for (const r of rows) {
        if (!r.profiles) continue;
        const m = map.get(r.profiles.id) ?? { ...r.profiles, roles: [] };
        m.roles.push(r.role_key);
        map.set(r.profiles.id, m);
      }
      return [...map.values()].sort((a, b) => (a.full_name || a.email).localeCompare(b.full_name || b.email));
    },
  });
}

export function staffName(staff: StaffMember[] | undefined, id: string | null | undefined): string {
  if (!id) return '—';
  const m = staff?.find((s) => s.id === id);
  return m ? m.full_name || m.email : '—';
}

export const salesPeople = (staff: StaffMember[] = []) => staff.filter((s) => s.is_active && s.roles.some((r) => r === 'super_admin' || r === 'sales_admin' || r === 'sales_executive'));
export const supportPeople = (staff: StaffMember[] = []) => staff.filter((s) => s.is_active && s.roles.some((r) => r === 'super_admin' || r === 'sales_admin' || r === 'support_executive'));
