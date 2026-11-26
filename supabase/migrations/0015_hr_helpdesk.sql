-- ════════════════════════════════════════════════════════════════════
-- 0015 — HR helpdesk and staff help articles
--   • hr_tickets: an employee asks HR (payroll, leave, grievance, …);
--     answer-by time from priority; HR assigns and resolves
--   • hr_ticket_messages: conversation; HR can add internal notes
--   • hr_articles: the company's own policy / how-to articles for staff
-- Separate from support_tickets, which goes to the software vendor.
-- Only the employee and their company's HR see a ticket.
-- ════════════════════════════════════════════════════════════════════

create sequence if not exists public.hr_ticket_number_seq;

create table public.hr_tickets (
  id                uuid primary key default gen_random_uuid(),
  ticket_no         bigint not null default nextval('public.hr_ticket_number_seq'),
  company_id        uuid not null references public.companies (id) on delete cascade,
  employee_id       uuid not null references public.employees (id) on delete cascade,
  category          text not null check (category in ('payroll', 'leave', 'attendance', 'policy', 'it', 'grievance', 'other')),
  subject           text not null check (char_length(subject) between 3 and 150),
  priority          text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  status            text not null default 'open' check (status in ('open', 'waiting_employee', 'resolved', 'closed')),
  assigned_to       uuid references public.profiles (id) on delete set null,
  due_at            timestamptz,
  first_response_at timestamptz,
  resolved_at       timestamptz,
  created_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index hr_tickets_company_idx on public.hr_tickets (company_id, status, due_at);
create index hr_tickets_employee_idx on public.hr_tickets (employee_id, created_at desc);

create table public.hr_ticket_messages (
  id         uuid primary key default gen_random_uuid(),
  ticket_id  uuid not null references public.hr_tickets (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  author_id  uuid references public.profiles (id) on delete set null,
  from_hr    boolean not null default false,
  internal   boolean not null default false,
  body       text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index hr_ticket_messages_ticket_idx on public.hr_ticket_messages (ticket_id, created_at);

create table public.hr_articles (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  title      text not null check (char_length(title) between 3 and 150),
  body       text not null check (char_length(body) between 1 and 20000),
  category   text not null default 'policy' check (category in ('payroll', 'leave', 'attendance', 'policy', 'it', 'other')),
  published  boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index hr_articles_company_idx on public.hr_articles (company_id, published);

-- Time to answer, by priority.
create or replace function public.hr_ticket_due(p_from timestamptz, p_priority text) returns timestamptz
language sql immutable as $$
  select p_from + case p_priority when 'urgent' then interval '4 hours' when 'high' then interval '24 hours' when 'low' then interval '96 hours' else interval '48 hours' end;
$$;

create or replace function public.hr_tickets_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_company uuid;
  v_hr boolean;
begin
  select company_id into v_company from public.employees where id = new.employee_id;
  if v_company is null then raise exception 'employee not found' using errcode = '23503'; end if;
  v_hr := auth.uid() is null or public.is_company_hr(v_company);
  if not v_hr and not public.is_my_employee(new.employee_id) then raise exception 'not_allowed' using errcode = '42501'; end if;
  new.company_id := v_company;

  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.status := 'open';
    new.first_response_at := null;
    new.resolved_at := null;
    if not v_hr then new.assigned_to := null; end if;
    new.due_at := public.hr_ticket_due(coalesce(new.created_at, now()), new.priority);
  else
    if (new.employee_id, new.ticket_no, new.created_at) is distinct from (old.employee_id, old.ticket_no, old.created_at) then
      raise exception 'not_allowed' using errcode = '42501';
    end if;
    -- The employee may only close their ticket or reopen a resolved one. (Their replies
    -- update the status through the message trigger, which runs one level deeper.)
    if not v_hr and pg_trigger_depth() = 1 then
      if (new.subject, new.category, new.priority, new.assigned_to, new.due_at, new.first_response_at)
           is distinct from (old.subject, old.category, old.priority, old.assigned_to, old.due_at, old.first_response_at)
         or not (new.status = old.status or new.status = 'closed' or (new.status = 'open' and old.status = 'resolved')) then
        raise exception 'only_close_or_reopen' using errcode = '42501';
      end if;
    end if;
    if new.priority <> old.priority then new.due_at := public.hr_ticket_due(old.created_at, new.priority); end if;
    if new.status in ('resolved', 'closed') and old.status not in ('resolved', 'closed') then new.resolved_at := now(); end if;
    if new.status in ('open', 'waiting_employee') then new.resolved_at := null; end if;
  end if;

  -- Assignee must be HR of the same company.
  if new.assigned_to is not null and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to)
     and not exists (select 1 from public.company_memberships m where m.company_id = v_company and m.user_id = new.assigned_to and m.role in ('customer_admin', 'hr_manager')) then
    raise exception 'invalid_assignee' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger hr_tickets_before before insert or update on public.hr_tickets
  for each row execute function public.hr_tickets_before();
create trigger hr_tickets_set_updated_at before update on public.hr_tickets
  for each row execute function public.set_updated_at();
create trigger hr_tickets_audit after insert or update or delete on public.hr_tickets
  for each row execute function public.audit_row_change();

create or replace function public.hr_ticket_messages_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare t public.hr_tickets;
begin
  select * into t from public.hr_tickets where id = new.ticket_id;
  if not found then raise exception 'ticket not found' using errcode = '23503'; end if;
  new.company_id := t.company_id;
  new.author_id := coalesce(auth.uid(), new.author_id);
  new.created_at := now();
  -- "From HR" means an HR person answering someone else's ticket.
  new.from_hr := public.is_company_hr(t.company_id) and not public.is_my_employee(t.employee_id);
  if not public.is_company_hr(t.company_id) and auth.uid() is not null then
    if not public.is_my_employee(t.employee_id) then raise exception 'not_allowed' using errcode = '42501'; end if;
    new.internal := false;
  end if;
  if t.status = 'closed' and not new.internal then raise exception 'ticket_closed' using errcode = '22023'; end if;
  return new;
end $$;
create trigger hr_ticket_messages_before before insert on public.hr_ticket_messages
  for each row execute function public.hr_ticket_messages_before();

create or replace function public.hr_ticket_messages_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.internal then return null; end if;
  if new.from_hr then
    update public.hr_tickets
    set first_response_at = coalesce(first_response_at, now()),
        status = case when status = 'open' then 'waiting_employee' else status end
    where id = new.ticket_id;
  else
    update public.hr_tickets set status = 'open' where id = new.ticket_id and status in ('waiting_employee', 'resolved');
    update public.hr_tickets set updated_at = now() where id = new.ticket_id;
  end if;
  return null;
end $$;
create trigger hr_ticket_messages_after after insert on public.hr_ticket_messages
  for each row execute function public.hr_ticket_messages_after();

create trigger hr_articles_set_updated_at before update on public.hr_articles
  for each row execute function public.set_updated_at();
create trigger hr_articles_audit after insert or update or delete on public.hr_articles
  for each row execute function public.audit_row_change();

alter table public.hr_tickets enable row level security;
alter table public.hr_ticket_messages enable row level security;
alter table public.hr_articles enable row level security;
revoke all on public.hr_tickets, public.hr_ticket_messages, public.hr_articles from anon;
grant select, insert, update on public.hr_tickets to authenticated;
grant select, insert on public.hr_ticket_messages to authenticated;
grant select, insert, update, delete on public.hr_articles to authenticated;
grant usage on sequence public.hr_ticket_number_seq to authenticated;
grant all on public.hr_tickets, public.hr_ticket_messages, public.hr_articles to service_role;

create policy hr_tickets_select on public.hr_tickets for select to authenticated
  using (public.is_company_hr(company_id) or public.is_my_employee(employee_id));
create policy hr_tickets_insert on public.hr_tickets for insert to authenticated
  with check (public.is_company_hr(company_id) or public.is_my_employee(employee_id));
create policy hr_tickets_update on public.hr_tickets for update to authenticated
  using (public.is_company_hr(company_id) or public.is_my_employee(employee_id))
  with check (public.is_company_hr(company_id) or public.is_my_employee(employee_id));

create or replace function public.is_my_hr_ticket(p_ticket uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.hr_tickets t join public.employees e on e.id = t.employee_id where t.id = p_ticket and e.user_id = auth.uid());
$$;
revoke execute on function public.is_my_hr_ticket(uuid) from public, anon;
grant execute on function public.is_my_hr_ticket(uuid) to authenticated, service_role;

create policy hr_messages_select on public.hr_ticket_messages for select to authenticated
  using (public.is_company_hr(company_id) or (not internal and public.is_my_hr_ticket(ticket_id)));
create policy hr_messages_insert on public.hr_ticket_messages for insert to authenticated
  with check (public.is_company_hr(company_id) or (not internal and public.is_my_hr_ticket(ticket_id)));

create policy hr_articles_select on public.hr_articles for select to authenticated
  using (public.is_company_hr(company_id) or (published and public.is_company_member(company_id)));
create policy hr_articles_write on public.hr_articles for all to authenticated
  using (public.is_company_hr(company_id)) with check (public.is_company_hr(company_id));
