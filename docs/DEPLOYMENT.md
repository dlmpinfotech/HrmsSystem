# Deployment guide

Everything below fits in the free tiers of Supabase and Netlify. Paid services (email beyond free quota, WhatsApp Cloud API conversations, Razorpay fees, Azure storage) are optional.

## 1. Supabase

1. Create a project at supabase.com (choose the **Mumbai (ap-south-1)** region for Indian users).
2. **SQL Editor** → run, in order:
   `supabase/migrations/0001_schema.sql`, `0002_functions.sql`, `0003_rls.sql`, `0004_storage.sql`, `0005_reference_data.sql`.
   (With the Supabase CLI: `supabase link --project-ref <ref>` then `supabase db push`.)
3. **Authentication → URL configuration**
   - Site URL: `https://<your-site>.netlify.app` (or your domain)
   - Redirect URLs: add `https://<your-site>/login`, `https://<your-site>/reset-password`
4. **Authentication → Providers → Email**: keep *Confirm email* **on** (recommended). Configure custom SMTP under *Auth → SMTP* for reliable delivery (the built-in sender is rate-limited).
5. **Authentication → Email templates**: optionally translate the confirmation / invite / reset emails.
6. **Project Settings → API**: copy the Project URL, `anon` key and `service_role` key.
7. Storage bucket `branding` is created by migration `0004` (public read, 2 MB limit, PNG/JPG/WebP/ICO only).

## 2. Netlify

1. Push the repository to GitHub and **Add new site → Import from Git**.
2. Build settings are read from `netlify.toml`: build `npm run build`, publish `dist`, functions `netlify/functions`, Node 22.
3. **Site configuration → Environment variables** — add (see README for the full table):

   | Scope | Variables |
   |---|---|
   | Builds + Functions | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SITE_URL` |
   | Functions only | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `IP_HASH_SALT` (any random string) |
   | Optional | `EMAIL_*`, `META_*`, `RAZORPAY_*`, `AZURE_*`, `CRON_SECRET`, `ALLOWED_ORIGINS` |

   Mark secrets as *secret* values. Never give a server variable a `VITE_` prefix.
4. Deploy. Check `https://<site>/api/health` — every integration shows `true`/`false` (values are never returned).
5. The hourly scheduled function `scheduled-jobs` runs automatically (Netlify → Functions → Scheduled). It sends demo/trial/renewal/follow-up reminders, applies trial expiry/past-due/cancellation rules and retries failed notifications.

## 3. First users

1. Create your own account in Supabase → Authentication → *Add user* (or invite).
2. Run in the SQL editor (replace the email):
   ```sql
   insert into public.user_roles (user_id, role_key)
   select id, 'super_admin' from public.profiles where lower(email) = lower('you@yourcompany.com')
   on conflict do nothing;
   ```
3. Sign in at `/login` → **Settings → General**: brand name, support phone/email, WhatsApp number, HRMS login URL, demo settings.
4. **Settings → Team**: invite sales admins, executives and support staff.
5. **Demos → Availability**: set each salesperson's weekly hours (or run the optional block in `supabase/seed/seed.sql`).
6. **Subscriptions → Plans**: review prices — the seeded prices are placeholders.

## 3b. Google and Microsoft sign-in (optional)

The sign-in page shows **Continue with Google** and **Continue with Microsoft**. Each works once switched on in Supabase; until then the button explains it is not set up. A person signs in with the provider account whose email matches their invitation / employee email — a social login with no invitation lands on "No access yet".

Supabase callback URL for both providers: `https://<project-ref>.supabase.co/auth/v1/callback`

**Google**
1. https://console.cloud.google.com → create/select a project → **APIs & Services → OAuth consent screen**: External, app name, support email, your domain; publish the app.
2. **Credentials → Create credentials → OAuth client ID** → *Web application*. Authorised redirect URI = the Supabase callback URL above. Copy the Client ID and Client secret.
3. Supabase → **Authentication → Sign In / Providers → Google** → enable, paste both values, save.

**Microsoft (Azure / Entra ID)**
1. https://portal.azure.com → **Microsoft Entra ID → App registrations → New registration**. Supported account types: *Accounts in any organizational directory and personal Microsoft accounts* (or your organisation only). Redirect URI (Web) = the Supabase callback URL.
2. **Certificates & secrets → New client secret** → copy the *Value*. Copy the *Application (client) ID* from Overview.
3. **API permissions**: make sure `email`, `openid`, `profile` (Microsoft Graph, delegated) are granted.
4. Supabase → **Authentication → Sign In / Providers → Azure** → enable, paste client ID and secret. Azure Tenant URL: leave `https://login.microsoftonline.com/common` for any account, or use your tenant ID to restrict to your organisation.

Finally, Supabase → **Authentication → URL Configuration → Redirect URLs** must include `http://localhost:8888/login` (local) and `https://<your-site>/login` (live).

## 4. Email

**Free option — Gmail SMTP (no domain needed, about 500 emails a day):**
1. Google Account → **Security** → turn on **2-Step Verification**.
2. Open https://myaccount.google.com/apppasswords → create an app password named "HRMS" → copy the 16 letters.
3. App emails: `EMAIL_PROVIDER=smtp`, `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_USER=you@gmail.com`, `SMTP_PASS=<app password>`, `EMAIL_FROM="Brand <you@gmail.com>"` (must be the same Gmail address).
4. Login emails: Supabase → Authentication → Emails → **SMTP Settings** → enable custom SMTP with the same host, port, username and app password; sender email = your Gmail address.

**Higher volume:** Resend, SendGrid or Brevo with your own verified domain — set `EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_FROM="Brand <no-reply@yourdomain.com>"`.

Test: **Notifications → Templates** → open a template → *Send test*.

## 5. WhatsApp

**Click-to-chat (free):** enter the business number in Settings. Done.

**Official Cloud API (optional, chargeable):**
1. Meta Business account → developers.facebook.com → create an app with the *WhatsApp* product.
2. Add and verify the business phone number; create a permanent **System User** token with `whatsapp_business_messaging`.
3. Set `META_WHATSAPP_ACCESS_TOKEN`, `META_WHATSAPP_PHONE_NUMBER_ID`, `META_WHATSAPP_BUSINESS_ACCOUNT_ID`, `META_WHATSAPP_VERIFY_TOKEN` (any random string you choose), `META_APP_SECRET` (App → Settings → Basic) and redeploy.
4. App → WhatsApp → Configuration → Webhook: callback `https://<site>/api/whatsapp/webhook`, the same verify token; subscribe to `messages`.
5. Create templates in WhatsApp Manager named as in **Notifications → Templates** (`demo_confirmation`, `demo_reminder`, `trial_activation`, `trial_expiring`, `subscription_renewal`, `payment_confirmation`, `support_ticket_update`) with body parameters in the order shown in each template. Wait for approval (per language).
6. **Settings → General → Automated messages via Cloud API**: switch on.

## 6. Razorpay (optional)

Set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`. In the Razorpay dashboard add a webhook to `https://<site>/api/razorpay?webhook=1` for `payment.captured`. Orders are created by `POST /api/razorpay`; a payment is verified **only** by the signed webhook and only if the captured amount matches. A checkout button in the portal is not yet wired — manual bank/UPI payments with admin verification work today.

## 7. Azure Blob (optional, large videos)

Set `AZURE_STORAGE_ACCOUNT`, `AZURE_STORAGE_KEY`, `AZURE_STORAGE_CONTAINER` (container with public blob read). `POST /api/videos/upload` returns a 30-minute write-only SAS URL. Paste the resulting blob URL into **Settings → Content → Videos** (provider *Azure Blob*). YouTube links work without any setup. Add your storage host to the CSP `media-src` (already allows `https:`).

## 8. Custom domain & analytics

- Netlify → Domain management → add domain; HTTPS is automatic. Update `VITE_SITE_URL` and the Supabase Site URL.
- GA4: put the measurement ID in **Settings → General**. It loads only after a visitor accepts analytics cookies.

## 9. Verify the deployment

```bash
curl https://<site>/api/health
```
Then: submit the contact form → lead appears in **Leads**; book a demo → appears in **Demos** and the email log; start a free trial → customer appears in **Customers** and can sign in to `/portal`.
