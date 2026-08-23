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
npm run ingest   # parses all 29 feeds, upserts pending articles
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

Setup: apply `supabase/migrations/0003_create_candidate_topics_table.sql` (after `0001` and `0002`), and add a `YOUTUBE_API_KEY` secret in the GitHub repo (from a Google Cloud project with the YouTube Data API v3 enabled) and an `OPENAI_API_KEY` secret (from an OpenAI account with billing enabled — used for `gpt-5-nano` category classification, ~$0.07–0.35/month at current volume; see `docs/superpowers/specs/2026-08-22-discovery-category-accuracy-design.md`).

Sources: Google Trends (`@alkalisummer/google-trends-js`, unofficial but verified working for `geo=VN`), YouTube Data API (official), and the existing `articles` table (keyword frequency in recent titles). Reddit and TikTok Creative Center are deliberately out of scope — see `docs/superpowers/specs/2026-08-21-discovery-layer-design.md` §7 for why.

Schedule: `discovery-ingestion.yml` runs 1 hour after `rss-ingestion.yml` (09:00/12:00/21:00 ICT vs. 08:00/11:00/20:00 ICT) so it never reads the `articles` table while `ingest-rss` is mid-write and doesn't contend with it for GitHub Actions runners — see the schedule comment in the workflow file.

This produces a `candidate_topics` shortlist for the Apify deep-crawl layer (sub-project 2b, see below) to consume — this sub-project (2a) does not call Apify itself.

## Deep-crawl Threads (sub-project 2b v1)

```bash
export SUPABASE_URL=...
export SUPABASE_SERVICE_KEY=...
export APIFY_TOKEN=...
npm run deep-crawl   # reads today's shortlisted candidate_topics, searches Threads for up to 8 of them -> topic_social_data
```

Setup: apply `supabase/migrations/0004_add_topic_social_data.sql` (after `0001`-`0003`), and add an `APIFY_TOKEN` secret in the GitHub repo (from an Apify account — used for `futurizerush/meta-threads-scraper`, ~$39/month at 8 topics/day x 50 posts/topic, 1x/day; see `docs/superpowers/specs/2026-08-23-deep-crawl-threads-design.md`).

Scoped to Threads only — Facebook and TikTok are deliberately out of scope, see the design spec §7/§8 for why. Runs as a 3rd job in `discovery-ingestion.yml`, guarded by an idempotency check (skips if `topic_social_data` already has rows for today) rather than a hardcoded run time, so it only spends Apify budget once per day regardless of how many times the workflow runs that day.

## Deep-crawl Facebook (sub-project 2c)

```bash
export SUPABASE_URL=...
export SUPABASE_SERVICE_KEY=...
export APIFY_TOKEN=...
npm run deep-crawl-facebook   # crawls 6 hard-coded Facebook Pages (2/category) -> facebook_page_data
```

Setup: apply `supabase/migrations/0005_add_facebook_page_data.sql` (after `0001`-`0004`). No new GitHub secret needed — reuses the existing `APIFY_TOKEN` from sub-project 2b.

Uses `apify/facebook-posts-scraper` against a small hard-coded seed list (`src/lib/facebook-seed-pages.ts`), not keyword search — Facebook's actor only accepts specific Page URLs, unlike Threads. Runs as its own job in `discovery-ingestion.yml`, independent of `candidate_topics`/the other 3 jobs (no `needs:`), guarded by the same per-day idempotency check as `deep-crawl`. Deliberately small/exploratory scale (`MAX_POSTS_PER_PAGE=15`, 6 pages) to measure real cost/reliability before deciding whether to scale up — see `docs/superpowers/specs/2026-08-23-deep-crawl-facebook-design.md` §5.

## Tests

```bash
npm test
```

## Status

Live in production since 2026-08-20 — GitHub Actions (`.github/workflows/rss-ingestion.yml`, cron 08:00/11:00/20:00 ICT) + Supabase project "Social Listening ver 2" (ap-southeast-2). See `docs/superpowers/specs/2026-08-20-rss-ingestion-database-schema.md` for the schema and current source list.

The discovery layer (sub-project 2a) is **live in production since 2026-08-21** — migration `0003_create_candidate_topics_table.sql` applied and `.github/workflows/discovery-ingestion.yml` deployed, verified end-to-end via two real `workflow_dispatch` runs (`google_trends`/`rss`/`youtube` all fetching successfully, `rank-and-select` shortlisting per source). Runs on cron `0 2,5,14 * * *` UTC (09:00/12:00/21:00 ICT). See `docs/superpowers/specs/2026-08-21-discovery-layer-database-schema.md` for the schema and known gaps.

`category_hint` accuracy was improved 2026-08-22 (see `docs/superpowers/specs/2026-08-22-discovery-category-accuracy-design.md`): RSS candidates now carry the source article's real category instead of a keyword guess, YouTube adds a seed-driven `search.list` fetch per category, and any candidate still uncategorized after that is classified by `gpt-5-nano` (OpenAI). `rank-and-select` gained an additive per-(source, category) top-10 shortlist floor so a dashboard sector page isn't left empty on a day generic trending skews outside all 3 categories.

The dashboard (sub-project 4, `dashboard/`) is **live on Vercel since 2026-08-22** — Overview and all 3 sector pages confirmed rendering live data (hot topics from the discovery layer, recent articles from RSS ingestion). See `dashboard/README.md` for deployment details.

## Known pending items

- Feed URLs in `config/sources.config.ts` were verified live on 2026-08-20; re-check if ingestion starts silently returning 0 items for a source.
- RLS is enabled on `articles` with no policies — intentionally deferred until a real anon-key consumer exists. The dashboard (sub-project 4) reads via the **service_role** key server-side by design (never the anon key — see `dashboard/lib/supabase.ts`), so it does not trigger this yet. See the database schema doc for details.
- RLS is enabled on `candidate_topics` with no policies — same status as `articles`, see the discovery layer schema doc for details and other known limitations.
- Migration `0004_add_topic_social_data.sql` is applied to production and the `deep-crawl` job (Threads) is live-verified via a real `workflow_dispatch` run (`topicsSelected=8 postsUpserted=400 errors=0`). See `docs/superpowers/specs/2026-08-23-deep-crawl-threads-database-schema.md` for the schema.
- Migration `0005_add_facebook_page_data.sql` is **not yet applied** to production — until a human applies it, the `deep-crawl-facebook` job will fail every cron run (isolated failure via `if: ${{ !cancelled() }}`, but red until fixed). No new secret needed (reuses `APIFY_TOKEN`). See `docs/superpowers/specs/2026-08-23-deep-crawl-facebook-database-schema.md` for the schema.
- The 6 Facebook Page URLs in `src/lib/facebook-seed-pages.ts` were picked without a live browser check in this session — confirm they still resolve to real, active Pages if the `deep-crawl-facebook` job logs `no_items`/`not_available` errors for all 6 on its first live run.
