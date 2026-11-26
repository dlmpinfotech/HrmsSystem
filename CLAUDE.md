# CLAUDE.md

Sales/CRM/subscription platform for an existing HRMS product. React + Vite SPA, Netlify Functions, Supabase (Postgres + RLS). See README.md and docs/ARCHITECTURE.md.

## Commands
- `npm run dev` — frontend only · `npx netlify dev` — frontend + functions on :8888
- `npm run build` — type-check + build (must stay clean)
- `npm test` — Vitest unit + integration (real migrations in PGlite; ~20 s)
- `npm run test:e2e` — Playwright, public site, API mocked with `page.route`
- `npm run check:i18n` — translation key parity

## Rules that matter
- **Security lives in the database.** Any new table: enable RLS, add policies, add a test in `tests/integration/security.test.ts`. Never rely on UI hiding.
- Every new table with RLS also needs the restrictive `mfa_required` policy (see `0017_mfa.sql`); `tests/integration/mfa.test.ts` fails without it.
- Service-role client (`netlify/lib/supabase.ts`) only after `authenticate()` + permission check. Never import `netlify/` from `src/`. Browser env vars must be `VITE_`-prefixed and non-secret.
- Payments: never set `status = 'verified'` or invoice `paid` directly — use `verify_payment()`. Triggers enforce this.
- Validation: put schemas in `shared/schemas.ts` (used by forms and functions); error messages are i18n keys (`validation.*`).
- Every user-facing string goes through `t()`; add keys to **both** `en.json` and `ta.json` (test fails otherwise). Tamil text is longer — avoid `whitespace-nowrap` on long buttons.
- Times: store UTC, display with `lib/format.ts` (Asia/Kolkata). Demo availability is IST wall-clock.
- WhatsApp: click-to-chat via `shared/whatsapp.ts`; Cloud API sends only through `notify()` (consent + template + Settings switch). Do not add unofficial automation.
- Colours come from CSS variables (`globals.css`, `shared/branding.ts`); don't hard-code palette colours in components.
- Function endpoints: wrap with `defineHandler` (method, origin/CORS, rate limit, auth, zod body, safe errors) and set `config.path` under `/api/`.

## Migrations
Add a new numbered file in `supabase/migrations/` — never edit an applied one. The PGlite test harness (`tests/helpers/db.ts`) loads them all, so `npm test` validates SQL.
