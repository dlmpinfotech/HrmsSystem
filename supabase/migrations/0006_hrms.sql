-- ════════════════════════════════════════════════════════════════════
-- 0006 — HRMS core: employees, attendance, leave, holidays
-- Data here belongs to a customer company (tenant) and is visible only to:
--   • that company's HR (Company Admin or HR Manager), and
--   • the employee themself (their own rows).
-- Platform staff are intentionally NOT given access to employee personal data.
-- Attendance times are taken from the server clock (clock_attendance), never the browser.
-- ════════════════════════════════════════════════════════════════════

-- ── New company roles ───────────────────────────────────────────────
insert into public.roles (key, name, description, is_staff) values
  ('hr_manager', 'HR Manager', 'Manages employees, attendance and leave for one company', false),
  ('employee',   'Employee',   'Marks own attendance and applies for leave', false)
on conflict (key) do nothing;

alter table public.company_memberships drop constraint if exists company_memberships_role_check;
alter table public.company_memberships add constraint company_memberships_role_check
  check (role in ('customer_admin', 'hr_manager', 'customer_user', 'employee'));

-- Invitations now carry any of the four company roles into the membership.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare inv record;
begin
  insert into public.profiles (id, email, full_name, phone, preferred_language)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    case when new.raw_user_meta_data ->> 'language' in ('en', 'ta') then new.raw_user_meta_data ->> 'language' end
  )
  on conflict (id) do nothing;

  for inv in
    select * from public.user_invitations
    where lower(email) = lower(new.email) and status = 'pending'
  loop
    insert into public.user_roles (user_id, role_key, granted_by)
    values (new.id, inv.role_key, inv.invited_by)
    on conflict do nothing;

    if inv.company_id is not null then
      insert into public.company_memberships (company_id, user_id, role)
      values (
        inv.company_id, new.id,
        case when inv.role_key in ('customer_admin', 'hr_manager', 'customer_user', 'employee') then inv.role_key else 'customer_user' end
      )
      on conflict (company_id, user_id) do nothing;
    end if;

    update public.user_invitations set status = 'accepted', accepted_at = now() where id = inv.id;
  end loop;

  return new;
end $$;

-- ── Role helpers ────────────────────────────────────────────────────
create or replace function public.company_role(p_company uuid) returns text
language sql stable security definer set search_path = public as $$
  select m.role
  from public.company_memberships m
  join public.profiles p on p.id = m.user_id
  where m.company_id = p_company and m.user_id = auth.uid() and p.is_active
  limit 1;
$$;

create or replace function public.is_company_hr(p_company uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.company_role(p_company) in ('customer_admin', 'hr_manager'), false);
$$;

-- ── Employees ───────────────────────────────────────────────────────
create table public.employees (
  id                      uuid primary key default gen_random_uuid(),
  company_id              uuid not null references public.companies (id) on delete cascade,
  user_id                 uuid references public.profiles (id) on delete set null,
  employee_code           text not null check (char_length(employee_code) between 1 and 30),
  full_name               text not null check (char_length(full_name) between 2 and 120),
  email                   text,
  phone                   text,
  department              text,
  designation             text,
  employment_type         text not null default 'full_time'
                          check (employment_type in ('full_time', 'part_time', 'contract', 'intern')),
  date_of_joining         date,
  date_of_birth           date,
  gender                  text check (gender in ('male', 'female', 'other')),
  address                 text,
  emergency_contact_name  text,
  emergency_contact_phone text,
  shift_start             time not null default '09:30',
  shift_end               time not null default '18:30',
  grace_minutes           integer not null default 10 check (grace_minutes between 0 and 120),
  weekly_offs             smallint[] not null default '{0}',
  status                  text not null default 'active' check (status in ('active', 'inactive', 'exited')),
  exit_date               date,
  created_by              uuid references public.profiles (id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (company_id, employee_code),
  check (shift_end > shift_start),
  check (weekly_offs <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[])
);
create unique index employees_email_uniq on public.employees (company_id, lower(email)) where email is not null;
create unique index employees_user_uniq on public.employees (company_id, user_id) where user_id is not null;
create index employees_company_status_idx on public.employees (company_id, status);

-- ── Attendance ──────────────────────────────────────────────────────
create table public.attendance_records (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies (id) on delete cascade,
  employee_id        uuid not null references public.employees (id) on delete cascade,
  work_date          date not null, -- calendar day in Asia/Kolkata
  check_in_at        timestamptz,
  check_out_at       timestamptz,
  check_in_location  jsonb,
  check_out_location jsonb,
  source             text not null default 'self' check (source in ('self', 'hr')),
  status             text not null default 'present'
                     check (status in ('present', 'half_day', 'absent', 'on_leave', 'holiday', 'weekly_off')),
  late_minutes       integer not null default 0,
  work_minutes       integer,
  notes              text check (notes is null or char_length(notes) <= 500),
  corrected_by       uuid references public.profiles (id) on delete set null,
  corrected_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (employee_id, work_date),
  check (check_out_at is null or check_in_at is null or check_out_at >= check_in_at)
);
create index attendance_company_date_idx on public.attendance_records (company_id, work_date);

-- ── Leave ───────────────────────────────────────────────────────────
create table public.leave_types (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  name         text not null check (char_length(name) between 2 and 60),
  code         text not null check (char_length(code) between 1 and 10),
  annual_quota numeric(5, 1) check (annual_quota is null or annual_quota >= 0), -- null = no limit
  is_paid      boolean not null default true,
  is_active    boolean not null default true,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (company_id, code)
);

create table public.holidays (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  holiday_date date not null,
  name         text not null check (char_length(name) between 2 and 80),
  created_at   timestamptz not null default now(),
  unique (company_id, holiday_date)
);

create table public.leave_requests (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  employee_id   uuid not null references public.employees (id) on delete cascade,
  leave_type_id uuid not null references public.leave_types (id) on delete restrict,
  start_date    date not null,
  end_date      date not null,
  half_day      boolean not null default false,
  days          numeric(5, 1) not null default 0,
  reason        text check (reason is null or char_length(reason) <= 1000),
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by    uuid references public.profiles (id) on delete set null,
  decided_at    timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 500),
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (end_date >= start_date),
  check (not half_day or start_date = end_date)
);
create index leave_requests_company_status_idx on public.leave_requests (company_id, status);
create index leave_requests_employee_idx on public.leave_requests (employee_id, start_date);

do $$
declare t text;
begin
  foreach t in array array['employees', 'attendance_records', 'leave_types', 'leave_requests'] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_set_updated_at', t);
  end loop;
  foreach t in array array['employees', 'leave_requests', 'leave_types', 'holidays'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t || '_audit', t);
  end loop;
end $$;

-- ── Defaults per company ────────────────────────────────────────────
create or replace function public.seed_hr_defaults(p_company uuid) returns void
language sql security definer set search_path = public as $$
  insert into public.leave_types (company_id, name, code, annual_quota, is_paid, sort_order) values
    (p_company, 'Casual Leave', 'CL', 12, true, 1),
    (p_company, 'Sick Leave',   'SL', 12, true, 2),
    (p_company, 'Earned Leave', 'EL', 15, true, 3),
    (p_company, 'Loss of Pay',  'LOP', null, false, 4)
  on conflict (company_id, code) do nothing;
$$;

create or replace function public.companies_seed_hr() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.seed_hr_defaults(new.id);
  return new;
end $$;
create trigger companies_seed_hr after insert on public.companies for each row execute function public.companies_seed_hr();

select public.seed_hr_defaults(id) from public.companies;

-- ── Employee rules ──────────────────────────────────────────────────
create or replace function public.employees_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_limit integer;
  v_active integer;
  v_n integer;
begin
  new.email := nullif(lower(trim(coalesce(new.email, ''))), '');
  new.employee_code := upper(trim(coalesce(new.employee_code, '')));
  if new.employee_code = '' then
    select count(*) + 1 into v_n from public.employees where company_id = new.company_id;
    loop
      new.employee_code := 'EMP' || lpad(v_n::text, 4, '0');
      exit when not exists (select 1 from public.employees where company_id = new.company_id and employee_code = new.employee_code);
      v_n := v_n + 1;
    end loop;
  end if;

  if tg_op = 'UPDATE' and new.company_id <> old.company_id then
    raise exception 'company cannot change' using errcode = '42501';
  end if;
  if new.status = 'exited' and new.exit_date is null then
    new.exit_date := (now() at time zone 'Asia/Kolkata')::date;
  end if;

  -- Link to a portal login with the same email in this company.
  if new.user_id is null and new.email is not null then
    select m.user_id into new.user_id
    from public.company_memberships m join public.profiles p on p.id = m.user_id
    where m.company_id = new.company_id and lower(p.email) = new.email
      and not exists (select 1 from public.employees e where e.company_id = new.company_id and e.user_id = m.user_id and e.id <> new.id)
    limit 1;
  end if;

  -- Plan employee limit (counts active employees).
  if new.status = 'active' and (tg_op = 'INSERT' or old.status <> 'active') then
    select p.employee_limit into v_limit
    from public.subscriptions s join public.plans p on p.id = s.plan_id
    where s.company_id = new.company_id and s.status in ('trialing', 'active', 'past_due')
    limit 1;
    if v_limit is not null then
      select count(*) into v_active from public.employees where company_id = new.company_id and status = 'active' and id <> new.id;
      if v_active >= v_limit then
        raise exception 'employee_limit_reached' using errcode = '23514';
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger employees_before before insert or update on public.employees
  for each row execute function public.employees_before();

-- A new portal login is linked to the employee record with the same email.
create or replace function public.memberships_link_employee() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.employees e
  set user_id = new.user_id
  from public.profiles p
  where p.id = new.user_id and e.company_id = new.company_id and e.user_id is null
    and e.email = lower(p.email)
    and not exists (select 1 from public.employees x where x.company_id = new.company_id and x.user_id = new.user_id);
  return new;
end $$;
create trigger memberships_link_employee after insert on public.company_memberships
  for each row execute function public.memberships_link_employee();

-- ── Attendance rules ────────────────────────────────────────────────
create or replace function public.attendance_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_emp public.employees;
  v_late integer;
begin
  select * into v_emp from public.employees where id = new.employee_id;
  if not found then raise exception 'employee not found' using errcode = '23503'; end if;
  new.company_id := v_emp.company_id; -- never trust a client-supplied tenant

  if new.check_in_at is not null then
    v_late := floor(extract(epoch from ((new.check_in_at at time zone 'Asia/Kolkata') - (new.work_date + v_emp.shift_start))) / 60);
    new.late_minutes := case when v_late > v_emp.grace_minutes then v_late else 0 end;
  else
    new.late_minutes := 0;
  end if;

  if new.check_in_at is not null and new.check_out_at is not null then
    new.work_minutes := floor(extract(epoch from (new.check_out_at - new.check_in_at)) / 60);
    -- Less than four hours on a self-marked day counts as a half day.
    if new.source = 'self' and new.status = 'present' and new.work_minutes < 240 then
      new.status := 'half_day';
    end if;
  else
    new.work_minutes := null;
  end if;

  if new.source = 'hr' and auth.uid() is not null then
    new.corrected_by := auth.uid();
    new.corrected_at := now();
  end if;
  return new;
end $$;
create trigger attendance_before before insert or update on public.attendance_records
  for each row execute function public.attendance_before();

-- Clean location payload: only numeric lat/lng/accuracy within valid ranges.
create or replace function public.clean_location(p jsonb) returns jsonb
language sql immutable as $$
  select case
    when p is null or jsonb_typeof(p -> 'lat') <> 'number' or jsonb_typeof(p -> 'lng') <> 'number' then null
    when (p ->> 'lat')::numeric not between -90 and 90 or (p ->> 'lng')::numeric not between -180 and 180 then null
    else jsonb_build_object(
      'lat', round((p ->> 'lat')::numeric, 6),
      'lng', round((p ->> 'lng')::numeric, 6),
      'accuracy', case when jsonb_typeof(p -> 'accuracy') = 'number' then round((p ->> 'accuracy')::numeric) end)
  end;
$$;

-- Self check-in / check-out. Times come from the database clock.
create or replace function public.clock_attendance(p_company uuid, p_action text, p_location jsonb default null)
returns public.attendance_records
language plpgsql security definer set search_path = public as $$
declare
  v_emp public.employees;
  v_rec public.attendance_records;
  v_date date := (now() at time zone 'Asia/Kolkata')::date;
begin
  select e.* into v_emp
  from public.employees e join public.profiles p on p.id = e.user_id
  where e.company_id = p_company and e.user_id = auth.uid() and e.status = 'active' and p.is_active;
  if not found then raise exception 'no_employee_record' using errcode = 'P0002'; end if;

  if exists (select 1 from public.companies where id = p_company and status in ('suspended', 'cancelled')) then
    raise exception 'company_inactive' using errcode = '42501';
  end if;

  select * into v_rec from public.attendance_records where employee_id = v_emp.id and work_date = v_date for update;

  if p_action = 'in' then
    if found and v_rec.check_in_at is not null then raise exception 'already_checked_in' using errcode = '23505'; end if;
    insert into public.attendance_records (company_id, employee_id, work_date, check_in_at, check_in_location, source, status)
    values (v_emp.company_id, v_emp.id, v_date, now(), public.clean_location(p_location), 'self', 'present')
    on conflict (employee_id, work_date) do update
      set check_in_at = excluded.check_in_at, check_in_location = excluded.check_in_location, status = 'present'
    returning * into v_rec;
  elsif p_action = 'out' then
    if not found or v_rec.check_in_at is null then raise exception 'not_checked_in' using errcode = '22023'; end if;
    if v_rec.check_out_at is not null then raise exception 'already_checked_out' using errcode = '23505'; end if;
    update public.attendance_records
    set check_out_at = now(), check_out_location = public.clean_location(p_location)
    where id = v_rec.id
    returning * into v_rec;
  else
    raise exception 'invalid_action' using errcode = '22023';
  end if;
  return v_rec;
end $$;

-- ── Leave rules ─────────────────────────────────────────────────────
-- Working days in a range for one employee (weekly offs and company holidays excluded).
create or replace function public.leave_days(p_employee uuid, p_start date, p_end date, p_half boolean)
returns numeric
language sql stable security definer set search_path = public as $$
  with e as (select company_id, weekly_offs from public.employees where id = p_employee),
  d as (
    select g::date as day
    from generate_series(p_start, p_end, interval '1 day') g, e
    where not (extract(dow from g)::smallint = any (e.weekly_offs))
      and not exists (select 1 from public.holidays h where h.company_id = e.company_id and h.holiday_date = g::date)
  )
  select case when p_half then least(count(*), 1) * 0.5 else count(*) end from d;
$$;

create or replace function public.leave_requests_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_emp public.employees;
  v_type public.leave_types;
  v_hr boolean;
  v_used numeric;
begin
  select * into v_emp from public.employees where id = new.employee_id;
  if not found then raise exception 'employee not found' using errcode = '23503'; end if;
  new.company_id := v_emp.company_id;
  v_hr := auth.uid() is null or public.is_company_hr(v_emp.company_id);

  if tg_op = 'UPDATE' then
    if not v_hr then
      -- Employees may only withdraw their own pending request.
      if not (old.status = 'pending' and new.status = 'cancelled')
         or new.start_date <> old.start_date or new.end_date <> old.end_date
         or new.leave_type_id <> old.leave_type_id or new.half_day <> old.half_day then
        raise exception 'only_cancel_pending' using errcode = '42501';
      end if;
      return new;
    end if;
    if new.status <> old.status and new.status in ('approved', 'rejected') then
      if old.status not in ('pending', 'approved') then
        raise exception 'cannot_decide' using errcode = '22023';
      end if;
      new.decided_by := coalesce(auth.uid(), new.decided_by);
      new.decided_at := now();
    end if;
    if new.status = old.status and (new.start_date, new.end_date, new.half_day, new.leave_type_id) = (old.start_date, old.end_date, old.half_day, old.leave_type_id) then
      return new;
    end if;
  else
    if not v_hr and new.status <> 'pending' then
      raise exception 'new_requests_are_pending' using errcode = '42501';
    end if;
    new.created_by := coalesce(auth.uid(), new.created_by);
    if new.status = 'approved' then
      new.decided_by := coalesce(auth.uid(), new.decided_by);
      new.decided_at := now();
    end if;
  end if;

  select * into v_type from public.leave_types where id = new.leave_type_id;
  if not found or v_type.company_id <> v_emp.company_id or not v_type.is_active then
    raise exception 'invalid_leave_type' using errcode = '22023';
  end if;

  new.days := public.leave_days(new.employee_id, new.start_date, new.end_date, new.half_day);
  if new.days <= 0 then raise exception 'no_working_days' using errcode = '22023'; end if;

  if new.status in ('pending', 'approved') and exists (
    select 1 from public.leave_requests r
    where r.employee_id = new.employee_id and r.id <> new.id and r.status in ('pending', 'approved')
      and r.start_date <= new.end_date and r.end_date >= new.start_date
  ) then
    raise exception 'leave_overlap' using errcode = '23505';
  end if;

  if v_type.annual_quota is not null and new.status in ('pending', 'approved') then
    select coalesce(sum(days), 0) into v_used
    from public.leave_requests r
    where r.employee_id = new.employee_id and r.leave_type_id = new.leave_type_id and r.id <> new.id
      and r.status in ('pending', 'approved')
      and extract(year from r.start_date) = extract(year from new.start_date);
    if v_used + new.days > v_type.annual_quota then
      raise exception 'insufficient_balance' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger leave_requests_before before insert or update on public.leave_requests
  for each row execute function public.leave_requests_before();

-- ── Row Level Security ──────────────────────────────────────────────
alter table public.employees enable row level security;
alter table public.attendance_records enable row level security;
alter table public.leave_types enable row level security;
alter table public.holidays enable row level security;
alter table public.leave_requests enable row level security;

grant select, insert, update, delete on public.employees, public.attendance_records, public.leave_types, public.holidays, public.leave_requests to authenticated;
grant all on public.employees, public.attendance_records, public.leave_types, public.holidays, public.leave_requests to service_role;

create or replace function public.is_my_employee(p_employee uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.employees where id = p_employee and user_id = auth.uid());
$$;

create policy employees_select on public.employees for select to authenticated
  using (public.is_company_hr(company_id) or user_id = auth.uid());
create policy employees_write on public.employees for all to authenticated
  using (public.is_company_hr(company_id)) with check (public.is_company_hr(company_id));

create policy attendance_select on public.attendance_records for select to authenticated
  using (public.is_company_hr(company_id) or public.is_my_employee(employee_id));
create policy attendance_write on public.attendance_records for all to authenticated
  using (public.is_company_hr(company_id)) with check (public.is_company_hr(company_id));

create policy leave_types_select on public.leave_types for select to authenticated
  using (public.is_company_member(company_id));
create policy leave_types_write on public.leave_types for all to authenticated
  using (public.is_company_hr(company_id)) with check (public.is_company_hr(company_id));

create policy holidays_select on public.holidays for select to authenticated
  using (public.is_company_member(company_id));
create policy holidays_write on public.holidays for all to authenticated
  using (public.is_company_hr(company_id)) with check (public.is_company_hr(company_id));

create policy leave_select on public.leave_requests for select to authenticated
  using (public.is_company_hr(company_id) or public.is_my_employee(employee_id));
create policy leave_insert on public.leave_requests for insert to authenticated
  with check (public.is_company_hr(company_id) or public.is_my_employee(employee_id));
create policy leave_update on public.leave_requests for update to authenticated
  using (public.is_company_hr(company_id) or public.is_my_employee(employee_id))
  with check (public.is_company_hr(company_id) or public.is_my_employee(employee_id));

-- ── Function privileges ─────────────────────────────────────────────
revoke execute on function public.clock_attendance(uuid, text, jsonb) from public, anon;
grant execute on function public.clock_attendance(uuid, text, jsonb) to authenticated, service_role;
revoke execute on function public.seed_hr_defaults(uuid) from public, anon, authenticated;
grant execute on function public.seed_hr_defaults(uuid) to service_role;
