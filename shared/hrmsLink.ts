/**
 * Where "Open HRMS" goes. The HRMS is part of this app, so customers need no website
 * of their own. Only a company that has its own HRMS address (set by platform staff
 * on the customer record) is sent there.
 */
export function hrmsTarget(companyUrl: string | null | undefined, isHr: boolean): { external: boolean; href: string } {
  const own = companyUrl?.trim() ?? '';
  // Only real web addresses leave the app (never "javascript:" and the like).
  if (/^https?:\/\//i.test(own)) return { external: true, href: own };
  return { external: false, href: isHr ? '/portal/hr' : '/portal/attendance' };
}
