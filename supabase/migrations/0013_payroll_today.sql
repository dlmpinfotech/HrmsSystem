-- ════════════════════════════════════════════════════════════════════
-- 0013 — Payroll: today is not absent until the day ends
-- Replaces payroll_lop_days() from 0011. Running payroll before a day was
-- over counted that day as loss of pay (no check-in yet). Only completed days
-- can now be absent; today and future days count as paid unless HR has
-- recorded them (absent / half day) or they are unpaid leave.
-- Recalculate any draft payroll after running this.
-- ════════════════════════════════════════════════════════════════════

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
      elsif v_lv_half and d < v_today then v_lop := v_lop + 0.5; -- other half of the day not worked
      end if;
      continue;
    end if;

    v_off := exists (select 1 from public.holidays h where h.company_id = v_emp.company_id and h.holiday_date = d)
      or exists (select 1 from public.shift_overrides o where o.employee_id = p_employee and o.work_date = d and o.shift_id is null)
      or (extract(dow from d)::smallint = any (v_emp.weekly_offs)
          and not exists (select 1 from public.shift_overrides o where o.employee_id = p_employee and o.work_date = d and o.shift_id is not null));
    if v_off or d >= v_today then continue; end if; -- today is not over yet
    v_lop := v_lop + 1;
  end loop;
  return v_lop;
end $$;
