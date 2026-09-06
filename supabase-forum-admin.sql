create or replace function public.site_admin_list_forum_posts(admin_password text)
returns table (
  id uuid,
  name text,
  title text,
  category text,
  message text,
  is_private boolean,
  reply_count bigint,
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
    p.id,
    p.name,
    p.title,
    p.category,
    p.message,
    coalesce(p.is_private, false) as is_private,
    (
      select count(*)
      from public.forum_replies r
      where r.post_id = p.id
        and coalesce(r.is_hidden, false) = false
    ) as reply_count,
    p.created_at
  from public.forum_posts p
  where coalesce(p.is_hidden, false) = false
  order by p.created_at desc
  limit 100;
end;
$$;

create or replace function public.site_admin_hide_forum_post(
  admin_password text,
  target_post_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.site_admin_check(admin_password);

  update public.forum_posts
  set is_hidden = true
  where id = target_post_id;

  update public.forum_replies
  set is_hidden = true
  where post_id = target_post_id;
end;
$$;

grant execute on function public.site_admin_list_forum_posts(text) to anon;
grant execute on function public.site_admin_hide_forum_post(text, uuid) to anon;

notify pgrst, 'reload schema';
