# Dashboard — Design Spec (sub-project 4, with a scoped slice of sub-project 3)

## Status

Approved via chat brainstorm 2026-08-21. Supersedes the original roadmap order (2b before 3/4) at the user's explicit request: build the dashboard now, using data already live from sub-project 1 (RSS ingestion) and sub-project 2a (discovery layer). Apify deep-crawl (2b) is deferred until after this ships.

## Why this pulls in part of sub-project 3

Sub-project 3 ("Trend / share-of-voice computation") was deliberately left undefined in the architecture spec, pending its own brainstorm. This spec resolves **only the two formulas the dashboard needs to render** — trending score and share of voice — using the data already produced by sub-project 2a. It does not attempt a general trend-computation framework, does not touch sentiment, and does not add new backend jobs or schema. Anything beyond what's specified here still belongs to a future, fuller sub-project 3 brainstorm if one turns out to be needed.

## Reference: ver 1 prior art

An earlier attempt at this project (a separate, since-reset repo, memory preserved as `project-overview` / `apify-sources` under that old project's memory store) built a comparable Next.js dashboard against a different schema (Prisma/Postgres, `Topic`/`Post`/`BuzzSnapshot` models fed by custom crawlers). Its page layout and formula *shapes* are reused here as a proven reference:

- `trendingScore = buzzVolume / avg7dBuzz × 100`, capped at 999, default 50 with no history
- `shareOfVoice = topicBuzz / sectorTotalBuzz × 100` per day
- Sector routing: `/tai-chinh` (green `#16a34a`), `/giai-tri` (pink `#af006e`), `/du-lich` (blue `#3b82f6`)

Its actual data-fetching code, DB schema, and Prisma models do **not** carry over — ver 2's schema (`articles`, `candidate_topics`) is structurally different (no persistent `Topic` entity; keywords are re-discovered daily, not pre-defined watch targets).

## Architecture

- New Next.js 15 (App Router) + Tailwind CSS project at `dashboard/` (repo root), with its own `package.json` — kept separate from the root project's ingestion scripts (`tsx`-run, `"type": "module"`) to avoid dependency/build conflicts.
- Deployed to Vercel with Root Directory = `dashboard/`. Read-only: no cron, no crawl logic, per the architecture already fixed in `2026-08-20-social-listening-architecture-design.md`.
- No ORM. Data fetching uses `@supabase/supabase-js` directly from **Server Components only**, authenticated with the Supabase **service-role key**, stored as a Vercel environment variable never sent to the browser.
- **Why service-role, not anon key:** both `articles` and `candidate_topics` have RLS enabled with zero policies defined (migrations `0001`, `0003`) — the anon key currently cannot read either table. Service-role bypasses RLS by design, so this works today without reopening the deferred RLS decision.

## Access

Public, no authentication — the data displayed (aggregated public news/trends) is not sensitive. Revisit if that changes.

## Pages

Four routes, mirroring ver 1's sector URL convention:

- `/` — Overview: all three categories blended
- `/tai-chinh`, `/giai-tri`, `/du-lich` — filtered to one category

Each page renders two sections:

1. **Hot topics** — shortlisted `candidate_topics` (`is_shortlisted = true`) for the most recent `date` with data, grouped by `source` (google_trends / youtube / rss), each row showing keyword, trending score, share of voice.
2. **Recent articles** — latest 20 `articles` rows (by `published_at desc`), filtered by `categories` array containment for sector pages, unfiltered (most recent overall) for the Overview page.

Category filter uses the existing snake_case values from `config/sources.config.ts` (`tai_chinh`, `giai_tri`, `du_lich`) against `candidate_topics.category_hint` and `articles.categories` (both `text[]`).

## Formulas

### Trending score — reuse `growth_rate` as-is

`candidate_topics.growth_rate` (computed in `rank-and-select.ts`) is already: `(metric_value_today − avg(metric_value over prior 7 days)) / avg(...)`, with a `999` sentinel for keywords with no prior-week history. It is already normalized to the same ratio unit across all three sources (`normalizeGrowthRate()` in `google-trends-source.ts`). The dashboard displays this value directly (as a percentage, i.e. `× 100`) as "Trending score" — **no new computation, no backend change**.

### Share of voice — computed at render time, not persisted

Because `metric_value` units differ by source (Google Trends traffic score, YouTube view count, RSS article-mention count), share of voice is computed **per source, within one category and one date** — never blended across sources:

```
share_of_voice(keyword) = metric_value(keyword)
  / Σ metric_value(all candidates, same source + same category + same date)
  × 100
```

- Denominator is **all evaluated candidates** for that source/category/date (not just the shortlisted top 10) — matches ver 1's `sectorTotalBuzz` being a true total, not a top-N total.
- A keyword tagged with multiple categories (`category_hint` array) counts at **full weight** in each category it belongs to (not split) — documented simplification, revisit only if it visibly distorts a category's totals.
- Computed inline in the dashboard's data-fetching layer from the already-fetched `candidate_topics` rows for that page — **no new Supabase column, no change to `rank-and-select.ts`**.
- Overview page (blended categories): share of voice shown per source using the *keyword's own matched categories* as the denominator scope (i.e., same per-category number as would show on that keyword's sector page) — there is no single cross-category "overall" share of voice, since the categories aren't mutually exclusive partitions of one total.

## Error handling

- No `candidate_topics` row for the requested date (cron hasn't run yet, or a fresh deploy before first run) → empty-state message per section, not a crash.
- Supabase query failure → caught per-section, rendered as an inline error state; one section failing does not take down the whole page.

## Testing

Following the project's established TDD convention: vitest-test the pure data-shaping functions (grouping by source, category filtering, share-of-voice calculation) as plain functions independent of Next.js/Supabase wiring. No E2E tests for the MVP (YAGNI).

## Explicitly out of scope for this spec

- Sentiment analysis (no data source for it yet — that's Apify/2b territory)
- Historical charts / time-series views (`/trending`, `/analytics`, topic-detail pages from ver 1) — revisit once there's more than a few days of history
- Any general-purpose trend-computation framework beyond the two formulas above
- Authentication
- Apify deep-crawl (2b) — explicitly deferred, comes after this ships

## Known simplifications (carry forward, not fixed here)

- Share of voice's "full weight per category" for multi-category keywords can over-count a category's total if a keyword spans multiple categories — acceptable for MVP, revisit if it produces visibly wrong-looking totals.
- Trending score displayed as `growth_rate × 100` inherits every caveat already documented for `growth_rate` in `2026-08-21-discovery-layer-database-schema.md` (recomputed every run for non-Google-Trends sources, frozen per-day for Google Trends, 999 sentinel, UTC-vs-ICT date coupling).
