-- ════════════════════════════════════════════════════════════════════
-- Seed helpers (run manually in the Supabase SQL editor)
-- ════════════════════════════════════════════════════════════════════

-- 1) FIRST SUPER ADMIN
--    Create the user in Supabase Dashboard → Authentication → Users (or sign up in the app),
--    then run this with their email:
--
--    insert into public.user_roles (user_id, role_key)
--    select id, 'super_admin' from public.profiles where lower(email) = lower('you@yourcompany.com')
--    on conflict do nothing;

-- 2) OPTIONAL: default demo availability for every sales user
--    (Mon–Sat, 10:00–13:00 and 14:00–18:00 IST, 45-minute slots).
--    You can also manage this in Admin → Demos → Availability.
insert into public.demo_availability (salesperson_id, weekday, start_time, end_time, slot_minutes)
select ur.user_id, d.weekday, w.start_time, w.end_time, 45
from (select distinct user_id from public.user_roles where role_key in ('sales_admin', 'sales_executive')) ur
cross join generate_series(1, 6) as d (weekday)
cross join (values ('10:00'::time, '13:00'::time), ('14:00'::time, '18:00'::time)) as w (start_time, end_time)
on conflict (salesperson_id, weekday, start_time) do nothing;
