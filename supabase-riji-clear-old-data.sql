-- YANGX riji old data cleanup
-- Run this in Supabase SQL Editor only when you want to permanently delete
-- all current personal journal entries and uploaded journal attachments.
-- This does not affect forum posts, private chat messages, news, ideas, or projects.

begin;

select 'before_entries' as item, count(*) as total
from public.personal_diary_entries;

select 'before_files' as item, count(*) as total
from public.personal_diary_files;

delete from public.personal_diary_files;
delete from public.personal_diary_entries;

select 'after_entries' as item, count(*) as total
from public.personal_diary_entries;

select 'after_files' as item, count(*) as total
from public.personal_diary_files;

commit;

notify pgrst, 'reload schema';
