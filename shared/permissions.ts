import type { RoleKey } from './constants';
import { STAFF_ROLES } from './constants';

const SUPER: RoleKey[] = ['super_admin'];
const ADMIN: RoleKey[] = ['super_admin', 'sales_admin'];
const SALES: RoleKey[] = ['super_admin', 'sales_admin', 'sales_executive'];
const SUPPORT: RoleKey[] = ['super_admin', 'sales_admin', 'support_executive'];

/**
 * UI/API permission map. The database enforces the same rules through RLS —
 * this map only decides what to show and which API calls to accept.
 */
export const PERMISSIONS = {
  'dashboard.view': STAFF_ROLES,
  'leads.view': SALES,
  'leads.write': SALES,
  'leads.delete': ADMIN,
  'leads.assign': ADMIN,
  'demos.view': SALES,
  'demos.manage': SALES,
  'customers.view': STAFF_ROLES,
  'customers.manage': ADMIN,
  'subscriptions.view': STAFF_ROLES,
  'subscriptions.manage': ADMIN,
  'payments.verify': ADMIN,
  'support.view': STAFF_ROLES,
  'support.manage': SUPPORT,
  'notifications.view': STAFF_ROLES,
  'notifications.manage': ADMIN,
  'whatsapp.view': STAFF_ROLES,
  'whatsapp.send': [...SALES, 'support_executive'] as RoleKey[],
  'reports.view': ADMIN,
  'content.manage': SUPPORT,
  'team.manage': SUPER,
  'settings.manage': SUPER,
  'audit.view': SUPER,
} satisfies Record<string, RoleKey[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(roles: readonly string[], permission: Permission): boolean {
  const allowed: readonly string[] = PERMISSIONS[permission];
  return roles.some((r) => allowed.includes(r));
}

export function isStaff(roles: readonly string[]): boolean {
  return roles.some((r) => (STAFF_ROLES as string[]).includes(r));
}
