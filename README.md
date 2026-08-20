# Social Listening — RSS Ingestion

RSS ingestion sub-project. See `docs/superpowers/specs/2026-08-20-rss-ingestion-design.md` for the design and `docs/superpowers/specs/2026-08-20-social-listening-architecture-design.md` for how this fits the overall architecture.

## Setup

1. `npm install`
2. Create a Supabase project (not automated — user-owned step).
3. Apply `supabase/migrations/0001_create_articles_table.sql` to that project.
4. In the GitHub repo settings, add secrets `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` (the service-role key, since writes happen server-side in Actions).

## Running locally

```bash
export SUPABASE_URL=...
export SUPABASE_SERVICE_KEY=...
npm run ingest   # parses all 12 feeds, upserts pending articles
npm run crawl    # fetches full content for pending articles
```

## Tests

```bash
npm test
```

## Known pending items

- Supabase project not yet created in any environment — required before `run-ingest`/`run-crawl` can succeed for real.
- Feed URLs in `config/sources.config.ts` were verified live on 2026-08-20; re-check if ingestion starts silently returning 0 items for a source.
