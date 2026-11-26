-- ════════════════════════════════════════════════════════════════════
-- 0010 — Changing an employee's email moves their login link
-- Before: an employee stayed linked to the old login after HR corrected the
-- email (e.g. a record typed with the HR person's own email stayed tied to
-- the HR person's account). Now a changed email clears the link, and
-- employees_before() links the login that matches the new email, if any.
-- Runs before employees_before (triggers fire in name order).
-- ════════════════════════════════════════════════════════════════════

create or replace function public.employees_email_relink() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if lower(coalesce(new.email, '')) is distinct from lower(coalesce(old.email, ''))
     and new.user_id is not distinct from old.user_id then
    new.user_id := null;
  end if;
  return new;
end $$;

create trigger employees_a_email_relink before update of email on public.employees
  for each row execute function public.employees_email_relink();
