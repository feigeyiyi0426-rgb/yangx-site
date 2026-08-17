create table if not exists public.site_entries (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('idea', 'project')),
  title text not null,
  summary text not null,
  tag text not null default '',
  url text not null default '',
  is_published boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.site_entries enable row level security;

grant select on public.site_entries to anon;

drop policy if exists "published site entries are readable" on public.site_entries;
create policy "published site entries are readable"
on public.site_entries
for select
to anon
using (is_published = true);

create index if not exists site_entries_kind_order_idx
on public.site_entries (kind, is_published, sort_order, created_at desc);

insert into public.site_entries (kind, title, summary, tag, sort_order)
select 'idea', '长期观察', '记录新闻、科技、市场和行业变化里的长期线索。', '观察', 10
where not exists (select 1 from public.site_entries where kind = 'idea');

insert into public.site_entries (kind, title, summary, tag, sort_order)
select 'idea', '学习记录', '整理网站建设、工具使用、投资学习和日常思考。', '学习', 20
where not exists (select 1 from public.site_entries where kind = 'idea' and title = '学习记录');

insert into public.site_entries (kind, title, summary, tag, sort_order)
select 'idea', '待写主题', '后续可以做成文章列表，支持按分类查看。', '主题', 30
where not exists (select 1 from public.site_entries where kind = 'idea' and title = '待写主题');

insert into public.site_entries (kind, title, summary, tag, sort_order)
select 'project', 'YANGX Site', '个人网站入口，已经拆成首页、新闻、论坛、想法和项目页面。', '网站', 10
where not exists (select 1 from public.site_entries where kind = 'project');

insert into public.site_entries (kind, title, summary, tag, sort_order)
select 'project', '公开论坛', '已接入 Supabase 数据库，支持公开留言、回复和私密留言。', '论坛', 20
where not exists (select 1 from public.site_entries where kind = 'project' and title = '公开论坛');

insert into public.site_entries (kind, title, summary, tag, sort_order)
select 'project', '新闻更新', '聚合公开新闻线索，自动翻译并标注可能影响的行业方向。', '新闻', 30
where not exists (select 1 from public.site_entries where kind = 'project' and title = '新闻更新');

create or replace function public.site_admin_check(admin_password text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if admin_password is null or length(btrim(admin_password)) = 0 then
    raise exception 'admin password required';
  end if;

  -- Reuse the existing forum admin password check, so the website has one admin password.
  perform 1 from public.forum_admin_list_posts(admin_password) limit 1;
end;
$$;

create or replace function public.site_admin_list_entries(admin_password text)
returns table (
  id uuid,
  kind text,
  title text,
  summary text,
  tag text,
  url text,
  is_published boolean,
  sort_order integer,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.site_admin_check(admin_password);

  return query
  select
    e.id,
    e.kind,
    e.title,
    e.summary,
    e.tag,
    e.url,
    e.is_published,
    e.sort_order,
    e.created_at,
    e.updated_at
  from public.site_entries e
  order by e.kind, e.sort_order, e.created_at desc;
end;
$$;

create or replace function public.site_admin_upsert_entry(
  admin_password text,
  entry_id uuid,
  entry_kind text,
  entry_title text,
  entry_summary text,
  entry_tag text,
  entry_url text,
  entry_published boolean,
  entry_sort_order integer
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

  if entry_kind not in ('idea', 'project') then
    raise exception 'invalid entry kind';
  end if;

  if length(btrim(coalesce(entry_title, ''))) < 1 or length(btrim(coalesce(entry_summary, ''))) < 1 then
    raise exception 'title and summary are required';
  end if;

  if entry_id is null then
    insert into public.site_entries (
      kind,
      title,
      summary,
      tag,
      url,
      is_published,
      sort_order
    ) values (
      entry_kind,
      left(btrim(entry_title), 80),
      left(btrim(entry_summary), 360),
      left(btrim(coalesce(entry_tag, '')), 40),
      left(btrim(coalesce(entry_url, '')), 300),
      coalesce(entry_published, true),
      coalesce(entry_sort_order, 100)
    ) returning id into saved_id;
  else
    update public.site_entries
    set
      kind = entry_kind,
      title = left(btrim(entry_title), 80),
      summary = left(btrim(entry_summary), 360),
      tag = left(btrim(coalesce(entry_tag, '')), 40),
      url = left(btrim(coalesce(entry_url, '')), 300),
      is_published = coalesce(entry_published, true),
      sort_order = coalesce(entry_sort_order, 100),
      updated_at = now()
    where id = entry_id
    returning id into saved_id;

    if saved_id is null then
      raise exception 'entry not found';
    end if;
  end if;

  return saved_id;
end;
$$;

create or replace function public.site_admin_delete_entry(
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
  delete from public.site_entries where id = entry_id;
end;
$$;

grant execute on function public.site_admin_check(text) to anon;
grant execute on function public.site_admin_list_entries(text) to anon;
grant execute on function public.site_admin_upsert_entry(text, uuid, text, text, text, text, text, boolean, integer) to anon;
grant execute on function public.site_admin_delete_entry(text, uuid) to anon;
