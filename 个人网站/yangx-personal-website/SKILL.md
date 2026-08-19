---
name: yangx-personal-website
description: Maintain the YANGX personal website in GitHub/Vercel/Supabase. Use when working on yangx.xyz, feigeyiyi0426-rgb/yangx-site, Chinese personal-site UI, homepage/page layout, news/RSS summaries, forum and private chat, hidden riji journal, Supabase SQL setup/cleanup, Vercel deployment, custom domain, backups, or rollback-safe website changes.
---

# YANGX Personal Website

Use this skill to continue building, debugging, and maintaining the YANGX personal website without rediscovering the project every time.

Before changing anything, read `references/yangx-site.md` for the current project map, routes, database notes, and safety rules.

## Operating Rules

- Speak to the owner in plain Chinese and keep instructions short.
- Prefer the existing static HTML/CSS/JS structure unless a requested feature clearly needs a backend or framework.
- Use GitHub as the source of truth and let Vercel auto-deploy from the main branch.
- Keep important redesigns rollback-safe with a backup page, a clearly named file, or a commit reference.
- Never ask for or store passwords, verification codes, service-role keys, registrar credentials, or payment details.
- Treat Supabase SQL actions as production data changes. Read the target table names carefully before running delete/update statements.

## Default Workflow

1. Inspect the current repository state and the live route involved.
2. Identify the smallest file set needed for the requested change.
3. Edit using existing naming, Chinese copy, and the current dark technology visual style.
4. If database work is required, prepare narrow SQL and explain exactly which tables it touches.
5. Commit to GitHub with a focused message.
6. Verify the live URL after Vercel deploys, including mobile/layout sanity where relevant.
7. Report changed files, live links, and anything the owner still needs to do manually.

## Common Tasks

### Layout and pages

Keep the homepage compact. Content-heavy areas should stay on separate pages, especially news, forum, projects, ideas, and the hidden riji journal.

### News

Use reputable public RSS or public pages such as Reuters, AP, BBC, and The Guardian. Always show source links and label items as summary/news leads, not original reporting. Keep cards brief and include likely affected sectors when helpful.

### Forum and chat

No-login public posting is acceptable for the open forum, with Supabase row-level security. Private chat should remain password/room based and browser-encrypted where implemented. Make clear that anyone with the room password can read that room.

### Riji journal

The journal is personal-use only and hidden from normal navigation. Keep the route as `/riji`; do not reintroduce `/diary` unless the owner explicitly asks. Attachments should load thumbnails first and open originals only on click.

### Cleanup

For cleanup requests, delete only the table(s) the owner explicitly names. For current riji cleanup, only use `personal_diary_entries` and `personal_diary_files`. Do not touch forum, chat, news, ideas, or projects unless explicitly requested.

## Validation

- Check JavaScript syntax for changed JS files when possible.
- Verify changed live pages after deployment.
- For Supabase changes, run a read-only count/select after the write when possible.
- If browser login is required, ask the owner to log in; do not request credentials.
