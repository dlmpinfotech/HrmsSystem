# Production readiness checklist

## Must do before launch
- [ ] All five migrations applied to the production Supabase project
- [ ] Supabase Auth: Site URL + redirect URLs set; email confirmation on; custom SMTP configured
- [ ] Netlify env vars set; `SUPABASE_SERVICE_ROLE_KEY` only in Functions scope; no secret has a `VITE_` prefix
- [ ] `GET /api/health` shows `supabase: true`
- [ ] First Super Admin granted; staff invited with least-privilege roles
- [ ] Plan prices, limits and trial days reviewed (seeded values are placeholders)
- [ ] Settings → General: brand name, support phone/email, address, WhatsApp number, default HRMS URL
- [ ] Demo availability configured for each salesperson
- [ ] Email provider domain verified (SPF/DKIM) and a test email received in English and Tamil
- [ ] Privacy Policy and Terms reviewed by your legal advisor (templates are generic)
- [ ] Testimonials: only real, approved quotes (placeholders are clearly marked until then)
- [ ] Custom domain + HTTPS; `VITE_SITE_URL` and Supabase Site URL updated

## Verify end to end on the live site
- [ ] Contact form → lead in CRM, acknowledgement email sent
- [ ] Book demo → booking + confirmation; manage link reschedules and cancels
- [ ] Free trial → confirmation email → sign in → portal with onboarding checklist
- [ ] Branding: upload logo, change colours, save, sign out/in — branding persists; other tenant unaffected
- [ ] Record payment → stays pending → verify → invoice paid, subscription active, confirmation email
- [ ] Support ticket from portal → staff reply → customer notified
- [ ] Mobile (320–767 px), tablet, laptop, desktop; Tamil and English; light and dark

## Optional integrations
- [ ] WhatsApp Cloud API: credentials, webhook verified, templates approved, Settings switch on, test with an opted-in number
- [ ] Razorpay: keys + webhook secret; test-mode payment verified by webhook only
- [ ] Azure Blob container for videos
- [ ] GA4 measurement ID

## Operations
- [ ] Supabase daily backups enabled (Pro plan adds point-in-time recovery)
- [ ] Netlify deploy notifications / function error alerts
- [ ] Review **Notifications → Delivery log** weekly for failures
- [ ] Review **Settings → Audit log** for role and payment changes
- [ ] Rotate `SUPABASE_SERVICE_ROLE_KEY`, Meta and email keys if a team member with access leaves

## Known limitations (honest status)
- Integrations (email providers, Meta Cloud API, Razorpay, Azure Blob) are implemented against their documented HTTP APIs but were **not exercised against live accounts** in this repository; verify each after configuring credentials.
- Razorpay: order creation and signed-webhook verification exist; a checkout button in the portal is not wired yet.
- Calendar integration: bookings are stored with meeting links; Google/Outlook calendar sync is not implemented.
- Rate limiting is per IP hash in Postgres (adequate for forms; add Cloudflare/WAF for heavy abuse).
- Admin/portal screens are covered by type checks, database/RLS tests and handler tests; end-to-end browser tests cover the public site (signed-in flows need a Supabase test project).
