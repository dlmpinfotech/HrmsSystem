-- ════════════════════════════════════════════════════════════════════
-- 0014 — Employee documents
--   • Private storage bucket "employee-documents" (PDF / images, 5 MB)
--     path: <company_id>/<employee_id>/<random>-<file name>
--   • employee_documents: category, expiry, versions, HR approval
--     (employee uploads wait for HR; HR uploads are approved at once)
--   • Only the company's HR and the employee themself can see them
--   • hr_attention() also reports expiring documents and uploads to review
-- ════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('employee-documents', 'employee-documents', false, 5242880, array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create table public.employee_documents (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  employee_id   uuid not null references public.employees (id) on delete cascade,
  category      text not null check (category in ('id_proof', 'address_proof', 'offer_letter', 'contract', 'certificate', 'bank', 'medical', 'other')),
  title         text not null check (char_length(title) between 2 and 120),
  file_path     text not null unique check (char_length(file_path) <= 400),
  file_name     text not null check (char_length(file_name) between 1 and 200),
  mime_type     text not null check (mime_type in ('application/pdf', 'image/png', 'image/jpeg', 'image/webp')),
  file_size     integer not null check (file_size > 0 and file_size <= 5242880),
  expires_on    date,
  version       integer not null default 1,
  replaces_id   uuid references public.employee_documents (id) on delete set null,
  is_current    boolean not null default true,
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decision_note text check (decision_note is null or char_length(decision_note) <= 500),
  decided_by    uuid references public.profiles (id) on delete set null,
  decided_at    timestamptz,
  uploaded_by   uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index employee_documents_employee_idx on public.employee_documents (employee_id, category);
create index employee_documents_company_idx on public.employee_documents (company_id, status, expires_on);

create or replace function public.employee_documents_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_company uuid;
  v_hr boolean;
  v_old public.employee_documents;
begin
  select company_id into v_company from public.employees where id = new.employee_id;
  if v_company is null then raise exception 'employee not found' using errcode = '23503'; end if;
  v_hr := auth.uid() is null or public.is_company_hr(v_company);
  if not v_hr and not public.is_my_employee(new.employee_id) then raise exception 'not_allowed' using errcode = '42501'; end if;
  new.company_id := v_company;

  if tg_op = 'INSERT' then
    -- The file must sit in this employee's own folder, so a row can never point at someone else's file.
    if new.file_path not like v_company::text || '/' || new.employee_id::text || '/%' or new.file_path like '%..%' then
      raise exception 'invalid_file_path' using errcode = '22023';
    end if;
    new.uploaded_by := coalesce(auth.uid(), new.uploaded_by);
    new.version := 1;
    new.is_current := true;
    if new.replaces_id is not null then
      select * into v_old from public.employee_documents where id = new.replaces_id;
      if not found or v_old.employee_id <> new.employee_id then raise exception 'invalid_replacement' using errcode = '22023'; end if;
      new.version := v_old.version + 1;
      new.category := v_old.category;
    end if;
    if not v_hr then
      new.status := 'pending';
      new.decided_by := null;
      new.decided_at := null;
      new.decision_note := null;
    else
      new.status := 'approved';
      new.decided_by := coalesce(auth.uid(), new.decided_by);
      new.decided_at := now();
    end if;
    return new;
  end if;

  if not v_hr then raise exception 'not_allowed' using errcode = '42501'; end if;
  if (new.employee_id, new.file_path, new.version, new.replaces_id) is distinct from (old.employee_id, old.file_path, old.version, old.replaces_id) then
    raise exception 'document_file_fixed' using errcode = '22023';
  end if;
  if new.status <> old.status and new.status in ('approved', 'rejected') then
    new.decided_by := coalesce(auth.uid(), new.decided_by);
    new.decided_at := now();
  end if;
  return new;
end $$;
create trigger employee_documents_before before insert or update on public.employee_documents
  for each row execute function public.employee_documents_before();

-- A newer version takes over only once it is approved.
create or replace function public.employee_documents_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'approved' and new.replaces_id is not null and (tg_op = 'INSERT' or old.status <> 'approved') then
    update public.employee_documents set is_current = false where id = new.replaces_id;
  end if;
  return null;
end $$;
create trigger employee_documents_after after insert or update of status on public.employee_documents
  for each row execute function public.employee_documents_after();
create trigger employee_documents_set_updated_at before update on public.employee_documents
  for each row execute function public.set_updated_at();
create trigger employee_documents_audit after insert or update or delete on public.employee_documents
  for each row execute function public.audit_row_change();

alter table public.employee_documents enable row level security;
revoke all on public.employee_documents from anon;
grant select, insert, update, delete on public.employee_documents to authenticated;
grant all on public.employee_documents to service_role;

create policy documents_select on public.employee_documents for select to authenticated
  using (public.is_company_hr(company_id) or public.is_my_employee(employee_id));
create policy documents_insert on public.employee_documents for insert to authenticated
  with check (public.is_company_hr(company_id) or public.is_my_employee(employee_id));
create policy documents_update on public.employee_documents for update to authenticated
  using (public.is_company_hr(company_id)) with check (public.is_company_hr(company_id));
create policy documents_delete on public.employee_documents for delete to authenticated
  using (public.is_company_hr(company_id) or (public.is_my_employee(employee_id) and status <> 'approved'));

-- ── Storage access ──────────────────────────────────────────────────
-- Second folder of the object name = employee id.
create or replace function public.storage_employee_id(p_name text) returns uuid
language sql immutable as $$
  select case
    when split_part(p_name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(p_name, '/', 2)::uuid
  end;
$$;

-- The caller may use a file when they are HR of the company in the path, or the employee in the path
-- (and the employee really belongs to that company).
create or replace function public.can_access_employee_file(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.employees e
    where e.id = public.storage_employee_id(p_name) and e.company_id = public.storage_company_id(p_name)
      and (public.is_company_hr(e.company_id) or e.user_id = auth.uid())
  );
$$;

create policy employee_files_select on storage.objects for select to authenticated
  using (bucket_id = 'employee-documents' and public.can_access_employee_file(name));
create policy employee_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'employee-documents' and public.can_access_employee_file(name));
-- HR can remove files; an employee only one that is not an approved document.
create policy employee_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'employee-documents' and public.can_access_employee_file(name)
         and (public.is_company_hr(public.storage_company_id(name))
              or not exists (select 1 from public.employee_documents d where d.file_path = name and d.status = 'approved')));

revoke execute on function public.can_access_employee_file(text) from public, anon;
grant execute on function public.can_access_employee_file(text) to authenticated, service_role;

-- ── Requires attention: documents (replaces hr_attention from 0008) ──
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
    -- Approved documents that expired in the last 30 days or expire within 30.
    select 'document_expiry:' || d.id::text, 'document_expiry',
           case when d.expires_on < v_today then 'high' when d.expires_on <= v_today + 7 then 'medium' else 'low' end,
           d.employee_id, d.expires_on,
           jsonb_build_object('title', d.title, 'days_left', d.expires_on - v_today)
    from public.employee_documents d
    where d.company_id = p_company and d.is_current and d.status = 'approved' and d.expires_on between v_today - 30 and v_today + 30

    union all
    select 'pending_document:' || d.id::text, 'pending_document',
           case when d.created_at < now() - interval '3 days' then 'medium' else 'low' end,
           d.employee_id, (d.created_at at time zone 'Asia/Kolkata')::date,
           jsonb_build_object('title', d.title)
    from public.employee_documents d
    where d.company_id = p_company and d.status = 'pending'

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
