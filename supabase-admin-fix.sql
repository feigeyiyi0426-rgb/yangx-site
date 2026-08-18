create extension if not exists pgcrypto with schema extensions;

create or replace function public.site_admin_check(admin_password text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  saved_hash text;
begin
  select password_hash
  into saved_hash
  from public.site_admin_settings
  where id = true;

  if saved_hash is null then
    raise exception 'admin password is not set';
  end if;

  if encode(digest(coalesce(admin_password, ''), 'sha256'), 'hex') <> saved_hash then
    raise exception 'invalid admin password';
  end if;
end;
$$;

grant execute on function public.site_admin_check(text) to anon;
notify pgrst, 'reload schema';
