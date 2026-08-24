# Buzz Trend Chart + Topic Movers (Gainers/Losers) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new `/analytics` page with a 7-day Buzz Trend line chart (by category) and a Gainers/Losers "Topic Movers" section, ranked from Threads engagement per keyword.

**Architecture:** Extend the 3 existing readers (`ArticlesReader`, `ThreadsEngagementReader`, `FacebookEngagementReader`) with a new `getForDateRange` method alongside their existing `getForDate`. Two new pure-logic modules compute the chart data and the movers ranking from that range data; two new orchestration functions wire readers to logic (same reader/Fake DI pattern as every prior sub-project). A new page composes them, following `app/page.tsx`'s silent-degradation error pattern.

**Tech Stack:** Next.js 15 App Router, React 19 Server Components, TypeScript, Vitest, `@supabase/supabase-js`, Tailwind v4 (`@theme` tokens already defined in `dashboard/app/globals.css`).

**Spec:** `docs/superpowers/specs/2026-08-24-buzz-trend-topic-movers-design.md`

## Global Constraints

- No period toggle — fixed 7-day window only (current) / 14-day fetch (movers, split into two 7-day halves).
- Gainers/Losers ranks by Threads engagement only, grouped by `keyword` — Facebook/Articles are not keyword-scoped in this schema, so they are excluded from this ranking (documented gap, not a bug).
- Buzz Trend uses the exact same category-weighting rule as the donut chart from sub-project A (`dashboard/lib/overview-metrics.ts`): an article with N categories contributes `1/N` to each; a Threads row contributes its full `post_count` if `category` is non-null (excluded if null); a Facebook row always contributes its full `post_count`.
- Error handling: silent degradation only — on any load failure, `console.error` and render nothing for that section (no red banner). Matches sub-project A/3's rule.
- No new Supabase tables or migrations — every method here reads existing tables (`articles`, `threads_engagement_daily`, `facebook_engagement_daily`) with a date-range filter instead of an exact-date filter.
- Pure-logic modules (`buzz-trend.ts`, `topic-movers.ts`) get full test coverage with fixture data. Orchestration modules (`get-buzz-trend.ts`, `get-topic-movers.ts`) are tested via the existing Fake-reader pattern. React components are not unit-tested (project convention — see `dashboard/components/DonutChart.tsx`, which has none).
- Sidebar nav label stays in English ("Analytics"), matching ver1 and matching the existing "Overview" label already in this otherwise-Vietnamese UI (decision already made in sub-project A).
- All new dates are `YYYY-MM-DD` strings compared/added via UTC arithmetic (`Date.setUTCDate`), matching the existing convention in `dashboard/lib/articles-reader.ts`'s `getForDate`.

---

### Task 1: Data layer — `getForDateRange` on all 3 readers

**Files:**
- Modify: `dashboard/lib/articles-reader.ts`
- Modify: `dashboard/lib/threads-engagement-reader.ts`
- Modify: `dashboard/lib/facebook-engagement-reader.ts`
- Modify: `dashboard/tests/fakes/fake-articles-reader.ts`
- Modify: `dashboard/tests/fakes/fake-threads-engagement-reader.ts`
- Modify: `dashboard/tests/fakes/fake-facebook-engagement-reader.ts`
- Create: `dashboard/tests/reader-date-ranges.test.ts`

**Interfaces:**
- Produces (used by Tasks 4 and 5):
  - `ArticlesReader.getForDateRange(startDate: string, endDateExclusive: string): Promise<{ id: string; categories: string[]; date: string }[]>`
  - `ThreadsEngagementReader.getForDateRange(startDate: string, endDateExclusive: string): Promise<ThreadsEngagementDaily[]>`
  - `FacebookEngagementReader.getForDateRange(startDate: string, endDateExclusive: string): Promise<FacebookEngagementDaily[]>`
  - Range is `[startDate, endDateExclusive)` — `startDate` inclusive, `endDateExclusive` exclusive, both `YYYY-MM-DD`.

- [ ] **Step 1: Write the failing test**

Create `dashboard/tests/reader-date-ranges.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { FakeArticlesReader } from './fakes/fake-articles-reader';
import { FakeThreadsEngagementReader } from './fakes/fake-threads-engagement-reader';
import { FakeFacebookEngagementReader } from './fakes/fake-facebook-engagement-reader';
import type { Article, ThreadsEngagementDaily, FacebookEngagementDaily } from '../lib/types';

function article(overrides: Partial<Article> = {}): Article {
  return {
    id: 'a-1',
    url: 'https://example.com',
    title: 't',
    published_at: '2026-08-20T10:00:00Z',
    source_id: 's-1',
    categories: ['tai_chinh'],
    snippet: '',
    ...overrides,
  };
}

function threadsRow(overrides: Partial<ThreadsEngagementDaily> = {}): ThreadsEngagementDaily {
  return {
    date: '2026-08-20',
    keyword: 'bitcoin',
    category: 'tai_chinh',
    total_like_count: 1,
    total_reply_count: 0,
    total_repost_count: 0,
    total_quote_count: 0,
    total_share_count: 0,
    total_view_count: 0,
    post_count: 1,
    ...overrides,
  };
}

function facebookRow(overrides: Partial<FacebookEngagementDaily> = {}): FacebookEngagementDaily {
  return {
    date: '2026-08-20',
    category: 'giai_tri',
    total_like_count: 1,
    total_comment_count: 0,
    total_share_count: 0,
    post_count: 1,
    ...overrides,
  };
}

describe('FakeArticlesReader.getForDateRange', () => {
  it('includes the start date, excludes the end date, and attaches a `date` field', async () => {
    const reader = new FakeArticlesReader([
      article({ id: 'in-start', published_at: '2026-08-18T00:00:00Z' }),
      article({ id: 'in-mid', published_at: '2026-08-19T23:59:59Z' }),
      article({ id: 'out-end', published_at: '2026-08-20T00:00:00Z' }),
      article({ id: 'out-before', published_at: '2026-08-17T23:59:59Z' }),
      article({ id: 'no-date', published_at: null }),
    ]);
    const result = await reader.getForDateRange('2026-08-18', '2026-08-20');
    expect(result.map((r) => r.id).sort()).toEqual(['in-mid', 'in-start']);
    expect(result.find((r) => r.id === 'in-start')?.date).toBe('2026-08-18');
  });
});

describe('FakeThreadsEngagementReader.getForDateRange', () => {
  it('filters rows to [startDate, endDateExclusive)', async () => {
    const reader = new FakeThreadsEngagementReader([
      threadsRow({ date: '2026-08-18' }),
      threadsRow({ date: '2026-08-19' }),
      threadsRow({ date: '2026-08-20' }),
    ]);
    const result = await reader.getForDateRange('2026-08-18', '2026-08-20');
    expect(result.map((r) => r.date).sort()).toEqual(['2026-08-18', '2026-08-19']);
  });
});

describe('FakeFacebookEngagementReader.getForDateRange', () => {
  it('filters rows to [startDate, endDateExclusive)', async () => {
    const reader = new FakeFacebookEngagementReader([
      facebookRow({ date: '2026-08-18' }),
      facebookRow({ date: '2026-08-19' }),
      facebookRow({ date: '2026-08-20' }),
    ]);
    const result = await reader.getForDateRange('2026-08-18', '2026-08-20');
    expect(result.map((r) => r.date).sort()).toEqual(['2026-08-18', '2026-08-19']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `dashboard/`): `npm test -- reader-date-ranges`
Expected: FAIL — `getForDateRange` does not exist on any of the 3 Fakes (TypeScript compile error surfaced as a test failure).

- [ ] **Step 3: Add `getForDateRange` to `ArticlesReader`**

In `dashboard/lib/articles-reader.ts`, add to the `ArticlesReader` interface (after the existing `getForDate` line):

```typescript
  getForDateRange(startDate: string, endDateExclusive: string): Promise<{ id: string; categories: string[]; date: string }[]>;
```

Add to the `SupabaseArticlesReader` class (after the existing `getForDate` method):

```typescript
  // Same [date, date+1) UTC boundary logic as getForDate, generalized to an
  // arbitrary [startDate, endDateExclusive) range. Rows in this range always
  // have a non-null published_at (a null published_at can't match any
  // gte/lt range), so the `date` field below is always derivable.
  async getForDateRange(
    startDate: string,
    endDateExclusive: string
  ): Promise<{ id: string; categories: string[]; date: string }[]> {
    const { data, error } = await this.client
      .from('articles')
      .select('id, categories, published_at')
      .gte('published_at', `${startDate}T00:00:00Z`)
      .lt('published_at', `${endDateExclusive}T00:00:00Z`)
      .limit(5000);
    if (error) throw new Error(error.message);
    if (data && data.length === 5000) {
      console.warn(
        `articles-reader: hit the 5000-row limit for range [${startDate}, ${endDateExclusive}) — Buzz Trend counts may be truncated.`
      );
    }
    return ((data ?? []) as { id: string; categories: string[]; published_at: string }[]).map((row) => ({
      id: row.id,
      categories: row.categories,
      date: row.published_at.slice(0, 10),
    }));
  }
```

- [ ] **Step 4: Add `getForDateRange` to `ThreadsEngagementReader`**

In `dashboard/lib/threads-engagement-reader.ts`, add to the interface:

```typescript
  getForDateRange(startDate: string, endDateExclusive: string): Promise<ThreadsEngagementDaily[]>;
```

Add to `SupabaseThreadsEngagementReader`:

```typescript
  async getForDateRange(startDate: string, endDateExclusive: string): Promise<ThreadsEngagementDaily[]> {
    const { data, error } = await this.client
      .from('threads_engagement_daily')
      .select(
        'date, keyword, category, total_like_count, total_reply_count, total_repost_count, total_quote_count, total_share_count, total_view_count, post_count'
      )
      .gte('date', startDate)
      .lt('date', endDateExclusive);
    if (error) throw new Error(error.message);
    return (data ?? []) as ThreadsEngagementDaily[];
  }
```

- [ ] **Step 5: Add `getForDateRange` to `FacebookEngagementReader`**

In `dashboard/lib/facebook-engagement-reader.ts`, add to the interface:

```typescript
  getForDateRange(startDate: string, endDateExclusive: string): Promise<FacebookEngagementDaily[]>;
```

Add to `SupabaseFacebookEngagementReader`:

```typescript
  async getForDateRange(startDate: string, endDateExclusive: string): Promise<FacebookEngagementDaily[]> {
    const { data, error } = await this.client
      .from('facebook_engagement_daily')
      .select('date, category, total_like_count, total_comment_count, total_share_count, post_count')
      .gte('date', startDate)
      .lt('date', endDateExclusive);
    if (error) throw new Error(error.message);
    return (data ?? []) as FacebookEngagementDaily[];
  }
```

- [ ] **Step 6: Add `getForDateRange` to the 3 Fakes**

In `dashboard/tests/fakes/fake-articles-reader.ts`, add:

```typescript
  async getForDateRange(startDate: string, endDateExclusive: string): Promise<{ id: string; categories: string[]; date: string }[]> {
    return this.articles
      .filter((a) => {
        const d = a.published_at?.slice(0, 10);
        return d !== undefined && d >= startDate && d < endDateExclusive;
      })
      .map((a) => ({ id: a.id, categories: a.categories, date: a.published_at!.slice(0, 10) }));
  }
```

In `dashboard/tests/fakes/fake-threads-engagement-reader.ts`, add:

```typescript
  async getForDateRange(startDate: string, endDateExclusive: string): Promise<ThreadsEngagementDaily[]> {
    return this.rows.filter((r) => r.date >= startDate && r.date < endDateExclusive);
  }
```

In `dashboard/tests/fakes/fake-facebook-engagement-reader.ts`, add:

```typescript
  async getForDateRange(startDate: string, endDateExclusive: string): Promise<FacebookEngagementDaily[]> {
    return this.rows.filter((r) => r.date >= startDate && r.date < endDateExclusive);
  }
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npm test -- reader-date-ranges`
Expected: PASS (3 test files, 3 tests).

- [ ] **Step 8: Run the full test suite to confirm nothing else broke**

Run: `npm test`
Expected: PASS — the interface additions are additive (no existing method signature changed), so no other test should be affected.

- [ ] **Step 9: Commit**

```bash
git add dashboard/lib/articles-reader.ts dashboard/lib/threads-engagement-reader.ts dashboard/lib/facebook-engagement-reader.ts dashboard/tests/fakes/fake-articles-reader.ts dashboard/tests/fakes/fake-threads-engagement-reader.ts dashboard/tests/fakes/fake-facebook-engagement-reader.ts dashboard/tests/reader-date-ranges.test.ts
git commit -m "feat: add getForDateRange to Articles/Threads/Facebook readers"
```

---

### Task 2: Pure logic — `buzz-trend.ts` (+ extract `accumulateCategoryWeights`)

**Files:**
- Modify: `dashboard/lib/overview-metrics.ts`
- Create: `dashboard/lib/buzz-trend.ts`
- Create: `dashboard/tests/buzz-trend.test.ts`
- Test (regression): `dashboard/tests/overview-metrics.test.ts` (existing — must still pass unchanged)

**Interfaces:**
- Consumes: `ThreadsEngagementDaily`, `FacebookEngagementDaily` from `dashboard/lib/types.ts` (existing); `CATEGORIES` from `dashboard/lib/categories.ts` (existing, has `.value`/`.label`/`.color`/`.slug`).
- Produces (used by Task 4):
  - `accumulateCategoryWeights(articles: {categories: string[]}[], threadsRows: ThreadsEngagementDaily[], facebookRows: FacebookEngagementDaily[]): Map<string, number>` — exported from `overview-metrics.ts`.
  - `computeBuzzTrend(articles: {categories: string[]; date: string}[], threadsRows: ThreadsEngagementDaily[], facebookRows: FacebookEngagementDaily[], dates: string[]): BuzzTrendPoint[]` — exported from `buzz-trend.ts`.
  - `interface BuzzTrendPoint { date: string; [category: string]: number | string }` — one entry per category `value` (`tai_chinh`/`giai_tri`/`du_lich`) holding that day's weighted buzz.

- [ ] **Step 1: Write the failing test for the refactor + new module**

Create `dashboard/tests/buzz-trend.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computeBuzzTrend } from '../lib/buzz-trend';
import type { ThreadsEngagementDaily, FacebookEngagementDaily } from '../lib/types';

function threadsRow(overrides: Partial<ThreadsEngagementDaily> = {}): ThreadsEngagementDaily {
  return {
    date: '2026-08-18',
    keyword: 'k',
    category: 'du_lich',
    total_like_count: 0,
    total_reply_count: 0,
    total_repost_count: 0,
    total_quote_count: 0,
    total_share_count: 0,
    total_view_count: 0,
    post_count: 4,
    ...overrides,
  };
}

function facebookRow(overrides: Partial<FacebookEngagementDaily> = {}): FacebookEngagementDaily {
  return {
    date: '2026-08-19',
    category: 'giai_tri',
    total_like_count: 0,
    total_comment_count: 0,
    total_share_count: 0,
    post_count: 2,
    ...overrides,
  };
}

describe('computeBuzzTrend', () => {
  it('produces one point per date in `dates`, even for dates with zero data', () => {
    const result = computeBuzzTrend([], [], [], ['2026-08-18', '2026-08-19']);
    expect(result).toEqual([
      { date: '2026-08-18', tai_chinh: 0, giai_tri: 0, du_lich: 0 },
      { date: '2026-08-19', tai_chinh: 0, giai_tri: 0, du_lich: 0 },
    ]);
  });

  it('weights each source using the same rule as the donut chart, grouped per day', () => {
    const result = computeBuzzTrend(
      [
        { categories: ['tai_chinh', 'giai_tri'], date: '2026-08-18' },
        { categories: ['tai_chinh'], date: '2026-08-19' },
      ],
      [threadsRow({ date: '2026-08-18', category: 'du_lich', post_count: 4 })],
      [facebookRow({ date: '2026-08-19', category: 'giai_tri', post_count: 2 })],
      ['2026-08-18', '2026-08-19']
    );
    expect(result[0]).toEqual({ date: '2026-08-18', tai_chinh: 0.5, giai_tri: 0.5, du_lich: 4 });
    expect(result[1]).toEqual({ date: '2026-08-19', tai_chinh: 1, giai_tri: 2, du_lich: 0 });
  });

  it('ignores rows whose date is not in the requested dates array', () => {
    const result = computeBuzzTrend(
      [{ categories: ['tai_chinh'], date: '2026-08-20' }],
      [],
      [],
      ['2026-08-18']
    );
    expect(result[0].tai_chinh).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- buzz-trend`
Expected: FAIL — `dashboard/lib/buzz-trend.ts` does not exist yet.

- [ ] **Step 3: Extract `accumulateCategoryWeights` in `overview-metrics.ts`**

In `dashboard/lib/overview-metrics.ts`, replace the body of `computeDonutSegments` (everything from `const weightByCategory = new Map...` through `const total = ...`) by extracting a new exported function. The full new content of the weight-accumulation + `computeDonutSegments` head is:

```typescript
export function accumulateCategoryWeights(
  articles: { categories: string[] }[],
  threadsRows: ThreadsEngagementDaily[],
  facebookRows: FacebookEngagementDaily[]
): Map<string, number> {
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

  return weightByCategory;
}

export function computeDonutSegments(
  articles: { categories: string[] }[],
  threadsRows: ThreadsEngagementDaily[],
  facebookRows: FacebookEngagementDaily[]
): DonutSegment[] {
  const weightByCategory = accumulateCategoryWeights(articles, threadsRows, facebookRows);
  const total = [...weightByCategory.values()].reduce((sum, v) => sum + v, 0);

  if (total === 0) {
    return CATEGORIES.map((c) => ({ category: c.value, label: c.label, pct: 0 }));
  }

  // Largest-remainder rounding: independently rounding each category's
  // percentage can sum to 99 or 101 (e.g. three equal thirds each round to
  // 33, losing a point). Floor every value, then hand the leftover
  // percentage points to whichever categories had the largest fractional
  // remainder, so the legend always sums to exactly 100.
  const raw = CATEGORIES.map((c) => {
    const weight = weightByCategory.get(c.value) ?? 0;
    const exact = (weight / total) * 100;
    const floor = Math.floor(exact);
    return { category: c.value, label: c.label, floor, remainder: exact - floor };
  });

  const flooredSum = raw.reduce((sum, r) => sum + r.floor, 0);
  const remaining = 100 - flooredSum;
  const bonusCategories = new Set(
    [...raw].sort((a, b) => b.remainder - a.remainder).slice(0, remaining).map((r) => r.category)
  );

  return raw.map((r) => ({
    category: r.category,
    label: r.label,
    pct: r.floor + (bonusCategories.has(r.category) ? 1 : 0),
  }));
}
```

This is a pure extraction — `computeDonutSegments`'s observable behavior is unchanged, so `dashboard/tests/overview-metrics.test.ts` must still pass without modification.

- [ ] **Step 4: Create `buzz-trend.ts`**

Create `dashboard/lib/buzz-trend.ts`:

```typescript
import { accumulateCategoryWeights } from './overview-metrics';
import { CATEGORIES } from './categories';
import type { ThreadsEngagementDaily, FacebookEngagementDaily } from './types';

export interface BuzzTrendPoint {
  date: string;
  [category: string]: number | string;
}

export function computeBuzzTrend(
  articles: { categories: string[]; date: string }[],
  threadsRows: ThreadsEngagementDaily[],
  facebookRows: FacebookEngagementDaily[],
  dates: string[]
): BuzzTrendPoint[] {
  return dates.map((date) => {
    const dayArticles = articles.filter((a) => a.date === date);
    const dayThreads = threadsRows.filter((r) => r.date === date);
    const dayFacebook = facebookRows.filter((r) => r.date === date);
    const weightByCategory = accumulateCategoryWeights(dayArticles, dayThreads, dayFacebook);

    const point: BuzzTrendPoint = { date };
    for (const c of CATEGORIES) {
      point[c.value] = weightByCategory.get(c.value) ?? 0;
    }
    return point;
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- buzz-trend`
Expected: PASS (3 tests).

- [ ] **Step 6: Run the regression + full suite**

Run: `npm test -- overview-metrics`
Expected: PASS — all pre-existing `computeDonutSegments`/`computeOverviewMetrics` tests pass unchanged (confirms the extraction preserved behavior).

Run: `npm test`
Expected: PASS, full suite green.

- [ ] **Step 7: Commit**

```bash
git add dashboard/lib/overview-metrics.ts dashboard/lib/buzz-trend.ts dashboard/tests/buzz-trend.test.ts
git commit -m "feat: add computeBuzzTrend, extract accumulateCategoryWeights from computeDonutSegments"
```

---

### Task 3: Pure logic — `topic-movers.ts`

**Files:**
- Create: `dashboard/lib/topic-movers.ts`
- Create: `dashboard/tests/topic-movers.test.ts`

**Interfaces:**
- Consumes: `ThreadsEngagementDaily` (existing type); `threadsEngagementTotal(row: ThreadsEngagementDaily): number` — already exported from `dashboard/lib/topic-engagement.ts` (sub-project A).
- Produces (used by Task 5):
  - `interface TopicMover { keyword: string; category: string; buzz: number; deltaPct: number }`
  - `computeTopicMovers(currentRows: ThreadsEngagementDaily[], previousRows: ThreadsEngagementDaily[]): { gainers: TopicMover[]; losers: TopicMover[]; hasRealLosers: boolean }`

**Design note (deviation from the spec's literal wording, made here since it closes a real gap):** the spec says category is "taken from the latest current-period record" — but a keyword that dropped to zero buzz this period (the most useful kind of "loser") then has NO current-period rows at all, so it would wrongly be excluded for lacking a category. This implementation instead resolves category from current-period rows first, falling back to previous-period rows — so a vanished topic still gets a category and still shows up as a `-100%` loser. A keyword with no category in either period is excluded (nowhere to link it to).

- [ ] **Step 1: Write the failing test**

Create `dashboard/tests/topic-movers.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computeTopicMovers } from '../lib/topic-movers';
import type { ThreadsEngagementDaily } from '../lib/types';

function row(overrides: Partial<ThreadsEngagementDaily> = {}): ThreadsEngagementDaily {
  return {
    date: '2026-08-24',
    keyword: 'bitcoin',
    category: 'tai_chinh',
    total_like_count: 10,
    total_reply_count: 0,
    total_repost_count: 0,
    total_quote_count: 0,
    total_share_count: 0,
    total_view_count: 0,
    post_count: 1,
    ...overrides,
  };
}

describe('computeTopicMovers', () => {
  it('ranks gainers by deltaPct descending', () => {
    const current = [row({ keyword: 'a', total_like_count: 20 }), row({ keyword: 'b', total_like_count: 10 })];
    const previous = [row({ keyword: 'a', total_like_count: 10 }), row({ keyword: 'b', total_like_count: 10 })];
    const { gainers } = computeTopicMovers(current, previous);
    expect(gainers.map((g) => g.keyword)).toEqual(['a', 'b']);
    expect(gainers[0].deltaPct).toBe(100);
    expect(gainers[1].deltaPct).toBe(0);
  });

  it('treats a brand-new keyword (no previous rows) as +100%', () => {
    const { gainers } = computeTopicMovers([row({ keyword: 'new', total_like_count: 5 })], []);
    expect(gainers[0]).toMatchObject({ keyword: 'new', deltaPct: 100 });
  });

  it('excludes a keyword with zero buzz in both periods', () => {
    const current = [
      row({
        keyword: 'a',
        total_like_count: 0,
        total_reply_count: 0,
        total_repost_count: 0,
        total_quote_count: 0,
        total_share_count: 0,
      }),
    ];
    const { gainers, losers } = computeTopicMovers(current, []);
    expect(gainers).toHaveLength(0);
    expect(losers).toHaveLength(0);
  });

  it('excludes a keyword whose rows never carry a category, in either period', () => {
    const current = [row({ keyword: 'a', category: null })];
    const { gainers } = computeTopicMovers(current, []);
    expect(gainers).toHaveLength(0);
  });

  it('sums engagement (not post_count) across multiple rows for the same keyword in one period', () => {
    const current = [
      row({ keyword: 'a', total_like_count: 10, total_reply_count: 0 }),
      row({ keyword: 'a', total_like_count: 5, total_reply_count: 1 }),
    ];
    const { gainers } = computeTopicMovers(current, []);
    expect(gainers[0].buzz).toBe(16); // 10+5 likes + 1 reply
  });

  it('falls back to true losers (deltaPct < 0) when any exist, sorted ascending', () => {
    const current = [row({ keyword: 'up', total_like_count: 20 }), row({ keyword: 'down', total_like_count: 5 })];
    const previous = [row({ keyword: 'up', total_like_count: 10 }), row({ keyword: 'down', total_like_count: 10 })];
    const { losers, hasRealLosers } = computeTopicMovers(current, previous);
    expect(hasRealLosers).toBe(true);
    expect(losers.map((l) => l.keyword)).toEqual(['down']);
  });

  it('falls back to the slowest-growing topics when no true losers exist', () => {
    const current = [row({ keyword: 'fast', total_like_count: 30 }), row({ keyword: 'slow', total_like_count: 11 })];
    const previous = [row({ keyword: 'fast', total_like_count: 10 }), row({ keyword: 'slow', total_like_count: 10 })];
    const { losers, hasRealLosers } = computeTopicMovers(current, previous);
    expect(hasRealLosers).toBe(false);
    expect(losers[0].keyword).toBe('slow');
  });

  it('a keyword with buzz only in the previous period (vanished this period) still resolves a category and shows -100%', () => {
    const previous = [row({ keyword: 'gone', category: 'du_lich', total_like_count: 10 })];
    const { losers } = computeTopicMovers([], previous);
    expect(losers[0]).toMatchObject({ keyword: 'gone', category: 'du_lich', deltaPct: -100 });
  });

  it('caps gainers and losers at 5 entries each', () => {
    const current = Array.from({ length: 8 }, (_, i) => row({ keyword: `k${i}`, total_like_count: 10 + i }));
    const { gainers } = computeTopicMovers(current, []);
    expect(gainers).toHaveLength(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- topic-movers`
Expected: FAIL — `dashboard/lib/topic-movers.ts` does not exist yet.

- [ ] **Step 3: Implement `topic-movers.ts`**

Create `dashboard/lib/topic-movers.ts`:

```typescript
import { threadsEngagementTotal } from './topic-engagement';
import type { ThreadsEngagementDaily } from './types';

export interface TopicMover {
  keyword: string;
  category: string;
  buzz: number;
  deltaPct: number;
}

interface KeywordAgg {
  buzz: number;
  category: string | null;
  latestDate: string;
}

function aggregateByKeyword(rows: ThreadsEngagementDaily[]): Map<string, KeywordAgg> {
  const map = new Map<string, KeywordAgg>();
  for (const row of rows) {
    const existing = map.get(row.keyword);
    const buzz = (existing?.buzz ?? 0) + threadsEngagementTotal(row);
    const isNewest = existing === undefined || row.date >= existing.latestDate;
    const category = row.category !== null && isNewest ? row.category : (existing?.category ?? null);
    const latestDate = existing === undefined || row.date > existing.latestDate ? row.date : existing.latestDate;
    map.set(row.keyword, { buzz, category, latestDate });
  }
  return map;
}

// See this task's plan notes for why category resolution falls back to the
// previous period: a keyword can vanish entirely from the current period
// (its most useful "loser" case) and still needs a category to link to.
export function computeTopicMovers(
  currentRows: ThreadsEngagementDaily[],
  previousRows: ThreadsEngagementDaily[]
): { gainers: TopicMover[]; losers: TopicMover[]; hasRealLosers: boolean } {
  const current = aggregateByKeyword(currentRows);
  const previous = aggregateByKeyword(previousRows);

  const keywords = new Set([...current.keys(), ...previous.keys()]);
  const movers: TopicMover[] = [];
  for (const keyword of keywords) {
    const curr = current.get(keyword);
    const prev = previous.get(keyword);
    const category = curr?.category ?? prev?.category ?? null;
    if (category === null) continue;

    const buzz = curr?.buzz ?? 0;
    const prevBuzz = prev?.buzz ?? 0;
    if (buzz === 0 && prevBuzz === 0) continue;

    const deltaPct = prevBuzz > 0 ? ((buzz - prevBuzz) / prevBuzz) * 100 : 100;
    movers.push({ keyword, category, buzz, deltaPct });
  }

  const gainers = [...movers].sort((a, b) => b.deltaPct - a.deltaPct).slice(0, 5);
  const trueLosers = movers.filter((m) => m.deltaPct < 0).sort((a, b) => a.deltaPct - b.deltaPct);
  const losers =
    trueLosers.length > 0 ? trueLosers.slice(0, 5) : [...movers].sort((a, b) => a.deltaPct - b.deltaPct).slice(0, 5);

  return { gainers, losers, hasRealLosers: trueLosers.length > 0 };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- topic-movers`
Expected: PASS (9 tests).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add dashboard/lib/topic-movers.ts dashboard/tests/topic-movers.test.ts
git commit -m "feat: add computeTopicMovers (Gainers/Losers ranking from Threads engagement)"
```

---

### Task 4: Orchestration — `get-buzz-trend.ts`

**Files:**
- Create: `dashboard/lib/get-buzz-trend.ts`
- Create: `dashboard/tests/get-buzz-trend.test.ts`

**Interfaces:**
- Consumes: `ArticlesReader`, `ThreadsEngagementReader`, `FacebookEngagementReader` (Task 1's `getForDateRange`); `computeBuzzTrend`, `BuzzTrendPoint` (Task 2).
- Produces (used by Task 7): `getBuzzTrend(articlesReader, threadsEngagementReader, facebookEngagementReader, latestDate: string): Promise<BuzzTrendPoint[]>`.

- [ ] **Step 1: Write the failing test**

Create `dashboard/tests/get-buzz-trend.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { getBuzzTrend } from '../lib/get-buzz-trend';
import { FakeArticlesReader } from './fakes/fake-articles-reader';
import { FakeThreadsEngagementReader } from './fakes/fake-threads-engagement-reader';
import { FakeFacebookEngagementReader } from './fakes/fake-facebook-engagement-reader';
import type { Article } from '../lib/types';

function article(overrides: Partial<Article> = {}): Article {
  return {
    id: 'a',
    url: 'u',
    title: 't',
    published_at: '2026-08-24T00:00:00Z',
    source_id: 's',
    categories: ['tai_chinh'],
    snippet: '',
    ...overrides,
  };
}

describe('getBuzzTrend', () => {
  it('queries the 7-day range ending on latestDate and returns 7 points in chronological order', async () => {
    const articlesReader = new FakeArticlesReader([
      article({ id: 'in', published_at: '2026-08-18T00:00:00Z' }),
      article({ id: 'out-before', published_at: '2026-08-17T00:00:00Z' }),
      article({ id: 'out-after', published_at: '2026-08-25T00:00:00Z' }),
    ]);
    const result = await getBuzzTrend(
      articlesReader,
      new FakeThreadsEngagementReader([]),
      new FakeFacebookEngagementReader([]),
      '2026-08-24'
    );
    expect(result.map((p) => p.date)).toEqual([
      '2026-08-18',
      '2026-08-19',
      '2026-08-20',
      '2026-08-21',
      '2026-08-22',
      '2026-08-23',
      '2026-08-24',
    ]);
    expect(result[0].tai_chinh).toBe(1); // 'in' article counted on 2026-08-18
    expect(result.every((p) => p.date !== '2026-08-17' && p.date !== '2026-08-25')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- get-buzz-trend`
Expected: FAIL — `dashboard/lib/get-buzz-trend.ts` does not exist yet.

- [ ] **Step 3: Implement `get-buzz-trend.ts`**

Create `dashboard/lib/get-buzz-trend.ts`:

```typescript
import type { ArticlesReader } from './articles-reader';
import type { ThreadsEngagementReader } from './threads-engagement-reader';
import type { FacebookEngagementReader } from './facebook-engagement-reader';
import { computeBuzzTrend, type BuzzTrendPoint } from './buzz-trend';

function addDaysUTC(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function getBuzzTrend(
  articlesReader: ArticlesReader,
  threadsEngagementReader: ThreadsEngagementReader,
  facebookEngagementReader: FacebookEngagementReader,
  latestDate: string
): Promise<BuzzTrendPoint[]> {
  const startDate = addDaysUTC(latestDate, -6);
  const endDateExclusive = addDaysUTC(latestDate, 1);
  const dates = Array.from({ length: 7 }, (_, i) => addDaysUTC(startDate, i));

  const [articles, threadsRows, facebookRows] = await Promise.all([
    articlesReader.getForDateRange(startDate, endDateExclusive),
    threadsEngagementReader.getForDateRange(startDate, endDateExclusive),
    facebookEngagementReader.getForDateRange(startDate, endDateExclusive),
  ]);

  return computeBuzzTrend(articles, threadsRows, facebookRows, dates);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- get-buzz-trend`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add dashboard/lib/get-buzz-trend.ts dashboard/tests/get-buzz-trend.test.ts
git commit -m "feat: add getBuzzTrend orchestration"
```

---

### Task 5: Orchestration — `get-topic-movers.ts`

**Files:**
- Create: `dashboard/lib/get-topic-movers.ts`
- Create: `dashboard/tests/get-topic-movers.test.ts`

**Interfaces:**
- Consumes: `ThreadsEngagementReader` (Task 1's `getForDateRange`); `computeTopicMovers`, `TopicMover` (Task 3).
- Produces (used by Task 7): `getTopicMovers(threadsEngagementReader, latestDate: string): Promise<{ gainers: TopicMover[]; losers: TopicMover[]; hasRealLosers: boolean }>`.

- [ ] **Step 1: Write the failing test**

Create `dashboard/tests/get-topic-movers.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { getTopicMovers } from '../lib/get-topic-movers';
import { FakeThreadsEngagementReader } from './fakes/fake-threads-engagement-reader';
import type { ThreadsEngagementDaily } from '../lib/types';

function row(overrides: Partial<ThreadsEngagementDaily> = {}): ThreadsEngagementDaily {
  return {
    date: '2026-08-24',
    keyword: 'bitcoin',
    category: 'tai_chinh',
    total_like_count: 10,
    total_reply_count: 0,
    total_repost_count: 0,
    total_quote_count: 0,
    total_share_count: 0,
    total_view_count: 0,
    post_count: 1,
    ...overrides,
  };
}

describe('getTopicMovers', () => {
  it('splits the 14-day fetch into current (last 7 days) vs previous (7 days before that) at the latestDate-6 boundary', async () => {
    const reader = new FakeThreadsEngagementReader([
      row({ date: '2026-08-17', total_like_count: 5 }), // previous period (last day before the boundary)
      row({ date: '2026-08-10', total_like_count: 999 }), // outside the 14-day window entirely
      row({ date: '2026-08-18', total_like_count: 20 }), // current period (first day, inclusive boundary)
    ]);
    const { gainers } = await getTopicMovers(reader, '2026-08-24');
    expect(gainers[0].buzz).toBe(20); // only the current-period row counts toward buzz
    expect(gainers[0].deltaPct).toBe(300); // (20-5)/5*100
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- get-topic-movers`
Expected: FAIL — `dashboard/lib/get-topic-movers.ts` does not exist yet.

- [ ] **Step 3: Implement `get-topic-movers.ts`**

Create `dashboard/lib/get-topic-movers.ts`:

```typescript
import type { ThreadsEngagementReader } from './threads-engagement-reader';
import { computeTopicMovers, type TopicMover } from './topic-movers';

function addDaysUTC(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function getTopicMovers(
  threadsEngagementReader: ThreadsEngagementReader,
  latestDate: string
): Promise<{ gainers: TopicMover[]; losers: TopicMover[]; hasRealLosers: boolean }> {
  const currentStart = addDaysUTC(latestDate, -6);
  const endDateExclusive = addDaysUTC(latestDate, 1);
  const previousStart = addDaysUTC(latestDate, -13);

  const allRows = await threadsEngagementReader.getForDateRange(previousStart, endDateExclusive);
  const currentRows = allRows.filter((r) => r.date >= currentStart);
  const previousRows = allRows.filter((r) => r.date < currentStart);

  return computeTopicMovers(currentRows, previousRows);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- get-topic-movers`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add dashboard/lib/get-topic-movers.ts dashboard/tests/get-topic-movers.test.ts
git commit -m "feat: add getTopicMovers orchestration"
```

---

### Task 6: UI — `BuzzTrendChart.tsx`, `TopicMoversSection.tsx`, Sidebar nav entry

**Files:**
- Create: `dashboard/components/BuzzTrendChart.tsx`
- Create: `dashboard/components/TopicMoversSection.tsx`
- Modify: `dashboard/components/layout/Sidebar.tsx`

**Interfaces:**
- Consumes: `BuzzTrendPoint` (Task 2), `TopicMover` (Task 3), `CATEGORIES` (existing `dashboard/lib/categories.ts`, each item has `.value`/`.label`/`.color`/`.slug`).
- Produces (used by Task 7): `<BuzzTrendChart data={BuzzTrendPoint[]} />`, `<TopicMoversSection gainers={TopicMover[]} losers={TopicMover[]} hasRealLosers={boolean} />`.
- No tests for this task — components are not unit-tested in this project (see `dashboard/components/DonutChart.tsx`, `dashboard/components/KpiCard.tsx`, neither of which has a test file).

**Design note on the category badge:** ver1's Gainers/Losers list colors the category badge text directly with the category's raw color on a `${color}18` tinted background. This project already found `tai_chinh`'s raw color (`#16a34a`) fails WCAG AA as text (it's exactly why `--color-success` was darkened to `#15803d` in sub-project A) — so badge text must not reuse a raw `CATEGORIES` color. Instead, follow the pattern already used in `Sidebar.tsx`'s category list and `DonutChart.tsx`'s legend: put the category color only on a small decorative dot, and keep the label text in the existing neutral `text-ink-3` token.

- [ ] **Step 1: Create `BuzzTrendChart.tsx`**

Create `dashboard/components/BuzzTrendChart.tsx`:

```tsx
import { CATEGORIES } from '../lib/categories';
import type { BuzzTrendPoint } from '../lib/buzz-trend';

const H = 140;
const W = 500;
const PAD = { top: 8, bottom: 24, left: 4, right: 4 };

export function BuzzTrendChart({ data }: { data: BuzzTrendPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center text-sm text-ink-3" style={{ height: H + 32 }}>
        Chưa có dữ liệu
      </div>
    );
  }

  const allVals = data.flatMap((p) => CATEGORIES.map((c) => Number(p[c.value])));
  const max = Math.max(...allVals, 1);

  const chartH = H - PAD.top - PAD.bottom;
  const chartW = W - PAD.left - PAD.right;
  const toX = (i: number) => PAD.left + (i / (data.length - 1)) * chartW;
  const toY = (v: number) => PAD.top + chartH - (v / max) * chartH;

  const step = Math.max(1, Math.floor((data.length - 1) / 6));
  const labelIdxs = [
    ...new Set([...Array.from({ length: 7 }, (_, i) => Math.min(i * step, data.length - 1)), data.length - 1]),
  ];

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H + 8 }} aria-hidden="true">
        {[0, 0.25, 0.5, 0.75, 1].map((v) => {
          const y = PAD.top + chartH - v * chartH;
          return (
            <line
              key={v}
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y}
              y2={y}
              stroke="var(--color-line)"
              strokeWidth={0.5}
              strokeDasharray="3 3"
            />
          );
        })}
        {CATEGORIES.map((c) => {
          const coords = data.map((p, i) => ({ x: toX(i), y: toY(Number(p[c.value])) }));
          const linePath = coords.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x} ${pt.y}`).join(' ');
          const areaPath = `${linePath} L ${coords[coords.length - 1].x} ${PAD.top + chartH} L ${coords[0].x} ${PAD.top + chartH} Z`;
          return <path key={`area-${c.value}`} d={areaPath} fill={c.color} fillOpacity={0.06} />;
        })}
        {CATEGORIES.map((c) => {
          const coords = data.map((p, i) => ({ x: toX(i), y: toY(Number(p[c.value])) }));
          const linePath = coords.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x} ${pt.y}`).join(' ');
          return (
            <path
              key={c.value}
              d={linePath}
              fill="none"
              stroke={c.color}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          );
        })}
        {labelIdxs.map((i) => (
          <text key={i} x={toX(i)} y={H - 2} textAnchor="middle" fontSize={9} fill="var(--color-ink-3)">
            {String(data[i].date).slice(5)}
          </text>
        ))}
      </svg>
      <div className="flex items-center gap-5 mt-1">
        {CATEGORIES.map((c) => (
          <span key={c.value} className="flex items-center gap-1.5 text-[11px] text-ink-3">
            <span className="w-6 h-0.5 inline-block rounded-full" style={{ background: c.color }} />
            {c.label}
          </span>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `TopicMoversSection.tsx`**

Create `dashboard/components/TopicMoversSection.tsx`:

```tsx
import Link from 'next/link';
import { CATEGORIES } from '../lib/categories';
import type { TopicMover } from '../lib/topic-movers';

function categoryMeta(value: string) {
  return CATEGORIES.find((c) => c.value === value);
}

function MoverList({ movers }: { movers: TopicMover[] }) {
  if (movers.length === 0) {
    return <p className="text-sm text-ink-3 text-center py-4">Chưa có dữ liệu.</p>;
  }
  return (
    <div className="space-y-3">
      {movers.map((m, i) => {
        const meta = categoryMeta(m.category);
        const positive = m.deltaPct >= 0;
        return (
          <Link
            key={m.keyword}
            href={meta ? `/${meta.slug}` : '/'}
            className="flex items-center gap-3 p-3 rounded-[10px] hover:bg-muted transition-colors group"
          >
            <span className="text-xs font-bold text-ink-3 w-4 flex-shrink-0">{i + 1}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-ink truncate group-hover:text-brand transition-colors">
                {m.keyword}
              </p>
              {meta && (
                <span className="inline-flex items-center gap-1 text-[11px] text-ink-3 mt-0.5">
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: meta.color }} />
                  {meta.label}
                </span>
              )}
            </div>
            <div className="text-right flex-shrink-0">
              <p className={`text-sm font-bold ${positive ? 'text-success' : 'text-danger'}`}>
                {positive ? '▲' : '▼'} {Math.abs(m.deltaPct).toFixed(0)}%
              </p>
              <p className="text-[11px] text-ink-3">{m.buzz.toLocaleString('vi-VN')} buzz</p>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

export function TopicMoversSection({
  gainers,
  losers,
  hasRealLosers,
}: {
  gainers: TopicMover[];
  losers: TopicMover[];
  hasRealLosers: boolean;
}) {
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <div className="bg-surface border border-line rounded-card shadow-card p-6">
        <h2 className="text-base font-bold text-ink mb-1">Top Gainers</h2>
        <p className="text-xs text-ink-3 mb-4">Tăng trưởng mạnh nhất so với kỳ trước</p>
        <MoverList movers={gainers} />
      </div>
      <div className="bg-surface border border-line rounded-card shadow-card p-6">
        <h2 className="text-base font-bold text-ink mb-1">{hasRealLosers ? 'Top Losers' : 'Tăng trưởng chậm nhất'}</h2>
        <p className="text-xs text-ink-3 mb-4">
          {hasRealLosers ? 'Sụt giảm mạnh nhất so với kỳ trước' : 'Buzz tăng ít nhất so với kỳ trước'}
        </p>
        <MoverList movers={losers} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add the Analytics nav entry to `Sidebar.tsx`**

In `dashboard/components/layout/Sidebar.tsx`, inside the first `<div>` of the nav (the "Tổng quan" group), immediately after the closing `</Link>` of the Overview link and before that `<div>`'s closing tag, insert:

```tsx
          <Link
            href="/analytics"
            aria-current={pathname === '/analytics' ? 'page' : undefined}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-[10px] text-sm font-medium transition-colors ${
              pathname === '/analytics'
                ? 'bg-brand-faint text-brand font-semibold'
                : 'text-ink-2 hover:bg-muted hover:text-ink'
            }`}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 20V10M12 20V4M6 20v-6" />
            </svg>
            Analytics
          </Link>
```

- [ ] **Step 4: Run the full test suite (no new tests in this task, but confirm nothing broke)**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Run the build to catch any TypeScript/JSX errors**

Run: `npm run build`
Expected: Succeeds (no type errors in the new components or the Sidebar edit).

- [ ] **Step 6: Commit**

```bash
git add dashboard/components/BuzzTrendChart.tsx dashboard/components/TopicMoversSection.tsx dashboard/components/layout/Sidebar.tsx
git commit -m "feat: add BuzzTrendChart, TopicMoversSection components, Analytics nav entry"
```

---

### Task 7: Page — `app/analytics/page.tsx`

**Files:**
- Create: `dashboard/app/analytics/page.tsx`

**Interfaces:**
- Consumes: `SupabaseCandidateTopicsReader.getLatestDate()` (existing), `SupabaseArticlesReader`/`SupabaseThreadsEngagementReader`/`SupabaseFacebookEngagementReader` (existing constructors), `getBuzzTrend` (Task 4), `getTopicMovers` (Task 5), `BuzzTrendChart`/`TopicMoversSection` (Task 6), `Topbar` (existing, `dashboard/components/layout/Topbar.tsx`).
- No tests for this task — Server Component pages are not unit-tested in this project (see `dashboard/app/page.tsx`, `dashboard/app/[slug]/page.tsx`, neither has a test file); correctness here rests on Tasks 1-6 already being tested and this file matching the same wiring pattern as `app/page.tsx`.

- [ ] **Step 1: Create `dashboard/app/analytics/page.tsx`**

```tsx
import { createServerSupabaseClient } from '../../lib/supabase';
import { SupabaseCandidateTopicsReader } from '../../lib/candidate-topics-reader';
import { SupabaseArticlesReader } from '../../lib/articles-reader';
import { SupabaseThreadsEngagementReader } from '../../lib/threads-engagement-reader';
import { SupabaseFacebookEngagementReader } from '../../lib/facebook-engagement-reader';
import { getBuzzTrend } from '../../lib/get-buzz-trend';
import { getTopicMovers } from '../../lib/get-topic-movers';
import type { BuzzTrendPoint } from '../../lib/buzz-trend';
import type { TopicMover } from '../../lib/topic-movers';
import { BuzzTrendChart } from '../../components/BuzzTrendChart';
import { TopicMoversSection } from '../../components/TopicMoversSection';
import { Topbar } from '../../components/layout/Topbar';

export const dynamic = 'force-dynamic';

async function loadLatestDate(): Promise<string | null> {
  try {
    const client = createServerSupabaseClient();
    return await new SupabaseCandidateTopicsReader(client).getLatestDate();
  } catch (err) {
    console.error(err);
    return null;
  }
}

async function loadBuzzTrend(date: string): Promise<BuzzTrendPoint[] | null> {
  try {
    const client = createServerSupabaseClient();
    return await getBuzzTrend(
      new SupabaseArticlesReader(client),
      new SupabaseThreadsEngagementReader(client),
      new SupabaseFacebookEngagementReader(client),
      date
    );
  } catch (err) {
    console.error(err);
    return null;
  }
}

async function loadTopicMovers(
  date: string
): Promise<{ gainers: TopicMover[]; losers: TopicMover[]; hasRealLosers: boolean } | null> {
  try {
    const client = createServerSupabaseClient();
    return await getTopicMovers(new SupabaseThreadsEngagementReader(client), date);
  } catch (err) {
    console.error(err);
    return null;
  }
}

export default async function AnalyticsPage() {
  const latestDate = await loadLatestDate();

  const [buzzTrend, topicMovers] = latestDate
    ? await Promise.all([loadBuzzTrend(latestDate), loadTopicMovers(latestDate)])
    : [null, null];

  return (
    <>
      <Topbar title="Analytics" />
      <main className="max-w-4xl mx-auto p-6">
        {latestDate === null ? (
          <p className="text-sm text-ink-3">Chưa có dữ liệu.</p>
        ) : (
          <>
            <section className="bg-surface border border-line rounded-card shadow-card p-6 mb-8">
              <h2 className="text-base font-bold text-ink mb-1">Buzz Trend — theo lĩnh vực</h2>
              <p className="text-xs text-ink-3 mb-4">7 ngày qua</p>
              {buzzTrend ? (
                <BuzzTrendChart data={buzzTrend} />
              ) : (
                <p className="text-sm text-ink-3">Chưa có dữ liệu.</p>
              )}
            </section>
            {topicMovers && (
              <TopicMoversSection
                gainers={topicMovers.gainers}
                losers={topicMovers.losers}
                hasRealLosers={topicMovers.hasRealLosers}
              />
            )}
          </>
        )}
      </main>
    </>
  );
}
```

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 3: Run the build**

Run: `npm run build`
Expected: Succeeds, and the build output lists `/analytics` as a route.

- [ ] **Step 4: Commit**

```bash
git add dashboard/app/analytics/page.tsx
git commit -m "feat: add /analytics page (Buzz Trend chart + Topic Movers)"
```

---

## Self-Review Notes (for the plan author, already applied above)

- **Spec coverage:** §1 scope → Tasks 6-7 (page + nav). §1 data layer → Task 1. §1 pure logic (buzz-trend, topic-movers) → Tasks 2-3. §1 orchestration → Tasks 4-5. §1 UI → Task 6. §1 error handling → Task 7 (per-section try/catch, silent degrade). §1 testing → every pure/orchestration task includes its test step; components/page explicitly note the no-test convention with a pointer to precedent.
- **Placeholder scan:** no TBD/TODO; every step has literal code.
- **Type consistency:** `BuzzTrendPoint`, `TopicMover`, and every reader method signature are defined once (Tasks 1-3) and reused verbatim in later tasks (Tasks 4-7) — checked by hand across all 7 tasks.
- **Known, intentional deviation from the spec's literal text:** Task 3's category-resolution fallback (see that task's design note) — the spec said "current-period only," this plan uses "current, falling back to previous" to avoid silently dropping the most extreme loser case. Flagged inline in Task 3 rather than editing the spec file, matching how sub-project 4 handled its own share-of-voice averaging gap.
