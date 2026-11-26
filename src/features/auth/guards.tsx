import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { Permission } from '@shared/permissions';
import { useAuth } from './AuthProvider';
import { FullPageLoader } from '@/components/shared/states';

interface GuardProps {
  children: ReactNode;
  /** 'staff' = platform team area, 'customer' = tenant portal. */
  area: 'staff' | 'customer';
}

/** Blocks a whole area. The database enforces the same rule via RLS — this only routes. */
export function RequireArea({ children, area }: GuardProps) {
  const auth = useAuth();
  const location = useLocation();

  if (auth.loading) return <FullPageLoader />;
  if (!auth.session) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (auth.mfaPending) return <Navigate to="/mfa" replace state={{ from: location.pathname + location.search }} />;
  if (auth.homePath === '/choose-account') return <Navigate to="/choose-account" replace />;
  if (area === 'staff' && !auth.isStaff) return <Navigate to={auth.homePath} replace />;
  if (area === 'customer' && !auth.activeCompany) return <Navigate to={auth.homePath} replace />;
  return <>{children}</>;
}

/** Blocks a single page inside the staff area. */
export function RequirePermission({ children, permission }: { children: ReactNode; permission: Permission }) {
  const auth = useAuth();
  if (auth.loading) return <FullPageLoader />;
  if (!auth.can(permission)) return <Navigate to="/admin" replace />;
  return <>{children}</>;
}

/** Customer-admin-only pages inside the portal. */
export function RequireCompanyAdmin({ children }: { children: ReactNode }) {
  const auth = useAuth();
  if (auth.loading) return <FullPageLoader />;
  if (!auth.isCompanyAdmin) return <Navigate to="/portal" replace />;
  return <>{children}</>;
}

/** Portal pages that plain employees do not use (they land on Attendance). */
export function RequireNotEmployee({ children }: { children: ReactNode }) {
  const auth = useAuth();
  if (auth.loading) return <FullPageLoader />;
  if (auth.isEmployeeOnly) return <Navigate to="/portal/attendance" replace />;
  return <>{children}</>;
}

/** Company Admin or HR Manager pages inside the portal. */
export function RequireHr({ children }: { children: ReactNode }) {
  const auth = useAuth();
  if (auth.loading) return <FullPageLoader />;
  if (!auth.isHr) return <Navigate to="/portal" replace />;
  return <>{children}</>;
}

/** Sends signed-in users away from login/register screens. */
export function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const location = useLocation();
  if (auth.loading) return <FullPageLoader />;
  if (auth.session && auth.homePath !== '/login') {
    const from = (location.state as { from?: string } | null)?.from;
    const target = from && ((auth.isStaff && from.startsWith('/admin')) || (auth.activeCompany && from.startsWith('/portal'))) ? from : auth.homePath;
    return <Navigate to={target} replace />;
  }
  return <>{children}</>;
}
