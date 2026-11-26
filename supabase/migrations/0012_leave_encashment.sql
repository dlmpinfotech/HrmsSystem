-- ════════════════════════════════════════════════════════════════════
-- 0012 — Leave encashment + approval reminder templates
--   • Leave types can be encashable (with a yearly cap)
--   • leave_encashments: employee asks, HR approves; the amount is fixed at
--     approval from the salary in force (basic or gross ÷ 26 or 30 per day)
--   • Encashed days reduce the year's balance (leave_entitlement / leave_balances)
--   • generate_payroll() pays approved encashments in the next payroll
--     (earnings, not subject to PF or ESI)
--   • Email templates for HR approval reminders and escalations
-- ════════════════════════════════════════════════════════════════════

alter table public.leave_types
  add column encashable       boolean not null default false,
  add column max_encash_days  numeric(5, 1) check (max_encash_days is null or max_encash_days > 0);
alter table public.leave_types add constraint leave_types_encash_rules
  check (not encashable or (unit = 'day' and annual_quota is not null and not is_comp_off));

alter table public.payroll_settings
  add column encash_basis   text not null default 'basic' check (encash_basis in ('basic', 'gross')),
  add column encash_divisor integer not null default 26 check (encash_divisor in (26, 30));

create table public.leave_encashments (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  employee_id   uuid not null references public.employees (id) on delete cascade,
  leave_type_id uuid not null references public.leave_types (id) on delete restrict,
  year          integer not null check (year between 2000 and 2100),
  days          numeric(5, 1) not null check (days > 0 and days * 2 = floor(days * 2)),
  amount        numeric(12, 2),
  per_day       numeric(12, 2),
  reason        text check (reason is null or char_length(reason) <= 500),
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by    uuid references public.profiles (id) on delete set null,
  decided_at    timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 500),
  paid_run_id   uuid references public.payroll_runs (id) on delete set null,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index leave_encashments_company_idx on public.leave_encashments (company_id, status);
create index leave_encashments_employee_idx on public.leave_encashments (employee_id, leave_type_id, year);

alter table public.payslips add column leave_encashment numeric(12, 2) not null default 0;

-- ── Encashed days ───────────────────────────────────────────────────
create or replace function public.encashed_days(p_employee uuid, p_type uuid, p_year integer, p_exclude uuid default null)
returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(days), 0) from public.leave_encashments
  where employee_id = p_employee and leave_type_id = p_type and year = p_year and status in ('pending', 'approved')
    and (p_exclude is null or id <> p_exclude);
$$;

-- Entitlement now net of encashed days (replaces 0009). Carry-forward also
-- ignores days that were encashed last year.
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

  if not p_with_carry then return v_base; end if;

  if v_t.carry_forward_max > 0 and (v_join is null or extract(year from v_join)::int < p_year) then
    v_prev := coalesce(public.leave_entitlement(p_employee, p_type, p_year - 1, null, false), 0);
    select coalesce(sum(days), 0) into v_prev_used
    from public.leave_requests
    where employee_id = p_employee and leave_type_id = p_type and status = 'approved' and extract(year from start_date)::int = p_year - 1;
    v_prev_used := v_prev_used + public.encashed_days(p_employee, p_type, p_year - 1);
    v_carry := least(v_t.carry_forward_max, greatest(v_prev - v_prev_used, 0));
  end if;
  return v_base + v_carry - public.encashed_days(p_employee, p_type, p_year);
end $$;

-- leave_balances gains an "encashed" column (return type change → drop + create).
drop function if exists public.leave_balances(uuid, integer);
create function public.leave_balances(p_employee uuid, p_year integer)
returns table (
  leave_type_id uuid, unit text, is_comp_off boolean, entitled numeric, carried numeric, encashed numeric,
  used numeric, pending numeric, available numeric, hours_used_month numeric, hours_limit numeric, encashable boolean
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_emp public.employees;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_through date;
  t public.leave_types;
  v_net numeric;
  v_base numeric;
  v_used numeric;
  v_pending numeric;
  v_enc numeric;
begin
  select * into v_emp from public.employees where id = p_employee;
  if not found then return; end if;
  if auth.uid() is not null and not (public.is_company_hr(v_emp.company_id) or v_emp.user_id = auth.uid() or public.is_manager_of(p_employee)) then
    return;
  end if;
  v_through := case when p_year = extract(year from v_today)::int then v_today else make_date(p_year, 12, 31) end;

  for t in select * from public.leave_types x where x.company_id = v_emp.company_id and x.is_active order by x.sort_order, x.name loop
    leave_type_id := t.id;
    unit := t.unit;
    is_comp_off := t.is_comp_off;
    encashable := t.encashable;
    hours_used_month := null;
    hours_limit := null;
    entitled := null;
    carried := 0;
    encashed := 0;
    if t.unit = 'hour' then
      select coalesce(sum(r.hours), 0) into v_used from public.leave_requests r
      where r.employee_id = p_employee and r.leave_type_id = t.id and r.status in ('pending', 'approved')
        and date_trunc('month', r.start_date) = date_trunc('month', v_today);
      used := 0; pending := 0;
      hours_used_month := v_used;
      hours_limit := t.max_hours_per_month;
      available := case when t.max_hours_per_month is null then null else greatest(t.max_hours_per_month - v_used, 0) end;
    else
      select coalesce(sum(r.days) filter (where r.status = 'approved'), 0), coalesce(sum(r.days) filter (where r.status = 'pending'), 0)
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
        v_net := public.leave_entitlement(p_employee, t.id, p_year, v_through, true);
        v_base := public.leave_entitlement(p_employee, t.id, p_year, v_through, false);
        v_enc := public.encashed_days(p_employee, t.id, p_year);
        encashed := v_enc;
        entitled := v_net + v_enc;
        carried := v_net + v_enc - v_base;
        available := greatest(v_net - v_used - v_pending, 0);
      end if;
    end if;
    return next;
  end loop;
end $$;

-- ── Encashment rules ────────────────────────────────────────────────
create or replace function public.leave_encashments_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_emp public.employees;
  v_type public.leave_types;
  v_hr boolean;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_avail numeric;
  v_used numeric;
  v_set public.payroll_settings;
  s public.salary_structures;
  v_base numeric;
begin
  select * into v_emp from public.employees where id = new.employee_id;
  if not found then raise exception 'employee not found' using errcode = '23503'; end if;
  new.company_id := v_emp.company_id;
  v_hr := auth.uid() is null or public.is_company_hr(v_emp.company_id);
  if not v_hr and not public.is_my_employee(new.employee_id) then raise exception 'not_allowed' using errcode = '42501'; end if;

  if tg_op = 'UPDATE' then
    if (new.employee_id, new.leave_type_id, new.year) is distinct from (old.employee_id, old.leave_type_id, old.year) then
      raise exception 'only_cancel_pending' using errcode = '42501';
    end if;
    if old.paid_run_id is not null and new.status <> old.status then raise exception 'encashment_paid' using errcode = '22023'; end if;
    if not v_hr then
      if not (old.status = 'pending' and new.status = 'cancelled' and new.days = old.days) then raise exception 'only_cancel_pending' using errcode = '42501'; end if;
      return new;
    end if;
    if new.status = old.status and new.days = old.days then return new; end if;
    if new.status <> old.status and new.status in ('approved', 'rejected') then
      if old.status <> 'pending' then raise exception 'cannot_decide' using errcode = '22023'; end if;
      new.decided_by := coalesce(auth.uid(), new.decided_by);
      new.decided_at := now();
    end if;
  else
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.paid_run_id := null;
    new.amount := null;
    new.per_day := null;
    if not v_hr and new.status <> 'pending' then raise exception 'new_requests_are_pending' using errcode = '42501'; end if;
    if new.year is null then new.year := extract(year from v_today)::int; end if;
    if new.status = 'approved' then
      new.decided_by := coalesce(auth.uid(), new.decided_by);
      new.decided_at := now();
    end if;
  end if;

  select * into v_type from public.leave_types where id = new.leave_type_id;
  if not found or v_type.company_id <> v_emp.company_id or not v_type.encashable or not v_type.is_active then
    raise exception 'not_encashable' using errcode = '22023';
  end if;

  if new.status in ('pending', 'approved') then
    if v_type.max_encash_days is not null and public.encashed_days(new.employee_id, new.leave_type_id, new.year, new.id) + new.days > v_type.max_encash_days then
      raise exception 'encash_limit' using errcode = '23514';
    end if;
    -- Balance for the year, ignoring this row (it is not yet saved, or it is being changed).
    v_avail := public.leave_entitlement(new.employee_id, new.leave_type_id, new.year, case when new.year = extract(year from v_today)::int then v_today else make_date(new.year, 12, 31) end, true)
             + case when tg_op = 'UPDATE' and old.status in ('pending', 'approved') then old.days else 0 end;
    select coalesce(sum(days), 0) into v_used from public.leave_requests
    where employee_id = new.employee_id and leave_type_id = new.leave_type_id and status in ('pending', 'approved')
      and extract(year from start_date)::int = new.year;
    if v_used + new.days > v_avail then raise exception 'insufficient_balance' using errcode = '23514'; end if;
  end if;

  -- Fix the amount when approved, from the salary in force today.
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status <> 'approved' or new.days <> old.days) then
    insert into public.payroll_settings (company_id) values (v_emp.company_id) on conflict (company_id) do nothing;
    select * into v_set from public.payroll_settings where company_id = v_emp.company_id;
    select * into s from public.salary_structures where employee_id = new.employee_id and effective_from <= v_today order by effective_from desc limit 1;
    if not found then raise exception 'no_salary_structure' using errcode = '22023'; end if;
    v_base := case when v_set.encash_basis = 'gross' then s.basic + s.hra + s.conveyance + s.special_allowance + s.other_allowance else s.basic end;
    new.per_day := round(v_base / v_set.encash_divisor, 2);
    new.amount := round(new.per_day * new.days);
  elsif new.status <> 'approved' then
    new.amount := null;
    new.per_day := null;
  end if;
  return new;
end $$;
create trigger leave_encashments_before before insert or update on public.leave_encashments
  for each row execute function public.leave_encashments_before();
create trigger leave_encashments_set_updated_at before update on public.leave_encashments
  for each row execute function public.set_updated_at();
create trigger leave_encashments_audit after insert or update or delete on public.leave_encashments
  for each row execute function public.audit_row_change();

-- ── Payroll pays approved encashments (replaces 0011 version) ───────
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
  v_basic numeric; v_hra numeric; v_conv numeric; v_special numeric; v_other numeric; v_gross numeric; v_enc numeric; v_wages numeric;
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
  -- Encashments attached to this (draft) run are released and picked up again below.
  update public.leave_encashments set paid_run_id = null where paid_run_id = v_run.id;

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
    v_wages := v_basic + v_hra + v_conv + v_special + v_other;
    v_full := s.basic + s.hra + s.conveyance + s.special_allowance + s.other_allowance;

    update public.leave_encashments set paid_run_id = v_run.id
    where employee_id = e.id and status = 'approved' and paid_run_id is null and decided_at < (v_end + 1)::timestamp at time zone 'Asia/Kolkata';
    select coalesce(sum(amount), 0) into v_enc from public.leave_encashments where employee_id = e.id and paid_run_id = v_run.id;
    v_gross := v_wages + v_enc;

    v_pf := 0; v_pf_er := 0;
    if v_set.pf_enabled and s.pf_applicable then
      v_pf_wage := case when v_set.pf_cap_at_ceiling then least(v_basic, v_set.pf_wage_ceiling) else v_basic end;
      v_pf := round(v_pf_wage * v_set.pf_employee_rate / 100);
      v_pf_er := round(v_pf_wage * v_set.pf_employer_rate / 100);
    end if;

    -- Leave encashment is not ESI wages.
    v_esi := 0; v_esi_er := 0;
    if v_set.esi_enabled and s.esi_applicable and v_full <= v_set.esi_wage_limit and v_wages > 0 then
      v_esi := ceil(v_wages * v_set.esi_employee_rate / 100);
      v_esi_er := ceil(v_wages * v_set.esi_employer_rate / 100);
    end if;

    v_pt := 0;
    if v_set.pt_enabled and s.pt_applicable and v_wages > 0 then
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
      days_in_month, paid_days, lop_days, basic, hra, conveyance, special_allowance, other_allowance, leave_encashment, gross,
      pf_employee, esi_employee, professional_tax, tds, other_deduction, total_deductions, net_pay, pf_employer, esi_employer
    ) values (
      v_run.id, p_company, e.id, v_start, e.employee_code, e.full_name, e.department, e.designation,
      v_dim, v_paid, v_lop, v_basic, v_hra, v_conv, v_special, v_other, v_enc, v_gross,
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

-- ── Row Level Security ──────────────────────────────────────────────
alter table public.leave_encashments enable row level security;
revoke all on public.leave_encashments from anon;
grant select, insert, update on public.leave_encashments to authenticated;
grant all on public.leave_encashments to service_role;

create policy encash_select on public.leave_encashments for select to authenticated
  using (public.is_company_hr(company_id) or public.is_my_employee(employee_id));
create policy encash_insert on public.leave_encashments for insert to authenticated
  with check (public.is_company_hr(company_id) or public.is_my_employee(employee_id));
create policy encash_update on public.leave_encashments for update to authenticated
  using (public.is_company_hr(company_id) or public.is_my_employee(employee_id))
  with check (public.is_company_hr(company_id) or public.is_my_employee(employee_id));

revoke execute on function public.encashed_days(uuid, uuid, integer, uuid) from public, anon, authenticated;
grant execute on function public.encashed_days(uuid, uuid, integer, uuid) to service_role;
revoke execute on function public.leave_balances(uuid, integer) from public, anon;
grant execute on function public.leave_balances(uuid, integer) to authenticated, service_role;

-- ── Reminder / escalation email templates ───────────────────────────
insert into public.notification_templates (key, channel, language, name, subject, body, variables) values
  ('hr_pending_digest', 'email', 'en', 'Approvals waiting',
   '{{count}} requests are waiting for your approval — {{company}}',
   E'Hi {{name}},\n\nThese requests at {{company}} are waiting for a decision:\n\n{{items}}\n\nReview them here: {{url}}\n\nRegards,\n{{brand}}',
   '{name,count,company,items,url,brand}'),
  ('hr_pending_digest', 'email', 'ta', 'ஒப்புதலுக்குக் காத்திருப்பவை',
   '{{count}} கோரிக்கைகள் உங்கள் ஒப்புதலுக்குக் காத்திருக்கின்றன — {{company}}',
   E'வணக்கம் {{name}},\n\n{{company}} நிறுவனத்தின் இந்தக் கோரிக்கைகள் முடிவுக்குக் காத்திருக்கின்றன:\n\n{{items}}\n\nஇங்கே பார்க்கவும்: {{url}}\n\nநன்றி,\n{{brand}}',
   '{name,count,company,items,url,brand}'),
  ('approval_escalation', 'email', 'en', 'Approval overdue',
   'Overdue: {{count}} requests have waited more than {{hours}} hours — {{company}}',
   E'Hi {{name}},\n\nThese requests at {{company}} have waited more than {{hours}} hours without a decision:\n\n{{items}}\n\nPlease review them or ask the approver to: {{url}}\n\nRegards,\n{{brand}}',
   '{name,count,hours,company,items,url,brand}'),
  ('approval_escalation', 'email', 'ta', 'ஒப்புதல் தாமதம்',
   'தாமதம்: {{count}} கோரிக்கைகள் {{hours}} மணி நேரத்துக்கு மேல் காத்திருக்கின்றன — {{company}}',
   E'வணக்கம் {{name}},\n\n{{company}} நிறுவனத்தின் இந்தக் கோரிக்கைகள் {{hours}} மணி நேரத்துக்கு மேல் முடிவின்றிக் காத்திருக்கின்றன:\n\n{{items}}\n\nதயவுசெய்து பார்க்கவும் அல்லது ஒப்புதல் அளிப்பவரிடம் கேட்கவும்: {{url}}\n\nநன்றி,\n{{brand}}',
   '{name,count,hours,company,items,url,brand}')
on conflict (key, channel, language) do nothing;
