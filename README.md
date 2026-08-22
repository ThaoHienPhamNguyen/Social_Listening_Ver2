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

## Discovery layer (sub-project 2a)

```bash
export SUPABASE_URL=...
export SUPABASE_SERVICE_KEY=...
export YOUTUBE_API_KEY=...
npm run discover   # Google Trends + YouTube + RSS keyword signals -> candidate_topics
npm run rank       # computes growth_rate, shortlists top candidates per source
```

Setup: apply `supabase/migrations/0003_create_candidate_topics_table.sql` (after `0001` and `0002`), and add a `YOUTUBE_API_KEY` secret in the GitHub repo (from a Google Cloud project with the YouTube Data API v3 enabled).

Sources: Google Trends (`@alkalisummer/google-trends-js`, unofficial but verified working for `geo=VN`), YouTube Data API (official), and the existing `articles` table (keyword frequency in recent titles). Reddit and TikTok Creative Center are deliberately out of scope — see `docs/superpowers/specs/2026-08-21-discovery-layer-design.md` §7 for why.

Schedule: `discovery-ingestion.yml` runs 1 hour after `rss-ingestion.yml` (09:00/12:00/21:00 ICT vs. 08:00/11:00/20:00 ICT) so it never reads the `articles` table while `ingest-rss` is mid-write and doesn't contend with it for GitHub Actions runners — see the schedule comment in the workflow file.

This produces a `candidate_topics` shortlist for the future Apify deep-crawl layer (sub-project 2b, not yet built) to consume — this sub-project does not call Apify.

## Tests

```bash
npm test
```

## Status

Live in production since 2026-08-20 — GitHub Actions (`.github/workflows/rss-ingestion.yml`, cron 08:00/11:00/20:00 ICT) + Supabase project "Social Listening ver 2" (ap-southeast-2). See `docs/superpowers/specs/2026-08-20-rss-ingestion-database-schema.md` for the schema and current source list.

The discovery layer (sub-project 2a) is **live in production since 2026-08-21** — migration `0003_create_candidate_topics_table.sql` applied and `.github/workflows/discovery-ingestion.yml` deployed, verified end-to-end via two real `workflow_dispatch` runs (`google_trends`/`rss`/`youtube` all fetching successfully, `rank-and-select` shortlisting per source). Runs on cron `0 2,5,14 * * *` UTC (09:00/12:00/21:00 ICT). See `docs/superpowers/specs/2026-08-21-discovery-layer-database-schema.md` for the schema and known gaps.

The dashboard (sub-project 4, `dashboard/`) is **live on Vercel since 2026-08-22** — Overview and all 3 sector pages confirmed rendering live data (hot topics from the discovery layer, recent articles from RSS ingestion). See `dashboard/README.md` for deployment details.

## Known pending items

- Feed URLs in `config/sources.config.ts` were verified live on 2026-08-20; re-check if ingestion starts silently returning 0 items for a source.
- RLS is enabled on `articles` with no policies — intentionally deferred until a real anon-key consumer exists. The dashboard (sub-project 4) reads via the **service_role** key server-side by design (never the anon key — see `dashboard/lib/supabase.ts`), so it does not trigger this yet. See the database schema doc for details.
- RLS is enabled on `candidate_topics` with no policies — same status as `articles`, see the discovery layer schema doc for details and other known limitations.
