create extension if not exists pgcrypto with schema extensions;

create table if not exists public.personal_diary_entries (
  id uuid primary key default gen_random_uuid(),
  payload text not null,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.personal_diary_entries enable row level security;

create index if not exists personal_diary_entries_created_idx
on public.personal_diary_entries (is_deleted, created_at desc);

create or replace function public.personal_diary_list_entries(admin_password text)
returns table (
  id uuid,
  payload text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.site_admin_check(admin_password);

  return query
  select e.id, e.payload, e.created_at
  from public.personal_diary_entries e
  where e.is_deleted = false
  order by e.created_at desc
  limit 300;
end;
$$;

create or replace function public.personal_diary_add_entry(
  admin_password text,
  entry_payload text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  saved_id uuid;
begin
  perform public.site_admin_check(admin_password);

  if char_length(coalesce(entry_payload, '')) < 1 or char_length(entry_payload) > 12000 then
    raise exception 'invalid diary payload';
  end if;

  insert into public.personal_diary_entries (payload)
  values (entry_payload)
  returning id into saved_id;

  return saved_id;
end;
$$;

create or replace function public.personal_diary_delete_entry(
  admin_password text,
  entry_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.site_admin_check(admin_password);

  update public.personal_diary_entries
  set is_deleted = true
  where id = entry_id;
end;
$$;

grant execute on function public.personal_diary_list_entries(text) to anon;
grant execute on function public.personal_diary_add_entry(text, text) to anon;
grant execute on function public.personal_diary_delete_entry(text, uuid) to anon;

notify pgrst, 'reload schema';
