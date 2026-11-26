-- ════════════════════════════════════════════════════════════════════
-- 0009 — Leave automation
--   • Reporting-manager scope: is_manager_of(); managers see and decide their team's leave
--   • Two-level approval per leave type (manager → HR); one level = manager or HR
--   • Hourly permissions (leave types measured in hours, monthly hour limit)
--   • Monthly accrual and carry-forward of unused days (capped)
--   • Compensatory off: credits earned by working on an off day / holiday, used FIFO, expire
--   • leave_balances() for the UI and team_leave() for the team calendar
-- Only adds. Existing leave types keep "annual quota, no carry-forward, one level",
-- so balances and approvals of existing requests do not change.
-- ════════════════════════════════════════════════════════════════════

-- ── Manager scope ───────────────────────────────────────────────────
create or replace function public.is_manager_of(p_employee uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.employees e
    join public.employees m on m.id = e.reporting_manager_id
    join public.profiles p on p.id = m.user_id
    where e.id = p_employee and m.user_id = auth.uid() and m.status = 'active' and p.is_active
  );
$$;

-- ── Leave type policy ───────────────────────────────────────────────
alter table public.leave_types
  add column accrual             text not null default 'annual' check (accrual in ('annual', 'monthly')),
  add column carry_forward_max   numeric(5, 1) not null default 0 check (carry_forward_max >= 0),
  add column unit                text not null default 'day' check (unit in ('day', 'hour')),
  add column max_hours_per_month numeric(4, 1) check (max_hours_per_month is null or max_hours_per_month > 0),
  add column approval_levels     smallint not null default 1 check (approval_levels in (1, 2)),
  add column is_comp_off         boolean not null default false;
alter table public.leave_types add constraint leave_types_hour_rules
  check (unit = 'day' or (annual_quota is null and not is_comp_off and carry_forward_max = 0));
alter table public.leave_types add constraint leave_types_comp_off_rules
  check (not is_comp_off or (annual_quota is null and carry_forward_max = 0));

-- ── Compensatory off credits ────────────────────────────────────────
create table public.comp_off_credits (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  employee_id   uuid not null references public.employees (id) on delete cascade,
  work_date     date not null,
  days          numeric(3, 1) not null default 1 check (days in (0.5, 1)),
  reason        text check (reason is null or char_length(reason) <= 500),
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  expires_on    date,
  decided_by    uuid references public.profiles (id) on delete set null,
  decided_at    timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 500),
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (expires_on is null or expires_on >= work_date)
);
create unique index comp_off_credits_day_uniq on public.comp_off_credits (employee_id, work_date) where status in ('pending', 'approved');
create index comp_off_credits_company_idx on public.comp_off_credits (company_id, status);

-- ── Leave request columns ───────────────────────────────────────────
alter table public.leave_requests
  add column start_time         time,
  add column end_time           time,
  add column hours              numeric(4, 2),
  add column approval_step      smallint not null default 1 check (approval_step in (1, 2)),
  add column manager_decided_by uuid references public.profiles (id) on delete set null,
  add column manager_decided_at timestamptz,
  add column manager_note       text check (manager_note is null or char_length(manager_note) <= 500),
  add column comp_off_credit_id uuid references public.comp_off_credits (id) on delete set null;
alter table public.leave_requests add constraint leave_requests_hours_rules
  check ((start_time is null) = (end_time is null) and (start_time is null or (start_date = end_date and not half_day and end_time > start_time)));
create unique index leave_requests_credit_uniq on public.leave_requests (comp_off_credit_id)
  where comp_off_credit_id is not null and status in ('pending', 'approved');

-- ── Entitlement: accrual + carry-forward ────────────────────────────
-- Days a person is entitled to for one type in one year, accrued through p_through
-- (null = whole year). Carry-forward = unused days of the previous year, capped.
create or replace function public.leave_entitlement(p_employee uuid, p_type uuid, p_year integer, p_through date default null, p_with_carry boolean default true)
returns numeric
language plpgsql stable security definer set search_path = public as $$
declare
  v_t public.leave_types;
  v_join date;
  v_first integer;
  v_last integer;
  v_base numeric;
  v_prev numeric;
  v_prev_used numeric;
  v_carry numeric := 0;
begin
  select * into v_t from public.leave_types where id = p_type;
  if not found or v_t.annual_quota is null or v_t.unit <> 'day' or v_t.is_comp_off then return null; end if;
  select date_of_joining into v_join from public.employees where id = p_employee;
  if v_join is not null and extract(year from v_join)::int > p_year then return 0; end if;

  if v_t.accrual = 'monthly' then
    v_first := case when v_join is not null and extract(year from v_join)::int = p_year then extract(month from v_join)::int else 1 end;
    v_last := case
      when p_through is null or extract(year from p_through)::int > p_year then 12
      when extract(year from p_through)::int < p_year then 0
      else extract(month from p_through)::int
    end;
    v_base := floor(v_t.annual_quota * greatest(v_last - v_first + 1, 0) / 12.0 * 2) / 2;
  else
    v_base := v_t.annual_quota;
  end if;

  if p_with_carry and v_t.carry_forward_max > 0 and (v_join is null or extract(year from v_join)::int < p_year) then
    v_prev := coalesce(public.leave_entitlement(p_employee, p_type, p_year - 1, null, false), 0);
    select coalesce(sum(days), 0) into v_prev_used
    from public.leave_requests
    where employee_id = p_employee and leave_type_id = p_type and status = 'approved' and extract(year from start_date)::int = p_year - 1;
    v_carry := least(v_t.carry_forward_max, greatest(v_prev - v_prev_used, 0));
  end if;
  return v_base + v_carry;
end $$;

-- ── Leave request rules (replaces 0006 version) ─────────────────────
create or replace function public.leave_requests_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_emp public.employees;
  v_type public.leave_types;
  v_hr boolean;
  v_mgr boolean;
  v_used numeric;
  v_ent numeric;
  v_credit uuid;
begin
  select * into v_emp from public.employees where id = new.employee_id;
  if not found then raise exception 'employee not found' using errcode = '23503'; end if;
  new.company_id := v_emp.company_id;
  v_hr := auth.uid() is null or public.is_company_hr(v_emp.company_id);
  v_mgr := not v_hr and public.is_manager_of(new.employee_id);
  if not v_hr and not v_mgr and not public.is_my_employee(new.employee_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then
    if new.employee_id <> old.employee_id then raise exception 'employee cannot change' using errcode = '42501'; end if;
    -- Approval trail is written here only.
    new.approval_step := old.approval_step;
    new.manager_decided_by := old.manager_decided_by;
    new.manager_decided_at := old.manager_decided_at;
    new.manager_note := old.manager_note;

    if not v_hr then
      if (new.start_date, new.end_date, new.half_day, new.leave_type_id) is distinct from (old.start_date, old.end_date, old.half_day, old.leave_type_id)
         or (new.start_time, new.end_time) is distinct from (old.start_time, old.end_time) then
        raise exception 'only_cancel_pending' using errcode = '42501';
      end if;
      new.comp_off_credit_id := old.comp_off_credit_id;

      -- Reporting manager decides step 1.
      if v_mgr and old.status = 'pending' and old.approval_step = 1 and new.status in ('approved', 'rejected') then
        select * into v_type from public.leave_types where id = old.leave_type_id;
        new.manager_decided_by := auth.uid();
        new.manager_decided_at := now();
        new.manager_note := new.decision_note;
        if new.status = 'rejected' then
          new.decided_by := auth.uid();
          new.decided_at := now();
          new.comp_off_credit_id := null;
        elsif v_type.approval_levels >= 2 then
          new.status := 'pending';
          new.approval_step := 2;
          new.decision_note := old.decision_note;
        else
          new.decided_by := auth.uid();
          new.decided_at := now();
        end if;
        return new;
      end if;

      -- Employees may only withdraw their own pending request.
      if not (public.is_my_employee(old.employee_id) and old.status = 'pending' and new.status = 'cancelled') then
        raise exception 'only_cancel_pending' using errcode = '42501';
      end if;
      new.comp_off_credit_id := null;
      return new;
    end if;

    if new.status <> old.status and new.status in ('approved', 'rejected') then
      if old.status not in ('pending', 'approved') then
        raise exception 'cannot_decide' using errcode = '22023';
      end if;
      new.decided_by := coalesce(auth.uid(), new.decided_by);
      new.decided_at := now();
    end if;
    if new.status in ('rejected', 'cancelled') then new.comp_off_credit_id := null; end if;
    if new.status = old.status
       and (new.start_date, new.end_date, new.half_day, new.leave_type_id) = (old.start_date, old.end_date, old.half_day, old.leave_type_id)
       and (new.start_time, new.end_time) is not distinct from (old.start_time, old.end_time) then
      return new;
    end if;
  else
    if not v_hr and new.status <> 'pending' then
      raise exception 'new_requests_are_pending' using errcode = '42501';
    end if;
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.approval_step := 1;
    new.manager_decided_by := null;
    new.manager_decided_at := null;
    new.manager_note := null;
    new.comp_off_credit_id := null;
    if new.status = 'approved' then
      new.decided_by := coalesce(auth.uid(), new.decided_by);
      new.decided_at := now();
    end if;
  end if;

  select * into v_type from public.leave_types where id = new.leave_type_id;
  if not found or v_type.company_id <> v_emp.company_id or not v_type.is_active then
    raise exception 'invalid_leave_type' using errcode = '22023';
  end if;

  if v_type.unit = 'hour' then
    if new.start_time is null or new.end_time is null then raise exception 'hours_required' using errcode = '22023'; end if;
    if public.leave_days(new.employee_id, new.start_date, new.start_date, false) <= 0 then
      raise exception 'no_working_days' using errcode = '22023';
    end if;
    new.hours := round((extract(epoch from (new.end_time - new.start_time)) / 3600)::numeric, 2);
    new.days := 0;
  else
    if new.start_time is not null or new.end_time is not null then raise exception 'hours_not_allowed' using errcode = '22023'; end if;
    new.hours := null;
    new.days := public.leave_days(new.employee_id, new.start_date, new.end_date, new.half_day);
    if new.days <= 0 then raise exception 'no_working_days' using errcode = '22023'; end if;
  end if;

  if new.status in ('pending', 'approved') and exists (
    select 1 from public.leave_requests r
    where r.employee_id = new.employee_id and r.id <> new.id and r.status in ('pending', 'approved')
      and r.start_date <= new.end_date and r.end_date >= new.start_date
      and not (r.hours is not null and new.hours is not null and (r.end_time <= new.start_time or r.start_time >= new.end_time))
  ) then
    raise exception 'leave_overlap' using errcode = '23505';
  end if;

  if new.status in ('pending', 'approved') then
    if v_type.unit = 'hour' then
      if v_type.max_hours_per_month is not null then
        select coalesce(sum(hours), 0) into v_used
        from public.leave_requests r
        where r.employee_id = new.employee_id and r.leave_type_id = new.leave_type_id and r.id <> new.id
          and r.status in ('pending', 'approved') and date_trunc('month', r.start_date) = date_trunc('month', new.start_date);
        if v_used + new.hours > v_type.max_hours_per_month then
          raise exception 'insufficient_balance' using errcode = '23514';
        end if;
      end if;
    elsif v_type.is_comp_off then
      if new.start_date <> new.end_date then raise exception 'comp_off_single_day' using errcode = '22023'; end if;
      if new.comp_off_credit_id is null then
        select c.id into v_credit
        from public.comp_off_credits c
        where c.employee_id = new.employee_id and c.status = 'approved' and c.expires_on >= new.start_date and c.days >= new.days
          and not exists (select 1 from public.leave_requests r where r.comp_off_credit_id = c.id and r.id <> new.id and r.status in ('pending', 'approved'))
        order by (c.days = new.days) desc, c.expires_on, c.work_date
        limit 1
        for update;
        if v_credit is null then raise exception 'insufficient_balance' using errcode = '23514'; end if;
        new.comp_off_credit_id := v_credit;
      end if;
    elsif v_type.annual_quota is not null then
      v_ent := public.leave_entitlement(new.employee_id, new.leave_type_id, extract(year from new.start_date)::int, new.start_date, true);
      select coalesce(sum(days), 0) into v_used
      from public.leave_requests r
      where r.employee_id = new.employee_id and r.leave_type_id = new.leave_type_id and r.id <> new.id
        and r.status in ('pending', 'approved')
        and extract(year from r.start_date) = extract(year from new.start_date);
      if v_used + new.days > v_ent then
        raise exception 'insufficient_balance' using errcode = '23514';
      end if;
    end if;
  end if;
  return new;
end $$;

-- ── Comp-off credit rules ───────────────────────────────────────────
create or replace function public.comp_off_credits_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_emp public.employees;
  v_hr boolean;
  v_mgr boolean;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  select * into v_emp from public.employees where id = new.employee_id;
  if not found then raise exception 'employee not found' using errcode = '23503'; end if;
  new.company_id := v_emp.company_id;
  v_hr := auth.uid() is null or public.is_company_hr(v_emp.company_id);
  v_mgr := not v_hr and public.is_manager_of(new.employee_id);
  -- Refuse outsiders before any check that could reveal another person's data.
  if not v_hr and not v_mgr and not public.is_my_employee(new.employee_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    if not v_hr then
      if new.status <> 'pending' then raise exception 'new_requests_are_pending' using errcode = '42501'; end if;
      if new.work_date > v_today then raise exception 'future_date' using errcode = '22023'; end if;
      if public.leave_days(new.employee_id, new.work_date, new.work_date, false) > 0 then
        raise exception 'not_an_off_day' using errcode = '22023';
      end if;
      if not exists (select 1 from public.attendance_records a where a.employee_id = new.employee_id and a.work_date = new.work_date and a.check_in_at is not null) then
        raise exception 'no_attendance_on_day' using errcode = '22023';
      end if;
      new.expires_on := new.work_date + 90;
      new.decided_by := null;
      new.decided_at := null;
    else
      new.expires_on := coalesce(new.expires_on, new.work_date + 90);
      if new.status in ('approved', 'rejected') then
        new.decided_by := coalesce(auth.uid(), new.decided_by);
        new.decided_at := now();
      end if;
    end if;
    return new;
  end if;

  if new.employee_id <> old.employee_id then raise exception 'employee cannot change' using errcode = '42501'; end if;
  if not v_hr then
    if (new.work_date, new.days, new.expires_on) is distinct from (old.work_date, old.days, old.expires_on) then
      raise exception 'only_cancel_pending' using errcode = '42501';
    end if;
    if v_mgr and old.status = 'pending' and new.status in ('approved', 'rejected') then
      new.decided_by := auth.uid();
      new.decided_at := now();
      return new;
    end if;
    if not (public.is_my_employee(old.employee_id) and old.status = 'pending' and new.status = 'cancelled') then
      raise exception 'only_cancel_pending' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.status <> old.status and new.status in ('approved', 'rejected') then
    new.decided_by := coalesce(auth.uid(), new.decided_by);
    new.decided_at := now();
  end if;
  if old.status = 'approved' and new.status <> 'approved'
     and exists (select 1 from public.leave_requests r where r.comp_off_credit_id = old.id and r.status in ('pending', 'approved')) then
    raise exception 'credit_in_use' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger comp_off_credits_before before insert or update on public.comp_off_credits
  for each row execute function public.comp_off_credits_before();
create trigger comp_off_credits_set_updated_at before update on public.comp_off_credits
  for each row execute function public.set_updated_at();
create trigger comp_off_credits_audit after insert or update or delete on public.comp_off_credits
  for each row execute function public.audit_row_change();

-- ── Balances for the UI ─────────────────────────────────────────────
create or replace function public.leave_balances(p_employee uuid, p_year integer)
returns table (
  leave_type_id uuid, unit text, is_comp_off boolean, entitled numeric, carried numeric,
  used numeric, pending numeric, available numeric, hours_used_month numeric, hours_limit numeric
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_emp public.employees;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_through date;
  t public.leave_types;
  v_ent numeric;
  v_base numeric;
  v_used numeric;
  v_pending numeric;
begin
  select * into v_emp from public.employees where id = p_employee;
  if not found then return; end if;
  if auth.uid() is not null and not (public.is_company_hr(v_emp.company_id) or v_emp.user_id = auth.uid() or public.is_manager_of(p_employee)) then
    return;
  end if;
  v_through := case when p_year = extract(year from v_today)::int then v_today else make_date(p_year, 12, 31) end;

  for t in select * from public.leave_types where company_id = v_emp.company_id and is_active order by sort_order, name loop
    leave_type_id := t.id;
    unit := t.unit;
    is_comp_off := t.is_comp_off;
    hours_used_month := null;
    hours_limit := null;
    entitled := null;
    carried := 0;
    if t.unit = 'hour' then
      select coalesce(sum(hours), 0) into v_used from public.leave_requests r
      where r.employee_id = p_employee and r.leave_type_id = t.id and r.status in ('pending', 'approved')
        and date_trunc('month', r.start_date) = date_trunc('month', v_today);
      used := 0; pending := 0;
      hours_used_month := v_used;
      hours_limit := t.max_hours_per_month;
      available := case when t.max_hours_per_month is null then null else greatest(t.max_hours_per_month - v_used, 0) end;
    else
      select coalesce(sum(days) filter (where status = 'approved'), 0), coalesce(sum(days) filter (where status = 'pending'), 0)
        into v_used, v_pending
      from public.leave_requests r
      where r.employee_id = p_employee and r.leave_type_id = t.id and extract(year from r.start_date)::int = p_year;
      used := v_used;
      pending := v_pending;
      if t.is_comp_off then
        select coalesce(sum(c.days), 0) into available
        from public.comp_off_credits c
        where c.employee_id = p_employee and c.status = 'approved' and c.expires_on >= v_today
          and not exists (select 1 from public.leave_requests r where r.comp_off_credit_id = c.id and r.status in ('pending', 'approved'));
        entitled := available + v_used + v_pending;
      elsif t.annual_quota is null then
        available := null;
      else
        v_ent := public.leave_entitlement(p_employee, t.id, p_year, v_through, true);
        v_base := public.leave_entitlement(p_employee, t.id, p_year, v_through, false);
        entitled := v_ent;
        carried := v_ent - v_base;
        available := greatest(v_ent - v_used - v_pending, 0);
      end if;
    end if;
    return next;
  end loop;
end $$;

-- ── Team calendar ───────────────────────────────────────────────────
-- HR: everyone. Others: their department, manager, team-mates and reports.
-- Returns no reasons or notes — just who is away and when.
create or replace function public.team_leave(p_company uuid, p_from date, p_to date)
returns table (
  request_id uuid, employee_id uuid, full_name text, department text, leave_code text, leave_name text,
  start_date date, end_date date, half_day boolean, start_time time, end_time time, status text
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_hr boolean := public.is_company_hr(p_company);
  v_me public.employees;
begin
  if p_to < p_from or p_to - p_from > 62 then raise exception 'range_too_long' using errcode = '22023'; end if;
  if not public.is_company_member(p_company) then return; end if;
  if not v_hr then
    select * into v_me from public.employees x where x.company_id = p_company and x.user_id = auth.uid() and x.status = 'active';
    if not found then return; end if;
  end if;
  return query
    select r.id, e.id, e.full_name, e.department, t.code, t.name, r.start_date, r.end_date, r.half_day, r.start_time, r.end_time, r.status
    from public.leave_requests r
    join public.employees e on e.id = r.employee_id
    join public.leave_types t on t.id = r.leave_type_id
    where r.company_id = p_company and r.status in ('pending', 'approved')
      and r.start_date <= p_to and r.end_date >= p_from
      and (
        v_hr
        or e.id = v_me.id
        or e.reporting_manager_id = v_me.id
        or e.id = v_me.reporting_manager_id
        or (v_me.reporting_manager_id is not null and e.reporting_manager_id = v_me.reporting_manager_id)
        or (v_me.department is not null and e.department = v_me.department)
      )
    order by r.start_date, e.full_name
    limit 2000;
end $$;

-- ── Default types: Comp-off and Permission ──────────────────────────
create or replace function public.seed_hr_defaults(p_company uuid) returns void
language sql security definer set search_path = public as $$
  insert into public.leave_types (company_id, name, code, annual_quota, is_paid, sort_order) values
    (p_company, 'Casual Leave', 'CL', 12, true, 1),
    (p_company, 'Sick Leave',   'SL', 12, true, 2),
    (p_company, 'Earned Leave', 'EL', 15, true, 3),
    (p_company, 'Loss of Pay',  'LOP', null, false, 4)
  on conflict (company_id, code) do nothing;
  insert into public.leave_types (company_id, name, code, annual_quota, is_paid, sort_order, is_comp_off) values
    (p_company, 'Compensatory Off', 'CO', null, true, 5, true)
  on conflict (company_id, code) do nothing;
  insert into public.leave_types (company_id, name, code, annual_quota, is_paid, sort_order, unit, max_hours_per_month) values
    (p_company, 'Permission', 'PER', null, true, 6, 'hour', 4)
  on conflict (company_id, code) do nothing;
$$;
select public.seed_hr_defaults(id) from public.companies;

-- ── Row Level Security ──────────────────────────────────────────────
alter table public.comp_off_credits enable row level security;
revoke all on public.comp_off_credits from anon;
grant select, insert, update, delete on public.comp_off_credits to authenticated;
grant all on public.comp_off_credits to service_role;

create policy comp_off_select on public.comp_off_credits for select to authenticated
  using (public.is_company_hr(company_id) or public.is_my_employee(employee_id) or public.is_manager_of(employee_id));
create policy comp_off_insert on public.comp_off_credits for insert to authenticated
  with check (public.is_company_hr(company_id) or public.is_my_employee(employee_id));
create policy comp_off_update on public.comp_off_credits for update to authenticated
  using (public.is_company_hr(company_id) or public.is_my_employee(employee_id) or public.is_manager_of(employee_id))
  with check (public.is_company_hr(company_id) or public.is_my_employee(employee_id) or public.is_manager_of(employee_id));
create policy comp_off_delete on public.comp_off_credits for delete to authenticated
  using (public.is_company_hr(company_id));

-- Managers read their team's records and decide their leave (never insert or delete).
create policy employees_select_manager on public.employees for select to authenticated
  using (public.is_manager_of(id));
create policy attendance_select_manager on public.attendance_records for select to authenticated
  using (public.is_manager_of(employee_id));
create policy leave_select_manager on public.leave_requests for select to authenticated
  using (public.is_manager_of(employee_id));
create policy leave_update_manager on public.leave_requests for update to authenticated
  using (public.is_manager_of(employee_id)) with check (public.is_manager_of(employee_id));

-- ── Function privileges ─────────────────────────────────────────────
revoke execute on function public.leave_entitlement(uuid, uuid, integer, date, boolean) from public, anon, authenticated;
grant execute on function public.leave_entitlement(uuid, uuid, integer, date, boolean) to service_role;
revoke execute on function public.is_manager_of(uuid) from public, anon;
grant execute on function public.is_manager_of(uuid) to authenticated, service_role;
revoke execute on function public.leave_balances(uuid, integer) from public, anon;
grant execute on function public.leave_balances(uuid, integer) to authenticated, service_role;
revoke execute on function public.team_leave(uuid, date, date) from public, anon;
grant execute on function public.team_leave(uuid, date, date) to authenticated, service_role;
