-- ════════════════════════════════════════════════════════════════════
-- 0017 — Two-step sign-in is enforced in the database
-- A person who has turned on an authenticator app (a verified MFA factor)
-- can reach company data only with a session that passed the second step
-- (JWT claim aal = 'aal2'). A stolen password alone gets nothing.
-- People who have not turned it on are not affected.
--
-- How: mfa_ok() is added as a RESTRICTIVE policy on every table that has RLS,
-- and to the role helpers used inside security-definer functions.
-- Every new table must add the same "mfa_required" policy
-- (tests/integration/mfa.test.ts fails otherwise).
--
-- Locked out (lost phone)? In the Supabase dashboard: Authentication → Users →
-- the person → remove the MFA factor.
-- ════════════════════════════════════════════════════════════════════

create or replace function public.mfa_ok() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or auth.uid() is null
      or not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status::text = 'verified');
$$;
revoke execute on function public.mfa_ok() from public, anon;
grant execute on function public.mfa_ok() to authenticated, service_role;

do $$
declare t record;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
  loop
    execute format('create policy mfa_required on public.%I as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()))', t.relname);
  end loop;
end $$;

create policy mfa_required on storage.objects as restrictive for all to authenticated
  using ((select public.mfa_ok())) with check ((select public.mfa_ok()));

-- Security-definer functions skip RLS but ask these helpers who the caller is.
create or replace function public.company_role(p_company uuid) returns text
language sql stable security definer set search_path = public as $$
  select m.role
  from public.company_memberships m
  join public.profiles p on p.id = m.user_id
  where m.company_id = p_company and m.user_id = auth.uid() and p.is_active and public.mfa_ok()
  limit 1;
$$;

create or replace function public.is_my_employee(p_employee uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.mfa_ok() and exists (select 1 from public.employees where id = p_employee and user_id = auth.uid());
$$;

create or replace function public.has_any_role(p_roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select public.mfa_ok() and exists (
    select 1
    from public.user_roles ur
    join public.profiles p on p.id = ur.user_id
    where ur.user_id = auth.uid() and p.is_active and ur.role_key = any (p_roles)
  );
$$;

create or replace function public.is_company_member(p_company uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.mfa_ok() and exists (
    select 1
    from public.company_memberships m
    join public.profiles p on p.id = m.user_id
    where m.company_id = p_company and m.user_id = auth.uid() and p.is_active
  );
$$;

create or replace function public.is_company_admin(p_company uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.mfa_ok() and exists (
    select 1
    from public.company_memberships m
    join public.profiles p on p.id = m.user_id
    where m.company_id = p_company and m.user_id = auth.uid() and m.role = 'customer_admin' and p.is_active
  );
$$;

-- Check-in runs as a security-definer function, so guard the rows it writes too.
create or replace function public.require_mfa() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.mfa_ok() then raise exception 'mfa_required' using errcode = '42501'; end if;
  return new;
end $$;
create trigger attendance_records_require_mfa before insert or update on public.attendance_records
  for each row execute function public.require_mfa();
create trigger attendance_breaks_require_mfa before insert or update on public.attendance_breaks
  for each row execute function public.require_mfa();
