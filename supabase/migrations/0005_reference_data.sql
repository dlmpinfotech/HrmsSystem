-- ════════════════════════════════════════════════════════════════════
-- 0005 — Reference data required for the app to run
-- (roles, default plans, settings, notification templates, help articles)
-- Plan prices are STARTING DEFAULTS — change them in Admin → Subscriptions → Plans.
-- ════════════════════════════════════════════════════════════════════

insert into public.roles (key, name, description, is_staff) values
  ('super_admin',       'Super Admin',       'Full platform access including users, settings and audit logs', true),
  ('sales_admin',       'Sales Admin',       'Manages the sales team, all leads, customers, plans and billing', true),
  ('sales_executive',   'Sales Executive',   'Works on assigned leads and demos', true),
  ('support_executive', 'Support Executive', 'Handles customer support tickets', true),
  ('customer_admin',    'Customer Admin',    'Administers one customer company in the portal', false),
  ('customer_user',     'Customer User',     'Member of a customer company', false)
on conflict (key) do update set name = excluded.name, description = excluded.description, is_staff = excluded.is_staff;

insert into public.plans (key, name, description, price_monthly, price_yearly, employee_limit, user_limit, trial_days, sort_order, is_featured, features) values
  ('starter', 'Starter', 'For small teams getting started with digital HR', 999, 9990, 25, 2, 14, 1, false,
   '[{"en":"Employee database","ta":"பணியாளர் தரவுத்தளம்"},{"en":"Attendance & leave","ta":"வருகைப் பதிவு & விடுப்பு"},{"en":"Basic payroll & payslips","ta":"அடிப்படை சம்பளப் பட்டியல் & சம்பளச் சீட்டு"},{"en":"Email support","ta":"மின்னஞ்சல் ஆதரவு"}]'::jsonb),
  ('business', 'Business', 'For growing businesses that need payroll compliance', 2499, 24990, 100, 5, 14, 2, true,
   '[{"en":"Everything in Starter","ta":"Starter-இல் உள்ள அனைத்தும்"},{"en":"PF, ESI & professional tax","ta":"PF, ESI & தொழில் வரி"},{"en":"Shift & overtime management","ta":"ஷிப்ட் & கூடுதல் நேர மேலாண்மை"},{"en":"Employee self-service app","ta":"பணியாளர் சுய சேவை செயலி"},{"en":"WhatsApp & phone support","ta":"WhatsApp & தொலைபேசி ஆதரவு"}]'::jsonb),
  ('growth', 'Growth', 'For multi-branch organisations', 4999, 49990, 300, 15, 14, 3, false,
   '[{"en":"Everything in Business","ta":"Business-இல் உள்ள அனைத்தும்"},{"en":"Multi-branch & departments","ta":"பல கிளைகள் & துறைகள்"},{"en":"Biometric device integration","ta":"பயோமெட்ரிக் சாதன இணைப்பு"},{"en":"Advanced reports & analytics","ta":"மேம்பட்ட அறிக்கைகள் & பகுப்பாய்வு"},{"en":"Priority support","ta":"முன்னுரிமை ஆதரவு"}]'::jsonb),
  ('enterprise', 'Enterprise', 'Custom rollout for large organisations', null, null, null, null, 30, 4, false,
   '[{"en":"Everything in Growth","ta":"Growth-இல் உள்ள அனைத்தும்"},{"en":"Unlimited employees","ta":"வரம்பற்ற பணியாளர்கள்"},{"en":"Custom workflows & integrations","ta":"தனிப்பயன் பணிப்பாய்வுகள் & இணைப்புகள்"},{"en":"Dedicated account manager","ta":"பிரத்யேக கணக்கு மேலாளர்"},{"en":"On-site onboarding","ta":"நேரடி செயலாக்க உதவி"}]'::jsonb)
on conflict (key) do nothing;

insert into public.app_settings (key, value, is_public) values
  ('brand',          '{"name":"HRMS Cloud","support_email":"","support_phone":"","address":"Tirunelveli, Tamil Nadu, India","hrms_login_url":""}'::jsonb, true),
  ('whatsapp',       '{"number":"","click_to_chat_enabled":true}'::jsonb, true),
  ('demo',           '{"min_lead_hours":4,"max_days_ahead":21,"default_meeting_url":""}'::jsonb, true),
  ('analytics',      '{"ga4_measurement_id":""}'::jsonb, true),
  ('testimonials',   '[]'::jsonb, true),
  -- Chargeable WhatsApp Cloud API messaging is OFF until a Super Admin enables it.
  ('whatsapp_cloud', '{"enabled":false,"default_language":"en"}'::jsonb, false),
  ('email',          '{"enabled":true}'::jsonb, false)
on conflict (key) do nothing;

-- ── Notification templates ──────────────────────────────────────────
-- Placeholders use {{variable}}. For WhatsApp, `variables` order = body parameter order
-- ({{1}}, {{2}}, …) of the template approved in Meta Business Manager.
insert into public.notification_templates (key, channel, language, name, subject, body, whatsapp_template_name, variables) values
  ('lead_acknowledgement', 'email', 'en', 'Enquiry received',
   'We received your enquiry — {{brand}}',
   E'Hi {{name}},\n\nThank you for your interest in {{brand}}. Our team will contact you shortly.\n\nIf you would like to see the product right away, book a free demo: {{demo_url}}\n\nRegards,\n{{brand}} Team',
   null, '{name,brand,demo_url}'),
  ('lead_acknowledgement', 'email', 'ta', 'விசாரணை பெறப்பட்டது',
   'உங்கள் விசாரணை பெறப்பட்டது — {{brand}}',
   E'வணக்கம் {{name}},\n\n{{brand}} மீது ஆர்வம் காட்டியதற்கு நன்றி. எங்கள் குழு விரைவில் உங்களைத் தொடர்பு கொள்ளும்.\n\nஉடனடியாக தயாரிப்பைப் பார்க்க இலவச டெமோவை முன்பதிவு செய்யுங்கள்: {{demo_url}}\n\nநன்றி,\n{{brand}} குழு',
   null, '{name,brand,demo_url}'),

  ('demo_confirmation', 'email', 'en', 'Demo confirmation',
   'Your demo is confirmed for {{date}} at {{time}}',
   E'Hi {{name}},\n\nYour {{brand}} demo for {{company}} is confirmed.\n\nDate: {{date}}\nTime: {{time}} (IST)\nMode: {{mode}}\n{{meeting_line}}\n\nNeed to change the time? Reschedule or cancel here: {{manage_url}}\n\nRegards,\n{{brand}} Team',
   null, '{name,brand,company,date,time,mode,meeting_line,manage_url}'),
  ('demo_confirmation', 'email', 'ta', 'டெமோ உறுதிப்படுத்தல்',
   'உங்கள் டெமோ {{date}} அன்று {{time}} மணிக்கு உறுதி செய்யப்பட்டது',
   E'வணக்கம் {{name}},\n\n{{company}} நிறுவனத்திற்கான {{brand}} டெமோ உறுதி செய்யப்பட்டது.\n\nதேதி: {{date}}\nநேரம்: {{time}} (IST)\nமுறை: {{mode}}\n{{meeting_line}}\n\nநேரத்தை மாற்ற வேண்டுமா? இங்கே மாற்றலாம் அல்லது ரத்து செய்யலாம்: {{manage_url}}\n\nநன்றி,\n{{brand}} குழு',
   null, '{name,brand,company,date,time,mode,meeting_line,manage_url}'),
  ('demo_confirmation', 'whatsapp', 'en', 'Demo confirmation (WhatsApp)', null,
   'Hi {{name}}, your {{brand}} demo is confirmed for {{date}} at {{time}} IST. Manage your booking: {{manage_url}}',
   'demo_confirmation', '{name,brand,date,time,manage_url}'),
  ('demo_confirmation', 'whatsapp', 'ta', 'டெமோ உறுதிப்படுத்தல் (WhatsApp)', null,
   'வணக்கம் {{name}}, உங்கள் {{brand}} டெமோ {{date}} அன்று {{time}} IST மணிக்கு உறுதி செய்யப்பட்டது. முன்பதிவை நிர்வகிக்க: {{manage_url}}',
   'demo_confirmation', '{name,brand,date,time,manage_url}'),

  ('demo_reminder', 'email', 'en', 'Demo reminder',
   'Reminder: your demo is {{when}}',
   E'Hi {{name}},\n\nThis is a reminder for your {{brand}} demo.\n\nDate: {{date}}\nTime: {{time}} (IST)\n{{meeting_line}}\n\nReschedule or cancel: {{manage_url}}\n\nRegards,\n{{brand}} Team',
   null, '{name,brand,when,date,time,meeting_line,manage_url}'),
  ('demo_reminder', 'email', 'ta', 'டெமோ நினைவூட்டல்',
   'நினைவூட்டல்: உங்கள் டெமோ {{when}}',
   E'வணக்கம் {{name}},\n\nஉங்கள் {{brand}} டெமோவிற்கான நினைவூட்டல்.\n\nதேதி: {{date}}\nநேரம்: {{time}} (IST)\n{{meeting_line}}\n\nமாற்ற அல்லது ரத்து செய்ய: {{manage_url}}\n\nநன்றி,\n{{brand}} குழு',
   null, '{name,brand,when,date,time,meeting_line,manage_url}'),
  ('demo_reminder', 'whatsapp', 'en', 'Demo reminder (WhatsApp)', null,
   'Hi {{name}}, a reminder that your {{brand}} demo is on {{date}} at {{time}} IST.',
   'demo_reminder', '{name,brand,date,time}'),
  ('demo_reminder', 'whatsapp', 'ta', 'டெமோ நினைவூட்டல் (WhatsApp)', null,
   'வணக்கம் {{name}}, உங்கள் {{brand}} டெமோ {{date}} அன்று {{time}} IST மணிக்கு நடைபெறும் என்பதை நினைவூட்டுகிறோம்.',
   'demo_reminder', '{name,brand,date,time}'),

  ('demo_rescheduled', 'email', 'en', 'Demo rescheduled',
   'Your demo has been moved to {{date}} at {{time}}',
   E'Hi {{name}},\n\nYour {{brand}} demo has been rescheduled.\n\nNew date: {{date}}\nNew time: {{time}} (IST)\n{{meeting_line}}\n\nManage your booking: {{manage_url}}\n\nRegards,\n{{brand}} Team',
   null, '{name,brand,date,time,meeting_line,manage_url}'),
  ('demo_rescheduled', 'email', 'ta', 'டெமோ நேரம் மாற்றப்பட்டது',
   'உங்கள் டெமோ {{date}} அன்று {{time}} மணிக்கு மாற்றப்பட்டது',
   E'வணக்கம் {{name}},\n\nஉங்கள் {{brand}} டெமோ நேரம் மாற்றப்பட்டுள்ளது.\n\nபுதிய தேதி: {{date}}\nபுதிய நேரம்: {{time}} (IST)\n{{meeting_line}}\n\nமுன்பதிவை நிர்வகிக்க: {{manage_url}}\n\nநன்றி,\n{{brand}} குழு',
   null, '{name,brand,date,time,meeting_line,manage_url}'),

  ('demo_cancelled', 'email', 'en', 'Demo cancelled',
   'Your demo on {{date}} has been cancelled',
   E'Hi {{name}},\n\nYour {{brand}} demo scheduled for {{date}} at {{time}} (IST) has been cancelled.\n\nYou can book a new time whenever it suits you: {{demo_url}}\n\nRegards,\n{{brand}} Team',
   null, '{name,brand,date,time,demo_url}'),
  ('demo_cancelled', 'email', 'ta', 'டெமோ ரத்து செய்யப்பட்டது',
   '{{date}} அன்றைய உங்கள் டெமோ ரத்து செய்யப்பட்டது',
   E'வணக்கம் {{name}},\n\n{{date}} அன்று {{time}} (IST) மணிக்கு திட்டமிடப்பட்ட உங்கள் {{brand}} டெமோ ரத்து செய்யப்பட்டது.\n\nஉங்களுக்கு வசதியான நேரத்தில் மீண்டும் முன்பதிவு செய்யலாம்: {{demo_url}}\n\nநன்றி,\n{{brand}} குழு',
   null, '{name,brand,date,time,demo_url}'),

  ('trial_activation', 'email', 'en', 'Trial activated',
   'Your {{brand}} free trial is active',
   E'Hi {{name}},\n\nWelcome! The free trial for {{company}} is now active on the {{plan}} plan until {{trial_end}}.\n\nSign in to your customer portal: {{portal_url}}\n\nRegards,\n{{brand}} Team',
   null, '{name,brand,company,plan,trial_end,portal_url}'),
  ('trial_activation', 'email', 'ta', 'இலவச சோதனை தொடங்கியது',
   'உங்கள் {{brand}} இலவச சோதனை தொடங்கியது',
   E'வணக்கம் {{name}},\n\nவரவேற்கிறோம்! {{company}} நிறுவனத்திற்கான இலவச சோதனை {{plan}} திட்டத்தில் {{trial_end}} வரை செயலில் உள்ளது.\n\nவாடிக்கையாளர் போர்ட்டலில் உள்நுழையுங்கள்: {{portal_url}}\n\nநன்றி,\n{{brand}} குழு',
   null, '{name,brand,company,plan,trial_end,portal_url}'),
  ('trial_activation', 'whatsapp', 'en', 'Trial activated (WhatsApp)', null,
   'Hi {{name}}, your {{brand}} free trial for {{company}} is active until {{trial_end}}.',
   'trial_activation', '{name,brand,company,trial_end}'),

  ('trial_expiring', 'email', 'en', 'Trial expiring',
   'Your free trial ends on {{trial_end}}',
   E'Hi {{name}},\n\nThe {{brand}} free trial for {{company}} ends on {{trial_end}}.\n\nTo continue without interruption, choose a plan in your portal: {{portal_url}}\n\nRegards,\n{{brand}} Team',
   null, '{name,brand,company,trial_end,portal_url}'),
  ('trial_expiring', 'email', 'ta', 'இலவச சோதனை முடிவடைகிறது',
   'உங்கள் இலவச சோதனை {{trial_end}} அன்று முடிவடைகிறது',
   E'வணக்கம் {{name}},\n\n{{company}} நிறுவனத்திற்கான {{brand}} இலவச சோதனை {{trial_end}} அன்று முடிவடைகிறது.\n\nதடையின்றி தொடர, போர்ட்டலில் ஒரு திட்டத்தைத் தேர்ந்தெடுக்கவும்: {{portal_url}}\n\nநன்றி,\n{{brand}} குழு',
   null, '{name,brand,company,trial_end,portal_url}'),
  ('trial_expiring', 'whatsapp', 'en', 'Trial expiring (WhatsApp)', null,
   'Hi {{name}}, your {{brand}} free trial for {{company}} ends on {{trial_end}}.',
   'trial_expiring', '{name,brand,company,trial_end}'),

  ('subscription_renewal', 'email', 'en', 'Subscription renewal',
   'Your {{plan}} subscription renews on {{renewal_date}}',
   E'Hi {{name}},\n\nThe {{plan}} subscription for {{company}} is due for renewal on {{renewal_date}}.\nAmount: {{amount}}\n\nView details in your portal: {{portal_url}}\n\nRegards,\n{{brand}} Team',
   null, '{name,brand,company,plan,renewal_date,amount,portal_url}'),
  ('subscription_renewal', 'email', 'ta', 'சந்தா புதுப்பிப்பு',
   'உங்கள் {{plan}} சந்தா {{renewal_date}} அன்று புதுப்பிக்கப்பட வேண்டும்',
   E'வணக்கம் {{name}},\n\n{{company}} நிறுவனத்தின் {{plan}} சந்தா {{renewal_date}} அன்று புதுப்பிக்கப்பட வேண்டும்.\nதொகை: {{amount}}\n\nவிவரங்களை போர்ட்டலில் பார்க்கவும்: {{portal_url}}\n\nநன்றி,\n{{brand}} குழு',
   null, '{name,brand,company,plan,renewal_date,amount,portal_url}'),
  ('subscription_renewal', 'whatsapp', 'en', 'Subscription renewal (WhatsApp)', null,
   'Hi {{name}}, the {{plan}} subscription for {{company}} is due for renewal on {{renewal_date}}.',
   'subscription_renewal', '{name,plan,company,renewal_date}'),

  ('payment_confirmation', 'email', 'en', 'Payment confirmation',
   'Payment received — {{invoice_number}}',
   E'Hi {{name}},\n\nWe have received and verified your payment of {{amount}} for {{company}}.\nInvoice: {{invoice_number}}\n\nThank you for choosing {{brand}}.\n\nRegards,\n{{brand}} Team',
   null, '{name,brand,company,amount,invoice_number}'),
  ('payment_confirmation', 'email', 'ta', 'பணம் பெறப்பட்டது',
   'பணம் பெறப்பட்டது — {{invoice_number}}',
   E'வணக்கம் {{name}},\n\n{{company}} நிறுவனத்திற்கான {{amount}} தொகை பெறப்பட்டு சரிபார்க்கப்பட்டது.\nவிலைப்பட்டியல்: {{invoice_number}}\n\n{{brand}}-ஐத் தேர்ந்தெடுத்ததற்கு நன்றி.\n\nநன்றி,\n{{brand}} குழு',
   null, '{name,brand,company,amount,invoice_number}'),
  ('payment_confirmation', 'whatsapp', 'en', 'Payment confirmation (WhatsApp)', null,
   'Hi {{name}}, we received your payment of {{amount}} for invoice {{invoice_number}}. Thank you!',
   'payment_confirmation', '{name,amount,invoice_number}'),

  ('support_ticket_update', 'email', 'en', 'Support ticket update',
   '[{{ticket_number}}] {{ticket_subject}} — {{status}}',
   E'Hi {{name}},\n\nThere is an update on your support ticket {{ticket_number}}: {{ticket_subject}}\nStatus: {{status}}\n\n{{message}}\n\nView the ticket: {{portal_url}}\n\nRegards,\n{{brand}} Support',
   null, '{name,brand,ticket_number,ticket_subject,status,message,portal_url}'),
  ('support_ticket_update', 'email', 'ta', 'ஆதரவு டிக்கெட் புதுப்பிப்பு',
   '[{{ticket_number}}] {{ticket_subject}} — {{status}}',
   E'வணக்கம் {{name}},\n\nஉங்கள் ஆதரவு டிக்கெட் {{ticket_number}} புதுப்பிக்கப்பட்டுள்ளது: {{ticket_subject}}\nநிலை: {{status}}\n\n{{message}}\n\nடிக்கெட்டைப் பார்க்க: {{portal_url}}\n\nநன்றி,\n{{brand}} ஆதரவுக் குழு',
   null, '{name,brand,ticket_number,ticket_subject,status,message,portal_url}'),
  ('support_ticket_update', 'whatsapp', 'en', 'Support ticket update (WhatsApp)', null,
   'Hi {{name}}, your support ticket {{ticket_number}} has been updated. Status: {{status}}.',
   'support_ticket_update', '{name,ticket_number,status}'),

  ('follow_up_reminder', 'email', 'en', 'Follow-up reminder (internal)',
   'Follow-up due: {{company}}',
   E'Hi {{name}},\n\nA follow-up is due for {{company}} ({{contact}}, {{phone}}).\nDue: {{due}}\n\nOpen the lead: {{lead_url}}',
   null, '{name,company,contact,phone,due,lead_url}')
on conflict (key, channel, language) do nothing;

-- ── Starter help articles (editable in Admin → Help Center) ─────────
insert into public.help_articles (slug, category, title, title_ta, body, body_ta, sort_order) values
  ('getting-started', 'getting_started', 'Getting started with your account', 'உங்கள் கணக்கைத் தொடங்குதல்',
   E'1. Sign in to the customer portal with the email you registered.\n2. Open Company Profile and complete your company details.\n3. Open Branding to upload your logo and choose your colours.\n4. Follow the onboarding checklist on your dashboard.\n5. Use the "Open HRMS" button to launch the HRMS application once your account is activated.',
   E'1. பதிவு செய்த மின்னஞ்சலுடன் வாடிக்கையாளர் போர்ட்டலில் உள்நுழையவும்.\n2. நிறுவன விவரம் பக்கத்தில் உங்கள் நிறுவன விவரங்களை நிரப்பவும்.\n3. பிராண்டிங் பக்கத்தில் லோகோவை பதிவேற்றி நிறங்களைத் தேர்ந்தெடுக்கவும்.\n4. டாஷ்போர்டில் உள்ள செயலாக்கப் பட்டியலைப் பின்பற்றவும்.\n5. கணக்கு செயல்படுத்தப்பட்டதும் "HRMS திற" பொத்தானைப் பயன்படுத்தவும்.', 1),
  ('billing-and-payments', 'billing', 'How billing and payments work', 'பில்லிங் மற்றும் பணம் செலுத்துதல்',
   E'Invoices appear under Billing in your portal. You can pay by bank transfer or UPI and share the reference with our team. A payment is shown as "Verified" only after our accounts team confirms it has been received.',
   E'விலைப்பட்டியல்கள் போர்ட்டலின் பில்லிங் பகுதியில் தோன்றும். வங்கி பரிமாற்றம் அல்லது UPI மூலம் செலுத்தி குறிப்பு எண்ணை எங்கள் குழுவுடன் பகிரலாம். எங்கள் கணக்குக் குழு பணம் பெறப்பட்டதை உறுதிசெய்த பிறகே "சரிபார்க்கப்பட்டது" எனக் காட்டப்படும்.', 2),
  ('raise-support-ticket', 'support', 'Raising a support ticket', 'ஆதரவு டிக்கெட் எழுப்புதல்',
   E'Go to Support → New ticket, choose a category and describe the issue. You will be notified when our team replies, and you can continue the conversation inside the ticket.',
   E'ஆதரவு → புதிய டிக்கெட் பக்கத்திற்குச் சென்று வகையைத் தேர்ந்தெடுத்து சிக்கலை விவரிக்கவும். எங்கள் குழு பதிலளிக்கும்போது உங்களுக்கு அறிவிக்கப்படும்; டிக்கெட்டிலேயே உரையாடலைத் தொடரலாம்.', 3)
on conflict (slug) do nothing;
