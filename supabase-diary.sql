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

create table if not exists public.personal_diary_files (
  id uuid primary key default gen_random_uuid(),
  payload text not null,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.personal_diary_files enable row level security;

alter table public.personal_diary_files
  add column if not exists metadata_payload text,
  add column if not exists file_payload text,
  add column if not exists thumbnail_payload text;

update public.personal_diary_files
set
  metadata_payload = coalesce(metadata_payload, payload::jsonb ->> 'metadata'),
  file_payload = coalesce(
    file_payload,
    jsonb_build_object(
      'version', coalesce(payload::jsonb ->> 'version', '1'),
      'kind', coalesce(payload::jsonb ->> 'kind', 'encrypted-file'),
      'fileSalt', payload::jsonb ->> 'fileSalt',
      'fileIv', payload::jsonb ->> 'fileIv',
      'fileData', payload::jsonb ->> 'fileData'
    )::text
  ),
  thumbnail_payload = coalesce(thumbnail_payload, payload::jsonb ->> 'thumbnail')
where (metadata_payload is null or file_payload is null or thumbnail_payload is null)
  and payload is not null
  and left(ltrim(payload), 1) = '{';

create index if not exists personal_diary_files_created_idx
on public.personal_diary_files (is_deleted, created_at desc);

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

create or replace function public.personal_diary_list_files(admin_password text)
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
  select
    f.id,
    jsonb_build_object(
      'version', 3,
      'kind', 'encrypted-file-meta',
      'metadata', coalesce(f.metadata_payload, f.payload::jsonb ->> 'metadata'),
      'thumbnail', f.thumbnail_payload
    )::text as payload,
    f.created_at
  from public.personal_diary_files f
  where f.is_deleted = false
  order by f.created_at desc
  limit 300;
end;
$$;

create or replace function public.personal_diary_get_file(
  admin_password text,
  file_id uuid
)
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
  select
    f.id,
    coalesce(
      f.file_payload,
      jsonb_build_object(
        'version', coalesce(f.payload::jsonb ->> 'version', '1'),
        'kind', coalesce(f.payload::jsonb ->> 'kind', 'encrypted-file'),
        'fileSalt', f.payload::jsonb ->> 'fileSalt',
        'fileIv', f.payload::jsonb ->> 'fileIv',
        'fileData', f.payload::jsonb ->> 'fileData'
      )::text
    ) as payload,
    f.created_at
  from public.personal_diary_files f
  where f.id = file_id
    and f.is_deleted = false
  limit 1;
end;
$$;

create or replace function public.personal_diary_update_thumbnail(
  admin_password text,
  file_id uuid,
  new_thumbnail_payload text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.site_admin_check(admin_password);

  if char_length(coalesce(new_thumbnail_payload, '')) < 1 or char_length(new_thumbnail_payload) > 600000 then
    raise exception 'invalid diary thumbnail payload';
  end if;

  update public.personal_diary_files
  set thumbnail_payload = new_thumbnail_payload
  where id = file_id
    and is_deleted = false;
end;
$$;

create or replace function public.personal_diary_add_file_v3(
  admin_password text,
  file_metadata text,
  encrypted_file text,
  thumbnail_payload text
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

  if char_length(coalesce(file_metadata, '')) < 1 or char_length(file_metadata) > 12000 then
    raise exception 'invalid diary file metadata';
  end if;

  if char_length(coalesce(encrypted_file, '')) < 1 or char_length(encrypted_file) > 16000000 then
    raise exception 'invalid diary file payload';
  end if;

  if thumbnail_payload is not null and char_length(thumbnail_payload) > 600000 then
    raise exception 'invalid diary thumbnail payload';
  end if;

  insert into public.personal_diary_files (payload, metadata_payload, file_payload, thumbnail_payload)
  values (
    jsonb_build_object(
      'version', 3,
      'kind', 'encrypted-file-meta',
      'metadata', file_metadata,
      'thumbnail', thumbnail_payload
    )::text,
    file_metadata,
    encrypted_file,
    thumbnail_payload
  )
  returning id into saved_id;

  return saved_id;
end;
$$;

create or replace function public.personal_diary_add_file_v2(
  admin_password text,
  file_metadata text,
  encrypted_file text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.personal_diary_add_file_v3(admin_password, file_metadata, encrypted_file, null);
end;
$$;

create or replace function public.personal_diary_add_file(
  admin_password text,
  file_payload text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  parsed jsonb;
begin
  parsed := file_payload::jsonb;

  return public.personal_diary_add_file_v3(
    admin_password,
    parsed ->> 'metadata',
    jsonb_build_object(
      'version', coalesce(parsed ->> 'version', '1'),
      'kind', coalesce(parsed ->> 'kind', 'encrypted-file'),
      'fileSalt', parsed ->> 'fileSalt',
      'fileIv', parsed ->> 'fileIv',
      'fileData', parsed ->> 'fileData'
    )::text,
    parsed ->> 'thumbnail'
  );
end;
$$;

create or replace function public.personal_diary_delete_file(
  admin_password text,
  file_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.site_admin_check(admin_password);

  update public.personal_diary_files
  set is_deleted = true
  where id = file_id;
end;
$$;

grant execute on function public.personal_diary_list_entries(text) to anon;
grant execute on function public.personal_diary_add_entry(text, text) to anon;
grant execute on function public.personal_diary_delete_entry(text, uuid) to anon;
grant execute on function public.personal_diary_list_files(text) to anon;
grant execute on function public.personal_diary_get_file(text, uuid) to anon;
grant execute on function public.personal_diary_update_thumbnail(text, uuid, text) to anon;
grant execute on function public.personal_diary_add_file_v3(text, text, text, text) to anon;
grant execute on function public.personal_diary_add_file_v2(text, text, text) to anon;
grant execute on function public.personal_diary_add_file(text, text) to anon;
grant execute on function public.personal_diary_delete_file(text, uuid) to anon;

notify pgrst, 'reload schema';
