# HRMS upgrade roadmap

Status of the enterprise HRMS upgrade. The plan extends the existing app (React + Vite, Netlify Functions, Supabase Postgres + RLS). It does not replace it.

## 1. Existing project analysis

| Existing module | Current features | Missing advanced features | Priority | Technical impact |
|---|---|---|---|---|
| Auth & tenancy | Supabase Auth, email/password, Google/Microsoft buttons, invitations via Gmail, roles (`customer_admin`, `hr_manager`, `customer_user`, `employee`), RLS with `is_company_hr` / `is_my_employee` | MFA, reporting-manager scope, delegated approvers, session list | P1 (manager scope) / P4 (MFA) | New helper `is_manager_of`; policies extended, never loosened |
| Employees | CRUD, CSV import/export, auto codes, login linking, plan employee limit, one fixed shift per employee | Reporting manager, contract / probation dates, 360° profile, timeline, documents, assets | P1 | New columns on `employees`; new 360° page reusing existing hooks |
| Attendance | Server-clock check-in/out, geolocation, late via shift + grace, half-day rule, HR corrections, daily register, monthly report | Shift templates, weekly rotation, overnight shifts, breaks, WFH/WFO, early leave, overtime, missing-punch detection, regularization workflow, employee + date-range search | **P1 (this increment)** | `attendance_before` and `clock_attendance` rewritten (same table, extra columns); old rows still valid |
| Leave | Types + quotas, holidays, working-day calc, overlap / balance checks, apply / approve / cancel | Hourly leave & permissions, comp-off, accrual, carry-forward, encashment, multi-level / delegated approval, team calendar, escalation | P1 (next increment) | Extends `leave_types` / `leave_requests`; new `leave_policies` |
| HR dashboard | None (portal dashboard shows subscription & tickets only) | Command center KPIs, Requires Attention queue with assign / snooze / resolve / escalate | **P1 (this increment)** | New SQL function `hr_attention()` + `hr_alert_states` table |
| Support (platform) | Tickets between customer and platform staff | Internal HR helpdesk for employees, knowledge base for employees, SLA | P2 | New tables; current `support_tickets` stays for vendor support |
| Notifications | Email + WhatsApp templates, consent, scheduled retries | HR events (approvals, reminders, escalations) | P2 | Reuse `notify()` and `scheduled-jobs` |
| Workflows | Hard-coded single-step approvals (leave) | Configurable multi-step workflows, SLA engine | P2 | New `workflow_*` tables; leave / regularization become first consumers |
| Documents | Branding storage bucket only | Employee documents, expiry, versions, approvals | P2 | New private storage bucket + RLS |
| Payroll | None | Salary structures, PF / ESI / PT rules, LOP from attendance, payslips, email | P3 | New tables; reads attendance & leave |
| Analytics | Platform sales reports (Recharts) | Workforce analytics, forecasts with confidence | P3 | Reuse chart components |
| AI copilot | None | Natural-language HR questions with server-side permission checks | P3 | Netlify function + tool calls over RLS-scoped queries; no personal data leaves without consent |

Reusable building blocks: `DataTable`, `PageHeader`, `QueryState` / `EmptyState`, `RadioGroupField`, `StatusBadge`, `ConfirmDialog`, `useInvalidateHr`, `defineHandler`, `notify()`, `audit_row_change()` trigger, PGlite test harness.

## 2. Architecture plan

- **Database first.** Every rule that matters (who can approve, shift resolution, late / overtime maths, alert detection) lives in Postgres functions and triggers, protected by RLS. The browser computes the same values only for previews; `shared/hr.ts` mirrors the SQL and both are tested.
- **Tenant isolation.** Every new table carries `company_id`, is filled by trigger from the parent row (never trusted from the client), and has RLS that uses `is_company_hr()` / `is_my_employee()`.
- **Component structure.** `src/features/hr/<area>Pages.tsx` per module, shared hooks in `src/features/hr/api.ts`, pure logic in `shared/hr.ts`.
- **Migrations.** New numbered files only (`0008_attendance_intelligence.sql` onwards). They only add things, so existing rows keep working.
- **Background work.** The hourly `scheduled-jobs` function will send reminders and escalations (P2), always through `notify()`.

### Risks

| Risk | Mitigation |
|---|---|
| Rewriting `attendance_before` changes late-minute maths for existing rows | Without a shift assignment, the employee's own `shift_start` / `shift_end` / grace is used, so existing rows give the same result |
| Overnight shifts cross the IST date line | Check-out finds yesterday's open record; check-in shortly before a midnight shift is dated to the shift day; covered by tests |
| `clock_attendance` signature change | Old 3-argument function dropped and recreated with an optional 4th argument; existing callers use named args |
| Alert queries on large companies | Limited to recent windows (30 days) and indexed columns |

## 3. Delivery order and status

| Phase | Increment | Status |
|---|---|---|
| P1 | Attendance intelligence: shifts, weekly rotation, overnight, breaks, WFH/WFO, early leave, overtime, regularization requests, search by employee + date range | Done in increment 1 (DB + UI: `/portal/attendance` tabs Search / Correction requests, `/portal/attendance/regularize`, `/portal/shifts`) |
| P1 | HR Command Center: KPIs, department distribution, 14-day trend, joiners vs exits, Requires Attention (assign / snooze / resolve / escalate) | Done in increment 1 (`/portal/hr`) |
| P1 | Employee 360° (reporting manager, contract dates, timeline, attendance / leave summary) | Done in increment 2 (`/portal/employees/:id`: profile header, KPIs, 12-week heatmap, team, leave balance, timeline; edit moved to `/portal/employees/:id/edit`) |

**Going live with increment 5:** run `0014`–`0018` in order in the Supabase SQL editor before deploying.

**Going live with increment 4:** run `0012_leave_encashment.sql` and `0013_payroll_today.sql` before deploying.

**Going live with increment 3:** run `0010_employee_email_relink.sql` and `0011_payroll.sql` in the Supabase SQL editor before deploying.

**Going live with increment 2:** run `supabase/migrations/0009_leave_automation.sql` in the Supabase SQL editor before deploying. Until then the Leave page shows load errors.

**Going live with increment 1:** run `supabase/migrations/0008_attendance_intelligence.sql` in the Supabase SQL editor before deploying the new frontend. Until then the new pages show load errors, and check-in keeps working through the old function.

### Completion report — increment 1

| Module | Enhancement | Files | Backend | Tests | Status |
|---|---|---|---|---|---|
| Attendance | Work mode, breaks, early / overtime, overnight-aware check-out, register columns | `src/features/hr/AttendancePages.tsx` | `clock_attendance`, `attendance_before` (0008) | `attendance-intelligence.test.ts` | Done |
| Attendance | Search by employee + date range + status, CSV export | `AttendancePages.tsx` | existing RLS | type-checked, build | Done |
| Attendance | Correction requests (employee page, HR queue, approve / reject) | `AttendancePages.tsx` | `attendance_regularizations` + triggers | integration tests | Done |
| Shifts | Templates, weekly rotations, assignments, weekly roster with one-day overrides | `src/features/hr/ShiftsPages.tsx` | `shifts`, `shift_rotations`, `shift_assignments`, `shift_overrides`, `employee_shift_on` | unit + integration | Done |
| HR overview | KPIs, charts, Requires Attention with saved filters | `src/features/hr/CommandCenterPage.tsx` | `hr_attention`, `hr_alert_states` | integration | Done |
| Employees | Reporting manager, work location, probation / contract end | `EmployeesPages.tsx` | columns + `employees_manager_check` | integration | Done |
| Notifications for alerts / escalations | Email when escalated, daily digest | — | `scheduled-jobs` + `notify()` | — | Future (P2) |
| P1 | Leave automation: hourly permissions, comp-off, accrual, carry-forward, team calendar, multi-level approval | Done in increment 2 (`0009_leave_automation.sql`; Leave page tabs Team approvals / Team calendar, Rules dialog per leave type, comp-off credits). Encashment (`0012`) and approval reminders / escalations (hourly job: digest after 24 h, admins after 72 h) added in increment 4 |
| P2 | Employee documents | Done in increment 5 (`0014`; private bucket, approval, versions, expiry alerts; Documents tab on the profile and `/portal/documents`) |
| P2 | HR helpdesk + staff help articles | Done in increment 5 (`0015`; `/portal/helpdesk`, answer-by times, internal notes, overdue tickets in the daily reminder) |
| P2 | Company assets | Done in increment 5 (`0016`; `/portal/assets`) |
| P2 | Approval delegation and time limits | Done in increment 5 (`0016`). A fully configurable multi-step workflow builder is not built; leave keeps one or two levels |
| P3 | Payroll (PF / ESI / PT, payslips, email to all or selected) | Done in increment 3 (`0011_payroll.sql`; `/portal/payroll` run / structures / statutory settings, `/portal/payslips` for employees, `/api/payroll` emails payslips over SMTP) |
| P3 | Workforce analytics | Done in increment 5 (`/portal/analytics`). Forecasting not built |
| P3 | AI copilot | Not built: needs an AI provider API key and a decision on what data may be sent to it |
| P4 | Two-step sign-in (MFA), sign out other devices | Done in increment 5 (`0017`; enforced by RLS and server functions; `/security`, `/mfa`). New tables must add the `mfa_required` policy |
| P4 | Integrations, forecasting, performance tuning | Not built: integrations need the list of systems |
