# Architecture

```
Browser (React SPA)
 ├─ reads/writes via supabase-js (anon key + user JWT) ──► Postgres (RLS on every table)
 └─ privileged/public actions via fetch('/api/…') ──────► Netlify Functions (service role) ──► Postgres
                                                                   ├─► Email provider (HTTPS)
Meta WhatsApp Cloud API ──signed webhook──► /api/whatsapp/webhook  ├─► Meta Graph API
Razorpay ──signed webhook──► /api/razorpay?webhook=1                └─► Razorpay / Azure Blob
Netlify scheduler ──hourly──► scheduled-jobs (reminders, lifecycle, retries)
```

## Why two data paths

- **Direct (supabase-js)** for ordinary CRUD a role is allowed to do (leads, tasks, branding, tickets list…). RLS is the only gate and is tested in `tests/integration/security.test.ts`.
- **Functions** for anything that must not be trusted to the browser: public forms (validation, honeypot, rate limit, duplicate merge, consent records), demo booking (slot must be one the server offers), trial signup (atomic tenant provisioning), payments, invitations/roles, notifications, webhooks.

## Tenancy

Each customer company is a row in `companies` with an immutable `tenant_code`. Users belong to tenants through `company_memberships`. Every tenant-owned table carries `company_id`; policies call `is_company_member()` / `is_company_admin()` (SECURITY DEFINER helpers, no recursion). Storage objects live under `branding/<company_id>/…` and storage policies parse the folder name. Triggers stop customers changing protected fields (`status`, `hrms_url`, `tenant_code`) and pin `support_messages.company_id` to the ticket's tenant.

## Key database rules

| Rule | Mechanism |
|---|---|
| No double-booked demos | partial unique index + overlap trigger on `demo_bookings` |
| One live subscription per tenant | partial unique index |
| Payments verified only by verification | `guard_payment_status` / `guard_invoice_status` triggers + `verify_payment()` |
| Lead history | `log_lead_change` trigger (creation, status, assignment) |
| Duplicate detection | normalised phone/email columns + `find_duplicate_leads()` |
| Invitations | `handle_new_user` applies pending invitations on sign-up |
| Audit | `audit_row_change` trigger on roles, memberships, companies, branding, plans, subscriptions, invoices, payments, settings, templates |
| Rate limiting | `check_rate_limit()` fixed window in `rate_limits` (service role only) |

## Time

All timestamps are `timestamptz` (UTC). Demo availability is stored as IST wall-clock per weekday; `shared/slots.ts` converts (IST is a fixed +05:30). The UI formats every date with `timeZone: 'Asia/Kolkata'`; `datetime-local` inputs are interpreted as IST.

## Branding

`company_branding` stores colours (validated `#RRGGBB`), appearance options and logo paths. `shared/branding.ts` converts it to CSS custom properties; the ThemeProvider writes them on `<html>` for the portal, and the Branding Studio writes the same variables onto the preview element — so the preview is the real styling. Uploads are type-sniffed from magic bytes (no SVG), ≤ 2 MB, and limited again by the bucket's MIME allowlist.

## Localisation

`src/i18n/locales/{en,ta}.json`. Zod error messages are i18n keys, so client and server validation share translations. `scripts/check-i18n.mjs` (run in tests) fails if a used key is missing or the locales drift. Adding a language = new JSON file + entry in `SUPPORTED_LANGUAGES` + the DB `language` check constraints + template rows.

## Notifications

`netlify/lib/notifications.ts` renders a stored template (language with English fallback), writes a `notification_logs` row (unique `dedupe_key` ⇒ idempotent), then delivers. Failures are retried with backoff (5 m, 30 m, 2 h, 12 h; max 5 attempts) by the hourly job or manually. WhatsApp sends require the Settings switch, credentials, an approved template name and recorded opt-in.
