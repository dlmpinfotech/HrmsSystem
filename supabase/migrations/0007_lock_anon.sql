-- ════════════════════════════════════════════════════════════════════
-- 0007 — Defence in depth: the public (anon) key gets no table rights on HR data.
-- Supabase grants anon access to newly created tables by default; RLS already
-- returns no rows, but the grant itself is removed so private tables refuse outright.
-- Also stops future tables created by this role from being auto-granted to anon.
-- ════════════════════════════════════════════════════════════════════
revoke all on public.employees, public.attendance_records, public.leave_types, public.holidays, public.leave_requests from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
