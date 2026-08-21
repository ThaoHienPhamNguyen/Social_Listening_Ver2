# Social Listening — RSS Ingestion

RSS ingestion sub-project. See `docs/superpowers/specs/2026-08-20-rss-ingestion-design.md` for the design and `docs/superpowers/specs/2026-08-20-social-listening-architecture-design.md` for how this fits the overall architecture.

## Setup

1. `npm install`
2. Create a Supabase project (not automated — user-owned step).
3. Apply `supabase/migrations/0001_create_articles_table.sql` and `0002_add_updated_at_trigger.sql`, in order, to that project (via the SQL Editor).
4. In the GitHub repo settings, add secrets `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` (the service-role key, since writes happen server-side in Actions).

## Running locally

```bash
export SUPABASE_URL=...
export SUPABASE_SERVICE_KEY=...
npm run ingest   # parses all 26 feeds, upserts pending articles
npm run crawl    # fetches full content for pending articles
```

## Tests

```bash
npm test
```

## Status

Live in production since 2026-08-20 — GitHub Actions (`.github/workflows/rss-ingestion.yml`, cron 08:00/11:00/20:00 ICT) + Supabase project "Social Listening ver 2" (ap-southeast-2). See `docs/superpowers/specs/2026-08-20-rss-ingestion-database-schema.md` for the schema and current source list.

## Known pending items

- Feed URLs in `config/sources.config.ts` were verified live on 2026-08-20; re-check if ingestion starts silently returning 0 items for a source.
- **⚠️ Migration `0002_add_updated_at_trigger.sql` has not been applied to the live Supabase project yet** — needs a manual SQL Editor run.
- RLS is enabled on `articles` with no policies — intentionally deferred until a real anon-key consumer (e.g. a future dashboard) exists. See the database schema doc for details.
