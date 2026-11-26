-- ════════════════════════════════════════════════════════════════════
-- 0016 — Company assets, approval delegation and approval time limits
--   • company_assets + asset_assignments (one open assignment per asset;
--     the asset's status follows the assignment)
--   • approval_delegations: while a manager is away, a colleague approves
--     their team's leave and comp-off (extends is_manager_of)
--   • hr_settings: after how many hours approvals are reminded / escalated
-- ════════════════════════════════════════════════════════════════════

-- ── Assets ──────────────────────────────────────────────────────────
create table public.company_assets (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  asset_tag     text not null check (char_length(asset_tag) between 1 and 40),
  name          text not null check (char_length(name) between 2 and 120),
  category      text not null default 'other' check (category in ('laptop', 'phone', 'id_card', 'sim', 'vehicle', 'tool', 'uniform', 'other')),
  serial_no     text check (serial_no is null or char_length(serial_no) <= 80),
  status        text not null default 'available' check (status in ('available', 'assigned', 'repair', 'retired')),
  purchased_on  date,
  note          text check (note is null or char_length(note) <= 500),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, asset_tag)
);

create table public.asset_assignments (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  asset_id     uuid not null references public.company_assets (id) on delete cascade,
  employee_id  uuid not null references public.employees (id) on delete cascade,
  assigned_on  date not null default (now() at time zone 'Asia/Kolkata')::date,
  returned_on  date,
  note         text check (note is null or char_length(note) <= 500),
  assigned_by  uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  check (returned_on is null or returned_on >= assigned_on)
);
create unique index asset_assignments_open_uniq on public.asset_assignments (asset_id) where returned_on is null;
create index asset_assignments_employee_idx on public.asset_assignments (employee_id);

create or replace function public.asset_assignments_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare a public.company_assets;
begin
  select * into a from public.company_assets where id = new.asset_id for update;
  if not found then raise exception 'asset not found' using errcode = '23503'; end if;
  new.company_id := a.company_id;
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.employees e where e.id = new.employee_id and e.company_id = a.company_id and e.status = 'active') then
      raise exception 'invalid_employee' using errcode = '22023';
    end if;
    if a.status <> 'available' then raise exception 'asset_not_available' using errcode = '23505'; end if;
    new.returned_on := null;
    new.assigned_by := coalesce(auth.uid(), new.assigned_by);
  elsif (new.asset_id, new.employee_id, new.assigned_on) is distinct from (old.asset_id, old.employee_id, old.assigned_on)
        or (old.returned_on is not null and new.returned_on is distinct from old.returned_on) then
    raise exception 'assignment_fixed' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger asset_assignments_before before insert or update on public.asset_assignments
  for each row execute function public.asset_assignments_before();

create or replace function public.asset_assignments_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.company_assets set status = 'assigned' where id = new.asset_id;
  elsif new.returned_on is not null and old.returned_on is null then
    update public.company_assets set status = 'available' where id = new.asset_id and status = 'assigned';
  end if;
  return null;
end $$;
create trigger asset_assignments_after after insert or update on public.asset_assignments
  for each row execute function public.asset_assignments_after();

-- "Assigned" is only ever set by an assignment, and an asset in use cannot change status by hand.
create or replace function public.company_assets_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() = 1 then
    if tg_op = 'INSERT' and new.status = 'assigned' then raise exception 'asset_assigned' using errcode = '22023'; end if;
    if tg_op = 'UPDATE' and new.status <> old.status and (new.status = 'assigned' or old.status = 'assigned') then
      raise exception 'asset_assigned' using errcode = '22023';
    end if;
    if tg_op = 'UPDATE' and new.company_id <> old.company_id then raise exception 'not_allowed' using errcode = '42501'; end if;
  end if;
  return new;
end $$;
create trigger company_assets_before before insert or update on public.company_assets
  for each row execute function public.company_assets_before();

-- ── Approval delegation ─────────────────────────────────────────────
create table public.approval_delegations (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies (id) on delete cascade,
  manager_employee_id  uuid not null references public.employees (id) on delete cascade,
  delegate_employee_id uuid not null references public.employees (id) on delete cascade,
  from_date            date not null,
  to_date              date not null,
  note                 text check (note is null or char_length(note) <= 300),
  created_by           uuid references public.profiles (id) on delete set null,
  created_at           timestamptz not null default now(),
  check (to_date >= from_date and to_date - from_date <= 180),
  check (manager_employee_id <> delegate_employee_id)
);
create index approval_delegations_delegate_idx on public.approval_delegations (delegate_employee_id, to_date);

create or replace function public.approval_delegations_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_company uuid;
begin
  select company_id into v_company from public.employees where id = new.manager_employee_id;
  if v_company is null then raise exception 'employee not found' using errcode = '23503'; end if;
  new.company_id := v_company;
  if not exists (select 1 from public.employees where id = new.delegate_employee_id and company_id = v_company and status = 'active') then
    raise exception 'invalid_employee' using errcode = '22023';
  end if;
  new.created_by := coalesce(auth.uid(), new.created_by);
  return new;
end $$;
create trigger approval_delegations_before before insert or update on public.approval_delegations
  for each row execute function public.approval_delegations_before();

-- Direct reporting manager, or someone that manager has delegated to for today.
-- Nobody is ever the approver of their own requests.
create or replace function public.is_manager_of(p_employee uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.employees e
    join public.employees m on m.company_id = e.company_id and m.user_id = auth.uid() and m.status = 'active'
    join public.profiles p on p.id = m.user_id and p.is_active
    where e.id = p_employee and e.id <> m.id
      and (
        e.reporting_manager_id = m.id
        or exists (
          select 1 from public.approval_delegations d
          where d.manager_employee_id = e.reporting_manager_id and d.delegate_employee_id = m.id
            and (now() at time zone 'Asia/Kolkata')::date between d.from_date and d.to_date
        )
      )
  );
$$;

-- The people whose requests the caller can decide as manager or delegate.
create or replace function public.my_approval_team(p_company uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select e.id from public.employees e where e.company_id = p_company and e.status <> 'exited' and public.is_manager_of(e.id);
$$;

-- ── Approval time limits ────────────────────────────────────────────
create table public.hr_settings (
  company_id           uuid primary key references public.companies (id) on delete cascade,
  remind_after_hours   integer not null default 24 check (remind_after_hours between 1 and 240),
  escalate_after_hours integer not null default 72 check (escalate_after_hours between 2 and 720),
  updated_at           timestamptz not null default now(),
  check (escalate_after_hours > remind_after_hours)
);
create trigger hr_settings_set_updated_at before update on public.hr_settings
  for each row execute function public.set_updated_at();

do $$
declare t text;
begin
  foreach t in array array['company_assets'] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_set_updated_at', t);
  end loop;
  foreach t in array array['company_assets', 'asset_assignments', 'approval_delegations', 'hr_settings'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t || '_audit', t);
  end loop;
end $$;

-- ── Row Level Security ──────────────────────────────────────────────
alter table public.company_assets enable row level security;
alter table public.asset_assignments enable row level security;
alter table public.approval_delegations enable row level security;
alter table public.hr_settings enable row level security;
revoke all on public.company_assets, public.asset_assignments, public.approval_delegations, public.hr_settings from anon;
grant select, insert, update, delete on public.company_assets, public.asset_assignments, public.approval_delegations, public.hr_settings to authenticated;
grant all on public.company_assets, public.asset_assignments, public.approval_delegations, public.hr_settings to service_role;

create or replace function public.holds_asset(p_asset uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.asset_assignments a join public.employees e on e.id = a.employee_id
    where a.asset_id = p_asset and a.returned_on is null and e.user_id = auth.uid()
  );
$$;

create policy assets_hr on public.company_assets for all to authenticated
  using (public.is_company_hr(company_id)) with check (public.is_company_hr(company_id));
create policy assets_holder on public.company_assets for select to authenticated using (public.holds_asset(id));
create policy asset_assignments_hr on public.asset_assignments for all to authenticated
  using (public.is_company_hr(company_id)) with check (public.is_company_hr(company_id));
create policy asset_assignments_own on public.asset_assignments for select to authenticated using (public.is_my_employee(employee_id));

-- A manager hands over their own approvals; HR can set it for anyone.
create policy delegations_select on public.approval_delegations for select to authenticated
  using (public.is_company_hr(company_id) or public.is_my_employee(manager_employee_id) or public.is_my_employee(delegate_employee_id));
create policy delegations_write on public.approval_delegations for all to authenticated
  using (public.is_company_hr(company_id) or public.is_my_employee(manager_employee_id))
  with check (public.is_company_hr(company_id) or public.is_my_employee(manager_employee_id));

create policy hr_settings_hr on public.hr_settings for all to authenticated
  using (public.is_company_hr(company_id)) with check (public.is_company_hr(company_id));

revoke execute on function public.my_approval_team(uuid) from public, anon;
grant execute on function public.my_approval_team(uuid) to authenticated, service_role;
revoke execute on function public.holds_asset(uuid) from public, anon;
grant execute on function public.holds_asset(uuid) to authenticated, service_role;

-- Names only (no other details), for choosing and showing a delegate. HR and
-- people with direct reports see all active colleagues; others get nothing.
create or replace function public.colleague_names(p_company uuid)
returns table (id uuid, full_name text)
language sql stable security definer set search_path = public as $$
  select e.id, e.full_name
  from public.employees e
  where e.company_id = p_company and e.status = 'active'
    and (
      public.is_company_hr(p_company)
      or exists (
        select 1 from public.employees m join public.employees r on r.reporting_manager_id = m.id
        where m.company_id = p_company and m.user_id = auth.uid() and m.status = 'active'
      )
    )
  order by e.full_name;
$$;
revoke execute on function public.colleague_names(uuid) from public, anon;
grant execute on function public.colleague_names(uuid) to authenticated, service_role;

-- A delegate needs to see the names of the team they are covering.
-- (employees_select_manager from 0009 already uses is_manager_of, which now includes delegates.)
