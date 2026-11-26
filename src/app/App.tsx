import { lazy, Suspense, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useRouteError } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Toaster } from 'sonner';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/primitives';
import { FullPageLoader } from '@/components/shared/states';
import { PublicLayout } from '@/components/layout/PublicLayout';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { RedirectIfAuthed, RequireArea, RequireCompanyAdmin, RequireHr, RequireNotEmployee, RequirePermission } from '@/features/auth/guards';
import { ThemeProvider, useTheme } from '@/features/branding/ThemeProvider';
import { SCHEMA_MISSING_CODES } from '@/lib/api';
import * as Marketing from '@/features/marketing/pages';

// Authenticated areas are code-split so the public website stays light.
const AuthPages = () => import('@/features/auth/pages');
const LoginPage = lazy(() => AuthPages().then((m) => ({ default: m.LoginPage })));
const ForgotPasswordPage = lazy(() => AuthPages().then((m) => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => AuthPages().then((m) => ({ default: m.ResetPasswordPage })));
const NoAccessPage = lazy(() => AuthPages().then((m) => ({ default: m.NoAccessPage })));
const ChooseAccountPage = lazy(() => AuthPages().then((m) => ({ default: m.ChooseAccountPage })));
const AdminLayout = lazy(() => import('./AdminLayout').then((m) => ({ default: m.AdminLayout })));
const DashboardPage = lazy(() => import('@/features/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const LeadsPage = lazy(() => import('@/features/crm/LeadsPage').then((m) => ({ default: m.LeadsPage })));
const LeadDetailPage = lazy(() => import('@/features/crm/LeadDetailPage').then((m) => ({ default: m.LeadDetailPage })));
const DemosPage = lazy(() => import('@/features/demos/DemosPage').then((m) => ({ default: m.DemosPage })));
const CustomersPage = lazy(() => import('@/features/customers/CustomersPage').then((m) => ({ default: m.CustomersPage })));
const CustomerDetailPage = lazy(() => import('@/features/customers/CustomersPage').then((m) => ({ default: m.CustomerDetailPage })));
const SubscriptionsPage = lazy(() => import('@/features/subscriptions/SubscriptionsPage').then((m) => ({ default: m.SubscriptionsPage })));
const AdminTicketsPage = lazy(() => import('@/features/support/TicketsPage').then((m) => ({ default: m.AdminTicketsPage })));
const PortalTicketsPage = lazy(() => import('@/features/support/TicketsPage').then((m) => ({ default: m.PortalTicketsPage })));
const TicketDetailPage = lazy(() => import('@/features/support/TicketsPage').then((m) => ({ default: m.TicketDetailPage })));
const NotificationsPage = lazy(() => import('@/features/notifications/NotificationsPage').then((m) => ({ default: m.NotificationsPage })));
const WhatsAppPage = lazy(() => import('@/features/whatsapp/WhatsAppPage').then((m) => ({ default: m.WhatsAppPage })));
const ReportsPage = lazy(() => import('@/features/analytics/ReportsPage').then((m) => ({ default: m.ReportsPage })));
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const Portal = () => import('@/features/portal/PortalPages');
const PortalLayout = lazy(() => Portal().then((m) => ({ default: m.PortalLayout })));
const PortalDashboardPage = lazy(() => Portal().then((m) => ({ default: m.PortalDashboardPage })));
const PortalCompanyPage = lazy(() => Portal().then((m) => ({ default: m.PortalCompanyPage })));
const PortalSubscriptionPage = lazy(() => Portal().then((m) => ({ default: m.PortalSubscriptionPage })));
const PortalBillingPage = lazy(() => Portal().then((m) => ({ default: m.PortalBillingPage })));
const HelpCenterPage = lazy(() => Portal().then((m) => ({ default: m.HelpCenterPage })));
const PortalVideosPage = lazy(() => Portal().then((m) => ({ default: m.PortalVideosPage })));
const PortalAddPersonPage = lazy(() => import('@/features/customers/people').then((m) => ({ default: m.PortalAddPersonPage })));
const AdminAddPersonPage = lazy(() => import('@/features/customers/people').then((m) => ({ default: m.AdminAddPersonPage })));
const HR = () => import('@/features/hr/EmployeesPages');
const EmployeesPage = lazy(() => HR().then((m) => ({ default: m.EmployeesPage })));
const EmployeeFormPage = lazy(() => HR().then((m) => ({ default: m.EmployeeFormPage })));
const ImportEmployeesPage = lazy(() => HR().then((m) => ({ default: m.ImportEmployeesPage })));
const Employee360Page = lazy(() => import('@/features/hr/Employee360Page').then((m) => ({ default: m.Employee360Page })));
const Att = () => import('@/features/hr/AttendancePages');
const AttendancePage = lazy(() => Att().then((m) => ({ default: m.AttendancePage })));
const RegularizePage = lazy(() => Att().then((m) => ({ default: m.RegularizePage })));
const Shifts = () => import('@/features/hr/ShiftsPages');
const ShiftsPage = lazy(() => Shifts().then((m) => ({ default: m.ShiftsPage })));
const ShiftFormPage = lazy(() => Shifts().then((m) => ({ default: m.ShiftFormPage })));
const RotationFormPage = lazy(() => Shifts().then((m) => ({ default: m.RotationFormPage })));
const AssignShiftsPage = lazy(() => Shifts().then((m) => ({ default: m.AssignShiftsPage })));
const CommandCenterPage = lazy(() => import('@/features/hr/CommandCenterPage').then((m) => ({ default: m.CommandCenterPage })));
const AttendanceCorrectPage = lazy(() => Att().then((m) => ({ default: m.AttendanceCorrectPage })));
const Leave = () => import('@/features/hr/LeavePages');
const LeavePage = lazy(() => Leave().then((m) => ({ default: m.LeavePage })));
const ApplyLeavePage = lazy(() => Leave().then((m) => ({ default: m.ApplyLeavePage })));
const Payroll = () => import('@/features/payroll/PayrollPages');
const PayrollPage = lazy(() => Payroll().then((m) => ({ default: m.PayrollPage })));
const PayslipPage = lazy(() => Payroll().then((m) => ({ default: m.PayslipPage })));
const MyPayslipsPage = lazy(() => Payroll().then((m) => ({ default: m.MyPayslipsPage })));
const MyDocumentsPage = lazy(() => import('@/features/documents/DocumentsPanel').then((m) => ({ default: m.MyDocumentsPage })));
const Helpdesk = () => import('@/features/helpdesk/HelpdeskPages');
const HelpdeskPage = lazy(() => Helpdesk().then((m) => ({ default: m.HelpdeskPage })));
const HrTicketPage = lazy(() => Helpdesk().then((m) => ({ default: m.HrTicketPage })));
const AssetsPage = lazy(() => import('@/features/assets/AssetsPages').then((m) => ({ default: m.AssetsPage })));
const WorkforcePage = lazy(() => import('@/features/hr/WorkforcePage').then((m) => ({ default: m.WorkforcePage })));
const MfaChallengePage = lazy(() => import('@/features/auth/mfa').then((m) => ({ default: m.MfaChallengePage })));
const SecurityPage = lazy(() => import('@/features/auth/mfa').then((m) => ({ default: m.SecurityPage })));
const BrandingStudioPage = lazy(() => import('@/features/branding/BrandingStudio').then((m) => ({ default: m.BrandingStudioPage })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (count, error) => count < 2 && !['42501', 'PGRST301', ...SCHEMA_MISSING_CODES].includes((error as { code?: string }).code ?? ''),
    },
  },
});

function RouteError() {
  const { t } = useTranslation();
  const error = useRouteError();
  console.error(error);
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-bold">{t('errors.pageCrashed')}</h1>
      <p className="max-w-md text-muted-foreground">{t('errors.pageCrashedBody')}</p>
      <Button onClick={() => window.location.reload()}>{t('common.reload')}</Button>
    </div>
  );
}

const S = ({ children }: { children: ReactNode }) => <Suspense fallback={<FullPageLoader />}>{children}</Suspense>;
const perm = (permission: Parameters<typeof RequirePermission>[0]['permission'], el: ReactNode) => <RequirePermission permission={permission}>{el}</RequirePermission>;

/** Providers that need router context (navigation inside auth/sign-out). */
function Root() {
  return (
    <AuthProvider>
      <S><Outlet /></S>
    </AuthProvider>
  );
}

const router = createBrowserRouter([
  {
    element: <Root />,
    errorElement: <RouteError />,
    children: [
      {
        element: <PublicLayout />,
        children: [
          { index: true, element: <Marketing.HomePage /> },
          { path: 'features', element: <Marketing.FeaturesPage /> },
          { path: 'solutions', element: <Marketing.SolutionsPage /> },
          { path: 'pricing', element: <Marketing.PricingPage /> },
          { path: 'videos', element: <Marketing.VideosPage /> },
          { path: 'book-demo', element: <Marketing.BookDemoPage /> },
          { path: 'demo/manage/:token', element: <Marketing.ManageDemoPage /> },
          { path: 'contact', element: <Marketing.ContactPage /> },
          { path: 'free-trial', element: <Marketing.FreeTrialPage /> },
          { path: 'about', element: <Marketing.AboutPage /> },
          { path: 'faq', element: <Marketing.FaqPage /> },
          { path: 'privacy', element: <Marketing.PrivacyPage /> },
          { path: 'terms', element: <Marketing.TermsPage /> },
          { path: '*', element: <Marketing.NotFoundPage /> },
        ],
      },
      { path: 'login', element: <RedirectIfAuthed><LoginPage /></RedirectIfAuthed> },
      { path: 'register', element: <Navigate to="/free-trial" replace /> },
      { path: 'forgot-password', element: <ForgotPasswordPage /> },
      { path: 'reset-password', element: <ResetPasswordPage /> },
      { path: 'no-access', element: <NoAccessPage /> },
      { path: 'choose-account', element: <ChooseAccountPage /> },
      { path: 'mfa', element: <MfaChallengePage /> },
      { path: 'security', element: <SecurityPage /> },
      {
        path: 'admin',
        element: <RequireArea area="staff"><AdminLayout /></RequireArea>,
        children: [
          { index: true, element: perm('dashboard.view', <DashboardPage />) },
          { path: 'leads', element: perm('leads.view', <LeadsPage />) },
          { path: 'leads/:id', element: perm('leads.view', <LeadDetailPage />) },
          { path: 'demos', element: perm('demos.view', <DemosPage />) },
          { path: 'customers', element: perm('customers.view', <CustomersPage />) },
          { path: 'customers/:id', element: perm('customers.view', <CustomerDetailPage />) },
          { path: 'customers/:id/users/new', element: perm('customers.manage', <AdminAddPersonPage />) },
          { path: 'subscriptions', element: perm('subscriptions.view', <SubscriptionsPage />) },
          { path: 'support', element: perm('support.view', <AdminTicketsPage />) },
          { path: 'support/:id', element: perm('support.view', <TicketDetailPage basePath="/admin/support" />) },
          { path: 'whatsapp', element: perm('whatsapp.view', <WhatsAppPage />) },
          { path: 'notifications', element: perm('notifications.view', <NotificationsPage />) },
          { path: 'reports', element: perm('reports.view', <ReportsPage />) },
          { path: 'settings', element: perm('dashboard.view', <SettingsPage />) },
          { path: '*', element: <Navigate to="/admin" replace /> },
        ],
      },
      {
        path: 'portal',
        element: <RequireArea area="customer"><PortalLayout /></RequireArea>,
        children: [
          { index: true, element: <RequireNotEmployee><PortalDashboardPage /></RequireNotEmployee> },
          { path: 'company', element: <RequireNotEmployee><PortalCompanyPage /></RequireNotEmployee> },
          { path: 'company/users/new', element: <RequireCompanyAdmin><PortalAddPersonPage /></RequireCompanyAdmin> },
          { path: 'branding', element: <RequireCompanyAdmin><BrandingStudioPage /></RequireCompanyAdmin> },
          { path: 'subscription', element: <RequireNotEmployee><PortalSubscriptionPage /></RequireNotEmployee> },
          { path: 'billing', element: <RequireCompanyAdmin><PortalBillingPage /></RequireCompanyAdmin> },
          { path: 'support', element: <RequireNotEmployee><PortalTicketsPage /></RequireNotEmployee> },
          { path: 'support/:id', element: <RequireNotEmployee><TicketDetailPage basePath="/portal/support" /></RequireNotEmployee> },
          { path: 'hr', element: <RequireHr><CommandCenterPage /></RequireHr> },
          { path: 'shifts', element: <RequireHr><ShiftsPage /></RequireHr> },
          { path: 'shifts/new', element: <RequireHr><ShiftFormPage /></RequireHr> },
          { path: 'shifts/rotations/new', element: <RequireHr><RotationFormPage /></RequireHr> },
          { path: 'shifts/assign', element: <RequireHr><AssignShiftsPage /></RequireHr> },
          { path: 'shifts/:id', element: <RequireHr><ShiftFormPage /></RequireHr> },
          { path: 'employees', element: <RequireHr><EmployeesPage /></RequireHr> },
          { path: 'employees/new', element: <RequireHr><EmployeeFormPage /></RequireHr> },
          { path: 'employees/import', element: <RequireHr><ImportEmployeesPage /></RequireHr> },
          { path: 'employees/:id', element: <RequireHr><Employee360Page /></RequireHr> },
          { path: 'employees/:id/edit', element: <RequireHr><EmployeeFormPage /></RequireHr> },
          { path: 'attendance', element: <AttendancePage /> },
          { path: 'attendance/regularize', element: <RegularizePage /> },
          { path: 'attendance/correct', element: <RequireHr><AttendanceCorrectPage /></RequireHr> },
          { path: 'leave', element: <LeavePage /> },
          { path: 'leave/apply', element: <ApplyLeavePage /> },
          { path: 'payroll', element: <RequireHr><PayrollPage /></RequireHr> },
          { path: 'payroll/payslips/:id', element: <RequireHr><PayslipPage back="hr" /></RequireHr> },
          { path: 'documents', element: <MyDocumentsPage /> },
          { path: 'assets', element: <RequireHr><AssetsPage /></RequireHr> },
          { path: 'analytics', element: <RequireHr><WorkforcePage /></RequireHr> },
          { path: 'helpdesk', element: <HelpdeskPage /> },
          { path: 'helpdesk/:id', element: <HrTicketPage /> },
          { path: 'payslips', element: <MyPayslipsPage /> },
          { path: 'payslips/:id', element: <PayslipPage back="mine" /> },
          { path: 'help', element: <HelpCenterPage /> },
          { path: 'videos', element: <PortalVideosPage /> },
          { path: '*', element: <Navigate to="/portal" replace /> },
        ],
      },
    ],
  },
]);

function ThemedToaster() {
  const { resolved } = useTheme();
  return <Toaster theme={resolved} position="top-center" richColors closeButton />;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <RouterProvider router={router} />
          <ThemedToaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
