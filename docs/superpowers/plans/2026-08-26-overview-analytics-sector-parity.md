# Overview + Analytics + Trang lĩnh vực Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the confirmed visual/content parity gaps between ver2's Overview, Analytics, and sector (`/[slug]`) pages and the ver1 reference design — new KPI icons/deltas, sector mini-cards, sentiment-by-category, buzz-by-platform, ranked trending lists with Trending/Mới nhất tabs, plus a Top Gainers/Losers tie-break bug fix.

**Architecture:** Pure-logic functions in `lib/` (tested in isolation) feed thin orchestration functions (`get-*.ts`, tested with fake readers) which server components in `app/**/page.tsx` call directly (untested, per existing convention). New presentational components in `components/` consume already-computed data — no client-side data fetching except the tab-toggle state in `TrendingTabs.tsx`.

**Tech Stack:** Next.js 15 App Router (server components), TypeScript, Vitest, `@supabase/supabase-js`, Tailwind v4 (`@theme` tokens in `app/globals.css`).

**Spec:** `docs/superpowers/specs/2026-08-26-overview-analytics-sector-parity-design.md`

## Global Constraints

- Không copy số liệu từ ver1 (mock data) — mọi số liệu tính từ Supabase thật của ver2.
- Không thêm mô tả (description) giả cho topic — `CandidateTopic` không có cột đó.
- Overview KPI delta = single-day vs single-day-7-ngày-trước (không đổi semantics `computeOverviewMetrics` đã duyệt). Sector-page KPI delta = window-sum-7-ngày vs window-sum-7-ngày-trước.
- "Mới nhất" tab sort theo `candidate_topics.created_at`, không phải `date`.
- "Buzz theo nền tảng" = 3 nguồn: Báo điện tử / Threads / Facebook (không có "Diễn đàn" như ver1).
- Mọi field mới thêm vào `CandidateTopic`/`HotTopicRow` phải **optional** — không được bắt buộc sửa các fixture `candidate()`/literal `HotTopicRow` đã có trong 6 file test hiện tại.
- Error handling: mọi loader mới bọc try/catch, lỗi → `console.error` + trả `null`/mảng rỗng, section hiện "Chưa có dữ liệu." — không dùng banner đỏ (`text-red-600` chỉ dành cho 2 luồng hiện có: `loadHotTopics`/`loadArticles`).
- Pure logic có test đầy đủ; orchestration test bằng fake reader; component/page không test (convention hiện có).
- Chạy `npm test` (103 test hiện có + test mới) phải xanh sau mỗi task.

---

### Task 1: `created_at` field + `getShortlistedForDateRange` reader method

**Files:**
- Modify: `dashboard/lib/types.ts`
- Modify: `dashboard/lib/candidate-topics-reader.ts`
- Modify: `dashboard/tests/fakes/fake-candidate-topics-reader.ts`

**Interfaces:**
- Produces: `CandidateTopic.created_at?: string`; `CandidateTopicsReader.getShortlistedForDateRange(category: string, startDate: string, endDateExclusive: string): Promise<CandidateTopic[]>`

- [ ] **Step 1: Add `created_at` to `CandidateTopic`**

In `dashboard/lib/types.ts`, find the `CandidateTopic` interface and add one field:

```typescript
export interface CandidateTopic {
  id: string;
  source: DiscoverySourceName;
  keyword: string;
  date: string;
  metric_value: number;
  growth_rate: number | null;
  category_hint: string[];
  is_shortlisted: boolean;
  created_at?: string; // ISO timestamp — always present on real Supabase rows
  // (column is NOT NULL), optional here only so existing test fixtures that
  // build CandidateTopic literals without it don't need updating (same
  // convention as HotTopicRow.categoryHint below).
}
```

- [ ] **Step 2: Add `created_at` to the existing `getCandidatesForDate` select**

In `dashboard/lib/candidate-topics-reader.ts`, find `getCandidatesForDate`'s `.select(...)` call and add `created_at` to the column list:

```typescript
.select('id, source, keyword, date, metric_value, growth_rate, category_hint, is_shortlisted, created_at')
```

(Same for the existing `getHistoryForKeyword` method's select — add `created_at` there too for consistency, even though nothing consumes it there yet.)

- [ ] **Step 3: Add `getShortlistedForDateRange` to the interface and class**

Add to the `CandidateTopicsReader` interface:

```typescript
  // Every shortlisted candidate_topics row for one category within
  // [startDate, endDateExclusive) — used by getSectorMetrics's 7-day
  // window (current + previous period fetched together, split by date
  // locally — same pattern as getTopicMovers/getBuzzTrend).
  getShortlistedForDateRange(category: string, startDate: string, endDateExclusive: string): Promise<CandidateTopic[]>;
```

Add to `SupabaseCandidateTopicsReader`:

```typescript
  async getShortlistedForDateRange(
    category: string,
    startDate: string,
    endDateExclusive: string
  ): Promise<CandidateTopic[]> {
    const { data, error } = await this.client
      .from('candidate_topics')
      .select('id, source, keyword, date, metric_value, growth_rate, category_hint, is_shortlisted, created_at')
      .eq('is_shortlisted', true)
      .contains('category_hint', [category])
      .gte('date', startDate)
      .lt('date', endDateExclusive)
      .limit(5000);
    if (error) throw new Error(error.message);
    if (data && data.length === 5000) {
      console.warn(
        `candidate-topics-reader: hit the 5000-row limit for category ${category}, range [${startDate}, ${endDateExclusive}) — sector metrics may be truncated.`
      );
    }
    return (data ?? []) as CandidateTopic[];
  }
```

- [ ] **Step 4: Extend the fake reader**

In `dashboard/tests/fakes/fake-candidate-topics-reader.ts`, add:

```typescript
  async getShortlistedForDateRange(
    category: string,
    startDate: string,
    endDateExclusive: string
  ): Promise<CandidateTopic[]> {
    return this.candidates.filter(
      (c) => c.is_shortlisted && c.category_hint.includes(category) && c.date >= startDate && c.date < endDateExclusive
    );
  }
```

- [ ] **Step 5: Verify the project still builds and tests pass**

Run: `npm test -- --run` and `npm run build` from `dashboard/`.
Expected: 103 tests still pass (no new tests in this task — reader classes aren't unit-tested directly per existing convention; this method is exercised by Task 4's orchestration test), build succeeds with no TypeScript errors (confirms `SupabaseCandidateTopicsReader` and `FakeCandidateTopicsReader` both correctly implement the extended interface).

- [ ] **Step 6: Commit**

```bash
git add dashboard/lib/types.ts dashboard/lib/candidate-topics-reader.ts dashboard/tests/fakes/fake-candidate-topics-reader.ts
git commit -m "feat: add created_at field and getShortlistedForDateRange reader method"
```

---

### Task 2: `computeKpiDelta` pure function

**Files:**
- Modify: `dashboard/lib/overview-metrics.ts`
- Test: `dashboard/tests/overview-metrics.test.ts`

**Interfaces:**
- Produces: `computeKpiDelta(curr: number, prev: number): { text: string; positive: boolean }`

- [ ] **Step 1: Write the failing tests**

Add to `dashboard/tests/overview-metrics.test.ts` (new `describe` block):

```typescript
import { computeOverviewMetrics, computeDonutSegments, computeKpiDelta } from '../lib/overview-metrics';

describe('computeKpiDelta', () => {
  it('formats a positive change with an up arrow and rounded percent', () => {
    const result = computeKpiDelta(120, 100);
    expect(result).toEqual({ text: '▲ +20% so với 7 ngày trước', positive: true });
  });

  it('formats a negative change with a down arrow', () => {
    const result = computeKpiDelta(80, 100);
    expect(result).toEqual({ text: '▼ -20% so với 7 ngày trước', positive: false });
  });

  it('falls back to a no-data message when prev is 0', () => {
    const result = computeKpiDelta(50, 0);
    expect(result).toEqual({ text: 'Chưa có dữ liệu 7 ngày trước', positive: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/overview-metrics.test.ts`
Expected: FAIL with "computeKpiDelta is not a function" or similar.

- [ ] **Step 3: Implement `computeKpiDelta`**

Add to `dashboard/lib/overview-metrics.ts` (after `computeOverviewMetrics`):

```typescript
export function computeKpiDelta(curr: number, prev: number): { text: string; positive: boolean } {
  if (prev === 0) return { text: 'Chưa có dữ liệu 7 ngày trước', positive: true };
  const pct = ((curr - prev) / prev) * 100;
  const up = pct >= 0;
  return { text: `${up ? '▲' : '▼'} ${up ? '+' : ''}${pct.toFixed(0)}% so với 7 ngày trước`, positive: up };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/overview-metrics.test.ts`
Expected: PASS (all tests in the file, old + new).

- [ ] **Step 5: Commit**

```bash
git add dashboard/lib/overview-metrics.ts dashboard/tests/overview-metrics.test.ts
git commit -m "feat: add computeKpiDelta for week-over-week KPI comparisons"
```

---

### Task 3: `computeSectorMetrics` pure function

**Files:**
- Create: `dashboard/lib/sector-metrics.ts`
- Test: `dashboard/tests/sector-metrics.test.ts`

**Interfaces:**
- Consumes: `threadsEngagementTotal(row): number` from `lib/topic-engagement.ts`; `facebookEngagementTotal(row): number` from `lib/facebook-summary.ts`
- Produces: `SectorMetrics { buzzVolume7d: number; activeTopics: number; audienceScale7d: number }`; `computeSectorMetrics(candidates, articles, threadsRows, facebookRows): SectorMetrics`

- [ ] **Step 1: Write the failing test**

Create `dashboard/tests/sector-metrics.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computeSectorMetrics } from '../lib/sector-metrics';
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
    category: 'tai_chinh',
    total_like_count: 5,
    total_comment_count: 1,
    total_share_count: 1,
    post_count: 1,
    ...overrides,
  };
}

describe('computeSectorMetrics', () => {
  it('sums buzz volume across articles + threads + facebook post counts', () => {
    const result = computeSectorMetrics(
      [candidate()],
      [{ categories: ['tai_chinh'] }, { categories: ['tai_chinh'] }],
      [threadsRow()],
      [facebookRow()]
    );
    expect(result.buzzVolume7d).toBe(4); // 2 articles + 2 threads posts + 1 facebook post... wait see step 3
  });

  it('counts distinct shortlisted keywords for activeTopics, ignoring non-shortlisted', () => {
    const result = computeSectorMetrics(
      [candidate({ keyword: 'a', is_shortlisted: true }), candidate({ keyword: 'a', date: '2026-08-25', is_shortlisted: true }), candidate({ keyword: 'b', is_shortlisted: false })],
      [],
      [],
      []
    );
    expect(result.activeTopics).toBe(1); // 'a' counted once, 'b' excluded (not shortlisted)
  });

  it('sums audience scale from threads + facebook engagement totals', () => {
    const result = computeSectorMetrics([], [], [threadsRow({ total_like_count: 10, total_reply_count: 0, total_repost_count: 0, total_quote_count: 0, total_share_count: 0 })], [facebookRow({ total_like_count: 5, total_comment_count: 0, total_share_count: 0 })]);
    expect(result.audienceScale7d).toBe(15); // 10 (threads like) + 5 (facebook like)
  });

  it('returns all zeros for empty input', () => {
    const result = computeSectorMetrics([], [], [], []);
    expect(result).toEqual({ buzzVolume7d: 0, activeTopics: 0, audienceScale7d: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sector-metrics.test.ts`
Expected: FAIL — module `../lib/sector-metrics` does not exist.

- [ ] **Step 3: Implement `computeSectorMetrics`**

Create `dashboard/lib/sector-metrics.ts`:

```typescript
import type { CandidateTopic, ThreadsEngagementDaily, FacebookEngagementDaily } from './types';
import { threadsEngagementTotal } from './topic-engagement';
import { facebookEngagementTotal } from './facebook-summary';

export interface SectorMetrics {
  buzzVolume7d: number;
  activeTopics: number;
  audienceScale7d: number;
}

// Same formulas as computeOverviewMetrics (lib/overview-metrics.ts), scoped
// to a single category and a 7-day window instead of one day, all
// categories — caller is responsible for pre-filtering every input array to
// the category + date range (see get-sector-metrics.ts).
export function computeSectorMetrics(
  candidates: CandidateTopic[],
  articles: { categories: string[] }[],
  threadsRows: ThreadsEngagementDaily[],
  facebookRows: FacebookEngagementDaily[]
): SectorMetrics {
  const buzzVolume7d =
    articles.length +
    threadsRows.reduce((sum, r) => sum + r.post_count, 0) +
    facebookRows.reduce((sum, r) => sum + r.post_count, 0);

  const activeTopics = new Set(candidates.filter((c) => c.is_shortlisted).map((c) => c.keyword)).size;

  const audienceScale7d =
    threadsRows.reduce((sum, r) => sum + threadsEngagementTotal(r), 0) +
    facebookRows.reduce((sum, r) => sum + facebookEngagementTotal(r), 0);

  return { buzzVolume7d, activeTopics, audienceScale7d };
}
```

Fix the first test's expected value: `2 articles + 2 (threads post_count) + 1 (facebook post_count) = 5`, not 4 — correct the test:

```typescript
    expect(result.buzzVolume7d).toBe(5);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sector-metrics.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add dashboard/lib/sector-metrics.ts dashboard/tests/sector-metrics.test.ts
git commit -m "feat: add computeSectorMetrics pure function"
```

---

### Task 4: `getSectorMetrics` orchestration

**Files:**
- Create: `dashboard/lib/get-sector-metrics.ts`
- Test: `dashboard/tests/get-sector-metrics.test.ts`

**Interfaces:**
- Consumes: `CandidateTopicsReader.getShortlistedForDateRange` (Task 1); `ArticlesReader.getForDateRange`; `ThreadsEngagementReader.getForDateRange`; `FacebookEngagementReader.getForDateRange` (all pre-existing); `computeSectorMetrics` (Task 3); `computeKpiDelta` (Task 2)
- Produces: `getSectorMetrics(candidateReader, articlesReader, threadsEngagementReader, facebookEngagementReader, category, latestDate): Promise<{ metrics: SectorMetrics; buzzVolumeDelta: {text,positive}; audienceScaleDelta: {text,positive} }>`

- [ ] **Step 1: Write the failing test**

Create `dashboard/tests/get-sector-metrics.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { getSectorMetrics } from '../lib/get-sector-metrics';
import { FakeCandidateTopicsReader } from './fakes/fake-candidate-topics-reader';
import { FakeArticlesReader } from './fakes/fake-articles-reader';
import { FakeThreadsEngagementReader } from './fakes/fake-threads-engagement-reader';
import { FakeFacebookEngagementReader } from './fakes/fake-facebook-engagement-reader';
import type { Article, CandidateTopic } from '../lib/types';

function candidate(overrides: Partial<CandidateTopic> = {}): CandidateTopic {
  return {
    id: 'id-1', source: 'rss', keyword: 'bitcoin', date: '2026-08-24', metric_value: 10,
    growth_rate: 0.5, category_hint: ['tai_chinh'], is_shortlisted: true, ...overrides,
  };
}

function article(overrides: Partial<Article> = {}): Article {
  return {
    id: 'a1', url: 'x', title: 'x', published_at: '2026-08-24T10:00:00Z', source_id: 's',
    categories: ['tai_chinh'], snippet: '', ...overrides,
  } as Article;
}

describe('getSectorMetrics', () => {
  it('splits a 14-day fetch into current (last 7 days) vs previous window and computes deltas', async () => {
    const candidateReader = new FakeCandidateTopicsReader([
      candidate({ date: '2026-08-24' }), // current window
      candidate({ id: 'id-2', keyword: 'ethereum', date: '2026-08-17' }), // previous window
    ]);
    const articlesReader = new FakeArticlesReader([
      article({ id: 'cur-1', published_at: '2026-08-24T10:00:00Z' }),
      article({ id: 'cur-2', published_at: '2026-08-24T11:00:00Z' }),
      article({ id: 'prev-1', published_at: '2026-08-17T10:00:00Z' }),
    ]);
    const threadsReader = new FakeThreadsEngagementReader([]);
    const facebookReader = new FakeFacebookEngagementReader([]);

    const result = await getSectorMetrics(candidateReader, articlesReader, threadsReader, facebookReader, 'tai_chinh', '2026-08-24');

    expect(result.metrics.buzzVolume7d).toBe(2); // only current-window articles count
    expect(result.metrics.activeTopics).toBe(1); // only 'bitcoin' (current window)
    // curr=2, prev=1 -> (2-1)/1*100 = 100%
    expect(result.buzzVolumeDelta.text).toBe('▲ +100% so với 7 ngày trước');
  });

  it('ignores candidates and rows from a different category', async () => {
    const candidateReader = new FakeCandidateTopicsReader([
      candidate({ category_hint: ['giai_tri'] }),
    ]);
    const result = await getSectorMetrics(
      candidateReader,
      new FakeArticlesReader([]),
      new FakeThreadsEngagementReader([]),
      new FakeFacebookEngagementReader([]),
      'tai_chinh',
      '2026-08-24'
    );
    expect(result.metrics.activeTopics).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/get-sector-metrics.test.ts`
Expected: FAIL — module `../lib/get-sector-metrics` does not exist.

- [ ] **Step 3: Implement `getSectorMetrics`**

Create `dashboard/lib/get-sector-metrics.ts`:

```typescript
import type { CandidateTopicsReader } from './candidate-topics-reader';
import type { ArticlesReader } from './articles-reader';
import type { ThreadsEngagementReader } from './threads-engagement-reader';
import type { FacebookEngagementReader } from './facebook-engagement-reader';
import { computeSectorMetrics, type SectorMetrics } from './sector-metrics';
import { computeKpiDelta } from './overview-metrics';

function addDaysUTC(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function getSectorMetrics(
  candidateReader: CandidateTopicsReader,
  articlesReader: ArticlesReader,
  threadsEngagementReader: ThreadsEngagementReader,
  facebookEngagementReader: FacebookEngagementReader,
  category: string,
  latestDate: string
): Promise<{
  metrics: SectorMetrics;
  buzzVolumeDelta: { text: string; positive: boolean };
  audienceScaleDelta: { text: string; positive: boolean };
}> {
  const currentStart = addDaysUTC(latestDate, -6);
  const endDateExclusive = addDaysUTC(latestDate, 1);
  const previousStart = addDaysUTC(latestDate, -13);

  const [allCandidates, allArticles, allThreadsRows, allFacebookRows] = await Promise.all([
    candidateReader.getShortlistedForDateRange(category, previousStart, endDateExclusive),
    articlesReader.getForDateRange(previousStart, endDateExclusive),
    threadsEngagementReader.getForDateRange(previousStart, endDateExclusive),
    facebookEngagementReader.getForDateRange(previousStart, endDateExclusive),
  ]);

  const articlesInCategory = allArticles.filter((a) => a.categories.includes(category));
  const threadsInCategory = allThreadsRows.filter((r) => r.category === category);
  const facebookInCategory = allFacebookRows.filter((r) => r.category === category);

  const currentMetrics = computeSectorMetrics(
    allCandidates.filter((c) => c.date >= currentStart),
    articlesInCategory.filter((a) => a.date >= currentStart),
    threadsInCategory.filter((r) => r.date >= currentStart),
    facebookInCategory.filter((r) => r.date >= currentStart)
  );
  const previousMetrics = computeSectorMetrics(
    allCandidates.filter((c) => c.date < currentStart),
    articlesInCategory.filter((a) => a.date < currentStart),
    threadsInCategory.filter((r) => r.date < currentStart),
    facebookInCategory.filter((r) => r.date < currentStart)
  );

  return {
    metrics: currentMetrics,
    buzzVolumeDelta: computeKpiDelta(currentMetrics.buzzVolume7d, previousMetrics.buzzVolume7d),
    audienceScaleDelta: computeKpiDelta(currentMetrics.audienceScale7d, previousMetrics.audienceScale7d),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/get-sector-metrics.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add dashboard/lib/get-sector-metrics.ts dashboard/tests/get-sector-metrics.test.ts
git commit -m "feat: add getSectorMetrics orchestration"
```

---

### Task 5: `extractTopKeywords` pure function

**Files:**
- Create: `dashboard/lib/top-keywords.ts`
- Test: `dashboard/tests/top-keywords.test.ts`

**Interfaces:**
- Produces: `extractTopKeywords(candidates: CandidateTopic[], limit?: number): string[]`

- [ ] **Step 1: Write the failing test**

Create `dashboard/tests/top-keywords.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { extractTopKeywords } from '../lib/top-keywords';
import type { CandidateTopic } from '../lib/types';

function candidate(overrides: Partial<CandidateTopic> = {}): CandidateTopic {
  return {
    id: 'id-1', source: 'rss', keyword: 'bitcoin', date: '2026-08-24', metric_value: 10,
    growth_rate: 0.5, category_hint: ['tai_chinh'], is_shortlisted: true, ...overrides,
  };
}

describe('extractTopKeywords', () => {
  it('sorts distinct keywords by total metric_value descending', () => {
    const result = extractTopKeywords([
      candidate({ id: '1', keyword: 'bitcoin', metric_value: 5 }),
      candidate({ id: '2', keyword: 'bitcoin', date: '2026-08-25', metric_value: 5 }), // same keyword, 2nd day -> totals 10
      candidate({ id: '3', keyword: 'vàng', metric_value: 20 }),
    ]);
    expect(result).toEqual(['vàng', 'bitcoin']);
  });

  it('caps to the given limit', () => {
    const candidates = ['a', 'b', 'c', 'd'].map((k, i) => candidate({ id: k, keyword: k, metric_value: 4 - i }));
    expect(extractTopKeywords(candidates, 2)).toEqual(['a', 'b']);
  });

  it('returns an empty array for empty input', () => {
    expect(extractTopKeywords([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/top-keywords.test.ts`
Expected: FAIL — module `../lib/top-keywords` does not exist.

- [ ] **Step 3: Implement `extractTopKeywords`**

Create `dashboard/lib/top-keywords.ts`:

```typescript
import type { CandidateTopic } from './types';

// Distinct keywords ranked by total metric_value across every input row
// (caller pre-filters to category + shortlisted + window — see
// get-sector-metrics.ts's callers for the exact scoping). Used for the
// "Từ khóa nổi bật" pill list — ver2 has no separate tag/description field,
// so the most prominent shortlisted keywords stand in for it.
export function extractTopKeywords(candidates: CandidateTopic[], limit = 12): string[] {
  const totals = new Map<string, number>();
  for (const c of candidates) {
    totals.set(c.keyword, (totals.get(c.keyword) ?? 0) + c.metric_value);
  }
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([keyword]) => keyword);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/top-keywords.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add dashboard/lib/top-keywords.ts dashboard/tests/top-keywords.test.ts
git commit -m "feat: add extractTopKeywords pure function"
```

---

### Task 6: `sortByRecency` + `createdAt` on `HotTopicRow`

**Files:**
- Modify: `dashboard/lib/hot-topics.ts`
- Test: `dashboard/tests/hot-topics.test.ts`

**Interfaces:**
- Consumes: `CandidateTopic.created_at?: string` (Task 1)
- Produces: `HotTopicRow.createdAt?: string`; `sortByRecency<T extends HotTopicRow>(rows: T[]): T[]`

- [ ] **Step 1: Write the failing tests**

Add to `dashboard/tests/hot-topics.test.ts`:

```typescript
import { sortByRecency, type HotTopicRow } from '../lib/hot-topics';
// (add to whatever existing import line already pulls from '../lib/hot-topics')

describe('sortByRecency', () => {
  function hotTopicRow(overrides: Partial<HotTopicRow> = {}): HotTopicRow {
    return { id: '1', source: 'rss', keyword: 'a', metricValue: 1, trendingScore: 1, shareOfVoice: 1, ...overrides };
  }

  it('orders rows by createdAt descending', () => {
    const rows = [
      hotTopicRow({ id: '1', createdAt: '2026-08-24T08:00:00Z' }),
      hotTopicRow({ id: '2', createdAt: '2026-08-24T14:00:00Z' }),
    ];
    expect(sortByRecency(rows).map((r) => r.id)).toEqual(['2', '1']);
  });

  it('sorts rows with no createdAt to the end', () => {
    const rows = [
      hotTopicRow({ id: '1' }), // no createdAt
      hotTopicRow({ id: '2', createdAt: '2026-08-24T14:00:00Z' }),
    ];
    expect(sortByRecency(rows).map((r) => r.id)).toEqual(['2', '1']);
  });
});

describe('buildHotTopicsForCategory createdAt', () => {
  it('populates createdAt from the candidate row', () => {
    const candidates = [
      { id: '1', source: 'rss' as const, keyword: 'a', date: '2026-08-24', metric_value: 1, growth_rate: 0, category_hint: ['tai_chinh'], is_shortlisted: true, created_at: '2026-08-24T09:00:00Z' },
    ];
    const result = buildHotTopicsForCategory(candidates, 'tai_chinh');
    expect(result.rss[0].createdAt).toBe('2026-08-24T09:00:00Z');
  });
});
```

(Add `buildHotTopicsForCategory` to the existing import from `'../lib/hot-topics'` if not already imported in this test file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/hot-topics.test.ts`
Expected: FAIL — `sortByRecency` is not exported; `createdAt` is `undefined` in the last test.

- [ ] **Step 3: Implement**

In `dashboard/lib/hot-topics.ts`, add `createdAt` to the `HotTopicRow` interface:

```typescript
export interface HotTopicRow {
  id: string;
  source: CandidateTopic['source'];
  keyword: string;
  metricValue: number;
  trendingScore: number | null;
  shareOfVoice: number | null;
  categoryHint?: string[];
  createdAt?: string; // candidate_topics.created_at — populated by
  // buildHotTopicsForCategory/buildHotTopicsOverview, consumed by
  // sortByRecency for the "Mới nhất" tab. Optional for the same reason
  // categoryHint is: existing HotTopicRow literals in tests don't supply it.
}
```

In `buildHotTopicsForCategory`'s row-mapping (the `rows: HotTopicRow[] = shortlisted.map((c) => ({...}))` block), add one line:

```typescript
  const rows: HotTopicRow[] = shortlisted.map((c) => ({
    id: c.id,
    source: c.source,
    keyword: c.keyword,
    metricValue: c.metric_value,
    trendingScore: computeTrendingScore(c),
    shareOfVoice: shareMap.get(c.id) ?? null,
    categoryHint: c.category_hint,
    createdAt: c.created_at,
  }));
```

Same one-line addition (`createdAt: c.created_at,`) in `buildHotTopicsOverview`'s row-mapping.

At the end of the file, add:

```typescript
// Sort by candidate_topics.created_at descending — the "Mới nhất" tab.
// Rows fetched for one day still vary in created_at because the discovery
// layer runs 2-3x/day and upserts, so this distinguishes "most recently
// (re-)discovered today" from "Trending" (sorted by trendingScore instead).
// Rows with no createdAt sort last.
export function sortByRecency<T extends HotTopicRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/hot-topics.test.ts`
Expected: PASS (all tests in the file, old + new).

- [ ] **Step 5: Commit**

```bash
git add dashboard/lib/hot-topics.ts dashboard/tests/hot-topics.test.ts
git commit -m "feat: add sortByRecency and createdAt on HotTopicRow"
```

---

### Task 7: `computeSentimentByCategory` pure function

**Files:**
- Create: `dashboard/lib/sentiment-by-category.ts`
- Test: `dashboard/tests/sentiment-by-category.test.ts`

**Interfaces:**
- Consumes: `groupSentimentCounts(rows: {key,sentiment}[]): Map<string,SentimentCounts>` from `lib/topic-engagement.ts`
- Produces: `CategorySentiment { category: string; label: string; counts: SentimentCounts }`; `computeSentimentByCategory(threadsSentimentRows, candidatesForLookup, facebookSentimentRows): CategorySentiment[]`

- [ ] **Step 1: Write the failing test**

Create `dashboard/tests/sentiment-by-category.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computeSentimentByCategory } from '../lib/sentiment-by-category';
import type { CandidateTopic } from '../lib/types';

function candidate(overrides: Partial<CandidateTopic> = {}): CandidateTopic {
  return {
    id: 'id-1', source: 'rss', keyword: 'bitcoin', date: '2026-08-24', metric_value: 10,
    growth_rate: 0.5, category_hint: ['tai_chinh'], is_shortlisted: true, ...overrides,
  };
}

describe('computeSentimentByCategory', () => {
  it('maps threads sentiment to category via candidate keyword lookup', () => {
    const result = computeSentimentByCategory(
      [{ keyword: 'bitcoin', sentiment: 'positive' }],
      [candidate({ keyword: 'bitcoin', category_hint: ['tai_chinh'] })],
      []
    );
    const taiChinh = result.find((r) => r.category === 'tai_chinh')!;
    expect(taiChinh.counts).toEqual({ positive: 1, negative: 0, neutral: 0 });
  });

  it('adds facebook sentiment directly by category (no keyword lookup needed)', () => {
    const result = computeSentimentByCategory([], [], [{ category: 'giai_tri', sentiment: 'negative' }]);
    const giaiTri = result.find((r) => r.category === 'giai_tri')!;
    expect(giaiTri.counts).toEqual({ positive: 0, negative: 1, neutral: 0 });
  });

  it('excludes a threads sentiment row whose keyword has no matching candidate', () => {
    const result = computeSentimentByCategory([{ keyword: 'unknown-keyword', sentiment: 'positive' }], [], []);
    const total = result.reduce((sum, r) => sum + r.counts.positive + r.counts.negative + r.counts.neutral, 0);
    expect(total).toBe(0);
  });

  it('always returns all 3 categories, even with zero counts', () => {
    const result = computeSentimentByCategory([], [], []);
    expect(result.map((r) => r.category).sort()).toEqual(['du_lich', 'giai_tri', 'tai_chinh']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sentiment-by-category.test.ts`
Expected: FAIL — module `../lib/sentiment-by-category` does not exist.

- [ ] **Step 3: Implement**

Create `dashboard/lib/sentiment-by-category.ts`:

```typescript
import { CATEGORIES } from './categories';
import { groupSentimentCounts, type SentimentCounts } from './topic-engagement';
import type { CandidateTopic, SentimentLabel } from './types';

export interface CategorySentiment {
  category: string;
  label: string;
  counts: SentimentCounts;
}

// keyword -> category lookup, first non-empty category_hint wins (order in
// the input array doesn't matter for correctness here since it's a single
// day's candidates — no cross-day order-dependence risk like
// topic-movers.ts's categoryDate tracking had to solve).
function resolveKeywordCategories(candidates: CandidateTopic[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const c of candidates) {
    if (c.category_hint.length > 0 && !result.has(c.keyword)) {
      result.set(c.keyword, c.category_hint[0]);
    }
  }
  return result;
}

export function computeSentimentByCategory(
  threadsSentimentRows: { keyword: string; sentiment: SentimentLabel | null }[],
  candidatesForLookup: CandidateTopic[],
  facebookSentimentRows: { category: string; sentiment: SentimentLabel | null }[]
): CategorySentiment[] {
  const keywordToCategory = resolveKeywordCategories(candidatesForLookup);

  const keyed: { key: string; sentiment: SentimentLabel | null }[] = [];
  for (const r of threadsSentimentRows) {
    const category = keywordToCategory.get(r.keyword);
    if (category !== undefined) keyed.push({ key: category, sentiment: r.sentiment });
  }
  for (const r of facebookSentimentRows) {
    keyed.push({ key: r.category, sentiment: r.sentiment });
  }

  const counted = groupSentimentCounts(keyed);

  return CATEGORIES.map((c) => ({
    category: c.value,
    label: c.label,
    counts: counted.get(c.value) ?? { positive: 0, negative: 0, neutral: 0 },
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sentiment-by-category.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add dashboard/lib/sentiment-by-category.ts dashboard/tests/sentiment-by-category.test.ts
git commit -m "feat: add computeSentimentByCategory pure function"
```

---

### Task 8: `computeBuzzByPlatform` pure function

**Files:**
- Create: `dashboard/lib/buzz-by-platform.ts`
- Test: `dashboard/tests/buzz-by-platform.test.ts`

**Interfaces:**
- Produces: `PlatformBuzz { label: string; pct: number }`; `computeBuzzByPlatform(articles, threadsRows, facebookRows): PlatformBuzz[]` — always 3 elements: `Báo điện tử`, `Threads`, `Facebook`.

- [ ] **Step 1: Write the failing test**

Create `dashboard/tests/buzz-by-platform.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computeBuzzByPlatform } from '../lib/buzz-by-platform';
import type { ThreadsEngagementDaily, FacebookEngagementDaily } from '../lib/types';

function threadsRow(overrides: Partial<ThreadsEngagementDaily> = {}): ThreadsEngagementDaily {
  return {
    date: '2026-08-24', keyword: 'a', category: 'tai_chinh', total_like_count: 0, total_reply_count: 0,
    total_repost_count: 0, total_quote_count: 0, total_share_count: 0, total_view_count: 0, post_count: 1, ...overrides,
  };
}

function facebookRow(overrides: Partial<FacebookEngagementDaily> = {}): FacebookEngagementDaily {
  return { date: '2026-08-24', category: 'tai_chinh', total_like_count: 0, total_comment_count: 0, total_share_count: 0, post_count: 1, ...overrides };
}

describe('computeBuzzByPlatform', () => {
  it('returns 3 fixed platforms summing to exactly 100%', () => {
    const result = computeBuzzByPlatform(
      [{ categories: ['tai_chinh'] }, { categories: ['tai_chinh'] }, { categories: ['tai_chinh'] }], // 3 articles
      [threadsRow({ post_count: 3 })], // 3 threads posts
      [facebookRow({ post_count: 4 })] // 4 facebook posts
    );
    expect(result.map((r) => r.label)).toEqual(['Báo điện tử', 'Threads', 'Facebook']);
    const total = result.reduce((sum, r) => sum + r.pct, 0);
    expect(total).toBe(100);
    // 3/10=30%, 3/10=30%, 4/10=40% — no rounding remainder to distribute
    expect(result.map((r) => r.pct)).toEqual([30, 30, 40]);
  });

  it('returns all zeros when there is no data at all', () => {
    const result = computeBuzzByPlatform([], [], []);
    expect(result.every((r) => r.pct === 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/buzz-by-platform.test.ts`
Expected: FAIL — module `../lib/buzz-by-platform` does not exist.

- [ ] **Step 3: Implement**

Create `dashboard/lib/buzz-by-platform.ts`:

```typescript
import type { ThreadsEngagementDaily, FacebookEngagementDaily } from './types';

export interface PlatformBuzz {
  label: string;
  pct: number;
}

// Caller pre-scopes the input window (Overview: 1 day; sector page: 7-day
// window filtered to 1 category) — this function is agnostic to that,
// mirroring computeOverviewMetrics/computeSectorMetrics's own convention.
export function computeBuzzByPlatform(
  articles: { categories: string[] }[],
  threadsRows: ThreadsEngagementDaily[],
  facebookRows: FacebookEngagementDaily[]
): PlatformBuzz[] {
  const counts = [
    { label: 'Báo điện tử', count: articles.length },
    { label: 'Threads', count: threadsRows.reduce((sum, r) => sum + r.post_count, 0) },
    { label: 'Facebook', count: facebookRows.reduce((sum, r) => sum + r.post_count, 0) },
  ];
  const total = counts.reduce((sum, p) => sum + p.count, 0);

  if (total === 0) {
    return counts.map((p) => ({ label: p.label, pct: 0 }));
  }

  // Largest-remainder rounding — same technique as computeDonutSegments
  // (lib/overview-metrics.ts) — so the 3 percentages always sum to 100.
  const raw = counts.map((p) => {
    const exact = (p.count / total) * 100;
    const floor = Math.floor(exact);
    return { label: p.label, floor, remainder: exact - floor };
  });
  const flooredSum = raw.reduce((sum, r) => sum + r.floor, 0);
  const remaining = 100 - flooredSum;
  const bonusLabels = new Set([...raw].sort((a, b) => b.remainder - a.remainder).slice(0, remaining).map((r) => r.label));

  return raw.map((r) => ({ label: r.label, pct: r.floor + (bonusLabels.has(r.label) ? 1 : 0) }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/buzz-by-platform.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add dashboard/lib/buzz-by-platform.ts dashboard/tests/buzz-by-platform.test.ts
git commit -m "feat: add computeBuzzByPlatform pure function"
```

---

### Task 9: `computeSentimentTrend` + `FacebookSentimentReader.getForDateRange`

**Files:**
- Modify: `dashboard/lib/facebook-sentiment-reader.ts`
- Modify: `dashboard/tests/fakes/fake-facebook-sentiment-reader.ts`
- Create: `dashboard/lib/sentiment-trend.ts`
- Test: `dashboard/tests/sentiment-trend.test.ts`

**Interfaces:**
- Produces: `FacebookSentimentReader.getForDateRange(startDate, endDateExclusive): Promise<{category,date,sentiment}[]>`; `SentimentTrendPoint { date, positive, negative, neutral }`; `computeSentimentTrend(threadsSentimentRows, facebookSentimentRows, dates): SentimentTrendPoint[]`

- [ ] **Step 1: Add `getForDateRange` to `FacebookSentimentReader`**

In `dashboard/lib/facebook-sentiment-reader.ts`, add to the interface:

```typescript
  getForDateRange(startDate: string, endDateExclusive: string): Promise<{ category: string; date: string; sentiment: SentimentLabel | null }[]>;
```

And to `SupabaseFacebookSentimentReader` (mirrors `ThreadsSentimentReader.getForDateRange` exactly, same table family):

```typescript
  async getForDateRange(
    startDate: string,
    endDateExclusive: string
  ): Promise<{ category: string; date: string; sentiment: SentimentLabel | null }[]> {
    const { data, error } = await this.client
      .from('facebook_page_data')
      .select('category, date, sentiment')
      .gte('date', startDate)
      .lt('date', endDateExclusive)
      .limit(5000);
    if (error) throw new Error(error.message);
    if (data && data.length === 5000) {
      console.warn(
        `facebook-sentiment-reader: hit the 5000-row limit for range [${startDate}, ${endDateExclusive}) — sentiment trend may be truncated.`
      );
    }
    return (data ?? []) as { category: string; date: string; sentiment: SentimentLabel | null }[];
  }
```

- [ ] **Step 2: Extend the fake reader**

In `dashboard/tests/fakes/fake-facebook-sentiment-reader.ts`, add (the fake's constructor already takes an array with a `date` field — check its existing shape and filter the same way `FakeThreadsSentimentReader.getForDateRange` does):

```typescript
  async getForDateRange(
    startDate: string,
    endDateExclusive: string
  ): Promise<{ category: string; date: string; sentiment: SentimentLabel | null }[]> {
    return this.rows.filter((r) => r.date >= startDate && r.date < endDateExclusive);
  }
```

(If the fake's internal array field isn't named `rows`, use whatever the existing `getForDate` method already references — keep the addition consistent with the file's existing style.)

- [ ] **Step 3: Write the failing test for `computeSentimentTrend`**

Create `dashboard/tests/sentiment-trend.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computeSentimentTrend } from '../lib/sentiment-trend';

describe('computeSentimentTrend', () => {
  it('combines threads + facebook sentiment counts per day, in the given date order', () => {
    const result = computeSentimentTrend(
      [
        { date: '2026-08-24', sentiment: 'positive' },
        { date: '2026-08-25', sentiment: 'negative' },
      ],
      [{ date: '2026-08-24', sentiment: 'negative' }],
      ['2026-08-24', '2026-08-25']
    );
    expect(result).toEqual([
      { date: '2026-08-24', positive: 1, negative: 1, neutral: 0 },
      { date: '2026-08-25', positive: 0, negative: 1, neutral: 0 },
    ]);
  });

  it('fills zero counts for a date with no rows', () => {
    const result = computeSentimentTrend([], [], ['2026-08-24']);
    expect(result).toEqual([{ date: '2026-08-24', positive: 0, negative: 0, neutral: 0 }]);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run tests/sentiment-trend.test.ts`
Expected: FAIL — module `../lib/sentiment-trend` does not exist.

- [ ] **Step 5: Implement `computeSentimentTrend`**

Create `dashboard/lib/sentiment-trend.ts`:

```typescript
import { groupSentimentCounts } from './topic-engagement';
import type { SentimentLabel } from './types';

export interface SentimentTrendPoint {
  date: string;
  positive: number;
  negative: number;
  neutral: number;
}

// Aggregate, not category-scoped (unlike computeSentimentByCategory) —
// Analytics' "Xu hướng Sentiment" chart shows the whole product's sentiment
// mix per day, not broken down by category.
export function computeSentimentTrend(
  threadsSentimentRows: { date: string; sentiment: SentimentLabel | null }[],
  facebookSentimentRows: { date: string; sentiment: SentimentLabel | null }[],
  dates: string[]
): SentimentTrendPoint[] {
  const keyed = [
    ...threadsSentimentRows.map((r) => ({ key: r.date, sentiment: r.sentiment })),
    ...facebookSentimentRows.map((r) => ({ key: r.date, sentiment: r.sentiment })),
  ];
  const counted = groupSentimentCounts(keyed);
  return dates.map((date) => {
    const counts = counted.get(date) ?? { positive: 0, negative: 0, neutral: 0 };
    return { date, ...counts };
  });
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/sentiment-trend.test.ts`
Expected: PASS (2 tests). Also run `npm test -- --run` to confirm the `FacebookSentimentReader` interface extension didn't break any existing caller (nothing else implements this interface besides `SupabaseFacebookSentimentReader` and the fake — both updated in this task).

- [ ] **Step 7: Commit**

```bash
git add dashboard/lib/facebook-sentiment-reader.ts dashboard/tests/fakes/fake-facebook-sentiment-reader.ts dashboard/lib/sentiment-trend.ts dashboard/tests/sentiment-trend.test.ts
git commit -m "feat: add computeSentimentTrend and FacebookSentimentReader.getForDateRange"
```

---

### Task 10: Fix Top Gainers/Losers tie-break bug

**Files:**
- Modify: `dashboard/lib/topic-movers.ts`
- Test: `dashboard/tests/topic-movers.test.ts`

**Interfaces:** No signature changes — `computeTopicMovers`'s existing return shape is unchanged, only the fallback sort order changes.

- [ ] **Step 1: Write the failing test**

Add to `dashboard/tests/topic-movers.test.ts` (reuse whatever `row()`/fixture helper the file already defines for `ThreadsEngagementDaily`):

```typescript
describe('computeTopicMovers tie-break', () => {
  it('breaks a deltaPct tie by buzz, so gainers-fallback and losers-fallback differ when every keyword is new', () => {
    const rows = [
      row({ keyword: 'high-buzz', total_like_count: 50 }), // buzz 50, no previous row -> deltaPct 100
      row({ keyword: 'low-buzz', total_like_count: 10 }), // buzz 10, no previous row -> deltaPct 100
    ];
    const { gainers, losers } = computeTopicMovers(rows, []);
    expect(gainers.map((m) => m.keyword)).toEqual(['high-buzz', 'low-buzz']); // gainers-fallback: highest buzz first
    expect(losers.map((m) => m.keyword)).toEqual(['low-buzz', 'high-buzz']); // losers-fallback: lowest buzz first
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/topic-movers.test.ts`
Expected: FAIL — both `gainers` and `losers` come back in the same order (the bug: with `deltaPct` tied at 100 for both, the current single-key sort by `deltaPct` is a no-op, so both fallback lists end up in the original `movers` array order).

- [ ] **Step 3: Fix the tie-break**

In `dashboard/lib/topic-movers.ts`, find the block:

```typescript
  const trueGainers = movers.filter((m) => m.deltaPct > 0).sort((a, b) => b.deltaPct - a.deltaPct);
  const gainers =
    trueGainers.length > 0 ? trueGainers.slice(0, 5) : [...movers].sort((a, b) => b.deltaPct - a.deltaPct).slice(0, 5);
  const trueLosers = movers.filter((m) => m.deltaPct < 0).sort((a, b) => a.deltaPct - b.deltaPct);
  const losers =
    trueLosers.length > 0 ? trueLosers.slice(0, 5) : [...movers].sort((a, b) => a.deltaPct - b.deltaPct).slice(0, 5);
```

Replace with:

```typescript
  // Secondary sort by buzz breaks ties when every mover shares the same
  // deltaPct (e.g. all 100% because every keyword is new this period,
  // prevBuzz=0 for all of them) — without it, gainers-fallback and
  // losers-fallback both resolve to the same stable-sort order and end up
  // showing identical lists under different headings.
  const gainersSort = (a: TopicMover, b: TopicMover) => b.deltaPct - a.deltaPct || b.buzz - a.buzz;
  const losersSort = (a: TopicMover, b: TopicMover) => a.deltaPct - b.deltaPct || a.buzz - b.buzz;

  const trueGainers = movers.filter((m) => m.deltaPct > 0).sort(gainersSort);
  const gainers = trueGainers.length > 0 ? trueGainers.slice(0, 5) : [...movers].sort(gainersSort).slice(0, 5);
  const trueLosers = movers.filter((m) => m.deltaPct < 0).sort(losersSort);
  const losers = trueLosers.length > 0 ? trueLosers.slice(0, 5) : [...movers].sort(losersSort).slice(0, 5);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/topic-movers.test.ts`
Expected: PASS (all tests in the file, old + new — existing tests are unaffected since the secondary sort key only breaks ties, it doesn't change ordering when `deltaPct` already differs).

- [ ] **Step 5: Commit**

```bash
git add dashboard/lib/topic-movers.ts dashboard/tests/topic-movers.test.ts
git commit -m "fix: break Top Gainers/Losers deltaPct ties by buzz

When every keyword is new (deltaPct=100% for all), the fallback sort for
both lists was a no-op tie, so Top Gainers and Top Losers rendered the
identical list under different headings."
```

---

### Task 11: Extend `get-overview-metrics.ts` with week-over-week deltas

**Files:**
- Modify: `dashboard/lib/get-overview-metrics.ts`
- Test: `dashboard/tests/get-overview-metrics.test.ts`

**Interfaces:**
- Consumes: `computeKpiDelta` (Task 2)
- Produces: `getOverviewMetrics(...)` now resolves to `{ metrics, donut, deltas: { buzzVolume: {text,positive}; audienceScale: {text,positive} } }` (adds `deltas`, `metrics`/`donut` shape unchanged)

- [ ] **Step 1: Write the failing test**

Add to `dashboard/tests/get-overview-metrics.test.ts`:

```typescript
  it('computes week-over-week deltas by also fetching the date 7 days earlier', async () => {
    const articlesReader = new FakeArticlesReader([
      { id: 'cur-1', url: 'x', title: 'x', published_at: '2026-08-24T10:00:00Z', source_id: 's', categories: ['tai_chinh'], snippet: '' } as Article,
      { id: 'cur-2', url: 'x', title: 'x', published_at: '2026-08-24T11:00:00Z', source_id: 's', categories: ['tai_chinh'], snippet: '' } as Article,
      { id: 'prev-1', url: 'x', title: 'x', published_at: '2026-08-17T10:00:00Z', source_id: 's', categories: ['tai_chinh'], snippet: '' } as Article,
    ]);

    const result = await getOverviewMetrics(
      new FakeCandidateTopicsReader([]),
      articlesReader,
      new FakeThreadsEngagementReader([]),
      new FakeFacebookEngagementReader([]),
      new FakeThreadsSentimentReader([]),
      new FakeFacebookSentimentReader([]),
      '2026-08-24'
    );

    // curr buzzVolume = 2 articles, prev (2026-08-17) = 1 article -> (2-1)/1*100 = 100%
    expect(result.deltas.buzzVolume.text).toBe('▲ +100% so với 7 ngày trước');
    expect(result.deltas.buzzVolume.positive).toBe(true);
  });
```

(Add this inside the existing `describe('getOverviewMetrics', ...)` block, alongside the 2 tests already there.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/get-overview-metrics.test.ts`
Expected: FAIL — `result.deltas` is `undefined`.

- [ ] **Step 3: Implement**

Replace the full contents of `dashboard/lib/get-overview-metrics.ts`:

```typescript
import type { CandidateTopicsReader } from './candidate-topics-reader';
import type { ArticlesReader } from './articles-reader';
import type { ThreadsEngagementReader } from './threads-engagement-reader';
import type { FacebookEngagementReader } from './facebook-engagement-reader';
import type { ThreadsSentimentReader } from './threads-sentiment-reader';
import type { FacebookSentimentReader } from './facebook-sentiment-reader';
import {
  computeOverviewMetrics,
  computeDonutSegments,
  computeKpiDelta,
  type OverviewMetrics,
  type DonutSegment,
} from './overview-metrics';

function addDaysUTC(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface OverviewMetricsResult {
  metrics: OverviewMetrics;
  donut: DonutSegment[];
  deltas: {
    buzzVolume: { text: string; positive: boolean };
    audienceScale: { text: string; positive: boolean };
  };
}

export async function getOverviewMetrics(
  candidateReader: CandidateTopicsReader,
  articlesReader: ArticlesReader,
  threadsEngagementReader: ThreadsEngagementReader,
  facebookEngagementReader: FacebookEngagementReader,
  threadsSentimentReader: ThreadsSentimentReader,
  facebookSentimentReader: FacebookSentimentReader,
  date: string
): Promise<OverviewMetricsResult> {
  const previousDate = addDaysUTC(date, -7);

  const [candidates, articles, threadsRows, facebookRows, threadsSentimentRows, facebookSentimentRows] =
    await Promise.all([
      candidateReader.getCandidatesForDate(date),
      articlesReader.getForDate(date),
      threadsEngagementReader.getForDate(date),
      facebookEngagementReader.getForDate(date),
      threadsSentimentReader.getForDate(date),
      facebookSentimentReader.getForDate(date),
    ]);

  const [prevArticles, prevThreadsRows, prevFacebookRows] = await Promise.all([
    articlesReader.getForDate(previousDate),
    threadsEngagementReader.getForDate(previousDate),
    facebookEngagementReader.getForDate(previousDate),
  ]);

  const sentimentRows = [...threadsSentimentRows, ...facebookSentimentRows];
  const metrics = computeOverviewMetrics(candidates, articles, threadsRows, facebookRows, sentimentRows);
  const donut = computeDonutSegments(articles, threadsRows, facebookRows);

  // Reuse computeOverviewMetrics for the previous-day figures too, passing
  // empty arrays for candidates/sentimentRows since those only feed
  // topicsTrending/sentimentScore — fields this delta computation doesn't
  // need — rather than re-deriving the buzzVolume/audienceScale formulas
  // inline a second time.
  const prevMetrics = computeOverviewMetrics([], prevArticles, prevThreadsRows, prevFacebookRows, []);

  return {
    metrics,
    donut,
    deltas: {
      buzzVolume: computeKpiDelta(metrics.buzzVolume, prevMetrics.buzzVolume),
      audienceScale: computeKpiDelta(metrics.audienceScale, prevMetrics.audienceScale),
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/get-overview-metrics.test.ts`
Expected: PASS (all tests — the 2 pre-existing ones still pass since they don't assert on `deltas`, and fake readers correctly return `[]` for an unqueried `previousDate`).

- [ ] **Step 5: Commit**

```bash
git add dashboard/lib/get-overview-metrics.ts dashboard/tests/get-overview-metrics.test.ts
git commit -m "feat: add week-over-week deltas to getOverviewMetrics"
```

---

### Task 12: `KpiCard.tsx` icon + delta props, and 2 new theme color tokens

**Files:**
- Modify: `dashboard/components/KpiCard.tsx`
- Modify: `dashboard/app/globals.css`

**Interfaces:**
- Produces: `KpiCard` accepts new optional props `icon?: string`, `iconBgClass?: string`, `iconColor?: string`, `delta?: string`, `deltaPositive?: boolean` — all existing callers (`label`, `value`, `tooltip` only) keep working unchanged.

- [ ] **Step 1: Add the 2 missing color tokens**

In `dashboard/app/globals.css`, in the `@theme` block, right after the existing `--color-danger-bg: #fff1f2;` line, add:

```css
  --color-info: #3b82f6;
  --color-info-bg: #eff6ff;
  --color-warning: #f59e0b;
  --color-warning-bg: #fffbeb;
```

- [ ] **Step 2: Extend `KpiCard.tsx`**

Replace the full contents of `dashboard/components/KpiCard.tsx`:

```tsx
import { MetricTooltip } from './MetricTooltip';

export function KpiCard({
  label,
  value,
  tooltip,
  icon,
  iconBgClass,
  iconColor,
  delta,
  deltaPositive,
}: {
  label: string;
  value: string;
  tooltip?: string;
  icon?: string;
  iconBgClass?: string;
  iconColor?: string;
  delta?: string;
  deltaPositive?: boolean;
}) {
  return (
    <div className="bg-surface border border-line rounded-card shadow-card p-6">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] font-semibold text-ink-3 tracking-wider uppercase">
          {label}
          {tooltip && <MetricTooltip text={tooltip} />}
        </div>
        {icon && iconBgClass && iconColor && (
          <div className={`w-9 h-9 rounded-[10px] flex items-center justify-center flex-shrink-0 ${iconBgClass}`}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d={icon} />
            </svg>
          </div>
        )}
      </div>
      <div className="text-2xl font-extrabold text-ink">{value}</div>
      {delta && (
        <div className={`text-xs font-semibold mt-2 ${deltaPositive ? 'text-success' : 'text-danger'}`}>{delta}</div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build` from `dashboard/`.
Expected: succeeds — existing `<KpiCard label=.. value=.. tooltip=..>` call sites (Overview, Analytics, sector page) compile unchanged since all new props are optional. No test file for this task (presentational component, no pure logic — matches existing convention).

- [ ] **Step 4: Commit**

```bash
git add dashboard/components/KpiCard.tsx dashboard/app/globals.css
git commit -m "feat: add icon and delta props to KpiCard, add info/warning color tokens"
```

---

### Task 13: Extract `SentimentBar.tsx`, add `SentimentByCategorySection.tsx`

**Files:**
- Create: `dashboard/components/SentimentBar.tsx`
- Modify: `dashboard/components/FacebookSummarySection.tsx`
- Create: `dashboard/components/SentimentByCategorySection.tsx`
- Modify: `dashboard/lib/metric-tooltips.ts`

**Interfaces:**
- Consumes: `CategorySentiment[]` (Task 7)
- Produces: `SentimentBar` (shared presentational component); `SentimentByCategorySection`

- [ ] **Step 1: Extract `SentimentBar.tsx`**

Create `dashboard/components/SentimentBar.tsx` with the exact component currently defined inline at the top of `FacebookSummarySection.tsx`:

```tsx
export function SentimentBar({
  label,
  count,
  total,
  colorClass,
}: {
  label: string;
  count: number;
  total: number;
  colorClass: string;
}) {
  const pct = total === 0 ? 0 : Math.round((count / total) * 100);
  return (
    <div className="flex items-center gap-3 mb-2 last:mb-0">
      <span className="text-xs text-ink-3 w-16 flex-shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${colorClass}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-bold w-9 text-right text-ink-3">{pct}%</span>
    </div>
  );
}
```

- [ ] **Step 2: Update `FacebookSummarySection.tsx` to import it**

In `dashboard/components/FacebookSummarySection.tsx`, delete the inline `SentimentBar` function definition (the whole block from `function SentimentBar({` through its closing `}`) and add an import at the top of the file instead:

```typescript
import { SentimentBar } from './SentimentBar';
```

- [ ] **Step 3: Add the tooltip key**

In `dashboard/lib/metric-tooltips.ts`, add inside the `METRIC_TOOLTIPS` object:

```typescript
  sentimentByCategory: 'Tỉ lệ Tích cực/Trung lập/Tiêu cực của các bài Threads + Facebook đã phân loại, tính riêng cho mỗi lĩnh vực.',
```

- [ ] **Step 4: Create `SentimentByCategorySection.tsx`**

Create `dashboard/components/SentimentByCategorySection.tsx`:

```tsx
import { SentimentBar } from './SentimentBar';
import { MetricTooltip } from './MetricTooltip';
import { METRIC_TOOLTIPS } from '../lib/metric-tooltips';
import type { CategorySentiment } from '../lib/sentiment-by-category';

export function SentimentByCategorySection({ data }: { data: CategorySentiment[] }) {
  const hasAny = data.some((d) => d.counts.positive + d.counts.negative + d.counts.neutral > 0);

  return (
    <section className="bg-surface border border-line rounded-card shadow-card p-6">
      <h2 className="text-base font-bold text-ink mb-4">
        Sentiment theo lĩnh vực
        <MetricTooltip text={METRIC_TOOLTIPS.sentimentByCategory} />
      </h2>
      {!hasAny ? (
        <p className="text-sm text-ink-3">Chưa có dữ liệu.</p>
      ) : (
        <div className="space-y-4">
          {data.map((d) => {
            const total = d.counts.positive + d.counts.negative + d.counts.neutral;
            return (
              <div key={d.category}>
                <p className="text-xs font-semibold text-ink-2 mb-2">{d.label}</p>
                <SentimentBar label="Tích cực" count={d.counts.positive} total={total} colorClass="bg-success" />
                <SentimentBar label="Trung lập" count={d.counts.neutral} total={total} colorClass="bg-ink-3" />
                <SentimentBar label="Tiêu cực" count={d.counts.negative} total={total} colorClass="bg-danger" />
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Verify build + tests**

Run: `npm test -- --run` and `npm run build`.
Expected: both green — `FacebookSummarySection` behaves identically (same JSX output, just imports `SentimentBar` instead of defining it inline).

- [ ] **Step 6: Commit**

```bash
git add dashboard/components/SentimentBar.tsx dashboard/components/FacebookSummarySection.tsx dashboard/components/SentimentByCategorySection.tsx dashboard/lib/metric-tooltips.ts
git commit -m "feat: extract SentimentBar, add SentimentByCategorySection"
```

---

### Task 14: `BuzzByPlatformSection.tsx`

**Files:**
- Create: `dashboard/components/BuzzByPlatformSection.tsx`
- Modify: `dashboard/lib/metric-tooltips.ts`

**Interfaces:**
- Consumes: `PlatformBuzz[]` (Task 8)
- Produces: `BuzzByPlatformSection`

- [ ] **Step 1: Add the tooltip key**

In `dashboard/lib/metric-tooltips.ts`, add:

```typescript
  buzzByPlatform: '% số bài viết theo từng nền tảng (Báo điện tử/Threads/Facebook) trong khoảng thời gian đang xem.',
```

- [ ] **Step 2: Create the component**

Create `dashboard/components/BuzzByPlatformSection.tsx`:

```tsx
import { MetricTooltip } from './MetricTooltip';
import { METRIC_TOOLTIPS } from '../lib/metric-tooltips';
import type { PlatformBuzz } from '../lib/buzz-by-platform';

export function BuzzByPlatformSection({ data }: { data: PlatformBuzz[] }) {
  const hasAny = data.some((d) => d.pct > 0);

  return (
    <section className="bg-surface border border-line rounded-card shadow-card p-6">
      <h2 className="text-base font-bold text-ink mb-4">
        Buzz theo nền tảng
        <MetricTooltip text={METRIC_TOOLTIPS.buzzByPlatform} />
      </h2>
      {!hasAny ? (
        <p className="text-sm text-ink-3">Chưa có dữ liệu.</p>
      ) : (
        <div className="space-y-3">
          {data.map((d) => (
            <div key={d.label} className="flex items-center gap-3">
              <span className="text-xs text-ink-3 w-24 flex-shrink-0">{d.label}</span>
              <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                <div className="h-full rounded-full bg-brand" style={{ width: `${d.pct}%` }} />
              </div>
              <span className="text-xs font-bold w-9 text-right text-ink-3">{d.pct}%</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`.
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add dashboard/components/BuzzByPlatformSection.tsx dashboard/lib/metric-tooltips.ts
git commit -m "feat: add BuzzByPlatformSection"
```

---

### Task 15: `SentimentTrendChart.tsx`

**Files:**
- Create: `dashboard/components/SentimentTrendChart.tsx`

**Interfaces:**
- Consumes: `SentimentTrendPoint[]` (Task 9)
- Produces: `SentimentTrendChart`

- [ ] **Step 1: Create the component**

Create `dashboard/components/SentimentTrendChart.tsx`:

```tsx
import type { SentimentTrendPoint } from '../lib/sentiment-trend';

const H = 140;
const W = 500;
const PAD = { top: 8, bottom: 24, left: 4, right: 4 };
const SERIES = [
  { key: 'positive' as const, label: 'Tích cực', color: 'var(--color-success)' },
  { key: 'neutral' as const, label: 'Trung lập', color: 'var(--color-ink-3)' },
  { key: 'negative' as const, label: 'Tiêu cực', color: 'var(--color-danger)' },
];

export function SentimentTrendChart({ data }: { data: SentimentTrendPoint[] }) {
  if (data.length <= 1) {
    return (
      <div className="flex items-center justify-center text-sm text-ink-3" style={{ height: H + 32 }}>
        Chưa có dữ liệu
      </div>
    );
  }

  const allVals = data.flatMap((p) => SERIES.map((s) => p[s.key]));
  const max = Math.max(...allVals, 1);

  const chartH = H - PAD.top - PAD.bottom;
  const chartW = W - PAD.left - PAD.right;
  const toX = (i: number) => PAD.left + (i / (data.length - 1)) * chartW;
  const toY = (v: number) => PAD.top + chartH - (v / max) * chartH;

  const step = Math.max(1, Math.floor((data.length - 1) / 6));
  const labelIdxs = [
    ...new Set([...Array.from({ length: 7 }, (_, i) => Math.min(i * step, data.length - 1)), data.length - 1]),
  ];

  const seriesPaths = SERIES.map((s) => {
    const coords = data.map((p, i) => ({ x: toX(i), y: toY(p[s.key]) }));
    const linePath = coords.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x} ${pt.y}`).join(' ');
    return { s, linePath };
  });

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H + 8 }} aria-hidden="true">
        {[0, 0.25, 0.5, 0.75, 1].map((v) => {
          const y = PAD.top + chartH - v * chartH;
          return (
            <line key={v} x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} stroke="var(--color-line)" strokeWidth={0.5} strokeDasharray="3 3" />
          );
        })}
        {seriesPaths.map(({ s, linePath }) => (
          <path key={s.key} d={linePath} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {labelIdxs.map((i) => (
          <text key={i} x={toX(i)} y={H - 2} textAnchor="middle" fontSize={9} fill="var(--color-ink-3)">
            {data[i].date.slice(5)}
          </text>
        ))}
      </svg>
      <div className="flex items-center gap-5 mt-1">
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 text-[11px] text-ink-3">
            <span className="w-6 h-0.5 inline-block rounded-full" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`.
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add dashboard/components/SentimentTrendChart.tsx
git commit -m "feat: add SentimentTrendChart"
```

---

### Task 16: `ShareOfVoiceBars.tsx`

**Files:**
- Create: `dashboard/components/ShareOfVoiceBars.tsx`

**Interfaces:**
- Consumes: `DonutSegment[]` from `lib/overview-metrics.ts` (pre-existing)
- Produces: `ShareOfVoiceBars`

- [ ] **Step 1: Create the component**

Create `dashboard/components/ShareOfVoiceBars.tsx`:

```tsx
import { CATEGORIES } from '../lib/categories';
import type { DonutSegment } from '../lib/overview-metrics';

function colorForCategory(category: string): string {
  return CATEGORIES.find((c) => c.value === category)?.color ?? '#888888';
}

export function ShareOfVoiceBars({ data }: { data: DonutSegment[] }) {
  return (
    <div className="space-y-2">
      {data.map((seg) => (
        <div key={seg.category} className="flex items-center gap-3">
          <span className="text-xs text-ink-2 w-16 flex-shrink-0">{seg.label}</span>
          <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${seg.pct}%`, background: colorForCategory(seg.category) }} />
          </div>
          <span className="text-xs font-bold w-9 text-right text-ink">{seg.pct}%</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`.
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add dashboard/components/ShareOfVoiceBars.tsx
git commit -m "feat: add ShareOfVoiceBars"
```

---

### Task 17: `TrendingTabs.tsx` (client component)

**Files:**
- Create: `dashboard/components/TrendingTabs.tsx`

**Interfaces:**
- Consumes: `TrendingTable` (pre-existing, `components/TrendingTable.tsx`), `EnrichedHotTopicRow` from `lib/topic-engagement.ts`
- Produces: `TrendingTabs`

- [ ] **Step 1: Create the component**

Create `dashboard/components/TrendingTabs.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { TrendingTable } from './TrendingTable';
import type { EnrichedHotTopicRow } from '../lib/topic-engagement';

// Both `trending` and `recent` are pre-sorted server-side (flattenAndRankHotTopics
// and sortByRecency respectively) — this component only toggles which
// already-computed array is displayed, no client-side sorting/fetching.
export function TrendingTabs({
  trending,
  recent,
  limit,
}: {
  trending: EnrichedHotTopicRow[];
  recent: EnrichedHotTopicRow[];
  limit?: number;
}) {
  const [tab, setTab] = useState<'trending' | 'recent'>('trending');
  const rows = tab === 'trending' ? trending : recent;
  const shown = limit ? rows.slice(0, limit) : rows;

  return (
    <div>
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setTab('trending')}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
            tab === 'trending' ? 'bg-brand text-white' : 'bg-muted text-ink-2 hover:bg-line'
          }`}
        >
          Trending
        </button>
        <button
          onClick={() => setTab('recent')}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
            tab === 'recent' ? 'bg-brand text-white' : 'bg-muted text-ink-2 hover:bg-line'
          }`}
        >
          Mới nhất
        </button>
      </div>
      <TrendingTable rows={shown} />
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`.
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add dashboard/components/TrendingTabs.tsx
git commit -m "feat: add TrendingTabs client component"
```

---

### Task 18: `SectorMiniCard.tsx`

**Files:**
- Create: `dashboard/components/SectorMiniCard.tsx`

**Interfaces:**
- Consumes: `TrendingTabs` (Task 17), `CATEGORIES` from `lib/categories.ts`
- Produces: `SectorMiniCard`

- [ ] **Step 1: Create the component**

Create `dashboard/components/SectorMiniCard.tsx`:

```tsx
import Link from 'next/link';
import { CATEGORIES } from '../lib/categories';
import { TrendingTabs } from './TrendingTabs';
import type { EnrichedHotTopicRow } from '../lib/topic-engagement';

export function SectorMiniCard({
  category,
  trending,
  recent,
  keywords,
}: {
  category: string;
  trending: EnrichedHotTopicRow[];
  recent: EnrichedHotTopicRow[];
  keywords: string[];
}) {
  const meta = CATEGORIES.find((c) => c.value === category);
  if (!meta) return null;

  return (
    <div className="bg-surface border border-line rounded-card shadow-card p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="flex items-center gap-2 text-sm font-bold text-ink">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: meta.color }} />
          {meta.label}
        </h3>
        <Link href={`/${meta.slug}`} className="text-xs font-semibold text-brand hover:underline">
          Thêm →
        </Link>
      </div>
      <TrendingTabs trending={trending} recent={recent} limit={4} />
      {keywords.length > 0 && (
        <div className="mt-4 pt-4 border-t border-line">
          <p className="text-[11px] font-semibold text-ink-3 tracking-wider uppercase mb-2">Từ khóa nổi bật</p>
          <div className="flex flex-wrap gap-2">
            {keywords.map((k) => (
              <span
                key={k}
                className="text-xs px-2.5 py-1 rounded-full"
                style={{ background: `${meta.color}1a`, color: meta.color }}
              >
                {k}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`.
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add dashboard/components/SectorMiniCard.tsx
git commit -m "feat: add SectorMiniCard"
```

---

### Task 19: Wire the Overview page (`app/page.tsx`)

**Files:**
- Modify: `dashboard/app/page.tsx`
- Modify: `dashboard/components/OverviewMetricsSection.tsx`

**Interfaces:**
- Consumes: `getOverviewMetrics` (Task 11), `getSectorMetrics` (Task 4), `extractTopKeywords` (Task 5), `sortByRecency` (Task 6), `flattenAndRankHotTopics` (pre-existing, `lib/trending.ts`), `computeSentimentByCategory` (Task 7), `computeBuzzByPlatform` (Task 8), `TrendingTable` (pre-existing), `SectorMiniCard` (Task 18), `SentimentByCategorySection` (Task 13), `BuzzByPlatformSection` (Task 14), `KpiCard` icon/delta props (Task 12)

- [ ] **Step 1: Add the 4 KPI icon constants and wire deltas in `OverviewMetricsSection.tsx`**

Replace the full contents of `dashboard/components/OverviewMetricsSection.tsx`:

```tsx
import Link from 'next/link';
import { KpiCard } from './KpiCard';
import { DonutChart } from './DonutChart';
import { BuzzTrendChart } from './BuzzTrendChart';
import { MetricTooltip } from './MetricTooltip';
import { METRIC_TOOLTIPS } from '../lib/metric-tooltips';
import type { OverviewMetrics, DonutSegment } from '../lib/overview-metrics';
import type { BuzzTrendPoint } from '../lib/buzz-trend';

function formatNumber(n: number): string {
  return n.toLocaleString('vi-VN');
}

function formatSentimentScore(score: number | null): string {
  if (score === null) return '—';
  return score > 0 ? `+${score}` : `${score}`;
}

const ICONS = {
  buzzVolume: { icon: 'M22 12h-4l-3 9L9 3l-3 9H2', iconBgClass: 'bg-success-bg', iconColor: 'var(--color-success)' },
  topicsTrending: { icon: 'M22 7L13.5 15.5L8.5 10.5L2 17M16 7H22V13', iconBgClass: 'bg-brand-faint', iconColor: 'var(--color-brand)' },
  audienceScale: {
    icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
    iconBgClass: 'bg-info-bg',
    iconColor: 'var(--color-info)',
  },
  sentimentScore: {
    icon: 'M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10-4.477 10-10 10zM8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01',
    iconBgClass: 'bg-warning-bg',
    iconColor: 'var(--color-warning)',
  },
};

export function OverviewMetricsSection({
  metrics,
  donut,
  buzzTrend,
  date,
  deltas,
}: {
  metrics: OverviewMetrics;
  donut: DonutSegment[];
  buzzTrend: BuzzTrendPoint[] | null;
  date: string;
  deltas: { buzzVolume: { text: string; positive: boolean }; audienceScale: { text: string; positive: boolean } };
}) {
  if (metrics.buzzVolume === 0) {
    return (
      <section className="mb-8">
        <p className="text-sm text-ink-3">Chưa có dữ liệu tổng quan hôm nay.</p>
      </section>
    );
  }

  return (
    <section className="mb-8">
      <p className="text-xs text-ink-3 mb-2">{date}</p>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 mb-6">
        <KpiCard
          label="Buzz Volume"
          value={formatNumber(metrics.buzzVolume)}
          tooltip={METRIC_TOOLTIPS.buzzVolume}
          {...ICONS.buzzVolume}
          delta={deltas.buzzVolume.text}
          deltaPositive={deltas.buzzVolume.positive}
        />
        <KpiCard
          label="Topics Trending"
          value={formatNumber(metrics.topicsTrending)}
          tooltip={METRIC_TOOLTIPS.topicsTrending}
          {...ICONS.topicsTrending}
          delta={`${metrics.topicsTrending} chủ đề được shortlist hôm nay`}
          deltaPositive={true}
        />
        <KpiCard
          label="Audience Scale"
          value={formatNumber(metrics.audienceScale)}
          tooltip={METRIC_TOOLTIPS.audienceScale}
          {...ICONS.audienceScale}
          delta={deltas.audienceScale.text}
          deltaPositive={deltas.audienceScale.positive}
        />
        <KpiCard
          label="Sentiment Score"
          value={formatSentimentScore(metrics.sentimentScore)}
          tooltip={METRIC_TOOLTIPS.sentimentScore}
          {...ICONS.sentimentScore}
          delta={metrics.sentimentScore !== null && metrics.sentimentScore >= 0 ? 'Xu hướng tích cực' : 'Xu hướng tiêu cực'}
          deltaPositive={metrics.sentimentScore !== null && metrics.sentimentScore >= 0}
        />
      </div>
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3 bg-surface border border-line rounded-card shadow-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-bold text-ink">
              Buzz Trend — 7 ngày qua
              <MetricTooltip text={METRIC_TOOLTIPS.buzzTrend} />
            </h2>
            <Link href="/analytics" className="text-sm font-semibold text-brand hover:underline">
              Xem chi tiết →
            </Link>
          </div>
          {buzzTrend ? <BuzzTrendChart data={buzzTrend} /> : <p className="text-sm text-ink-3">Chưa có dữ liệu.</p>}
        </div>
        <div className="lg:col-span-2 bg-surface border border-line rounded-card shadow-card p-6">
          <h2 className="text-base font-bold text-ink mb-4">
            Phân bổ lĩnh vực
            <MetricTooltip text={METRIC_TOOLTIPS.sectorShare} />
          </h2>
          <DonutChart data={donut} />
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Wire `app/page.tsx`**

Replace the full contents of `dashboard/app/page.tsx`:

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
import { getOverviewMetrics, type OverviewMetricsResult } from '../lib/get-overview-metrics';
import { getBuzzTrend } from '../lib/get-buzz-trend';
import { getSectorMetrics } from '../lib/get-sector-metrics';
import { flattenAndRankHotTopics } from '../lib/trending';
import { sortByRecency, type HotTopicRow } from '../lib/hot-topics';
import { extractTopKeywords } from '../lib/top-keywords';
import { computeSentimentByCategory, type CategorySentiment } from '../lib/sentiment-by-category';
import { computeBuzzByPlatform, type PlatformBuzz } from '../lib/buzz-by-platform';
import { CATEGORIES } from '../lib/categories';
import type { BuzzTrendPoint } from '../lib/buzz-trend';
import Link from 'next/link';
import { ArticlesSection } from '../components/ArticlesSection';
import { OverviewMetricsSection } from '../components/OverviewMetricsSection';
import { SectorMiniCard } from '../components/SectorMiniCard';
import { SentimentByCategorySection } from '../components/SentimentByCategorySection';
import { BuzzByPlatformSection } from '../components/BuzzByPlatformSection';
import { TrendingTable } from '../components/TrendingTable';
import { MetricTooltip } from '../components/MetricTooltip';
import { METRIC_TOOLTIPS } from '../lib/metric-tooltips';
import { Topbar } from '../components/layout/Topbar';
import type { Article, CandidateTopic } from '../lib/types';

export const dynamic = 'force-dynamic';

function addDaysUTC(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

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

async function loadOverviewMetrics(date: string | null): Promise<(OverviewMetricsResult & { date: string }) | null> {
  if (date === null) return null;
  try {
    const client = createServerSupabaseClient();
    const result = await getOverviewMetrics(
      new SupabaseCandidateTopicsReader(client),
      new SupabaseArticlesReader(client),
      new SupabaseThreadsEngagementReader(client),
      new SupabaseFacebookEngagementReader(client),
      new SupabaseThreadsSentimentReader(client),
      new SupabaseFacebookSentimentReader(client),
      date
    );
    return { ...result, date };
  } catch (err) {
    console.error(err);
    return null;
  }
}

async function loadBuzzTrend(date: string | null): Promise<BuzzTrendPoint[] | null> {
  if (date === null) return null;
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

async function loadSectorMiniCards(date: string | null) {
  if (date === null) return null;
  try {
    const client = createServerSupabaseClient();
    const candidateReader = new SupabaseCandidateTopicsReader(client);
    const results = await Promise.all(
      CATEGORIES.map(async (cat) => {
        const [hotTopics, sectorMetrics] = await Promise.all([
          getHotTopics(candidateReader, cat.value),
          getSectorMetrics(
            candidateReader,
            new SupabaseArticlesReader(client),
            new SupabaseThreadsEngagementReader(client),
            new SupabaseFacebookEngagementReader(client),
            cat.value,
            date
          ),
        ]);
        const enriched = await loadThreadsEngagement(hotTopics.bySource, hotTopics.date);
        const flattened = flattenAndRankHotTopics(enriched);
        return {
          category: cat.value,
          trending: flattened,
          recent: sortByRecency(flattened),
          keywords: extractTopKeywords(
            await candidateReader.getShortlistedForDateRange(cat.value, date, addDaysUTC(date, 1)),
            8
          ),
        };
      })
    );
    return results;
  } catch (err) {
    console.error(err);
    return null;
  }
}

async function loadSentimentByCategory(date: string | null): Promise<CategorySentiment[] | null> {
  if (date === null) return null;
  try {
    const client = createServerSupabaseClient();
    const candidateReader = new SupabaseCandidateTopicsReader(client);
    const [candidates, threadsSentiment, facebookSentiment] = await Promise.all([
      candidateReader.getCandidatesForDate(date),
      new SupabaseThreadsSentimentReader(client).getForDate(date),
      new SupabaseFacebookSentimentReader(client).getForDate(date),
    ]);
    return computeSentimentByCategory(threadsSentiment, candidates, facebookSentiment);
  } catch (err) {
    console.error(err);
    return null;
  }
}

async function loadBuzzByPlatform(date: string | null): Promise<PlatformBuzz[] | null> {
  if (date === null) return null;
  try {
    const client = createServerSupabaseClient();
    const [articles, threadsRows, facebookRows] = await Promise.all([
      new SupabaseArticlesReader(client).getForDate(date),
      new SupabaseThreadsEngagementReader(client).getForDate(date),
      new SupabaseFacebookEngagementReader(client).getForDate(date),
    ]);
    return computeBuzzByPlatform(articles, threadsRows, facebookRows);
  } catch (err) {
    console.error(err);
    return null;
  }
}

export default async function OverviewPage() {
  const [hotTopics, articles] = await Promise.all([loadHotTopics(), loadArticles()]);
  const date = 'error' in hotTopics ? null : hotTopics.date;

  const [threadsEnrichedBySource, overviewMetrics, buzzTrend, sectorMiniCards, sentimentByCategory, buzzByPlatform] =
    await Promise.all([
      'error' in hotTopics ? Promise.resolve(null) : loadThreadsEngagement(hotTopics.bySource, hotTopics.date),
      loadOverviewMetrics(date),
      loadBuzzTrend(date),
      loadSectorMiniCards(date),
      loadSentimentByCategory(date),
      loadBuzzByPlatform(date),
    ]);

  const hotTopicsWithEngagement =
    'error' in hotTopics
      ? hotTopics
      : { ...hotTopics, bySource: threadsEnrichedBySource ?? withoutEngagement(hotTopics.bySource) };

  const rankedTrending =
    'error' in hotTopicsWithEngagement ? [] : flattenAndRankHotTopics(hotTopicsWithEngagement.bySource);

  return (
    <>
      <Topbar title="Tổng quan thị trường" />
      <main className="max-w-4xl mx-auto p-6">
        {overviewMetrics && (
          <OverviewMetricsSection
            metrics={overviewMetrics.metrics}
            donut={overviewMetrics.donut}
            buzzTrend={buzzTrend}
            date={overviewMetrics.date}
            deltas={overviewMetrics.deltas}
          />
        )}
        <section className="bg-surface border border-line rounded-card shadow-card p-6 mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-bold text-ink">
              🔥 Top Trending hôm nay
              <MetricTooltip text={METRIC_TOOLTIPS.topTrending} />
            </h2>
            <Link href="/trending" className="text-sm font-semibold text-brand hover:underline">
              Xem tất cả →
            </Link>
          </div>
          <TrendingTable rows={rankedTrending.slice(0, 10)} />
        </section>
        {sectorMiniCards && (
          <div className="grid gap-6 md:grid-cols-3 mb-8">
            {sectorMiniCards.map((c) => (
              <SectorMiniCard key={c.category} {...c} />
            ))}
          </div>
        )}
        {(sentimentByCategory || buzzByPlatform) && (
          <div className="grid gap-6 lg:grid-cols-2 mb-8">
            {sentimentByCategory && <SentimentByCategorySection data={sentimentByCategory} />}
            {buzzByPlatform && <BuzzByPlatformSection data={buzzByPlatform} />}
          </div>
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

- [ ] **Step 3: Verify build**

Run: `npm run build` from `dashboard/`.
Expected: succeeds, `/` route present, no unused-import lint errors.

- [ ] **Step 4: Commit**

```bash
git add dashboard/app/page.tsx dashboard/components/OverviewMetricsSection.tsx
git commit -m "feat: wire Overview page — KPI icons/deltas, sector mini-cards, sentiment-by-category, buzz-by-platform, ranked trending list"
```

---

### Task 20: Wire the Analytics page (`app/analytics/page.tsx`)

**Files:**
- Modify: `dashboard/app/analytics/page.tsx`
- Modify: `dashboard/lib/metric-tooltips.ts`

**Interfaces:**
- Consumes: `getOverviewMetrics` (Task 11, reused as-is for the 3 KPI cards — no delta needed here per spec), `computeSentimentTrend` (Task 9), `ShareOfVoiceBars` (Task 16), `SentimentTrendChart` (Task 15), `KpiCard` (Task 12, without icon)

- [ ] **Step 1: Add the tooltip keys**

In `dashboard/lib/metric-tooltips.ts`, add:

```typescript
  shareOfVoice: '% Buzz Volume thuộc về mỗi lĩnh vực trong 7 ngày qua — cùng công thức với biểu đồ Phân bổ lĩnh vực trên Overview.',
  sentimentTrend: 'Số bài Threads + Facebook đã phân loại sentiment mỗi ngày, theo Tích cực/Trung lập/Tiêu cực.',
```

- [ ] **Step 2: Wire the page**

Replace the full contents of `dashboard/app/analytics/page.tsx`:

```tsx
import { createServerSupabaseClient } from '../../lib/supabase';
import { SupabaseCandidateTopicsReader } from '../../lib/candidate-topics-reader';
import { SupabaseArticlesReader } from '../../lib/articles-reader';
import { SupabaseThreadsEngagementReader } from '../../lib/threads-engagement-reader';
import { SupabaseFacebookEngagementReader } from '../../lib/facebook-engagement-reader';
import { SupabaseThreadsSentimentReader } from '../../lib/threads-sentiment-reader';
import { SupabaseFacebookSentimentReader } from '../../lib/facebook-sentiment-reader';
import { getBuzzTrend } from '../../lib/get-buzz-trend';
import { getTopicMovers } from '../../lib/get-topic-movers';
import { getOverviewMetrics, type OverviewMetricsResult } from '../../lib/get-overview-metrics';
import { computeSentimentTrend, type SentimentTrendPoint } from '../../lib/sentiment-trend';
import type { BuzzTrendPoint } from '../../lib/buzz-trend';
import type { TopicMover } from '../../lib/topic-movers';
import { BuzzTrendChart } from '../../components/BuzzTrendChart';
import { SentimentTrendChart } from '../../components/SentimentTrendChart';
import { ShareOfVoiceBars } from '../../components/ShareOfVoiceBars';
import { KpiCard } from '../../components/KpiCard';
import { TopicMoversSection } from '../../components/TopicMoversSection';
import { Topbar } from '../../components/layout/Topbar';
import { MetricTooltip } from '../../components/MetricTooltip';
import { METRIC_TOOLTIPS } from '../../lib/metric-tooltips';

export const dynamic = 'force-dynamic';

function addDaysUTC(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

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
): Promise<{ gainers: TopicMover[]; losers: TopicMover[]; hasRealGainers: boolean; hasRealLosers: boolean } | null> {
  try {
    const client = createServerSupabaseClient();
    return await getTopicMovers(new SupabaseThreadsEngagementReader(client), date);
  } catch (err) {
    console.error(err);
    return null;
  }
}

async function loadOverviewMetrics(date: string): Promise<OverviewMetricsResult | null> {
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

async function loadSentimentTrend(date: string): Promise<SentimentTrendPoint[] | null> {
  try {
    const client = createServerSupabaseClient();
    const startDate = addDaysUTC(date, -6);
    const endDateExclusive = addDaysUTC(date, 1);
    const [threadsSentiment, facebookSentiment] = await Promise.all([
      new SupabaseThreadsSentimentReader(client).getForDateRange(startDate, endDateExclusive),
      new SupabaseFacebookSentimentReader(client).getForDateRange(startDate, endDateExclusive),
    ]);
    const dates = Array.from({ length: 7 }, (_, i) => addDaysUTC(startDate, i));
    return computeSentimentTrend(threadsSentiment, facebookSentiment, dates);
  } catch (err) {
    console.error(err);
    return null;
  }
}

export default async function AnalyticsPage() {
  const latestDate = await loadLatestDate();

  const [buzzTrend, topicMovers, overviewMetrics, sentimentTrend] = latestDate
    ? await Promise.all([
        loadBuzzTrend(latestDate),
        loadTopicMovers(latestDate),
        loadOverviewMetrics(latestDate),
        loadSentimentTrend(latestDate),
      ])
    : [null, null, null, null];

  return (
    <>
      <Topbar title="Phân tích" />
      <main className="max-w-4xl mx-auto p-6">
        {latestDate === null ? (
          <p className="text-sm text-ink-3">Chưa có dữ liệu.</p>
        ) : (
          <>
            <p className="text-xs text-ink-3 mb-4">Dữ liệu tính đến {latestDate}</p>
            {overviewMetrics && (
              <div className="grid gap-4 md:grid-cols-3 mb-8">
                <KpiCard
                  label="Tổng Buzz Volume"
                  value={overviewMetrics.metrics.buzzVolume.toLocaleString('vi-VN')}
                  tooltip={METRIC_TOOLTIPS.buzzVolume}
                  delta={overviewMetrics.deltas.buzzVolume.text}
                  deltaPositive={overviewMetrics.deltas.buzzVolume.positive}
                />
                <KpiCard
                  label="Sentiment Index"
                  value={overviewMetrics.metrics.sentimentScore === null ? '—' : `${overviewMetrics.metrics.sentimentScore}`}
                  tooltip={METRIC_TOOLTIPS.sentimentScore}
                />
                <div className="bg-surface border border-line rounded-card shadow-card p-6">
                  <div className="text-[11px] font-semibold text-ink-3 tracking-wider uppercase mb-3">
                    Share of Voice
                    <MetricTooltip text={METRIC_TOOLTIPS.shareOfVoice} />
                  </div>
                  <ShareOfVoiceBars data={overviewMetrics.donut} />
                </div>
              </div>
            )}
            <div className="grid gap-6 lg:grid-cols-2 mb-8">
              <section className="bg-surface border border-line rounded-card shadow-card p-6">
                <h2 className="text-base font-bold text-ink mb-1">
                  Buzz Trend — theo lĩnh vực
                  <MetricTooltip text={METRIC_TOOLTIPS.buzzTrend} />
                </h2>
                <p className="text-xs text-ink-3 mb-4">7 ngày qua</p>
                {buzzTrend ? (
                  <BuzzTrendChart data={buzzTrend} />
                ) : (
                  <p className="text-sm text-ink-3">Chưa có dữ liệu.</p>
                )}
              </section>
              <section className="bg-surface border border-line rounded-card shadow-card p-6">
                <h2 className="text-base font-bold text-ink mb-1">
                  Xu hướng Sentiment
                  <MetricTooltip text={METRIC_TOOLTIPS.sentimentTrend} />
                </h2>
                <p className="text-xs text-ink-3 mb-4">7 ngày qua</p>
                {sentimentTrend ? (
                  <SentimentTrendChart data={sentimentTrend} />
                ) : (
                  <p className="text-sm text-ink-3">Chưa có dữ liệu.</p>
                )}
              </section>
            </div>
            {topicMovers ? (
              <TopicMoversSection
                gainers={topicMovers.gainers}
                losers={topicMovers.losers}
                hasRealGainers={topicMovers.hasRealGainers}
                hasRealLosers={topicMovers.hasRealLosers}
              />
            ) : (
              <p className="text-sm text-ink-3">Chưa có dữ liệu.</p>
            )}
          </>
        )}
      </main>
    </>
  );
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`.
Expected: succeeds, `/analytics` route present.

- [ ] **Step 4: Commit**

```bash
git add dashboard/app/analytics/page.tsx dashboard/lib/metric-tooltips.ts
git commit -m "feat: wire Analytics page — 3 KPI cards, Xu hướng Sentiment chart"
```

---

### Task 21: Wire the sector page (`app/[slug]/page.tsx`), delete unused `HotTopicsSection`

**Files:**
- Modify: `dashboard/app/[slug]/page.tsx`
- Modify: `dashboard/lib/metric-tooltips.ts`
- Delete: `dashboard/components/HotTopicsSection.tsx`

**Interfaces:**
- Consumes: `getSectorMetrics` (Task 4), `sortByRecency`/`flattenAndRankHotTopics`, `extractTopKeywords` (Task 5), `computeBuzzByPlatform` (Task 8), `TrendingTabs` (Task 17), `BuzzByPlatformSection` (Task 14), `KpiCard` (Task 12)

- [ ] **Step 1: Add sector-specific tooltip keys**

In `dashboard/lib/metric-tooltips.ts`, add:

```typescript
  sectorBuzzVolume: 'Tổng số bài báo + bài Threads + bài Facebook thuộc lĩnh vực này trong 7 ngày qua.',
  sectorActiveTopics: 'Số từ khóa khác nhau đang được shortlist trong lĩnh vực này, 7 ngày qua.',
```

- [ ] **Step 2: Wire the page**

Replace the full contents of `dashboard/app/[slug]/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { createServerSupabaseClient } from '../../lib/supabase';
import { SupabaseCandidateTopicsReader } from '../../lib/candidate-topics-reader';
import { SupabaseArticlesReader } from '../../lib/articles-reader';
import { SupabaseThreadsEngagementReader } from '../../lib/threads-engagement-reader';
import { SupabaseThreadsSentimentReader } from '../../lib/threads-sentiment-reader';
import { SupabaseFacebookEngagementReader } from '../../lib/facebook-engagement-reader';
import { SupabaseFacebookSentimentReader } from '../../lib/facebook-sentiment-reader';
import { getHotTopics, type HotTopicsResult } from '../../lib/get-hot-topics';
import { enrichHotTopicsWithThreadsData } from '../../lib/get-topic-engagement';
import { withoutEngagement } from '../../lib/topic-engagement';
import { getFacebookSummary } from '../../lib/get-facebook-summary';
import type { FacebookSummary } from '../../lib/facebook-summary';
import { getCategoryBySlug } from '../../lib/categories';
import { getSectorMetrics } from '../../lib/get-sector-metrics';
import { flattenAndRankHotTopics } from '../../lib/trending';
import { sortByRecency } from '../../lib/hot-topics';
import { extractTopKeywords } from '../../lib/top-keywords';
import { computeBuzzByPlatform, type PlatformBuzz } from '../../lib/buzz-by-platform';
import { ArticlesSection } from '../../components/ArticlesSection';
import { FacebookSummarySection } from '../../components/FacebookSummarySection';
import { TrendingTabs } from '../../components/TrendingTabs';
import { BuzzByPlatformSection } from '../../components/BuzzByPlatformSection';
import { KpiCard } from '../../components/KpiCard';
import { Topbar } from '../../components/layout/Topbar';
import { MetricTooltip } from '../../components/MetricTooltip';
import { METRIC_TOOLTIPS } from '../../lib/metric-tooltips';
import type { Article, CandidateTopic } from '../../lib/types';
import type { HotTopicRow } from '../../lib/hot-topics';

export const dynamic = 'force-dynamic';

function addDaysUTC(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function loadHotTopics(category: string): Promise<HotTopicsResult | { error: string }> {
  try {
    const client = createServerSupabaseClient();
    return await getHotTopics(new SupabaseCandidateTopicsReader(client), category);
  } catch (err) {
    console.error(err);
    return { error: 'Không tải được dữ liệu topic, vui lòng thử lại sau.' };
  }
}

async function loadArticles(category: string): Promise<Article[] | { error: string }> {
  try {
    const client = createServerSupabaseClient();
    return await new SupabaseArticlesReader(client).getRecentArticles(20, category);
  } catch (err) {
    console.error(err);
    return { error: 'Không tải được bài báo, vui lòng thử lại sau.' };
  }
}

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

async function loadFacebookSummary(category: string, date: string | null): Promise<FacebookSummary | null> {
  if (date === null) return null;
  try {
    const client = createServerSupabaseClient();
    return await getFacebookSummary(category, new SupabaseFacebookEngagementReader(client), new SupabaseFacebookSentimentReader(client), date);
  } catch (err) {
    console.error(err);
    return null;
  }
}

async function loadSectorMetrics(category: string, date: string | null) {
  if (date === null) return null;
  try {
    const client = createServerSupabaseClient();
    return await getSectorMetrics(
      new SupabaseCandidateTopicsReader(client),
      new SupabaseArticlesReader(client),
      new SupabaseThreadsEngagementReader(client),
      new SupabaseFacebookEngagementReader(client),
      category,
      date
    );
  } catch (err) {
    console.error(err);
    return null;
  }
}

async function loadTopKeywords(category: string, date: string | null): Promise<string[]> {
  if (date === null) return [];
  try {
    const client = createServerSupabaseClient();
    const candidates = await new SupabaseCandidateTopicsReader(client).getShortlistedForDateRange(
      category,
      addDaysUTC(date, -6),
      addDaysUTC(date, 1)
    );
    return extractTopKeywords(candidates);
  } catch (err) {
    console.error(err);
    return [];
  }
}

async function loadBuzzByPlatform(category: string, date: string | null): Promise<PlatformBuzz[] | null> {
  if (date === null) return null;
  try {
    const client = createServerSupabaseClient();
    const [articles, threadsRows, facebookRows] = await Promise.all([
      new SupabaseArticlesReader(client).getForDate(date),
      new SupabaseThreadsEngagementReader(client).getForDate(date),
      new SupabaseFacebookEngagementReader(client).getForDate(date),
    ]);
    return computeBuzzByPlatform(
      articles.filter((a) => a.categories.includes(category)),
      threadsRows.filter((r) => r.category === category),
      facebookRows.filter((r) => r.category === category)
    );
  } catch (err) {
    console.error(err);
    return null;
  }
}

export default async function SectorPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const categoryDef = getCategoryBySlug(slug);
  if (!categoryDef) notFound();

  const [hotTopics, articles] = await Promise.all([
    loadHotTopics(categoryDef.value),
    loadArticles(categoryDef.value),
  ]);
  const date = 'error' in hotTopics ? null : hotTopics.date;

  const [threadsEnrichedBySource, facebookSummary, sectorMetrics, topKeywords, buzzByPlatform] = await Promise.all([
    'error' in hotTopics ? Promise.resolve(null) : loadThreadsEngagement(hotTopics.bySource, hotTopics.date),
    loadFacebookSummary(categoryDef.value, date),
    loadSectorMetrics(categoryDef.value, date),
    loadTopKeywords(categoryDef.value, date),
    loadBuzzByPlatform(categoryDef.value, date),
  ]);

  const hotTopicsWithEngagement =
    'error' in hotTopics
      ? hotTopics
      : { ...hotTopics, bySource: threadsEnrichedBySource ?? withoutEngagement(hotTopics.bySource) };

  const rankedTrending =
    'error' in hotTopicsWithEngagement ? [] : flattenAndRankHotTopics(hotTopicsWithEngagement.bySource);

  return (
    <>
      <Topbar title={categoryDef.label} color={categoryDef.color} />
      <main className="max-w-4xl mx-auto p-6">
        {sectorMetrics && (
          <div className="grid gap-4 md:grid-cols-3 mb-8">
            <KpiCard
              label="Buzz Volume (7 ngày)"
              value={sectorMetrics.metrics.buzzVolume7d.toLocaleString('vi-VN')}
              tooltip={METRIC_TOOLTIPS.sectorBuzzVolume}
              delta={sectorMetrics.buzzVolumeDelta.text}
              deltaPositive={sectorMetrics.buzzVolumeDelta.positive}
            />
            <KpiCard
              label="Chủ đề hoạt động"
              value={sectorMetrics.metrics.activeTopics.toLocaleString('vi-VN')}
              tooltip={METRIC_TOOLTIPS.sectorActiveTopics}
              delta="trong 7 ngày qua"
              deltaPositive={true}
            />
            <KpiCard
              label="Audience Scale"
              value={sectorMetrics.metrics.audienceScale7d.toLocaleString('vi-VN')}
              tooltip={METRIC_TOOLTIPS.audienceScale}
              delta={sectorMetrics.audienceScaleDelta.text}
              deltaPositive={sectorMetrics.audienceScaleDelta.positive}
            />
          </div>
        )}
        <section className="bg-surface border border-line rounded-card shadow-card p-6 mb-8">
          <h2 className="text-base font-bold text-ink mb-4">
            Chủ đề đang trending
            <MetricTooltip text={METRIC_TOOLTIPS.topTrending} />
          </h2>
          <TrendingTabs trending={rankedTrending} recent={sortByRecency(rankedTrending)} />
        </section>
        {topKeywords.length > 0 && (
          <section className="bg-surface border border-line rounded-card shadow-card p-6 mb-8">
            <h2 className="text-base font-bold text-ink mb-4">Từ khóa nổi bật</h2>
            <div className="flex flex-wrap gap-2">
              {topKeywords.map((k) => (
                <span key={k} className="text-xs px-2.5 py-1 rounded-full bg-muted text-ink-2">
                  {k}
                </span>
              ))}
            </div>
          </section>
        )}
        {buzzByPlatform && <div className="mb-8"><BuzzByPlatformSection data={buzzByPlatform} /></div>}
        <FacebookSummarySection summary={facebookSummary} date={date} />
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

- [ ] **Step 3: Delete the now-unused `HotTopicsSection` component**

After this task, `app/page.tsx` (Task 19) and `app/[slug]/page.tsx` (this task) no longer import `HotTopicsSection` — it was fully replaced by `TrendingTable`/`TrendingTabs`. Confirm nothing else references it, then delete the file:

```bash
grep -rn "HotTopicsSection" dashboard/app dashboard/components dashboard/tests
```

Expected: no matches. Then:

```bash
rm dashboard/components/HotTopicsSection.tsx
```

- [ ] **Step 4: Verify build + full test suite**

Run: `npm test -- --run` and `npm run build` from `dashboard/`.
Expected: all tests green (103 + new tests from Tasks 2-11), build succeeds with all 7 routes present (`/`, `/[slug]`, `/analytics`, `/trending`, `/topic/[keyword]`, `/help`, `/_not-found`).

- [ ] **Step 5: Commit**

```bash
git add dashboard/app/\[slug\]/page.tsx dashboard/lib/metric-tooltips.ts
git rm dashboard/components/HotTopicsSection.tsx
git commit -m "feat: wire sector page — KPI cards, ranked trending tabs, từ khóa nổi bật, buzz-by-platform

Also removes HotTopicsSection.tsx, fully superseded by TrendingTable/TrendingTabs."
```

---

## Final check

After Task 21, run the full suite one more time and manually spot-check via `npm run dev` (with real Supabase env vars) that all 3 pages render without console errors, since none of the new page-wiring code is unit-tested (matches existing convention — component/page tests are out of scope, but a visual smoke check catches wiring mistakes unit tests can't).
