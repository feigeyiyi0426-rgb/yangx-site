create extension if not exists pgcrypto with schema extensions;

create table if not exists public.diary_entries (
  id uuid primary key default gen_random_uuid(),
  diary_id text not null,
  payload text not null,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.diary_entries enable row level security;

create index if not exists diary_entries_diary_created_idx
on public.diary_entries (diary_id, is_deleted, created_at desc);

create or replace function public.diary_list_entries(diary_key text)
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
  if char_length(coalesce(diary_key, '')) < 32 or char_length(diary_key) > 128 then
    raise exception 'invalid diary key';
  end if;

  return query
  select e.id, e.payload, e.created_at
  from public.diary_entries e
  where e.diary_id = diary_key
    and e.is_deleted = false
  order by e.created_at desc
  limit 200;
end;
$$;

create or replace function public.diary_add_entry(
  diary_key text,
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
  if char_length(coalesce(diary_key, '')) < 32 or char_length(diary_key) > 128 then
    raise exception 'invalid diary key';
  end if;

  if char_length(coalesce(entry_payload, '')) < 1 or char_length(entry_payload) > 12000 then
    raise exception 'invalid diary payload';
  end if;

  insert into public.diary_entries (diary_id, payload)
  values (diary_key, entry_payload)
  returning id into saved_id;

  return saved_id;
end;
$$;

create or replace function public.diary_delete_entry(
  diary_key text,
  entry_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if char_length(coalesce(diary_key, '')) < 32 or char_length(diary_key) > 128 then
    raise exception 'invalid diary key';
  end if;

  update public.diary_entries
  set is_deleted = true
  where id = entry_id
    and diary_id = diary_key;
end;
$$;

grant execute on function public.diary_list_entries(text) to anon;
grant execute on function public.diary_add_entry(text, text) to anon;
grant execute on function public.diary_delete_entry(text, uuid) to anon;

notify pgrst, 'reload schema';
