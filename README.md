# HRMS Cloud — Sales & Customer Management Platform

A cloud platform for **marketing, selling, onboarding and managing subscriptions** for an existing HRMS product, built for businesses in Tirunelveli, Thoothukudi and Nagercoil and ready to expand across India. It is the sales and customer layer around the HRMS — not a replacement for it.

| Area | What it includes |
|---|---|
| Public website | Home, Features, Industry Solutions, Pricing, Demo Videos, Book Demo, Contact, Free Trial, About, FAQ, Privacy, Terms — SEO tags, sticky nav, mobile drawer, WhatsApp button, cookie consent + GA4 |
| Sales CRM | Leads table + drag-and-drop Kanban, filters/search, assignment, duplicate detection, notes & activity history, follow-up tasks with reminders, CSV export, lead → customer conversion |
| Demos | Public slot picker (IST display, UTC storage), salesperson availability, double-booking prevention in the database, confirmations, reminders, self-service reschedule/cancel link, outcomes & feedback |
| Customers | Tenant directory, company profile, contacts, onboarding checklist, activation/suspension, trial extension, users & invitations, support history |
| Subscriptions | Configurable plans, trials, renewals, cancellations, expiry handling, invoices (GST), manual payment recording with mandatory verification, Razorpay webhook architecture |
| Customer portal | Dashboard, "Open HRMS" link, company profile, branding studio, subscription, billing, support tickets, help center, product videos |
| Branding Studio | Logos (light/dark/favicon), brand colours, light/dark/system/custom themes, sidebar/nav/button/font/radius/compact/animation options, live desktop/tablet/mobile preview, Save/Cancel/Reset/Restore defaults |
| Communication | WhatsApp click-to-chat (free), official Meta WhatsApp Cloud API (webhook, signatures, templates, inbox, statuses, retries — **off by default**), transactional email (Resend/SendGrid/Brevo), templates in English & Tamil, delivery logs and retries |
| Insights | Admin dashboard KPIs & charts, 11 reports with filters and CSV export |
| Platform | 6 roles, Row Level Security on every table, audit log, rate limiting, spam protection, Tamil/English switching, responsive 320 px → 1440 px+, Motion animations respecting reduced-motion |

## Tech stack

React 18 · Vite · TypeScript · Tailwind CSS · shadcn-style components on Radix UI · Lucide · Motion · React Router · React Hook Form + Zod · TanStack Query · Recharts · i18next — Netlify Functions (TypeScript) — Supabase (Postgres, Auth, Storage, RLS) — Vitest, PGlite, Playwright.

## Project structure

```
src/
  app/               App shell, router, admin layout
  components/        ui/ (primitives) · layout/ (public + app shells) · shared/ (forms, tables, states, widgets)
  features/          marketing · auth · dashboard · crm · demos · customers · branding · subscriptions
                     notifications · whatsapp · support · analytics · portal · settings · content
  hooks/ i18n/locales/ lib/ styles/ types/
shared/              Code used by BOTH browser and functions: zod schemas, permissions, slots, branding, phone, WhatsApp links, templates
netlify/functions/   REST endpoints (/api/*) + hourly scheduled job
netlify/lib/         Auth, HTTP wrapper (CORS, validation, rate limit, safe errors), email, WhatsApp, notifications, Razorpay, Azure Blob
supabase/migrations/ Schema, functions/triggers, RLS, storage, reference data
supabase/seed/       First super-admin + default availability helpers
tests/               unit/ · integration/ (real migrations in PGlite + handler tests) · e2e/ (Playwright)
docs/                Deployment guide, architecture, production checklist
```

## Quick start (local)

Requirements: Node 20+ (22 recommended), a free Supabase project, and the Netlify CLI for running functions locally.

```bash
npm install
```

```bash
cp .env.example .env
```

1. **Database** — in the Supabase SQL editor run the files in `supabase/migrations/` in order (`0001` → `0005`), or use the Supabase CLI: `supabase db push`.
2. **Environment** — fill `.env` with `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (see below).
3. **First admin** — sign up through the app (`/free-trial` creates a customer; for staff create the user in Supabase → Authentication), then run the snippet in `supabase/seed/seed.sql` to grant `super_admin`. Invite the rest of the team from **Settings → Team**.
4. **Run** — frontend and functions together:

```bash
npx netlify dev
```

The site is served at http://localhost:8888 (Vite on 5173 is proxied, `/api/*` goes to the functions). `npm run dev` alone runs only the frontend; the public site still works with built-in fallback plans.

## Environment variables

| Variable | Where | Required | Purpose |
|---|---|---|---|
| `VITE_SUPABASE_URL` | browser | yes | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | browser | yes | Public anon key (all access constrained by RLS) |
| `VITE_BRAND_NAME`, `VITE_WHATSAPP_NUMBER`, `VITE_GA_MEASUREMENT_ID`, `VITE_SITE_URL` | browser | no | Fallbacks; the same values are editable in **Settings → General** |
| `SUPABASE_URL` | server | yes | Supabase URL for functions |
| `SUPABASE_SERVICE_ROLE_KEY` | server | yes | Service role — **functions only, never `VITE_`-prefixed** |
| `ALLOWED_ORIGINS` | server | no | Extra origins allowed to call `/api` (the site's own URL is always allowed) |
| `EMAIL_PROVIDER`, `EMAIL_FROM` | server | for email | `smtp` (free with Gmail) \| `resend` \| `sendgrid` \| `brevo` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | server | if `smtp` | Gmail: `smtp.gmail.com`, `465`, your address, a Google App Password |
| `EMAIL_API_KEY` | server | if API provider | Resend / SendGrid / Brevo API key |
| `META_WHATSAPP_ACCESS_TOKEN`, `META_WHATSAPP_PHONE_NUMBER_ID`, `META_WHATSAPP_BUSINESS_ACCOUNT_ID`, `META_WHATSAPP_VERIFY_TOKEN`, `META_APP_SECRET` | server | for Cloud API | Official WhatsApp Cloud API |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | server | optional | Online payments (webhook-verified) |
| `AZURE_STORAGE_ACCOUNT`, `AZURE_STORAGE_KEY`, `AZURE_STORAGE_CONTAINER` | server | optional | Large video uploads |
| `CRON_SECRET`, `IP_HASH_SALT` | server | optional | Trigger jobs externally · salt for hashed IPs |

Only `VITE_*` variables are compiled into the browser bundle.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Type-check + production build to `dist/` |
| `npm test` | Unit + integration tests (Vitest; runs the real migrations in an embedded Postgres) |
| `npm run test:e2e` | Playwright tests (desktop + mobile Chromium; run `npx playwright install chromium` once) |
| `npm run check:i18n` | Every used translation key exists, and Tamil matches English key-for-key |

## Roles

| Role | Can |
|---|---|
| Super Admin | Everything, including team, settings and audit log |
| Sales Admin | All leads, customers, plans, invoices and payment verification |
| Sales Executive | Own + unassigned leads, own demos |
| Support Executive | Support tickets, contacts, help content |
| Customer Admin | Their company: profile, branding, users, billing, tickets |
| Customer User | Their company: view, raise tickets, help, videos |

Permissions are enforced three times: route guards (UX), function checks (`shared/permissions.ts`) and Postgres RLS (authoritative).

## Payments policy

Payments are always recorded as **pending**. A database trigger blocks every path to `verified` except the `verify_payment()` function (called by an admin, or by the signed Razorpay webhook), which atomically marks the invoice paid and activates/extends the subscription. Partial payments never activate a subscription.

## WhatsApp policy

Click-to-chat uses official `wa.me` links; the visitor presses send. Automated Cloud API messages require: server credentials, an approved Meta template, recorded opt-in for that number, **and** the Settings switch (off by default). Meta may charge per conversation. Replying **STOP** records an opt-out. No unofficial automation is used.

## More documentation

- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — step-by-step Supabase + Netlify + integrations setup
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how the pieces fit, data model, security model
- [docs/PRODUCTION_CHECKLIST.md](docs/PRODUCTION_CHECKLIST.md) — go-live checklist
