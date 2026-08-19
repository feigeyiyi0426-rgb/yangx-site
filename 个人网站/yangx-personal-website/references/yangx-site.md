# YANGX Site Reference

## Project

- Repository: `feigeyiyi0426-rgb/yangx-site`
- Main branch: `main`
- Live site: `https://www.yangx.xyz`
- Apex domain: `https://yangx.xyz`
- Hosting: Vercel, connected to GitHub auto-deploy
- Database/backend: Supabase project `mhiboklauvzlhkjpvruc`, visible project name `yangx-forum`
- Preferred implementation: static frontend files plus small JS modules and Vercel serverless APIs where needed

## Current Product Shape

YANGX is a Chinese personal website with a modern, simple, dark technology style. The homepage should stay compact and route into separate pages rather than becoming one long page.

Primary public areas:

- Home: overview and main entrances
- News: concise translated news summaries with original source links
- Forum: open no-login messages and replies
- Ideas: personal ideas list
- Projects: personal project list

Hidden/personal area:

- Riji: `/riji`
- Do not show the riji entrance in ordinary public navigation unless the owner asks.
- Do not use `/diary` for future user-facing routes. Use `riji` in new file names and URLs where possible, while preserving old database object names if changing them would risk breakage.

## Known Files

Inspect the repo before relying on this list because it may change.

- `index.html`: homepage
- `styles.css`: shared visual style
- `news.html`, `news-page.js`, `api/news.js`: news page and API
- `forum.html`, `forum-page.js`: public forum
- `ideas.html`, `projects.html`: ideas and projects pages
- `admin.html`, `admin-page.js`: admin page for ideas/projects and related management
- `riji.html`, `riji-page.js`: hidden personal journal
- `supabase-riji-clear-old-data.sql`: cleanup SQL for old riji entries/files

## Supabase Notes

Known tables/functions may include:

- `chat_messages`: private room chat messages
- `site_entries`: ideas/projects content
- `personal_diary_entries`: personal riji entries
- `personal_diary_files`: personal riji attachments/thumbnails

Safety:

- Never store admin passwords in repo docs.
- Never expose Supabase service-role keys.
- Anon/public keys may exist in frontend code, but do not copy them into this reference unless necessary.
- Use row-level security and narrow RPC functions for admin/private operations.
- For destructive cleanup, run counts before and after when possible.

Riji cleanup scope:

```sql
delete from public.personal_diary_files;
delete from public.personal_diary_entries;
```

Only run this when the owner explicitly asks to delete current personal journal data.

## Vercel and DNS

Use Vercel domain settings as the source of truth. Current DNS pattern:

- Root/apex `yangx.xyz`: A record to Vercel, commonly `216.198.79.1`
- `www.yangx.xyz`: CNAME to the Vercel-provided DNS target

DNS propagation usually takes minutes but can take hours. Avoid changing nameservers unless the owner deliberately chooses a different DNS provider.

## Design Preferences

- Chinese UI text
- Compact pages
- Dark, modern, technology-oriented look
- Clear entry cards and concise copy
- Avoid long stacked homepage content
- Avoid decorative clutter
- Keep mobile layouts readable with no overlapping text

## News Rules

- Use reputable public sources: Reuters, AP, BBC, The Guardian, and similar sources.
- Always include original source links.
- Label content as summaries or news leads.
- Keep item text brief.
- Include affected sectors when useful, for example stock market, technology, chips, defense, energy, finance, memory/storage, aviation, logistics.
- Explain cache/refresh behavior in plain language if news appears slow.

## Riji Attachment Rules

- The riji page should show small thumbnails automatically for image attachments.
- Do not auto-open full original images in the history list.
- Open original image only after the user clicks the thumbnail or download/open button.
- Prefer generating small compressed thumbnails at upload time to improve future loading.
- Old entries/files may not have thumbnails unless migrated or re-uploaded.

## Admin and Privacy Rules

- Admin password reset is done through Supabase SQL with hashes; do not ask the owner to send private passwords in chat.
- If a browser is already logged in, operate through the Supabase UI only for narrow requested actions.
- If login is required, ask the owner to log in and say when ready.
- Separate public forum features from private/personal riji features.
