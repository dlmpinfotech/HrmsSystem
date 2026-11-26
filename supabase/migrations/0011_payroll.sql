-- ════════════════════════════════════════════════════════════════════
-- 0011 — Payroll
--   • payroll_settings: PF / ESI / Tamil Nadu professional tax rules per company
--   • salary_structures: monthly components per employee, dated (latest one wins)
--   • payroll_runs + payslips: one run per company per month
--   • generate_payroll(): LOP from attendance + leave, pro-rated earnings,
--     PF (wage ceiling), ESI (wage limit), PT (half-yearly slabs), TDS
--   • finalize / reopen; employees see only their finalized payslips
-- Runs and payslips are written only by these functions (no direct writes).
-- ════════════════════════════════════════════════════════════════════

create table public.payroll_settings (
  company_id         uuid primary key references public.companies (id) on delete cascade,
  pf_enabled         boolean not null default true,
  pf_employee_rate   numeric(5, 2) not null default 12 check (pf_employee_rate between 0 and 20),
  pf_employer_rate   numeric(5, 2) not null default 12 check (pf_employer_rate between 0 and 20),
  pf_wage_ceiling    numeric(10, 2) not null default 15000 check (pf_wage_ceiling > 0),
  pf_cap_at_ceiling  boolean not null default true,
  esi_enabled        boolean not null default true,
  esi_employee_rate  numeric(5, 2) not null default 0.75 check (esi_employee_rate between 0 and 10),
  esi_employer_rate  numeric(5, 2) not null default 3.25 check (esi_employer_rate between 0 and 10),
  esi_wage_limit     numeric(10, 2) not null default 21000 check (esi_wage_limit > 0),
  pt_enabled         boolean not null default true,
  pt_frequency       text not null default 'half_yearly' check (pt_frequency in ('half_yearly', 'monthly')),
  -- Half-yearly income slabs → tax for the half year ("upto": null = and above). Tamil Nadu (2024 revision).
  pt_slabs           jsonb not null default '[{"upto":21000,"tax":0},{"upto":30000,"tax":180},{"upto":45000,"tax":425},{"upto":60000,"tax":930},{"upto":75000,"tax":1025},{"upto":null,"tax":1250}]'::jsonb
                     check (jsonb_typeof(pt_slabs) = 'array'),
  updated_by         uuid references public.profiles (id) on delete set null,
  updated_at         timestamptz not null default now()
);

create table public.salary_structures (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id) on delete cascade,
  employee_id       uuid not null references public.employees (id) on delete cascade,
  effective_from    date not null,
  basic             numeric(12, 2) not null check (basic >= 0),
  hra               numeric(12, 2) not null default 0 check (hra >= 0),
  conveyance        numeric(12, 2) not null default 0 check (conveyance >= 0),
  special_allowance numeric(12, 2) not null default 0 check (special_allowance >= 0),
  other_allowance   numeric(12, 2) not null default 0 check (other_allowance >= 0),
  other_deduction   numeric(12, 2) not null default 0 check (other_deduction >= 0),
  tds_monthly       numeric(12, 2) not null default 0 check (tds_monthly >= 0),
  pf_applicable     boolean not null default true,
  esi_applicable    boolean not null default true,
  pt_applicable     boolean not null default true,
  note              text check (note is null or char_length(note) <= 300),
  created_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (employee_id, effective_from)
);
create index salary_structures_company_idx on public.salary_structures (company_id);

create table public.payroll_runs (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies (id) on delete cascade,
  period              date not null check (extract(day from period) = 1),
  status              text not null default 'draft' check (status in ('draft', 'finalized')),
  employee_count      integer not null default 0,
  total_gross         numeric(14, 2) not null default 0,
  total_deductions    numeric(14, 2) not null default 0,
  total_net           numeric(14, 2) not null default 0,
  total_employer_cost numeric(14, 2) not null default 0,
  generated_at        timestamptz,
  generated_by        uuid references public.profiles (id) on delete set null,
  finalized_at        timestamptz,
  finalized_by        uuid references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (company_id, period)
);

create table public.payslips (
  id                uuid primary key default gen_random_uuid(),
  run_id            uuid not null references public.payroll_runs (id) on delete cascade,
  company_id        uuid not null references public.companies (id) on delete cascade,
  employee_id       uuid not null references public.employees (id) on delete cascade,
  period            date not null,
  employee_code     text not null,
  employee_name     text not null,
  department        text,
  designation       text,
  days_in_month     integer not null,
  paid_days         numeric(4, 1) not null,
  lop_days          numeric(4, 1) not null,
  basic             numeric(12, 2) not null default 0,
  hra               numeric(12, 2) not null default 0,
  conveyance        numeric(12, 2) not null default 0,
  special_allowance numeric(12, 2) not null default 0,
  other_allowance   numeric(12, 2) not null default 0,
  gross             numeric(12, 2) not null default 0,
  pf_employee       numeric(12, 2) not null default 0,
  esi_employee      numeric(12, 2) not null default 0,
  professional_tax  numeric(12, 2) not null default 0,
  tds               numeric(12, 2) not null default 0,
  other_deduction   numeric(12, 2) not null default 0,
  total_deductions  numeric(12, 2) not null default 0,
  net_pay           numeric(12, 2) not null default 0,
  pf_employer       numeric(12, 2) not null default 0,
  esi_employer      numeric(12, 2) not null default 0,
  emailed_at        timestamptz,
  email_error       text,
  created_at        timestamptz not null default now(),
  unique (run_id, employee_id)
);
create index payslips_employee_idx on public.payslips (employee_id, period desc);

-- ── Structure rules ─────────────────────────────────────────────────
create or replace function public.salary_structures_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_company uuid;
begin
  select company_id into v_company from public.employees where id = new.employee_id;
  if v_company is null then raise exception 'employee not found' using errcode = '23503'; end if;
  new.company_id := v_company;
  if tg_op = 'INSERT' then new.created_by := coalesce(auth.uid(), new.created_by); end if;
  return new;
end $$;
create trigger salary_structures_before before insert or update on public.salary_structures
  for each row execute function public.salary_structures_before();

create or replace function public.payroll_settings_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := now();
  return new;
end $$;
create trigger payroll_settings_before before insert or update on public.payroll_settings
  for each row execute function public.payroll_settings_before();

do $$
declare t text;
begin
  foreach t in array array['salary_structures', 'payroll_runs'] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_set_updated_at', t);
  end loop;
  foreach t in array array['salary_structures', 'payroll_settings', 'payroll_runs'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t || '_audit', t);
  end loop;
end $$;

-- ── Professional tax ────────────────────────────────────────────────
create or replace function public.pt_for_half_year(p_slabs jsonb, p_income numeric) returns numeric
language sql immutable as $$
  select coalesce((
    select (s ->> 'tax')::numeric
    from jsonb_array_elements(p_slabs) with ordinality as x(s, n)
    where s ->> 'upto' is null or p_income <= (s ->> 'upto')::numeric
    order by n
    limit 1
  ), 0);
$$;

-- ── Loss of pay ─────────────────────────────────────────────────────
-- Unpaid days in [p_start, p_end]: absent working days, half days (0.5), unpaid leave,
-- and days before joining / after exit. Future days count as paid.
create or replace function public.payroll_lop_days(p_employee uuid, p_start date, p_end date) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare
  v_emp public.employees;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_lop numeric := 0;
  d date;
  v_att text;
  v_found boolean;
  v_lv_half boolean;
  v_lv_paid boolean;
  v_lv_found boolean;
  v_off boolean;
begin
  select * into v_emp from public.employees where id = p_employee;
  if not found then return 0; end if;
  for d in select g::date from generate_series(p_start, p_end, interval '1 day') g loop
    if (v_emp.date_of_joining is not null and d < v_emp.date_of_joining) or (v_emp.exit_date is not null and d > v_emp.exit_date) then
      v_lop := v_lop + 1;
      continue;
    end if;

    select a.status into v_att from public.attendance_records a where a.employee_id = p_employee and a.work_date = d;
    v_found := found;
    select r.half_day, t.is_paid into v_lv_half, v_lv_paid
    from public.leave_requests r join public.leave_types t on t.id = r.leave_type_id
    where r.employee_id = p_employee and r.status = 'approved' and t.unit = 'day' and d between r.start_date and r.end_date
    order by t.is_paid, r.half_day
    limit 1;
    v_lv_found := found;

    if v_found then
      if v_att = 'half_day' then v_lop := v_lop + 0.5;
      elsif v_att = 'absent' then v_lop := v_lop + 1;
      elsif v_att = 'on_leave' and v_lv_found and not v_lv_paid then v_lop := v_lop + case when v_lv_half then 0.5 else 1 end;
      end if;
      continue;
    end if;

    if v_lv_found then
      if not v_lv_paid then v_lop := v_lop + case when v_lv_half then 0.5 else 1 end;
      elsif v_lv_half and d <= v_today then v_lop := v_lop + 0.5; -- other half of the day not worked
      end if;
      continue;
    end if;

    v_off := exists (select 1 from public.holidays h where h.company_id = v_emp.company_id and h.holiday_date = d)
      or exists (select 1 from public.shift_overrides o where o.employee_id = p_employee and o.work_date = d and o.shift_id is null)
      or (extract(dow from d)::smallint = any (v_emp.weekly_offs)
          and not exists (select 1 from public.shift_overrides o where o.employee_id = p_employee and o.work_date = d and o.shift_id is not null));
    if v_off or d > v_today then continue; end if;
    v_lop := v_lop + 1;
  end loop;
  return v_lop;
end $$;

-- ── Generate (or regenerate) a month ────────────────────────────────
create or replace function public.generate_payroll(p_company uuid, p_period date)
returns public.payroll_runs
language plpgsql security definer set search_path = public as $$
declare
  v_start date := date_trunc('month', p_period)::date;
  v_end date := (date_trunc('month', p_period) + interval '1 month - 1 day')::date;
  v_dim integer;
  v_set public.payroll_settings;
  v_run public.payroll_runs;
  e public.employees;
  s public.salary_structures;
  v_lop numeric;
  v_paid numeric;
  f numeric;
  v_basic numeric; v_hra numeric; v_conv numeric; v_special numeric; v_other numeric; v_gross numeric;
  v_full numeric; v_pf_wage numeric; v_pf numeric; v_pf_er numeric; v_esi numeric; v_esi_er numeric; v_pt numeric; v_tax numeric; v_ded numeric;
begin
  if auth.uid() is not null and not public.is_company_hr(p_company) then raise exception 'not_allowed' using errcode = '42501'; end if;
  v_dim := extract(day from v_end)::int;
  insert into public.payroll_settings (company_id) values (p_company) on conflict (company_id) do nothing;
  select * into v_set from public.payroll_settings where company_id = p_company;
  insert into public.payroll_runs (company_id, period) values (p_company, v_start) on conflict (company_id, period) do nothing;
  select * into v_run from public.payroll_runs where company_id = p_company and period = v_start for update;
  if v_run.status = 'finalized' then raise exception 'payroll_finalized' using errcode = '22023'; end if;

  delete from public.payslips where run_id = v_run.id;

  for e in
    select * from public.employees
    where company_id = p_company and status in ('active', 'exited')
      and (date_of_joining is null or date_of_joining <= v_end)
      and (exit_date is null or exit_date >= v_start)
    order by employee_code
  loop
    select * into s from public.salary_structures where employee_id = e.id and effective_from <= v_end order by effective_from desc limit 1;
    continue when not found;

    v_lop := least(public.payroll_lop_days(e.id, v_start, v_end), v_dim);
    v_paid := v_dim - v_lop;
    f := v_paid / v_dim;
    v_basic := round(s.basic * f);
    v_hra := round(s.hra * f);
    v_conv := round(s.conveyance * f);
    v_special := round(s.special_allowance * f);
    v_other := round(s.other_allowance * f);
    v_gross := v_basic + v_hra + v_conv + v_special + v_other;
    v_full := s.basic + s.hra + s.conveyance + s.special_allowance + s.other_allowance;

    v_pf := 0; v_pf_er := 0;
    if v_set.pf_enabled and s.pf_applicable then
      v_pf_wage := case when v_set.pf_cap_at_ceiling then least(v_basic, v_set.pf_wage_ceiling) else v_basic end;
      v_pf := round(v_pf_wage * v_set.pf_employee_rate / 100);
      v_pf_er := round(v_pf_wage * v_set.pf_employer_rate / 100);
    end if;

    v_esi := 0; v_esi_er := 0;
    if v_set.esi_enabled and s.esi_applicable and v_full <= v_set.esi_wage_limit and v_gross > 0 then
      v_esi := ceil(v_gross * v_set.esi_employee_rate / 100);
      v_esi_er := ceil(v_gross * v_set.esi_employer_rate / 100);
    end if;

    v_pt := 0;
    if v_set.pt_enabled and s.pt_applicable and v_gross > 0 then
      v_tax := public.pt_for_half_year(v_set.pt_slabs, v_full * 6);
      v_pt := case
        when v_set.pt_frequency = 'monthly' then round(v_tax / 6)
        when extract(month from v_start) in (3, 9) then v_tax
        else 0
      end;
    end if;

    v_ded := v_pf + v_esi + v_pt + s.tds_monthly + s.other_deduction;
    insert into public.payslips (
      run_id, company_id, employee_id, period, employee_code, employee_name, department, designation,
      days_in_month, paid_days, lop_days, basic, hra, conveyance, special_allowance, other_allowance, gross,
      pf_employee, esi_employee, professional_tax, tds, other_deduction, total_deductions, net_pay, pf_employer, esi_employer
    ) values (
      v_run.id, p_company, e.id, v_start, e.employee_code, e.full_name, e.department, e.designation,
      v_dim, v_paid, v_lop, v_basic, v_hra, v_conv, v_special, v_other, v_gross,
      v_pf, v_esi, v_pt, s.tds_monthly, s.other_deduction, v_ded, greatest(v_gross - v_ded, 0), v_pf_er, v_esi_er
    );
  end loop;

  update public.payroll_runs r set
    employee_count = x.n, total_gross = x.gross, total_deductions = x.ded, total_net = x.net, total_employer_cost = x.cost,
    generated_at = now(), generated_by = auth.uid()
  from (
    select count(*) n, coalesce(sum(gross), 0) gross, coalesce(sum(total_deductions), 0) ded, coalesce(sum(net_pay), 0) net,
           coalesce(sum(gross + pf_employer + esi_employer), 0) cost
    from public.payslips where run_id = v_run.id
  ) x
  where r.id = v_run.id
  returning r.* into v_run;
  return v_run;
end $$;

create or replace function public.set_payroll_status(p_run uuid, p_status text)
returns public.payroll_runs
language plpgsql security definer set search_path = public as $$
declare v_run public.payroll_runs;
begin
  select * into v_run from public.payroll_runs where id = p_run for update;
  if not found then raise exception 'payroll_not_found' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not public.is_company_hr(v_run.company_id) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p_status = 'finalized' then
    if v_run.status <> 'draft' or v_run.generated_at is null then raise exception 'payroll_not_ready' using errcode = '22023'; end if;
    if v_run.employee_count = 0 then raise exception 'payroll_empty' using errcode = '22023'; end if;
    update public.payroll_runs set status = 'finalized', finalized_at = now(), finalized_by = auth.uid() where id = p_run returning * into v_run;
  elsif p_status = 'draft' then
    -- Reopening is for corrections; only a Company Admin may undo a finalized month.
    if auth.uid() is not null and public.company_role(v_run.company_id) <> 'customer_admin' then raise exception 'not_allowed' using errcode = '42501'; end if;
    update public.payroll_runs set status = 'draft', finalized_at = null, finalized_by = null where id = p_run returning * into v_run;
  else
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  return v_run;
end $$;

-- ── Row Level Security ──────────────────────────────────────────────
alter table public.payroll_settings enable row level security;
alter table public.salary_structures enable row level security;
alter table public.payroll_runs enable row level security;
alter table public.payslips enable row level security;

revoke all on public.payroll_settings, public.salary_structures, public.payroll_runs, public.payslips from anon;
grant select, insert, update on public.payroll_settings to authenticated;
grant select, insert, update, delete on public.salary_structures to authenticated;
grant select on public.payroll_runs, public.payslips to authenticated;
grant all on public.payroll_settings, public.salary_structures, public.payroll_runs, public.payslips to service_role;

create policy payroll_settings_hr on public.payroll_settings for all to authenticated
  using (public.is_company_hr(company_id)) with check (public.is_company_hr(company_id));
create policy salary_structures_hr on public.salary_structures for all to authenticated
  using (public.is_company_hr(company_id)) with check (public.is_company_hr(company_id));
create policy salary_structures_own on public.salary_structures for select to authenticated
  using (public.is_my_employee(employee_id));
create policy payroll_runs_hr on public.payroll_runs for select to authenticated
  using (public.is_company_hr(company_id));
-- Employees cannot read payroll_runs, so the run's status is checked by a definer helper.
create or replace function public.is_finalized_run(p_run uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.payroll_runs where id = p_run and status = 'finalized');
$$;
create policy payslips_select on public.payslips for select to authenticated
  using (public.is_company_hr(company_id) or (public.is_my_employee(employee_id) and public.is_finalized_run(run_id)));

-- ── Function privileges ─────────────────────────────────────────────
revoke execute on function public.payroll_lop_days(uuid, date, date) from public, anon, authenticated;
grant execute on function public.payroll_lop_days(uuid, date, date) to service_role;
revoke execute on function public.is_finalized_run(uuid) from public, anon;
grant execute on function public.is_finalized_run(uuid) to authenticated, service_role;
revoke execute on function public.generate_payroll(uuid, date) from public, anon;
grant execute on function public.generate_payroll(uuid, date) to authenticated, service_role;
revoke execute on function public.set_payroll_status(uuid, text) from public, anon;
grant execute on function public.set_payroll_status(uuid, text) to authenticated, service_role;
