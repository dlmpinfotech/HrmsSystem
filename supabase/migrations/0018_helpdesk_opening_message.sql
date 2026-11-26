-- ════════════════════════════════════════════════════════════════════
-- 0018 — Helpdesk: the opening question is not a reply
-- Replaces hr_ticket_messages_after() from 0015. When HR opened a ticket on
-- an employee's behalf, the first message counted as HR's answer: the ticket
-- jumped to "waiting for employee" and the answer-by time stopped.
-- The opening message (the first one, written by whoever created the ticket)
-- now leaves the ticket open and unanswered.
-- ════════════════════════════════════════════════════════════════════

create or replace function public.hr_ticket_messages_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.internal then return null; end if;
  if new.author_id is not distinct from (select created_by from public.hr_tickets where id = new.ticket_id)
     and not exists (select 1 from public.hr_ticket_messages m where m.ticket_id = new.ticket_id and m.id <> new.id and not m.internal) then
    return null;
  end if;
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
