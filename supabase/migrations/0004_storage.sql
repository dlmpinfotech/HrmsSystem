-- ════════════════════════════════════════════════════════════════════
-- 0004 — Storage: company branding assets
-- Objects live at  branding/<company_uuid>/<kind>-<timestamp>.<ext>
-- The bucket enforces a 2 MB limit and an image-only MIME allowlist (no SVG:
-- SVG can carry scripts). Reads are public so logos render on login screens.
-- ════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'branding', 'branding', true, 2097152,
  array['image/png', 'image/jpeg', 'image/webp', 'image/x-icon', 'image/vnd.microsoft.icon']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy branding_objects_select on storage.objects for select to authenticated
  using (bucket_id = 'branding'
         and (public.is_staff() or public.is_company_member(public.storage_company_id(name))));

create policy branding_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'branding'
              and (public.is_super_admin() or public.is_company_admin(public.storage_company_id(name))));

create policy branding_objects_update on storage.objects for update to authenticated
  using (bucket_id = 'branding'
         and (public.is_super_admin() or public.is_company_admin(public.storage_company_id(name))))
  with check (bucket_id = 'branding'
              and (public.is_super_admin() or public.is_company_admin(public.storage_company_id(name))));

create policy branding_objects_delete on storage.objects for delete to authenticated
  using (bucket_id = 'branding'
         and (public.is_super_admin() or public.is_company_admin(public.storage_company_id(name))));
