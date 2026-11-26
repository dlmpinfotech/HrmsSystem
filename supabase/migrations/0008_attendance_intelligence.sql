-- ════════════════════════════════════════════════════════════════════
-- 0008 — Attendance intelligence + HR command center
--   • Shift templates (incl. overnight), weekly rotations, per-day overrides
--   • Attendance: work mode (office / home / field), breaks, early leave, overtime
--   • Attendance regularization requests (employee asks, HR approves)
--   • Employee: reporting manager, probation and contract end dates
--   • hr_attention(): "Requires attention" queue + per-alert state (assign / snooze / resolve / escalate)
-- Only adds; rows created before this migration keep their meaning
-- (no shift assigned → the employee's own shift_start / shift_end / grace, no break deduction).
-- ════════════════════════════════════════════════════════════════════

-- ── Employees ───────────────────────────────────────────────────────
-- Overnight default shifts (e.g. 22:00–06:00) are now allowed.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.employees'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%shift_end > shift_start%'
  loop
    execute format('alter table public.employees drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.employees add constraint employees_shift_not_empty check (shift_end <> shift_start);

alter table public.employees
  add column reporting_manager_id uuid references public.employees (id) on delete set null,
  add column probation_end_date   date,
  add column contract_end_date    date,
  add column work_location        text check (work_location is null or char_length(work_location) <= 80);
create index employees_manager_idx on public.employees (reporting_manager_id) where reporting_manager_id is not null;

create or replace function public.employees_manager_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.reporting_manager_id is not null then
    if new.reporting_manager_id = new.id then raise exception 'invalid_manager' using errcode = '22023'; end if;
    if not exists (select 1 from public.employees m where m.id = new.reporting_manager_id and m.company_id = new.company_id) then
      raise exception 'invalid_manager' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;
create trigger employees_manager_check before insert or update of reporting_manager_id on public.employees
  for each row execute function public.employees_manager_check();

-- ── Shift templates ─────────────────────────────────────────────────
create table public.shifts (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references public.companies (id) on delete cascade,
  name                   text not null check (char_length(name) between 2 and 60),
  code                   text not null check (char_length(code) between 1 and 10),
  start_time             time not null,
  end_time               time not null,           -- earlier than start_time = ends next day
  break_minutes          integer not null default 60 check (break_minutes between 0 and 240),
  grace_minutes          integer not null default 10 check (grace_minutes between 0 and 120),
  early_grace_minutes    integer not null default 10 check (early_grace_minutes between 0 and 120),
  overtime_after_minutes integer not null default 30 check (overtime_after_minutes between 0 and 480),
  color                  text not null default 'primary' check (color in ('primary', 'success', 'warning', 'info', 'danger', 'neutral')),
  is_active              boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (company_id, code),
  check (end_time <> start_time)
);

-- Weekly rotation: week 1 → shift_ids[1], week 2 → shift_ids[2], … then repeats.
create table public.shift_rotations (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  name        text not null check (char_length(name) between 2 and 60),
  shift_ids   uuid[] not null check (cardinality(shift_ids) between 1 and 12),
  anchor_date date not null, -- the Monday on which week 1 starts
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (extract(isodow from anchor_date) = 1)
);

create table public.shift_assignments (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id) on delete cascade,
  employee_id    uuid not null references public.employees (id) on delete cascade,
  shift_id       uuid references public.shifts (id) on delete cascade,
  rotation_id    uuid references public.shift_rotations (id) on delete cascade,
  effective_from date not null,
  effective_to   date,
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  check (num_nonnulls(shift_id, rotation_id) = 1),
  check (effective_to is null or effective_to >= effective_from)
);
create index shift_assignments_employee_idx on public.shift_assignments (employee_id, effective_from desc);

-- One-day change for one employee (shift swap, extra day off). shift_id null = day off.
create table public.shift_overrides (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  work_date   date not null,
  shift_id    uuid references public.shifts (id) on delete cascade,
  note        text check (note is null or char_length(note) <= 200),
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (employee_id, work_date)
);

-- Tenant + ownership checks: never trust company_id or foreign ids from the client.
create or replace function public.shift_refs_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_company uuid;
begin
  if tg_table_name = 'shift_rotations' then
    if exists (select 1 from unnest(new.shift_ids) s(id) where not exists (select 1 from public.shifts x where x.id = s.id and x.company_id = new.company_id)) then
      raise exception 'invalid_shift' using errcode = '22023';
    end if;
    return new;
  end if;

  select company_id into v_company from public.employees where id = new.employee_id;
  if v_company is null then raise exception 'employee not found' using errcode = '23503'; end if;
  new.company_id := v_company;
  if new.shift_id is not null and not exists (select 1 from public.shifts where id = new.shift_id and company_id = v_company) then
    raise exception 'invalid_shift' using errcode = '22023';
  end if;
  if tg_table_name = 'shift_assignments' then
    if new.rotation_id is not null and not exists (select 1 from public.shift_rotations where id = new.rotation_id and company_id = v_company) then
      raise exception 'invalid_shift' using errcode = '22023';
    end if;
  end if;
  if tg_op = 'INSERT' then new.created_by := coalesce(auth.uid(), new.created_by); end if;
  return new;
end $$;
create trigger shift_rotations_refs before insert or update on public.shift_rotations for each row execute function public.shift_refs_before();
create trigger shift_assignments_refs before insert or update on public.shift_assignments for each row execute function public.shift_refs_before();
create trigger shift_overrides_refs before insert or update on public.shift_overrides for each row execute function public.shift_refs_before();

-- The shift that applies to one employee on one day:
-- override → latest assignment (fixed shift or rotation week) → the employee's own default shift.
create or replace function public.employee_shift_on(p_employee uuid, p_date date)
returns table (
  shift_id uuid, shift_name text, start_time time, end_time time, break_minutes integer,
  grace_minutes integer, early_grace_minutes integer, overtime_after_minutes integer, is_off boolean
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_emp public.employees;
  v_sid uuid;
  v_rid uuid;
  v_found boolean := false;
  v_rot public.shift_rotations;
  v_n integer;
  v_week integer;
  v_s public.shifts;
begin
  select * into v_emp from public.employees where id = p_employee;
  if not found then return; end if;
  if auth.uid() is not null and not (public.is_company_hr(v_emp.company_id) or v_emp.user_id = auth.uid()) then return; end if;

  select o.shift_id into v_sid from public.shift_overrides o where o.employee_id = p_employee and o.work_date = p_date;
  v_found := found;
  if v_found and v_sid is null then
    return query select null::uuid, null::text, v_emp.shift_start, v_emp.shift_end, 0, v_emp.grace_minutes, 10, 30, true;
    return;
  end if;

  if not v_found then
    select a.shift_id, a.rotation_id into v_sid, v_rid
    from public.shift_assignments a
    where a.employee_id = p_employee and a.effective_from <= p_date and (a.effective_to is null or a.effective_to >= p_date)
    order by a.effective_from desc, a.created_at desc
    limit 1;
    if v_sid is null and v_rid is not null then
      select * into v_rot from public.shift_rotations where id = v_rid;
      v_n := cardinality(v_rot.shift_ids);
      v_week := floor((p_date - v_rot.anchor_date)::numeric / 7)::integer;
      v_sid := v_rot.shift_ids[((v_week % v_n) + v_n) % v_n + 1];
    end if;
  end if;

  if v_sid is not null then
    select * into v_s from public.shifts where id = v_sid;
    if found then
      return query select v_s.id, v_s.name, v_s.start_time, v_s.end_time, v_s.break_minutes, v_s.grace_minutes, v_s.early_grace_minutes, v_s.overtime_after_minutes, false;
      return;
    end if;
  end if;
  return query select null::uuid, null::text, v_emp.shift_start, v_emp.shift_end, 0, v_emp.grace_minutes, 10, 30, false;
end $$;

-- ── Attendance: work mode, breaks, early leave, overtime ────────────
alter table public.attendance_records drop constraint if exists attendance_records_source_check;
alter table public.attendance_records add constraint attendance_records_source_check check (source in ('self', 'hr', 'regularization'));
alter table public.attendance_records
  add column work_mode        text not null default 'office' check (work_mode in ('office', 'home', 'field')),
  add column shift_id         uuid references public.shifts (id) on delete set null,
  add column scheduled_start  timestamptz,
  add column scheduled_end    timestamptz,
  add column break_minutes    integer not null default 0 check (break_minutes >= 0),
  add column early_minutes    integer not null default 0,
  add column overtime_minutes integer not null default 0,
  add column on_break_since   timestamptz;
create index attendance_open_idx on public.attendance_records (company_id, work_date) where check_out_at is null;

create table public.attendance_breaks (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  employee_id   uuid not null references public.employees (id) on delete cascade,
  attendance_id uuid not null references public.attendance_records (id) on delete cascade,
  start_at      timestamptz not null,
  end_at        timestamptz,
  created_at    timestamptz not null default now(),
  check (end_at is null or end_at >= start_at)
);
create index attendance_breaks_attendance_idx on public.attendance_breaks (attendance_id);

-- Recomputes schedule, late, early, worked, overtime from the shift that applies that day.
-- Worked = span − max(breaks taken, scheduled break); the scheduled break is only deducted from spans of 5h+.
create or replace function public.attendance_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_emp public.employees;
  v_sh record;
  v_off boolean;
  v_sched integer;
  v_span integer;
  v_diff integer;
begin
  select * into v_emp from public.employees where id = new.employee_id;
  if not found then raise exception 'employee not found' using errcode = '23503'; end if;
  new.company_id := v_emp.company_id; -- never trust a client-supplied tenant

  select * into v_sh from public.employee_shift_on(new.employee_id, new.work_date);
  if v_sh.start_time is null then
    select null::uuid as shift_id, v_emp.shift_start as start_time, v_emp.shift_end as end_time, 0 as break_minutes,
           v_emp.grace_minutes as grace_minutes, 10 as early_grace_minutes, 30 as overtime_after_minutes, false as is_off
    into v_sh;
  end if;
  new.shift_id := v_sh.shift_id;
  new.scheduled_start := (new.work_date + v_sh.start_time) at time zone 'Asia/Kolkata';
  new.scheduled_end := new.scheduled_start
    + case when v_sh.end_time > v_sh.start_time then v_sh.end_time - v_sh.start_time else (v_sh.end_time - v_sh.start_time) + interval '24 hours' end;
  v_sched := floor(extract(epoch from (new.scheduled_end - new.scheduled_start)) / 60) - v_sh.break_minutes;
  v_off := v_sh.is_off
    or extract(dow from new.work_date)::smallint = any (v_emp.weekly_offs)
    or exists (select 1 from public.holidays h where h.company_id = v_emp.company_id and h.holiday_date = new.work_date)
    or new.status in ('holiday', 'weekly_off');

  if new.check_in_at is not null and not v_off then
    v_diff := floor(extract(epoch from (new.check_in_at - new.scheduled_start)) / 60);
    new.late_minutes := case when v_diff > v_sh.grace_minutes then v_diff else 0 end;
  else
    new.late_minutes := 0;
  end if;

  if new.check_in_at is not null and new.check_out_at is not null then
    v_span := floor(extract(epoch from (new.check_out_at - new.check_in_at)) / 60);
    new.work_minutes := greatest(v_span - greatest(new.break_minutes, case when v_span >= 300 then v_sh.break_minutes else 0 end), 0);
    if v_off then
      new.early_minutes := 0;
      new.overtime_minutes := new.work_minutes;
    else
      v_diff := floor(extract(epoch from (new.scheduled_end - new.check_out_at)) / 60);
      new.early_minutes := case when v_diff > v_sh.early_grace_minutes then v_diff else 0 end;
      new.overtime_minutes := case when new.work_minutes - v_sched > v_sh.overtime_after_minutes then new.work_minutes - v_sched else 0 end;
    end if;
    -- Less than four hours on a self-marked day counts as a half day.
    if new.source = 'self' and new.status = 'present' and new.work_minutes < 240 then
      new.status := 'half_day';
    end if;
  else
    new.work_minutes := null;
    new.early_minutes := 0;
    new.overtime_minutes := 0;
  end if;

  if new.source in ('hr', 'regularization') and auth.uid() is not null then
    new.corrected_by := auth.uid();
    new.corrected_at := now();
  end if;
  return new;
end $$;

-- Self check-in / check-out / breaks. Times come from the database clock.
-- Overnight shifts: check-out closes yesterday's open record; check-in up to 2h before a shift
-- that starts after midnight is dated to that shift's day.
drop function if exists public.clock_attendance(uuid, text, jsonb);
create function public.clock_attendance(p_company uuid, p_action text, p_location jsonb default null, p_mode text default null)
returns public.attendance_records
language plpgsql security definer set search_path = public as $$
declare
  v_emp public.employees;
  v_rec public.attendance_records;
  v_open public.attendance_records;
  v_now timestamptz := now();
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_date date;
  v_next record;
begin
  select e.* into v_emp
  from public.employees e join public.profiles p on p.id = e.user_id
  where e.company_id = p_company and e.user_id = auth.uid() and e.status = 'active' and p.is_active;
  if not found then raise exception 'no_employee_record' using errcode = 'P0002'; end if;
  if exists (select 1 from public.companies where id = p_company and status in ('suspended', 'cancelled')) then
    raise exception 'company_inactive' using errcode = '42501';
  end if;
  if p_mode is not null and p_mode not in ('office', 'home', 'field') then
    raise exception 'invalid_action' using errcode = '22023';
  end if;

  -- The record still "open" for this person: checked in, not out, and its shift not long over.
  select * into v_open from public.attendance_records r
  where r.employee_id = v_emp.id and r.check_in_at is not null and r.check_out_at is null
    and (r.work_date >= v_today or (r.work_date = v_today - 1 and v_now < r.scheduled_end + interval '6 hours'))
  order by r.work_date desc
  limit 1
  for update;

  if p_action = 'in' then
    if v_open.id is not null then raise exception 'already_checked_in' using errcode = '23505'; end if;
    v_date := v_today;
    select * into v_next from public.employee_shift_on(v_emp.id, v_today + 1);
    if v_next.start_time is not null and not v_next.is_off
       and v_now >= ((v_today + 1) + v_next.start_time) at time zone 'Asia/Kolkata' - interval '2 hours' then
      v_date := v_today + 1;
    end if;
    select * into v_rec from public.attendance_records where employee_id = v_emp.id and work_date = v_date for update;
    if found and v_rec.check_in_at is not null then raise exception 'already_checked_in' using errcode = '23505'; end if;
    insert into public.attendance_records (company_id, employee_id, work_date, check_in_at, check_in_location, source, status, work_mode)
    values (v_emp.company_id, v_emp.id, v_date, v_now, public.clean_location(p_location), 'self', 'present', coalesce(p_mode, 'office'))
    on conflict (employee_id, work_date) do update
      set check_in_at = excluded.check_in_at, check_in_location = excluded.check_in_location, status = 'present', work_mode = excluded.work_mode
    returning * into v_rec;
    return v_rec;
  end if;

  if v_open.id is null then
    if p_action = 'out' and exists (select 1 from public.attendance_records where employee_id = v_emp.id and work_date = v_today and check_out_at is not null) then
      raise exception 'already_checked_out' using errcode = '23505';
    end if;
    if p_action in ('out', 'break_start', 'break_end') then raise exception 'not_checked_in' using errcode = '22023'; end if;
    raise exception 'invalid_action' using errcode = '22023';
  end if;

  if p_action = 'break_start' then
    if v_open.on_break_since is not null then raise exception 'already_on_break' using errcode = '23505'; end if;
    insert into public.attendance_breaks (company_id, employee_id, attendance_id, start_at) values (v_open.company_id, v_emp.id, v_open.id, v_now);
    update public.attendance_records set on_break_since = v_now where id = v_open.id returning * into v_rec;
  elsif p_action in ('break_end', 'out') then
    if p_action = 'break_end' and v_open.on_break_since is null then raise exception 'not_on_break' using errcode = '22023'; end if;
    update public.attendance_breaks set end_at = v_now where attendance_id = v_open.id and end_at is null;
    update public.attendance_records r
    set on_break_since = null,
        break_minutes = coalesce((select floor(sum(extract(epoch from (b.end_at - b.start_at))) / 60) from public.attendance_breaks b where b.attendance_id = r.id and b.end_at is not null), 0),
        check_out_at = case when p_action = 'out' then v_now else r.check_out_at end,
        check_out_location = case when p_action = 'out' then public.clean_location(p_location) else r.check_out_location end
    where r.id = v_open.id
    returning * into v_rec;
  else
    raise exception 'invalid_action' using errcode = '22023';
  end if;
  return v_rec;
end $$;

-- ── Attendance regularization ───────────────────────────────────────
create table public.attendance_regularizations (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  employee_id      uuid not null references public.employees (id) on delete cascade,
  work_date        date not null,
  check_in_time    time not null,
  check_out_time   time,
  out_next_day     boolean not null default false,
  requested_status text not null default 'present' check (requested_status in ('present', 'half_day')),
  work_mode        text not null default 'office' check (work_mode in ('office', 'home', 'field')),
  reason           text not null check (char_length(reason) between 5 and 500),
  status           text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by       uuid references public.profiles (id) on delete set null,
  decided_at       timestamptz,
  decision_note    text check (decision_note is null or char_length(decision_note) <= 500),
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index regularizations_one_pending on public.attendance_regularizations (employee_id, work_date) where status = 'pending';
create index regularizations_company_status_idx on public.attendance_regularizations (company_id, status);

create or replace function public.regularizations_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_emp public.employees;
  v_hr boolean;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  select * into v_emp from public.employees where id = new.employee_id;
  if not found then raise exception 'employee not found' using errcode = '23503'; end if;
  new.company_id := v_emp.company_id;
  v_hr := auth.uid() is null or public.is_company_hr(v_emp.company_id);

  if tg_op = 'UPDATE' then
    if not v_hr then
      if not (old.status = 'pending' and new.status = 'cancelled')
         or (new.work_date, new.check_in_time, new.check_out_time, new.out_next_day) is distinct from (old.work_date, old.check_in_time, old.check_out_time, old.out_next_day) then
        raise exception 'only_cancel_pending' using errcode = '42501';
      end if;
      return new;
    end if;
    if new.status <> old.status and new.status in ('approved', 'rejected') then
      if old.status <> 'pending' then raise exception 'cannot_decide' using errcode = '22023'; end if;
      new.decided_by := coalesce(auth.uid(), new.decided_by);
      new.decided_at := now();
    end if;
  else
    if not v_hr and new.status <> 'pending' then raise exception 'new_requests_are_pending' using errcode = '42501'; end if;
    -- Employees may correct up to 30 days back; never the future.
    if new.work_date > v_today or (not v_hr and new.work_date < v_today - 30) then
      raise exception 'regularization_window' using errcode = '22023';
    end if;
    new.created_by := coalesce(auth.uid(), new.created_by);
  end if;

  if new.check_out_time is not null and not new.out_next_day and new.check_out_time <= new.check_in_time then
    raise exception 'out_before_in' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger regularizations_before before insert or update on public.attendance_regularizations
  for each row execute function public.regularizations_before();

-- Approval writes the attendance record (one row per employee per day — never a duplicate).
create or replace function public.regularizations_apply() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status <> 'approved') then
    insert into public.attendance_records (company_id, employee_id, work_date, check_in_at, check_out_at, status, work_mode, source, notes)
    values (
      new.company_id, new.employee_id, new.work_date,
      (new.work_date + new.check_in_time) at time zone 'Asia/Kolkata',
      case when new.check_out_time is not null
        then ((new.work_date + case when new.out_next_day then 1 else 0 end) + new.check_out_time) at time zone 'Asia/Kolkata' end,
      new.requested_status, new.work_mode, 'regularization', left(new.reason, 500)
    )
    on conflict (employee_id, work_date) do update
      set check_in_at = excluded.check_in_at, check_out_at = excluded.check_out_at, status = excluded.status,
          work_mode = excluded.work_mode, source = 'regularization', notes = excluded.notes, on_break_since = null;
  end if;
  return new;
end $$;
create trigger regularizations_apply after insert or update of status on public.attendance_regularizations
  for each row execute function public.regularizations_apply();

-- ── Requires attention ──────────────────────────────────────────────
create table public.hr_alert_states (
  company_id    uuid not null references public.companies (id) on delete cascade,
  alert_key     text not null check (char_length(alert_key) <= 200),
  status        text not null default 'open' check (status in ('open', 'snoozed', 'resolved', 'escalated')),
  snoozed_until date,
  assigned_to   uuid references public.profiles (id) on delete set null,
  note          text check (note is null or char_length(note) <= 500),
  updated_by    uuid references public.profiles (id) on delete set null,
  updated_at    timestamptz not null default now(),
  primary key (company_id, alert_key),
  check (status <> 'snoozed' or snoozed_until is not null)
);

create or replace function public.hr_alert_states_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.assigned_to is not null and not exists (
    select 1 from public.company_memberships where company_id = new.company_id and user_id = new.assigned_to and role in ('customer_admin', 'hr_manager')
  ) then
    raise exception 'invalid_assignee' using errcode = '22023';
  end if;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := now();
  return new;
end $$;
create trigger hr_alert_states_before before insert or update on public.hr_alert_states
  for each row execute function public.hr_alert_states_before();

-- Live list of issues for HR. Each row has a stable key so HR can snooze / resolve / assign it.
create or replace function public.hr_attention(p_company uuid)
returns table (
  alert_key text, alert_type text, severity text, employee_id uuid, employee_name text, employee_code text,
  department text, ref_date date, detail jsonb, status text, snoozed_until date, assigned_to uuid, note text
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if auth.uid() is not null and not public.is_company_hr(p_company) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  with emp as (
    select * from public.employees e where e.company_id = p_company
  ),
  raw as (
    -- Checked in but never checked out (2h after the shift ended).
    select 'missing_punch:' || r.id::text as k, 'missing_punch'::text as t,
           case when r.work_date < v_today - 1 then 'high' else 'medium' end as sev,
           r.employee_id as eid, r.work_date as d, jsonb_build_object('check_in_at', r.check_in_at) as det
    from public.attendance_records r
    where r.company_id = p_company and r.check_in_at is not null and r.check_out_at is null
      and r.work_date >= v_today - 30 and now() > coalesce(r.scheduled_end, r.check_in_at + interval '9 hours') + interval '2 hours'

    union all
    -- Working day, shift started more than 30 min ago, no check-in and no approved leave.
    select 'not_checked_in:' || e.id::text || ':' || v_today::text, 'not_checked_in', 'low', e.id, v_today,
           jsonb_build_object('shift_start', s.start_time)
    from emp e
    cross join lateral public.employee_shift_on(e.id, v_today) s
    where e.status = 'active' and (e.date_of_joining is null or e.date_of_joining <= v_today)
      and not s.is_off
      and not (extract(dow from v_today)::smallint = any (e.weekly_offs))
      and not exists (select 1 from public.holidays h where h.company_id = p_company and h.holiday_date = v_today)
      and now() > ((v_today + s.start_time) at time zone 'Asia/Kolkata') + make_interval(mins => s.grace_minutes + 30)
      and not exists (select 1 from public.attendance_records r where r.employee_id = e.id and r.work_date = v_today)
      and not exists (select 1 from public.leave_requests l where l.employee_id = e.id and l.status = 'approved' and v_today between l.start_date and l.end_date)

    union all
    -- Late three or more times in the last 30 days (one alert per employee per week).
    select 'repeated_late:' || r.employee_id::text || ':' || to_char(v_today, 'IYYY-IW'), 'repeated_late', 'medium', r.employee_id, max(r.work_date),
           jsonb_build_object('count', count(*), 'minutes', sum(r.late_minutes))
    from public.attendance_records r
    where r.company_id = p_company and r.work_date >= v_today - 30 and r.late_minutes > 0
    group by r.employee_id
    having count(*) >= 3

    union all
    -- Worked 2h+ beyond the schedule in the last 7 days.
    select 'overtime:' || r.id::text, 'excess_hours', 'low', r.employee_id, r.work_date,
           jsonb_build_object('overtime_minutes', r.overtime_minutes, 'work_minutes', r.work_minutes)
    from public.attendance_records r
    where r.company_id = p_company and r.work_date >= v_today - 7 and r.overtime_minutes >= 120

    union all
    -- Marked present on a day of approved leave.
    select 'leave_conflict:' || r.id::text, 'leave_conflict', 'medium', r.employee_id, r.work_date,
           jsonb_build_object('leave_id', l.id)
    from public.attendance_records r
    join public.leave_requests l on l.employee_id = r.employee_id and l.status = 'approved' and r.work_date between l.start_date and l.end_date and not l.half_day
    where r.company_id = p_company and r.work_date >= v_today - 30 and r.check_in_at is not null

    union all
    select 'pending_leave:' || l.id::text, 'pending_leave',
           case when l.created_at < now() - interval '3 days' then 'high' when l.created_at < now() - interval '1 day' then 'medium' else 'low' end,
           l.employee_id, l.start_date,
           jsonb_build_object('days', l.days, 'waiting_hours', floor(extract(epoch from (now() - l.created_at)) / 3600))
    from public.leave_requests l
    where l.company_id = p_company and l.status = 'pending'

    union all
    select 'pending_regularization:' || g.id::text, 'pending_regularization',
           case when g.created_at < now() - interval '3 days' then 'high' when g.created_at < now() - interval '1 day' then 'medium' else 'low' end,
           g.employee_id, g.work_date,
           jsonb_build_object('waiting_hours', floor(extract(epoch from (now() - g.created_at)) / 3600))
    from public.attendance_regularizations g
    where g.company_id = p_company and g.status = 'pending'

    union all
    select 'contract_expiry:' || e.id::text || ':' || e.contract_end_date::text, 'contract_expiry',
           case when e.contract_end_date <= v_today + 7 then 'high' else 'medium' end, e.id, e.contract_end_date,
           jsonb_build_object('days_left', e.contract_end_date - v_today)
    from emp e
    where e.status = 'active' and e.contract_end_date between v_today and v_today + 30

    union all
    select 'probation_end:' || e.id::text || ':' || e.probation_end_date::text, 'probation_end',
           case when e.probation_end_date <= v_today + 7 then 'medium' else 'low' end, e.id, e.probation_end_date,
           jsonb_build_object('days_left', e.probation_end_date - v_today)
    from emp e
    where e.status = 'active' and e.probation_end_date between v_today and v_today + 15

    union all
    select 'incomplete_profile:' || e.id::text, 'incomplete_profile', 'low', e.id, coalesce(e.date_of_joining, e.created_at::date),
           jsonb_build_object('missing', to_jsonb(array_remove(array[
             case when e.email is null then 'email' end,
             case when e.phone is null then 'phone' end,
             case when e.date_of_joining is null then 'date_of_joining' end,
             case when e.department is null then 'department' end], null)))
    from emp e
    where e.status = 'active' and (e.email is null or e.phone is null or e.date_of_joining is null or e.department is null)
  )
  select raw.k, raw.t,
         case when st.status = 'escalated' then 'critical' else raw.sev end,
         raw.eid, e.full_name, e.employee_code, e.department, raw.d, raw.det,
         coalesce(st.status, 'open'), st.snoozed_until, st.assigned_to, st.note
  from raw
  join emp e on e.id = raw.eid
  left join public.hr_alert_states st on st.company_id = p_company and st.alert_key = raw.k
  where coalesce(st.status, 'open') <> 'resolved'
    and (coalesce(st.status, 'open') <> 'snoozed' or st.snoozed_until <= v_today)
  order by case when st.status = 'escalated' then 0 when raw.sev = 'high' then 1 when raw.sev = 'medium' then 2 else 3 end, raw.d desc;
end $$;

-- ── Housekeeping triggers ───────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['shifts', 'shift_rotations', 'attendance_regularizations'] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_set_updated_at', t);
  end loop;
  foreach t in array array['shifts', 'shift_rotations', 'shift_assignments', 'shift_overrides', 'attendance_regularizations'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t || '_audit', t);
  end loop;
end $$;

-- ── Row Level Security ──────────────────────────────────────────────
alter table public.shifts enable row level security;
alter table public.shift_rotations enable row level security;
alter table public.shift_assignments enable row level security;
alter table public.shift_overrides enable row level security;
alter table public.attendance_breaks enable row level security;
alter table public.attendance_regularizations enable row level security;
alter table public.hr_alert_states enable row level security;

revoke all on public.shifts, public.shift_rotations, public.shift_assignments, public.shift_overrides,
  public.attendance_breaks, public.attendance_regularizations, public.hr_alert_states from anon;
grant select, insert, update, delete on public.shifts, public.shift_rotations, public.shift_assignments, public.shift_overrides,
  public.attendance_breaks, public.attendance_regularizations, public.hr_alert_states to authenticated;
grant all on public.shifts, public.shift_rotations, public.shift_assignments, public.shift_overrides,
  public.attendance_breaks, public.attendance_regularizations, public.hr_alert_states to service_role;

create policy shifts_select on public.shifts for select to authenticated using (public.is_company_member(company_id));
create policy shifts_write on public.shifts for all to authenticated
  using (public.is_company_hr(company_id)) with check (public.is_company_hr(company_id));

create policy rotations_select on public.shift_rotations for select to authenticated using (public.is_company_member(company_id));
create policy rotations_write on public.shift_rotations for all to authenticated
  using (public.is_company_hr(company_id)) with check (public.is_company_hr(company_id));

create policy assignments_select on public.shift_assignments for select to authenticated
  using (public.is_company_hr(company_id) or public.is_my_employee(employee_id));
create policy assignments_write on public.shift_assignments for all to authenticated
  using (public.is_company_hr(company_id)) with check (public.is_company_hr(company_id));

create policy overrides_select on public.shift_overrides for select to authenticated
  using (public.is_company_hr(company_id) or public.is_my_employee(employee_id));
create policy overrides_write on public.shift_overrides for all to authenticated
  using (public.is_company_hr(company_id)) with check (public.is_company_hr(company_id));

create policy breaks_select on public.attendance_breaks for select to authenticated
  using (public.is_company_hr(company_id) or public.is_my_employee(employee_id));
create policy breaks_write on public.attendance_breaks for all to authenticated
  using (public.is_company_hr(company_id)) with check (public.is_company_hr(company_id));

create policy regularizations_select on public.attendance_regularizations for select to authenticated
  using (public.is_company_hr(company_id) or public.is_my_employee(employee_id));
create policy regularizations_insert on public.attendance_regularizations for insert to authenticated
  with check (public.is_company_hr(company_id) or public.is_my_employee(employee_id));
create policy regularizations_update on public.attendance_regularizations for update to authenticated
  using (public.is_company_hr(company_id) or public.is_my_employee(employee_id))
  with check (public.is_company_hr(company_id) or public.is_my_employee(employee_id));

create policy alert_states_all on public.hr_alert_states for all to authenticated
  using (public.is_company_hr(company_id)) with check (public.is_company_hr(company_id));

-- ── Function privileges ─────────────────────────────────────────────
revoke execute on function public.clock_attendance(uuid, text, jsonb, text) from public, anon;
grant execute on function public.clock_attendance(uuid, text, jsonb, text) to authenticated, service_role;
revoke execute on function public.employee_shift_on(uuid, date) from public, anon;
grant execute on function public.employee_shift_on(uuid, date) to authenticated, service_role;
revoke execute on function public.hr_attention(uuid) from public, anon;
grant execute on function public.hr_attention(uuid) to authenticated, service_role;
