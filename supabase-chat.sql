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
using (is_hidden = false);

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
