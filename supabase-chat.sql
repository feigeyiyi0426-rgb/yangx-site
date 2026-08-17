create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  room_id text not null,
  name text not null default '访客',
  payload text not null,
  is_hidden boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.chat_messages enable row level security;

drop policy if exists "chat messages are readable by room id" on public.chat_messages;
create policy "chat messages are readable by room id"
on public.chat_messages
for select
to anon
using (
  is_hidden = false
  and created_at >= now() - interval '1 hour'
);

drop policy if exists "anyone can send encrypted chat messages" on public.chat_messages;
create policy "anyone can send encrypted chat messages"
on public.chat_messages
for insert
to anon
with check (
  char_length(room_id) between 32 and 128
  and char_length(name) between 1 and 40
  and char_length(payload) between 1 and 6000
);

create index if not exists chat_messages_room_created_idx
on public.chat_messages (room_id, created_at desc);

create table if not exists public.chat_presence (
  room_id text not null,
  member_id text not null,
  name text not null default '访客',
  updated_at timestamptz not null default now(),
  primary key (room_id, member_id)
);

alter table public.chat_presence enable row level security;

drop policy if exists "active chat presence is readable" on public.chat_presence;
create policy "active chat presence is readable"
on public.chat_presence
for select
to anon
using (updated_at >= now() - interval '2 minutes');

drop policy if exists "anyone can join chat presence" on public.chat_presence;
create policy "anyone can join chat presence"
on public.chat_presence
for insert
to anon
with check (
  char_length(room_id) between 32 and 128
  and char_length(member_id) between 16 and 80
  and char_length(name) between 1 and 40
);

drop policy if exists "anyone can refresh chat presence" on public.chat_presence;
create policy "anyone can refresh chat presence"
on public.chat_presence
for update
to anon
using (
  char_length(room_id) between 32 and 128
  and char_length(member_id) between 16 and 80
)
with check (
  char_length(room_id) between 32 and 128
  and char_length(member_id) between 16 and 80
  and char_length(name) between 1 and 40
);

create index if not exists chat_presence_room_updated_idx
on public.chat_presence (room_id, updated_at desc);

-- Optional cleanup. Run manually if you want to remove old encrypted rows from the database too.
delete from public.chat_messages
where created_at < now() - interval '1 hour';

delete from public.chat_presence
where updated_at < now() - interval '10 minutes';
