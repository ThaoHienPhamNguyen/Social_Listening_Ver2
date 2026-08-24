# Overview KPI Cards + Donut Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 4 KPI cards (Buzz Volume, Topics Trending, Audience Scale, Sentiment Score) + a donut chart (% buzz by sector) to the top of the Overview page, computed entirely from data the project already accumulates — no backend/migration changes.

**Architecture:** One new reader method (`ArticlesReader.getForDate`), a small DRY refactor exporting 2 existing engagement-total helpers plus one new sentiment-counting helper, one new pure-logic file (`overview-metrics.ts`), one new orchestration file, and 3 new presentational components.

**Tech Stack:** Next.js 15 (App Router), React 19, Tailwind CSS v4, TypeScript, Vitest, `@supabase/supabase-js`.

**Spec:** `docs/superpowers/specs/2026-08-24-overview-kpi-donut-design.md`

## Global Constraints

- Working directory for all tasks: `dashboard/` (the Next.js app), not the repo root.
- **No backend/migration/GitHub Actions changes** — every task only reads existing tables.
- **Overview page only** — never rendered on sector pages.
- **No delta-vs-previous-period, no icons in KpiCard** — deliberately out of scope, keep it to label+value.
- **Buzz Volume** = `articles.length + Σ(threadsRows.post_count) + Σ(facebookRows.post_count)` for the date.
- **Topics Trending** = count of **distinct** `keyword` among `is_shortlisted=true` candidates for the date.
- **Audience Scale** = `Σ threadsEngagementTotal(row) + Σ facebookEngagementTotal(row)` (like+reply+repost+quote+share for Threads excluding view_count; like+comment+share for Facebook).
- **Sentiment Score** = `computeSentimentIndex(countAllSentiment(threadsSentimentRows ++ facebookSentimentRows))` — one aggregate figure across both platforms, `null` if nothing classified.
- **Donut weighting:** article with N categories → `1/N` weight per category (0 categories → excluded); Threads row → full `post_count` weight to its `category` if non-null (excluded if null); Facebook row → full `post_count` weight to its `category` (always non-null).
- **Load failures degrade silently** — `OverviewMetricsSection` doesn't render at all on error/no-date, no red banner, `console.error` only.
- **No component tests** — matches this codebase's established convention (no `@testing-library/react`).

---

### Task 1: `ArticlesReader.getForDate` + fake

**Files:**
- Modify: `dashboard/lib/articles-reader.ts`
- Create: `dashboard/tests/fakes/fake-articles-reader.ts`

**Interfaces:**
- Produces: `ArticlesReader.getForDate(date: string): Promise<{ id: string; categories: string[] }[]>` (new interface method), `FakeArticlesReader` — Task 4's orchestration test depends on the fake.

No test cycle for the interface/Supabase-class change itself (matches this codebase's convention — `SupabaseArticlesReader` has no dedicated test). The fake also has no dedicated test file (matches sub-project 3's established convention — fakes are only exercised via a later orchestration test).

- [ ] **Step 1: Add `getForDate` to the interface and Supabase class**

Replace `dashboard/lib/articles-reader.ts` entirely with:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Article } from './types';

export interface ArticlesReader {
  getRecentArticles(limit: number, category: string | null): Promise<Article[]>;
  getForDate(date: string): Promise<{ id: string; categories: string[] }[]>;
}

export class SupabaseArticlesReader implements ArticlesReader {
  constructor(private client: SupabaseClient) {}

  async getRecentArticles(limit: number, category: string | null): Promise<Article[]> {
    let query = this.client
      .from('articles')
      .select('id, url, title, published_at, source_id, categories, snippet')
      .order('published_at', { ascending: false })
      .limit(limit);
    if (category) {
      query = query.contains('categories', [category]);
    }
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data ?? []) as Article[];
  }

  // articles has no `date` column (unlike candidate_topics/topic_social_data/
  // facebook_page_data) — only `published_at` (a timestamptz). Filter by the
  // [date, date+1) range in UTC. Rows with published_at === null never match
  // any range, so they're correctly excluded.
  async getForDate(date: string): Promise<{ id: string; categories: string[] }[]> {
    const nextDate = new Date(`${date}T00:00:00Z`);
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);
    const nextDateStr = nextDate.toISOString().slice(0, 10);

    const { data, error } = await this.client
      .from('articles')
      .select('id, categories')
      .gte('published_at', `${date}T00:00:00Z`)
      .lt('published_at', `${nextDateStr}T00:00:00Z`)
      .limit(5000);
    if (error) throw new Error(error.message);
    return (data ?? []) as { id: string; categories: string[] }[];
  }
}
```

- [ ] **Step 2: Write the fake**

Create `dashboard/tests/fakes/fake-articles-reader.ts`:

```typescript
import type { ArticlesReader } from '../../lib/articles-reader';
import type { Article } from '../../lib/types';

export class FakeArticlesReader implements ArticlesReader {
  constructor(private articles: Article[] = []) {}

  async getRecentArticles(limit: number, category: string | null): Promise<Article[]> {
    const filtered = category
      ? this.articles.filter((a) => a.categories.includes(category))
      : this.articles;
    return [...filtered]
      .sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? ''))
      .slice(0, limit);
  }

  async getForDate(date: string): Promise<{ id: string; categories: string[] }[]> {
    return this.articles
      .filter((a) => a.published_at?.slice(0, 10) === date)
      .map((a) => ({ id: a.id, categories: a.categories }));
  }
}
```

- [ ] **Step 3: Verify**

Run (from `dashboard/`): `npm run typecheck && npm test`
Expected: both exit 0, no regressions (this only adds a method — `getRecentArticles`'s existing behavior/callers are untouched).

- [ ] **Step 4: Commit**

```bash
git add dashboard/lib/articles-reader.ts dashboard/tests/fakes/fake-articles-reader.ts
git commit -m "feat(dashboard): add ArticlesReader.getForDate and its fake"
```

---

### Task 2: DRY refactor — export/add shared engagement-total and sentiment helpers

**Files:**
- Modify: `dashboard/lib/topic-engagement.ts`
- Modify: `dashboard/tests/topic-engagement.test.ts`
- Modify: `dashboard/lib/facebook-summary.ts`
- Modify: `dashboard/tests/facebook-summary.test.ts`

**Interfaces:**
- Produces: `threadsEngagementTotal(row: ThreadsEngagementDaily): number` (was private in `topic-engagement.ts`, now exported), `countAllSentiment(rows: {sentiment: SentimentLabel|null}[]): SentimentCounts` (new, in `topic-engagement.ts`), `facebookEngagementTotal(row: FacebookEngagementDaily): number` (new, in `facebook-summary.ts`) — Task 3's `overview-metrics.ts` depends on all 3.

This task touches 2 already-tested, already-live files. Existing behavior must not change — this is pure extraction/addition, verified by the full existing suite still passing plus new tests for the newly-exported/added functions.

- [ ] **Step 1: Write the failing tests for the new/newly-exported functions**

Append to `dashboard/tests/topic-engagement.test.ts` (inside the existing file, after the last `describe` block — add these as new top-level `describe` blocks, and add `threadsEngagementTotal` and `countAllSentiment` to the existing `import { ... } from '../lib/topic-engagement';` line at the top of the file):

```typescript
describe('threadsEngagementTotal', () => {
  it('sums like+reply+repost+quote+share, excluding view_count', () => {
    const total = threadsEngagementTotal(engagementRow({ total_view_count: 99999 }));
    expect(total).toBe(16); // 10+1+2+0+3, from the shared engagementRow() fixture above
  });
});

describe('countAllSentiment', () => {
  it('counts every classified row into one bucket, ignoring key/grouping', () => {
    const result = countAllSentiment([
      { sentiment: 'positive' },
      { sentiment: 'positive' },
      { sentiment: 'negative' },
      { sentiment: 'neutral' },
    ]);
    expect(result).toEqual({ positive: 2, negative: 1, neutral: 1 });
  });

  it('ignores null and unknown labels', () => {
    const result = countAllSentiment([{ sentiment: null }, { sentiment: 'happy' as any }, { sentiment: 'positive' }]);
    expect(result).toEqual({ positive: 1, negative: 0, neutral: 0 });
  });

  it('returns all-zero counts for an empty array', () => {
    expect(countAllSentiment([])).toEqual({ positive: 0, negative: 0, neutral: 0 });
  });
});
```

Append to `dashboard/tests/facebook-summary.test.ts` (add `facebookEngagementTotal` to the existing `import { ... } from '../lib/facebook-summary';` line):

```typescript
describe('facebookEngagementTotal', () => {
  it('sums like+comment+share', () => {
    const total = facebookEngagementTotal(engagementRow());
    expect(total).toBe(15); // 10+3+2, from the shared engagementRow() fixture above
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/topic-engagement.test.ts tests/facebook-summary.test.ts`
Expected: FAIL — `threadsEngagementTotal`, `countAllSentiment`, `facebookEngagementTotal` are not exported yet.

- [ ] **Step 3: Export `threadsEngagementTotal`, add `countAllSentiment`**

In `dashboard/lib/topic-engagement.ts`, change:
```typescript
function threadsEngagementTotal(row: ThreadsEngagementDaily): number {
```
to:
```typescript
export function threadsEngagementTotal(row: ThreadsEngagementDaily): number {
```
(no other change to that function's body).

Then add this new function anywhere after `computeSentimentIndex` and before `attachEngagement`:
```typescript
// Same accumulation as groupSentimentCounts but into ONE bucket rather than
// grouped by key — used where a single overall sentiment figure is wanted
// (e.g. an Overview-wide Sentiment Score) rather than per-keyword/
// per-category counts.
export function countAllSentiment(rows: { sentiment: SentimentLabel | null }[]): SentimentCounts {
  const counts: SentimentCounts = { positive: 0, negative: 0, neutral: 0 };
  for (const row of rows) {
    if (row.sentiment !== 'positive' && row.sentiment !== 'negative' && row.sentiment !== 'neutral') continue;
    counts[row.sentiment] += 1;
  }
  return counts;
}
```

- [ ] **Step 4: Add `facebookEngagementTotal`, use it in `buildFacebookSummary`**

Replace `dashboard/lib/facebook-summary.ts` entirely with:

```typescript
import { computeSentimentIndex, type SentimentCounts } from './topic-engagement';
import type { FacebookEngagementDaily } from './types';

export interface FacebookSummary {
  totalEngagement: number; // like+comment+share
  postCount: number;
  sentiment: SentimentCounts;
  sentimentIndex: number | null;
}

export function facebookEngagementTotal(row: FacebookEngagementDaily): number {
  return row.total_like_count + row.total_comment_count + row.total_share_count;
}

export function buildFacebookSummary(
  category: string,
  engagementRows: FacebookEngagementDaily[],
  sentimentByCategory: Map<string, SentimentCounts>
): FacebookSummary | null {
  const engagementRow = engagementRows.find((r) => r.category === category);
  if (!engagementRow) return null;

  const sentiment = sentimentByCategory.get(category) ?? { positive: 0, negative: 0, neutral: 0 };
  return {
    totalEngagement: facebookEngagementTotal(engagementRow),
    postCount: engagementRow.post_count,
    sentiment,
    sentimentIndex: computeSentimentIndex(sentiment),
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/topic-engagement.test.ts tests/facebook-summary.test.ts`
Expected: PASS, all tests including the new ones.

- [ ] **Step 6: Run the full test suite and typecheck (regression check)**

Run: `npm run typecheck && npm test`
Expected: both exit 0. This is the critical check for this task — confirm `buildFacebookSummary`'s existing tests (which assert `totalEngagement: 15` etc.) still pass unchanged, proving the refactor didn't alter behavior.

- [ ] **Step 7: Commit**

```bash
git add dashboard/lib/topic-engagement.ts dashboard/tests/topic-engagement.test.ts dashboard/lib/facebook-summary.ts dashboard/tests/facebook-summary.test.ts
git commit -m "refactor(dashboard): export/add shared engagement-total and sentiment helpers"
```

---

### Task 3: Pure logic — `overview-metrics.ts`

**Files:**
- Create: `dashboard/lib/overview-metrics.ts`
- Create: `dashboard/tests/overview-metrics.test.ts`

**Interfaces:**
- Consumes: `CandidateTopic`, `SentimentLabel`, `ThreadsEngagementDaily`, `FacebookEngagementDaily` (existing/sub-project 3 types), `countAllSentiment`, `computeSentimentIndex`, `threadsEngagementTotal` (Task 2, from `topic-engagement.ts`), `facebookEngagementTotal` (Task 2, from `facebook-summary.ts`), `CATEGORIES` (existing, `lib/categories.ts`).
- Produces: `OverviewMetrics`, `DonutSegment` types, `computeOverviewMetrics(...)`, `computeDonutSegments(...)` — Task 4 depends on these exact names/signatures.

- [ ] **Step 1: Write the failing tests**

Create `dashboard/tests/overview-metrics.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computeOverviewMetrics, computeDonutSegments } from '../lib/overview-metrics';
import type { CandidateTopic, ThreadsEngagementDaily, FacebookEngagementDaily } from '../lib/types';

function candidate(overrides: Partial<CandidateTopic> = {}): CandidateTopic {
  return {
    id: 'id-1',
    source: 'rss',
    keyword: 'bitcoin',
    date: '2026-08-24',
    metric_value: 10,
    growth_rate: 0.5,
    category_hint: ['tai_chinh'],
    is_shortlisted: true,
    ...overrides,
  };
}

function threadsRow(overrides: Partial<ThreadsEngagementDaily> = {}): ThreadsEngagementDaily {
  return {
    date: '2026-08-24',
    keyword: 'bitcoin',
    category: 'tai_chinh',
    total_like_count: 10,
    total_reply_count: 1,
    total_repost_count: 2,
    total_quote_count: 0,
    total_share_count: 3,
    total_view_count: 100,
    post_count: 2,
    ...overrides,
  };
}

function facebookRow(overrides: Partial<FacebookEngagementDaily> = {}): FacebookEngagementDaily {
  return {
    date: '2026-08-24',
    category: 'giai_tri',
    total_like_count: 5,
    total_comment_count: 1,
    total_share_count: 1,
    post_count: 3,
    ...overrides,
  };
}

describe('computeOverviewMetrics', () => {
  it('sums buzz volume from article count + Threads/Facebook post counts', () => {
    const result = computeOverviewMetrics(
      [],
      [{ categories: ['tai_chinh'] }, { categories: [] }],
      [threadsRow({ post_count: 2 })],
      [facebookRow({ post_count: 3 })],
      []
    );
    expect(result.buzzVolume).toBe(7); // 2 articles + 2 threads posts + 3 facebook posts
  });

  it('counts distinct shortlisted keywords for topicsTrending, ignoring duplicates and non-shortlisted', () => {
    const result = computeOverviewMetrics(
      [
        candidate({ id: 'a', keyword: 'bitcoin', source: 'google_trends', is_shortlisted: true }),
        candidate({ id: 'b', keyword: 'bitcoin', source: 'youtube', is_shortlisted: true }),
        candidate({ id: 'c', keyword: 'ethereum', source: 'rss', is_shortlisted: false }),
      ],
      [],
      [],
      [],
      []
    );
    expect(result.topicsTrending).toBe(1);
  });

  it('sums audience scale from Threads + Facebook engagement totals', () => {
    const result = computeOverviewMetrics([], [], [threadsRow()], [facebookRow()], []);
    expect(result.audienceScale).toBe(23); // 16 (threads) + 7 (facebook)
  });

  it('computes an overall sentiment score across all rows regardless of keyword/category', () => {
    const result = computeOverviewMetrics(
      [],
      [],
      [],
      [],
      [{ sentiment: 'positive' }, { sentiment: 'positive' }, { sentiment: 'negative' }]
    );
    expect(result.sentimentScore).toBe(33);
  });

  it('returns null sentimentScore when no rows are classified', () => {
    const result = computeOverviewMetrics([], [], [], [], []);
    expect(result.sentimentScore).toBeNull();
  });
});

describe('computeDonutSegments', () => {
  it('splits a multi-category article fractionally across its categories', () => {
    const result = computeDonutSegments([{ categories: ['tai_chinh', 'giai_tri'] }], [], []);
    expect(result.find((s) => s.category === 'tai_chinh')?.pct).toBe(50);
    expect(result.find((s) => s.category === 'giai_tri')?.pct).toBe(50);
  });

  it('excludes articles with no categories from the denominator', () => {
    const result = computeDonutSegments([{ categories: ['tai_chinh'] }, { categories: [] }], [], []);
    expect(result.find((s) => s.category === 'tai_chinh')?.pct).toBe(100);
  });

  it('excludes Threads rows with a null category, weights Facebook rows fully by post_count', () => {
    const result = computeDonutSegments(
      [],
      [threadsRow({ category: null, post_count: 99 }), threadsRow({ category: 'tai_chinh', post_count: 1 })],
      [facebookRow({ category: 'giai_tri', post_count: 1 })]
    );
    expect(result.find((s) => s.category === 'tai_chinh')?.pct).toBe(50);
    expect(result.find((s) => s.category === 'giai_tri')?.pct).toBe(50);
  });

  it('returns 0% for every category (all 3 always present) when there is no weighted data at all', () => {
    const result = computeDonutSegments([], [], []);
    expect(result).toHaveLength(3);
    expect(result.every((s) => s.pct === 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/overview-metrics.test.ts`
Expected: FAIL — `Cannot find module '../lib/overview-metrics'`

- [ ] **Step 3: Write the implementation**

Create `dashboard/lib/overview-metrics.ts`:

```typescript
import type { CandidateTopic, FacebookEngagementDaily, SentimentLabel, ThreadsEngagementDaily } from './types';
import { countAllSentiment, computeSentimentIndex, threadsEngagementTotal } from './topic-engagement';
import { facebookEngagementTotal } from './facebook-summary';
import { CATEGORIES } from './categories';

export interface OverviewMetrics {
  buzzVolume: number;
  topicsTrending: number;
  audienceScale: number;
  sentimentScore: number | null;
}

export interface DonutSegment {
  category: string;
  label: string;
  pct: number;
}

export function computeOverviewMetrics(
  candidates: CandidateTopic[],
  articles: { categories: string[] }[],
  threadsRows: ThreadsEngagementDaily[],
  facebookRows: FacebookEngagementDaily[],
  sentimentRows: { sentiment: SentimentLabel | null }[]
): OverviewMetrics {
  const buzzVolume =
    articles.length +
    threadsRows.reduce((sum, r) => sum + r.post_count, 0) +
    facebookRows.reduce((sum, r) => sum + r.post_count, 0);

  const topicsTrending = new Set(
    candidates.filter((c) => c.is_shortlisted).map((c) => c.keyword)
  ).size;

  const audienceScale =
    threadsRows.reduce((sum, r) => sum + threadsEngagementTotal(r), 0) +
    facebookRows.reduce((sum, r) => sum + facebookEngagementTotal(r), 0);

  const sentimentScore = computeSentimentIndex(countAllSentiment(sentimentRows));

  return { buzzVolume, topicsTrending, audienceScale, sentimentScore };
}

export function computeDonutSegments(
  articles: { categories: string[] }[],
  threadsRows: ThreadsEngagementDaily[],
  facebookRows: FacebookEngagementDaily[]
): DonutSegment[] {
  const weightByCategory = new Map<string, number>();
  const addWeight = (category: string, weight: number) => {
    weightByCategory.set(category, (weightByCategory.get(category) ?? 0) + weight);
  };

  for (const article of articles) {
    if (article.categories.length === 0) continue;
    const weight = 1 / article.categories.length;
    for (const category of article.categories) {
      addWeight(category, weight);
    }
  }
  for (const row of threadsRows) {
    if (row.category === null) continue;
    addWeight(row.category, row.post_count);
  }
  for (const row of facebookRows) {
    addWeight(row.category, row.post_count);
  }

  const total = [...weightByCategory.values()].reduce((sum, v) => sum + v, 0);

  return CATEGORIES.map((c) => ({
    category: c.value,
    label: c.label,
    pct: total === 0 ? 0 : Math.round(((weightByCategory.get(c.value) ?? 0) / total) * 100),
  }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/overview-metrics.test.ts`
Expected: PASS, 9/9 tests.

- [ ] **Step 5: Run the full test suite and typecheck**

Run: `npm run typecheck && npm test`
Expected: both exit 0, no regressions.

- [ ] **Step 6: Commit**

```bash
git add dashboard/lib/overview-metrics.ts dashboard/tests/overview-metrics.test.ts
git commit -m "feat(dashboard): add Overview KPI/donut pure logic (overview-metrics.ts)"
```

---

### Task 4: Orchestration — `get-overview-metrics.ts`

**Files:**
- Create: `dashboard/lib/get-overview-metrics.ts`
- Create: `dashboard/tests/get-overview-metrics.test.ts`

**Interfaces:**
- Consumes: `CandidateTopicsReader`, `ArticlesReader` (Task 1), `ThreadsEngagementReader`, `FacebookEngagementReader`, `ThreadsSentimentReader`, `FacebookSentimentReader` (existing, sub-project 3), `computeOverviewMetrics`, `computeDonutSegments`, `OverviewMetrics`, `DonutSegment` (Task 3).
- Produces: `getOverviewMetrics(candidateReader, articlesReader, threadsEngagementReader, facebookEngagementReader, threadsSentimentReader, facebookSentimentReader, date): Promise<{ metrics: OverviewMetrics; donut: DonutSegment[] }>` — Task 8's page wiring depends on this exact name/signature.

- [ ] **Step 1: Write the failing tests**

Create `dashboard/tests/get-overview-metrics.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { getOverviewMetrics } from '../lib/get-overview-metrics';
import { FakeCandidateTopicsReader } from './fakes/fake-candidate-topics-reader';
import { FakeArticlesReader } from './fakes/fake-articles-reader';
import { FakeThreadsEngagementReader } from './fakes/fake-threads-engagement-reader';
import { FakeFacebookEngagementReader } from './fakes/fake-facebook-engagement-reader';
import { FakeThreadsSentimentReader } from './fakes/fake-threads-sentiment-reader';
import { FakeFacebookSentimentReader } from './fakes/fake-facebook-sentiment-reader';
import type { Article } from '../lib/types';

describe('getOverviewMetrics', () => {
  it('combines all 6 readers into metrics + donut for the given date', async () => {
    const candidateReader = new FakeCandidateTopicsReader([
      { id: 'a', source: 'rss', keyword: 'bitcoin', date: '2026-08-24', metric_value: 1, growth_rate: 0, category_hint: ['tai_chinh'], is_shortlisted: true },
    ]);
    const articlesReader = new FakeArticlesReader([
      {
        id: 'art-1',
        url: 'https://x',
        title: 'x',
        published_at: '2026-08-24T10:00:00Z',
        source_id: 's',
        categories: ['tai_chinh'],
        snippet: '',
      } as Article,
    ]);
    const threadsEngagementReader = new FakeThreadsEngagementReader([
      {
        date: '2026-08-24',
        keyword: 'bitcoin',
        category: 'tai_chinh',
        total_like_count: 1,
        total_reply_count: 0,
        total_repost_count: 0,
        total_quote_count: 0,
        total_share_count: 0,
        total_view_count: 0,
        post_count: 1,
      },
    ]);
    const facebookEngagementReader = new FakeFacebookEngagementReader([]);
    const threadsSentimentReader = new FakeThreadsSentimentReader([
      { date: '2026-08-24', keyword: 'bitcoin', sentiment: 'positive' },
    ]);
    const facebookSentimentReader = new FakeFacebookSentimentReader([]);

    const result = await getOverviewMetrics(
      candidateReader,
      articlesReader,
      threadsEngagementReader,
      facebookEngagementReader,
      threadsSentimentReader,
      facebookSentimentReader,
      '2026-08-24'
    );

    expect(result.metrics.buzzVolume).toBe(2); // 1 article + 1 threads post
    expect(result.metrics.topicsTrending).toBe(1);
    expect(result.metrics.sentimentScore).toBe(100);
    expect(result.donut.find((s) => s.category === 'tai_chinh')?.pct).toBe(100);
  });

  it('returns zero/null metrics when every reader has no data for the date', async () => {
    const result = await getOverviewMetrics(
      new FakeCandidateTopicsReader([]),
      new FakeArticlesReader([]),
      new FakeThreadsEngagementReader([]),
      new FakeFacebookEngagementReader([]),
      new FakeThreadsSentimentReader([]),
      new FakeFacebookSentimentReader([]),
      '2026-08-24'
    );

    expect(result.metrics.buzzVolume).toBe(0);
    expect(result.metrics.sentimentScore).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/get-overview-metrics.test.ts`
Expected: FAIL — `Cannot find module '../lib/get-overview-metrics'`

- [ ] **Step 3: Write the implementation**

Create `dashboard/lib/get-overview-metrics.ts`:

```typescript
import type { CandidateTopicsReader } from './candidate-topics-reader';
import type { ArticlesReader } from './articles-reader';
import type { ThreadsEngagementReader } from './threads-engagement-reader';
import type { FacebookEngagementReader } from './facebook-engagement-reader';
import type { ThreadsSentimentReader } from './threads-sentiment-reader';
import type { FacebookSentimentReader } from './facebook-sentiment-reader';
import { computeOverviewMetrics, computeDonutSegments, type OverviewMetrics, type DonutSegment } from './overview-metrics';

export async function getOverviewMetrics(
  candidateReader: CandidateTopicsReader,
  articlesReader: ArticlesReader,
  threadsEngagementReader: ThreadsEngagementReader,
  facebookEngagementReader: FacebookEngagementReader,
  threadsSentimentReader: ThreadsSentimentReader,
  facebookSentimentReader: FacebookSentimentReader,
  date: string
): Promise<{ metrics: OverviewMetrics; donut: DonutSegment[] }> {
  const [candidates, articles, threadsRows, facebookRows, threadsSentimentRows, facebookSentimentRows] =
    await Promise.all([
      candidateReader.getCandidatesForDate(date),
      articlesReader.getForDate(date),
      threadsEngagementReader.getForDate(date),
      facebookEngagementReader.getForDate(date),
      threadsSentimentReader.getForDate(date),
      facebookSentimentReader.getForDate(date),
    ]);

  const sentimentRows = [...threadsSentimentRows, ...facebookSentimentRows];

  return {
    metrics: computeOverviewMetrics(candidates, articles, threadsRows, facebookRows, sentimentRows),
    donut: computeDonutSegments(articles, threadsRows, facebookRows),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/get-overview-metrics.test.ts`
Expected: PASS, 2/2 tests.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: all pass, no regressions.

- [ ] **Step 6: Commit**

```bash
git add dashboard/lib/get-overview-metrics.ts dashboard/tests/get-overview-metrics.test.ts
git commit -m "feat(dashboard): add getOverviewMetrics orchestration"
```

---

### Task 5: `KpiCard` component

**Files:**
- Create: `dashboard/components/KpiCard.tsx`

**Interfaces:**
- Produces: `KpiCard({ label, value }: { label: string; value: string })` — Task 7 depends on this exact name/signature.

No test cycle (JSX). Verified by `npm run build`.

- [ ] **Step 1: Write the component**

Create `dashboard/components/KpiCard.tsx`:

```tsx
export function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface border border-line rounded-card shadow-card p-6">
      <div className="text-[11px] font-semibold text-ink-3 tracking-wider uppercase mb-2">{label}</div>
      <div className="text-2xl font-extrabold text-ink">{value}</div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the build**

Run (from `dashboard/`): `npm run build`
Expected: exits 0 — standalone, unused-so-far component.

- [ ] **Step 3: Commit**

```bash
git add dashboard/components/KpiCard.tsx
git commit -m "feat(dashboard): add KpiCard component"
```

---

### Task 6: `DonutChart` component

**Files:**
- Create: `dashboard/components/DonutChart.tsx`

**Interfaces:**
- Consumes: `DonutSegment` (Task 3), `CATEGORIES` (existing, `lib/categories.ts`).
- Produces: `DonutChart({ data }: { data: DonutSegment[] })` — Task 7 depends on this exact name/signature.

No test cycle (JSX). Verified by `npm run build`.

- [ ] **Step 1: Write the component**

Create `dashboard/components/DonutChart.tsx`:

```tsx
import { CATEGORIES } from '../lib/categories';
import type { DonutSegment } from '../lib/overview-metrics';

const R = 52;
const CX = 70;
const CY = 70;
const CIRCUMFERENCE = 2 * Math.PI * R;

function colorForCategory(category: string): string {
  return CATEGORIES.find((c) => c.value === category)?.color ?? '#888888';
}

export function DonutChart({ data }: { data: DonutSegment[] }) {
  let offset = 0;

  return (
    <div className="flex items-center gap-8">
      <svg width="140" height="140" viewBox="0 0 140 140" className="flex-shrink-0">
        <circle cx={CX} cy={CY} r={R} fill="none" stroke="var(--color-muted)" strokeWidth="16" />
        {data.map((seg) => {
          const dash = (seg.pct / 100) * CIRCUMFERENCE;
          const el = (
            <circle
              key={seg.category}
              cx={CX}
              cy={CY}
              r={R}
              fill="none"
              stroke={colorForCategory(seg.category)}
              strokeWidth="16"
              strokeDasharray={`${dash} ${CIRCUMFERENCE}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${CX} ${CY})`}
            />
          );
          offset += dash;
          return el;
        })}
      </svg>
      <div className="flex flex-col gap-3">
        {data.map((seg) => (
          <div key={seg.category} className="flex items-center gap-2.5">
            <span
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ background: colorForCategory(seg.category) }}
            />
            <span className="text-sm text-ink-2 flex-1">{seg.label}</span>
            <span className="text-sm font-bold" style={{ color: colorForCategory(seg.category) }}>
              {seg.pct}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the build**

Run (from `dashboard/`): `npm run build`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add dashboard/components/DonutChart.tsx
git commit -m "feat(dashboard): add DonutChart component"
```

---

### Task 7: `OverviewMetricsSection` component

**Files:**
- Create: `dashboard/components/OverviewMetricsSection.tsx`

**Interfaces:**
- Consumes: `KpiCard` (Task 5), `DonutChart` (Task 6), `OverviewMetrics`, `DonutSegment` (Task 3).
- Produces: `OverviewMetricsSection({ metrics, donut }: { metrics: OverviewMetrics; donut: DonutSegment[] })` — Task 8's page wiring depends on this exact name/signature.

No test cycle (JSX). Verified by `npm run build`.

- [ ] **Step 1: Write the component**

Create `dashboard/components/OverviewMetricsSection.tsx`:

```tsx
import { KpiCard } from './KpiCard';
import { DonutChart } from './DonutChart';
import type { OverviewMetrics, DonutSegment } from '../lib/overview-metrics';

function formatNumber(n: number): string {
  return n.toLocaleString('vi-VN');
}

function formatSentimentScore(score: number | null): string {
  if (score === null) return '—';
  return score > 0 ? `+${score}` : `${score}`;
}

export function OverviewMetricsSection({
  metrics,
  donut,
}: {
  metrics: OverviewMetrics;
  donut: DonutSegment[];
}) {
  return (
    <section className="mb-8">
      <div className="grid gap-4 md:grid-cols-4 mb-6">
        <KpiCard label="Buzz Volume" value={formatNumber(metrics.buzzVolume)} />
        <KpiCard label="Topics Trending" value={formatNumber(metrics.topicsTrending)} />
        <KpiCard label="Audience Scale" value={formatNumber(metrics.audienceScale)} />
        <KpiCard label="Sentiment Score" value={formatSentimentScore(metrics.sentimentScore)} />
      </div>
      <div className="bg-surface border border-line rounded-card shadow-card p-6">
        <h2 className="text-base font-bold text-ink mb-4">Phân bổ lĩnh vực</h2>
        <DonutChart data={donut} />
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Verify the build**

Run (from `dashboard/`): `npm run build`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add dashboard/components/OverviewMetricsSection.tsx
git commit -m "feat(dashboard): add OverviewMetricsSection component"
```

---

### Task 8: Wire into the Overview page

**Files:**
- Modify: `dashboard/app/page.tsx`

**Interfaces:**
- Consumes: `getOverviewMetrics` (Task 4), `OverviewMetricsSection` (Task 7), `OverviewMetrics`/`DonutSegment` (Task 3), plus existing readers (`SupabaseArticlesReader`, `SupabaseCandidateTopicsReader`, `SupabaseThreadsEngagementReader`, `SupabaseFacebookEngagementReader`, `SupabaseThreadsSentimentReader`, `SupabaseFacebookSentimentReader`).

No test cycle — verified by `npm run build && npm run typecheck && npm test` (full regression check, this touches the page `loadHotTopics`/`loadArticles`/`loadThreadsEngagement` already live in).

- [ ] **Step 1: Replace the Overview page**

Replace `dashboard/app/page.tsx` entirely with:

```tsx
import { createServerSupabaseClient } from '../lib/supabase';
import { SupabaseCandidateTopicsReader } from '../lib/candidate-topics-reader';
import { SupabaseArticlesReader } from '../lib/articles-reader';
import { SupabaseThreadsEngagementReader } from '../lib/threads-engagement-reader';
import { SupabaseThreadsSentimentReader } from '../lib/threads-sentiment-reader';
import { SupabaseFacebookEngagementReader } from '../lib/facebook-engagement-reader';
import { SupabaseFacebookSentimentReader } from '../lib/facebook-sentiment-reader';
import { getHotTopics, type HotTopicsResult } from '../lib/get-hot-topics';
import { enrichHotTopicsWithThreadsData } from '../lib/get-topic-engagement';
import { withoutEngagement } from '../lib/topic-engagement';
import { getOverviewMetrics } from '../lib/get-overview-metrics';
import type { OverviewMetrics, DonutSegment } from '../lib/overview-metrics';
import { HotTopicsSection } from '../components/HotTopicsSection';
import { ArticlesSection } from '../components/ArticlesSection';
import { OverviewMetricsSection } from '../components/OverviewMetricsSection';
import { Topbar } from '../components/layout/Topbar';
import type { Article, CandidateTopic } from '../lib/types';
import type { HotTopicRow } from '../lib/hot-topics';

export const dynamic = 'force-dynamic';

async function loadHotTopics(): Promise<HotTopicsResult | { error: string }> {
  try {
    const client = createServerSupabaseClient();
    return await getHotTopics(new SupabaseCandidateTopicsReader(client), null);
  } catch (err) {
    console.error(err);
    return { error: 'Không tải được dữ liệu topic, vui lòng thử lại sau.' };
  }
}

async function loadArticles(): Promise<Article[] | { error: string }> {
  try {
    const client = createServerSupabaseClient();
    return await new SupabaseArticlesReader(client).getRecentArticles(20, null);
  } catch (err) {
    console.error(err);
    return { error: 'Không tải được bài báo, vui lòng thử lại sau.' };
  }
}

// Errors/missing data here are swallowed on purpose (sub-project 3's spec
// §5): engagement + sentiment is supplementary context, not primary
// content — a failure must not block hot topics from rendering, and
// degrades silently rather than a red error banner.
async function loadThreadsEngagement(
  bySource: Record<CandidateTopic['source'], HotTopicRow[]>,
  date: string | null
) {
  if (date === null) return withoutEngagement(bySource);
  try {
    const client = createServerSupabaseClient();
    return await enrichHotTopicsWithThreadsData(
      bySource,
      new SupabaseThreadsEngagementReader(client),
      new SupabaseThreadsSentimentReader(client),
      date
    );
  } catch (err) {
    console.error(err);
    return withoutEngagement(bySource);
  }
}

// Same silent-degradation rule (this spec's §7): a KPI/donut load failure
// just means the section doesn't render, no red banner.
async function loadOverviewMetrics(
  date: string | null
): Promise<{ metrics: OverviewMetrics; donut: DonutSegment[] } | null> {
  if (date === null) return null;
  try {
    const client = createServerSupabaseClient();
    return await getOverviewMetrics(
      new SupabaseCandidateTopicsReader(client),
      new SupabaseArticlesReader(client),
      new SupabaseThreadsEngagementReader(client),
      new SupabaseFacebookEngagementReader(client),
      new SupabaseThreadsSentimentReader(client),
      new SupabaseFacebookSentimentReader(client),
      date
    );
  } catch (err) {
    console.error(err);
    return null;
  }
}

export default async function OverviewPage() {
  const [hotTopics, articles] = await Promise.all([loadHotTopics(), loadArticles()]);

  const [threadsEnrichedBySource, overviewMetrics] = await Promise.all([
    'error' in hotTopics ? Promise.resolve(null) : loadThreadsEngagement(hotTopics.bySource, hotTopics.date),
    'error' in hotTopics ? Promise.resolve(null) : loadOverviewMetrics(hotTopics.date),
  ]);

  const hotTopicsWithEngagement =
    'error' in hotTopics
      ? hotTopics
      : { ...hotTopics, bySource: threadsEnrichedBySource ?? withoutEngagement(hotTopics.bySource) };

  return (
    <>
      <Topbar title="Overview" />
      <main className="max-w-4xl mx-auto p-6">
        {overviewMetrics && (
          <OverviewMetricsSection metrics={overviewMetrics.metrics} donut={overviewMetrics.donut} />
        )}
        {'error' in hotTopicsWithEngagement ? (
          <p className="text-red-600">{hotTopicsWithEngagement.error}</p>
        ) : (
          <HotTopicsSection date={hotTopicsWithEngagement.date} bySource={hotTopicsWithEngagement.bySource} />
        )}
        <div className="mt-8">
          {'error' in articles ? (
            <p className="text-red-600">{articles.error}</p>
          ) : (
            <ArticlesSection articles={articles} />
          )}
        </div>
      </main>
    </>
  );
}
```

- [ ] **Step 2: Verify**

Run (from `dashboard/`): `npm run build && npm run typecheck && npm test`
Expected: all exit 0.

- [ ] **Step 3: Commit**

```bash
git add dashboard/app/page.tsx
git commit -m "feat(dashboard): wire Overview KPI cards + donut chart into the Overview page"
```

---

### Task 9: Final full-suite verification

**Files:** none (verification-only task).

- [ ] **Step 1: Run the full check from `dashboard/`**

Run: `npm run build && npm run typecheck && npm test`
Expected: all exit 0.

- [ ] **Step 2: Structural check**

Start the dev server (`npm run dev`) and fetch `/` (e.g. `curl http://localhost:3000/`). Confirm the response contains the 4 KPI labels ("Buzz Volume", "Topics Trending", "Audience Scale", "Sentiment Score") and "Phân bổ lĩnh vực" (the donut section heading) somewhere in the HTML — either with real numbers (if Supabase credentials are configured) or the page still renders without crashing (if not, the whole `OverviewMetricsSection` is simply absent per the silent-degradation rule — confirm the rest of the page, e.g. "Topic đang hot", still renders in that case). Stop the dev server afterward.
