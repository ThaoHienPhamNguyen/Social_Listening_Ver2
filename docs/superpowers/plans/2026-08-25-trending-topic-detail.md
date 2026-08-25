# Trending Now + Topic Detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/trending` page (unified ranked table of all currently-shortlisted candidates) and a `/topic/[keyword]` detail page (7-day trending-score/engagement/sentiment timelines for one keyword, aggregate-only, no post list).

**Architecture:** Trending Now reuses the existing `getHotTopics`/`enrichHotTopicsWithThreadsData` orchestration almost entirely, adding one pure flatten/sort function. Topic Detail needs 2 new reader methods (a keyword+range query on `CandidateTopicsReader`, a range query on `ThreadsSentimentReader`) plus new pure logic and orchestration, following the same reader/Fake DI pattern as every prior sub-project. A shared-formatter extraction (`hot-topic-format.ts`) removes duplication between the existing Hot Topics section and the new Trending table.

**Tech Stack:** Next.js 15 App Router, React 19 Server Components, TypeScript, Vitest, `@supabase/supabase-js`, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-08-25-trending-topic-detail-design.md`

## Global Constraints

- No post/article list on Topic Detail — aggregate-only (decided with user; ver2 stores no per-keyword post content).
- Fixed 7-day window everywhere (no period toggle), anchored to `CandidateTopicsReader.getLatestDate()`, same `addDaysUTC` UTC-string arithmetic convention as sub-project B.
- Category resolution for a keyword MUST be order-independent — track the date of whichever row last supplied a non-empty category, never let processing order change the result (this exact class of bug was found and fixed in sub-project B's final review; do not reintroduce it).
- Threads-only for Topic Detail's engagement/sentiment timelines (Facebook/Articles aren't keyword-scoped) — same scoping reason as sub-project B's Gainers/Losers.
- Silent-degradation error handling everywhere: `console.error`, no red banner, matches every prior sub-project's convention. A keyword with no data at all is NOT an error — show "Không tìm thấy topic này." instead.
- Category badge color goes on a decorative dot only, never as text color directly from `CATEGORIES[].color` (the WCAG contrast bug this project has hit repeatedly) — EXCEPT the existing, already-reviewed `Topbar`'s `color` prop pattern for large bold headings (`text-xl font-bold`, WCAG large-text exemption), which is safe to reuse verbatim since `app/[slug]/page.tsx` already does exactly this.
- A line chart over a fixed-length data array MUST guard `data.length <= 1` in its empty-state check (not just `=== 0`) to avoid the NaN-coordinate bug found and fixed in sub-project B's `BuzzTrendChart.tsx`.
- Pure-logic/orchestration modules get full test coverage with fixture data; components/pages are not unit-tested (matches project convention).

---

### Task 1: Data layer — new reader methods

**Files:**
- Modify: `dashboard/lib/candidate-topics-reader.ts`
- Modify: `dashboard/lib/threads-sentiment-reader.ts`
- Modify: `dashboard/tests/fakes/fake-candidate-topics-reader.ts`
- Modify: `dashboard/tests/fakes/fake-threads-sentiment-reader.ts`
- Create: `dashboard/tests/topic-detail-readers.test.ts`

**Interfaces:**
- Produces (used by Task 4):
  - `CandidateTopicsReader.getHistoryForKeyword(keyword: string, startDate: string, endDateExclusive: string): Promise<CandidateTopic[]>`
  - `ThreadsSentimentReader.getForDateRange(startDate: string, endDateExclusive: string): Promise<{ keyword: string; date: string; sentiment: SentimentLabel | null }[]>`
  - Range is `[startDate, endDateExclusive)`, same convention as every range method in sub-project B.

- [ ] **Step 1: Write the failing test**

Create `dashboard/tests/topic-detail-readers.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { FakeCandidateTopicsReader } from './fakes/fake-candidate-topics-reader';
import { FakeThreadsSentimentReader } from './fakes/fake-threads-sentiment-reader';
import type { CandidateTopic } from '../lib/types';

function candidate(overrides: Partial<CandidateTopic> = {}): CandidateTopic {
  return {
    id: 'c-1',
    source: 'rss',
    keyword: 'bitcoin',
    date: '2026-08-20',
    metric_value: 10,
    growth_rate: 0.5,
    category_hint: ['tai_chinh'],
    is_shortlisted: true,
    ...overrides,
  };
}

describe('FakeCandidateTopicsReader.getHistoryForKeyword', () => {
  it('filters by keyword AND date range [startDate, endDateExclusive)', async () => {
    const reader = new FakeCandidateTopicsReader([
      candidate({ id: 'a', keyword: 'bitcoin', date: '2026-08-18' }),
      candidate({ id: 'b', keyword: 'bitcoin', date: '2026-08-20' }), // out of range (end excl)
      candidate({ id: 'c', keyword: 'ethereum', date: '2026-08-18' }), // wrong keyword
      candidate({ id: 'd', keyword: 'bitcoin', date: '2026-08-17' }), // before range
    ]);
    const result = await reader.getHistoryForKeyword('bitcoin', '2026-08-18', '2026-08-20');
    expect(result.map((c) => c.id)).toEqual(['a']);
  });
});

describe('FakeThreadsSentimentReader.getForDateRange', () => {
  it('filters rows to [startDate, endDateExclusive)', async () => {
    const reader = new FakeThreadsSentimentReader([
      { date: '2026-08-18', keyword: 'bitcoin', sentiment: 'positive' },
      { date: '2026-08-19', keyword: 'bitcoin', sentiment: 'negative' },
      { date: '2026-08-20', keyword: 'bitcoin', sentiment: 'neutral' },
    ]);
    const result = await reader.getForDateRange('2026-08-18', '2026-08-20');
    expect(result.map((r) => r.date).sort()).toEqual(['2026-08-18', '2026-08-19']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `dashboard/`): `npm test -- topic-detail-readers`
Expected: FAIL — `getHistoryForKeyword`/`getForDateRange` do not exist on these Fakes.

- [ ] **Step 3: Add `getHistoryForKeyword` to `CandidateTopicsReader`**

In `dashboard/lib/candidate-topics-reader.ts`, add to the interface (after `getCandidatesForDate`):

```typescript
  // Every candidate_topics row for one keyword within [startDate, endDateExclusive)
  // — used by Topic Detail's history timelines. Capped lower than the other
  // readers (1000 vs 5000) since it's already filtered to a single keyword —
  // 3 sources × 7 days = 21 rows in the normal case, 1000 is a wide safety margin.
  getHistoryForKeyword(keyword: string, startDate: string, endDateExclusive: string): Promise<CandidateTopic[]>;
```

Add to `SupabaseCandidateTopicsReader`:

```typescript
  async getHistoryForKeyword(keyword: string, startDate: string, endDateExclusive: string): Promise<CandidateTopic[]> {
    const { data, error } = await this.client
      .from('candidate_topics')
      .select('id, source, keyword, date, metric_value, growth_rate, category_hint, is_shortlisted')
      .eq('keyword', keyword)
      .gte('date', startDate)
      .lt('date', endDateExclusive)
      .limit(1000);
    if (error) throw new Error(error.message);
    if (data && data.length === 1000) {
      console.warn(
        `candidate-topics-reader: hit the 1000-row limit for keyword "${keyword}" range [${startDate}, ${endDateExclusive}) — Topic detail history may be truncated.`
      );
    }
    return (data ?? []) as CandidateTopic[];
  }
```

- [ ] **Step 4: Add `getForDateRange` to `ThreadsSentimentReader`**

In `dashboard/lib/threads-sentiment-reader.ts`, add to the interface (after `getForDate`):

```typescript
  getForDateRange(
    startDate: string,
    endDateExclusive: string
  ): Promise<{ keyword: string; date: string; sentiment: SentimentLabel | null }[]>;
```

Add to `SupabaseThreadsSentimentReader`:

```typescript
  async getForDateRange(
    startDate: string,
    endDateExclusive: string
  ): Promise<{ keyword: string; date: string; sentiment: SentimentLabel | null }[]> {
    const { data, error } = await this.client
      .from('topic_social_data')
      .select('keyword, date, sentiment')
      .gte('date', startDate)
      .lt('date', endDateExclusive)
      .limit(5000);
    if (error) throw new Error(error.message);
    if (data && data.length === 5000) {
      console.warn(
        `threads-sentiment-reader: hit the 5000-row limit for range [${startDate}, ${endDateExclusive}) — sentiment counts may be truncated.`
      );
    }
    return (data ?? []) as { keyword: string; date: string; sentiment: SentimentLabel | null }[];
  }
```

- [ ] **Step 5: Add both methods to the Fakes**

In `dashboard/tests/fakes/fake-candidate-topics-reader.ts`, add:

```typescript
  async getHistoryForKeyword(keyword: string, startDate: string, endDateExclusive: string): Promise<CandidateTopic[]> {
    return this.candidates.filter((c) => c.keyword === keyword && c.date >= startDate && c.date < endDateExclusive);
  }
```

In `dashboard/tests/fakes/fake-threads-sentiment-reader.ts`, add (note: the Fake's constructor already stores rows with a `date` field, so this is a straightforward filter):

```typescript
  async getForDateRange(
    startDate: string,
    endDateExclusive: string
  ): Promise<{ keyword: string; date: string; sentiment: SentimentLabel | null }[]> {
    return this.rows.filter((r) => r.date >= startDate && r.date < endDateExclusive);
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- topic-detail-readers`
Expected: PASS (2 tests).

- [ ] **Step 7: Run the full test suite**

Run: `npm test`
Expected: PASS — these are additive interface changes, nothing else should break.

- [ ] **Step 8: Commit**

```bash
git add dashboard/lib/candidate-topics-reader.ts dashboard/lib/threads-sentiment-reader.ts dashboard/tests/fakes/fake-candidate-topics-reader.ts dashboard/tests/fakes/fake-threads-sentiment-reader.ts dashboard/tests/topic-detail-readers.test.ts
git commit -m "feat: add getHistoryForKeyword and ThreadsSentimentReader.getForDateRange"
```

---

### Task 2: `hot-topics.ts` — category passthrough + `flattenAndRankHotTopics`

**Files:**
- Modify: `dashboard/lib/hot-topics.ts`
- Create: `dashboard/lib/trending.ts`
- Create: `dashboard/tests/trending.test.ts`
- Modify: `dashboard/tests/hot-topics.test.ts` (add new tests only — do not change any existing test)

**Interfaces:**
- Consumes: `EnrichedHotTopicRow` from `dashboard/lib/topic-engagement.ts` (existing, unchanged file — `EnrichedHotTopicRow extends HotTopicRow`, so it automatically inherits the new optional field added below with no code change to `topic-engagement.ts`).
- Produces (used by Task 6):
  - `HotTopicRow` gains a new OPTIONAL field: `categoryHint?: string[]` — the source candidate's raw `category_hint`, passed through so the UI can show a category badge on the unified Trending Now table (where rows from every category are mixed together, unlike the per-category sector pages).
  - `flattenAndRankHotTopics(bySource: Record<CandidateTopic['source'], EnrichedHotTopicRow[]>): EnrichedHotTopicRow[]` — new, exported from `dashboard/lib/trending.ts`.

- [ ] **Step 1: Write the failing tests**

Create `dashboard/tests/trending.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { flattenAndRankHotTopics } from '../lib/trending';
import type { EnrichedHotTopicRow } from '../lib/topic-engagement';

function row(overrides: Partial<EnrichedHotTopicRow> = {}): EnrichedHotTopicRow {
  return {
    id: 'r-1',
    source: 'rss',
    keyword: 'bitcoin',
    metricValue: 10,
    trendingScore: 50,
    shareOfVoice: 10,
    engagement: null,
    ...overrides,
  };
}

describe('flattenAndRankHotTopics', () => {
  it('flattens all sources into one array', () => {
    const bySource = {
      google_trends: [row({ id: 'a' })],
      youtube: [row({ id: 'b' })],
      rss: [row({ id: 'c' })],
    };
    const result = flattenAndRankHotTopics(bySource);
    expect(result.map((r) => r.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('sorts by trendingScore descending', () => {
    const bySource = {
      google_trends: [row({ id: 'low', trendingScore: 10 })],
      youtube: [row({ id: 'high', trendingScore: 90 })],
      rss: [],
    };
    const result = flattenAndRankHotTopics(bySource);
    expect(result.map((r) => r.id)).toEqual(['high', 'low']);
  });

  it('puts null trendingScore rows last, then breaks ties by metricValue descending', () => {
    const bySource = {
      google_trends: [row({ id: 'null-low', trendingScore: null, metricValue: 5 })],
      youtube: [row({ id: 'has-score', trendingScore: 20 })],
      rss: [row({ id: 'null-high', trendingScore: null, metricValue: 50 })],
    };
    const result = flattenAndRankHotTopics(bySource);
    expect(result.map((r) => r.id)).toEqual(['has-score', 'null-high', 'null-low']);
  });
});
```

Add these new tests to `dashboard/tests/hot-topics.test.ts` — append at the end of the file, do not modify any existing `describe`/`it` block:

```typescript
describe('categoryHint passthrough', () => {
  it('buildHotTopicsForCategory carries category_hint through onto each row', () => {
    const c = candidate({ id: 'a', category_hint: ['tai_chinh', 'giai_tri'] });
    const result = buildHotTopicsForCategory([c], 'tai_chinh');
    expect(result.rss[0].categoryHint).toEqual(['tai_chinh', 'giai_tri']);
  });

  it('buildHotTopicsOverview carries category_hint through onto each row', () => {
    const c = candidate({ id: 'a', category_hint: ['du_lich'] });
    const result = buildHotTopicsOverview([c], ['tai_chinh', 'giai_tri', 'du_lich']);
    expect(result.rss[0].categoryHint).toEqual(['du_lich']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- trending hot-topics`
Expected: FAIL — `dashboard/lib/trending.ts` doesn't exist yet, and `categoryHint` is `undefined` on the existing rows (the new `hot-topics.test.ts` assertions fail).

- [ ] **Step 3: Add `categoryHint` to `HotTopicRow` and populate it in both builders**

In `dashboard/lib/hot-topics.ts`, find the `HotTopicRow` interface:

```typescript
export interface HotTopicRow {
  id: string;
  source: CandidateTopic['source'];
  keyword: string;
  metricValue: number;
  trendingScore: number | null;
  shareOfVoice: number | null;
}
```

Replace with:

```typescript
export interface HotTopicRow {
  id: string;
  source: CandidateTopic['source'];
  keyword: string;
  metricValue: number;
  trendingScore: number | null;
  shareOfVoice: number | null;
  categoryHint?: string[]; // the source candidate's raw category_hint — optional
  // because existing callers (e.g. groupBySource's own tests) construct
  // HotTopicRow literals without it; only Trending Now's unified view needs it.
}
```

In `buildHotTopicsForCategory`, find:

```typescript
  const rows: HotTopicRow[] = shortlisted.map((c) => ({
    id: c.id,
    source: c.source,
    keyword: c.keyword,
    metricValue: c.metric_value,
    trendingScore: computeTrendingScore(c),
    shareOfVoice: shareMap.get(c.id) ?? null,
  }));
```

Replace with:

```typescript
  const rows: HotTopicRow[] = shortlisted.map((c) => ({
    id: c.id,
    source: c.source,
    keyword: c.keyword,
    metricValue: c.metric_value,
    trendingScore: computeTrendingScore(c),
    shareOfVoice: shareMap.get(c.id) ?? null,
    categoryHint: c.category_hint,
  }));
```

In `buildHotTopicsOverview`, find:

```typescript
    return {
      id: c.id,
      source: c.source,
      keyword: c.keyword,
      metricValue: c.metric_value,
      trendingScore: computeTrendingScore(c),
      shareOfVoice,
    };
```

Replace with:

```typescript
    return {
      id: c.id,
      source: c.source,
      keyword: c.keyword,
      metricValue: c.metric_value,
      trendingScore: computeTrendingScore(c),
      shareOfVoice,
      categoryHint: c.category_hint,
    };
```

- [ ] **Step 4: Create `dashboard/lib/trending.ts`**

```typescript
import type { EnrichedHotTopicRow } from './topic-engagement';
import type { CandidateTopic } from './types';

// Gộp bySource (dùng cho Overview/sector pages, chia theo 3 nguồn) thành 1
// mảng duy nhất cho Trending Now — sort theo trendingScore desc (null cuối
// cùng), rồi theo metricValue desc khi trendingScore bằng nhau hoặc đều null.
export function flattenAndRankHotTopics(
  bySource: Record<CandidateTopic['source'], EnrichedHotTopicRow[]>
): EnrichedHotTopicRow[] {
  const sources = Object.keys(bySource) as CandidateTopic['source'][];
  const all = sources.flatMap((source) => bySource[source]);
  return [...all].sort((a, b) => {
    if (a.trendingScore === null && b.trendingScore === null) return b.metricValue - a.metricValue;
    if (a.trendingScore === null) return 1;
    if (b.trendingScore === null) return -1;
    if (a.trendingScore !== b.trendingScore) return b.trendingScore - a.trendingScore;
    return b.metricValue - a.metricValue;
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- trending hot-topics`
Expected: PASS.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS — `categoryHint` is optional so every existing `HotTopicRow`/`EnrichedHotTopicRow` literal in other test files (e.g. `groupBySource`'s inline test fixtures) still type-checks without it.

- [ ] **Step 7: Commit**

```bash
git add dashboard/lib/hot-topics.ts dashboard/lib/trending.ts dashboard/tests/trending.test.ts dashboard/tests/hot-topics.test.ts
git commit -m "feat: add flattenAndRankHotTopics, pass category_hint through onto HotTopicRow"
```

---

### Task 3: Pure logic — `topic-detail.ts`

**Files:**
- Create: `dashboard/lib/topic-detail.ts`
- Create: `dashboard/tests/topic-detail.test.ts`

**Interfaces:**
- Consumes: `CandidateTopic`, `ThreadsEngagementDaily`, `SentimentLabel` (existing types); `computeTrendingScore` (existing, `dashboard/lib/hot-topics.ts`); `threadsEngagementTotal` (existing, `dashboard/lib/topic-engagement.ts`).
- Produces (used by Task 4):
  - `interface TopicDetailData { keyword: string; category: string | null; sources: CandidateTopic['source'][]; trendingScoreTimeline: { date: string; score: number | null }[]; engagementTimeline: { date: string; totalEngagement: number; postCount: number }[]; sentimentTimeline: { date: string; positive: number; negative: number; neutral: number }[] }`
  - `computeTopicDetail(keyword: string, candidateHistory: CandidateTopic[], threadsEngagementRows: ThreadsEngagementDaily[], threadsSentimentRows: { keyword: string; date: string; sentiment: SentimentLabel | null }[], dates: string[]): TopicDetailData | null`

**Design note (category resolution):** uses the exact same order-independent pattern as `dashboard/lib/topic-movers.ts`'s `aggregateByKeyword` (fixed in sub-project B's final review) — tracks the date of whichever candidate row last supplied a non-empty `category_hint`, so the result never depends on which row the Supabase query happens to return first.

- [ ] **Step 1: Write the failing test**

Create `dashboard/tests/topic-detail.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computeTopicDetail } from '../lib/topic-detail';
import type { CandidateTopic, ThreadsEngagementDaily } from '../lib/types';

function candidate(overrides: Partial<CandidateTopic> = {}): CandidateTopic {
  return {
    id: 'c-1',
    source: 'rss',
    keyword: 'bitcoin',
    date: '2026-08-18',
    metric_value: 10,
    growth_rate: 0.5,
    category_hint: ['tai_chinh'],
    is_shortlisted: true,
    ...overrides,
  };
}

function threadsRow(overrides: Partial<ThreadsEngagementDaily> = {}): ThreadsEngagementDaily {
  return {
    date: '2026-08-18',
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

describe('computeTopicDetail', () => {
  it('returns null when there is no data at all for this keyword', () => {
    const result = computeTopicDetail('nonexistent', [], [], [], ['2026-08-18']);
    expect(result).toBeNull();
  });

  it('produces one timeline point per date, with null score on days with no candidate row', () => {
    const result = computeTopicDetail(
      'bitcoin',
      [candidate({ date: '2026-08-18', metric_value: 10, growth_rate: 0.5 })],
      [],
      [],
      ['2026-08-17', '2026-08-18']
    );
    expect(result?.trendingScoreTimeline).toEqual([
      { date: '2026-08-17', score: null },
      { date: '2026-08-18', score: 50 },
    ]);
  });

  it('resolves score from the highest metric_value candidate when multiple sources share a day', () => {
    const result = computeTopicDetail(
      'bitcoin',
      [
        candidate({ id: 'a', date: '2026-08-18', metric_value: 5, growth_rate: 0.1, source: 'rss' }),
        candidate({ id: 'b', date: '2026-08-18', metric_value: 20, growth_rate: 0.9, source: 'youtube' }),
      ],
      [],
      [],
      ['2026-08-18']
    );
    expect(result?.trendingScoreTimeline[0].score).toBe(90);
  });

  it('resolves category order-independently regardless of row order (regression, mirrors topic-movers.ts fix)', () => {
    const newestNoCategory = candidate({ date: '2026-08-19', category_hint: [] });
    const olderWithCategory = candidate({ date: '2026-08-18', category_hint: ['tai_chinh'] });

    const forward = computeTopicDetail('bitcoin', [newestNoCategory, olderWithCategory], [], [], []);
    const reversed = computeTopicDetail('bitcoin', [olderWithCategory, newestNoCategory], [], [], []);

    expect(forward?.category).toBe('tai_chinh');
    expect(reversed?.category).toBe('tai_chinh');
  });

  it('collects distinct sources in first-seen order', () => {
    const result = computeTopicDetail(
      'bitcoin',
      [
        candidate({ date: '2026-08-18', source: 'rss' }),
        candidate({ date: '2026-08-19', source: 'youtube' }),
        candidate({ date: '2026-08-20', source: 'rss' }),
      ],
      [],
      [],
      []
    );
    expect(result?.sources).toEqual(['rss', 'youtube']);
  });

  it('sums engagement per day across multiple rows and defaults to 0 on days with none', () => {
    const result = computeTopicDetail(
      'bitcoin',
      [],
      [
        threadsRow({ date: '2026-08-18', total_like_count: 10, post_count: 1 }),
        threadsRow({ date: '2026-08-18', total_like_count: 5, post_count: 1 }),
      ],
      [],
      ['2026-08-17', '2026-08-18']
    );
    expect(result?.engagementTimeline).toEqual([
      { date: '2026-08-17', totalEngagement: 0, postCount: 0 },
      { date: '2026-08-18', totalEngagement: 15, postCount: 2 },
    ]);
  });

  it('counts sentiment per day, ignoring null sentiment, defaulting to zero counts on days with none', () => {
    const result = computeTopicDetail(
      'bitcoin',
      [],
      [],
      [
        { keyword: 'bitcoin', date: '2026-08-18', sentiment: 'positive' },
        { keyword: 'bitcoin', date: '2026-08-18', sentiment: 'positive' },
        { keyword: 'bitcoin', date: '2026-08-18', sentiment: 'negative' },
        { keyword: 'bitcoin', date: '2026-08-18', sentiment: null },
      ],
      ['2026-08-17', '2026-08-18']
    );
    expect(result?.sentimentTimeline).toEqual([
      { date: '2026-08-17', positive: 0, negative: 0, neutral: 0 },
      { date: '2026-08-18', positive: 2, negative: 1, neutral: 0 },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- topic-detail`
Expected: FAIL — `dashboard/lib/topic-detail.ts` doesn't exist yet. (Note: this will also match `topic-detail-readers.test.ts` from Task 1 — both should pass once Task 1 is done and this step's failure is specifically about the missing module.)

- [ ] **Step 3: Implement `topic-detail.ts`**

Create `dashboard/lib/topic-detail.ts`:

```typescript
import { computeTrendingScore } from './hot-topics';
import { threadsEngagementTotal } from './topic-engagement';
import type { CandidateTopic, ThreadsEngagementDaily, SentimentLabel } from './types';

export interface TopicDetailData {
  keyword: string;
  category: string | null;
  sources: CandidateTopic['source'][];
  trendingScoreTimeline: { date: string; score: number | null }[];
  engagementTimeline: { date: string; totalEngagement: number; postCount: number }[];
  sentimentTimeline: { date: string; positive: number; negative: number; neutral: number }[];
}

// Order-independent category resolution — same approach as topic-movers.ts's
// aggregateByKeyword fix (final review, sub-project B): track the date of
// whichever row last supplied a non-empty category_hint, independent of
// array/query order, so results don't depend on which row Supabase happens
// to return first.
function resolveCategory(candidateHistory: CandidateTopic[]): string | null {
  let category: string | null = null;
  let categoryDate: string | null = null;
  for (const c of candidateHistory) {
    const candidateCategory = c.category_hint[0] ?? null;
    if (candidateCategory === null) continue;
    if (categoryDate === null || c.date >= categoryDate) {
      category = candidateCategory;
      categoryDate = c.date;
    }
  }
  return category;
}

function resolveSources(candidateHistory: CandidateTopic[]): CandidateTopic['source'][] {
  const seen = new Set<CandidateTopic['source']>();
  const result: CandidateTopic['source'][] = [];
  for (const c of candidateHistory) {
    if (!seen.has(c.source)) {
      seen.add(c.source);
      result.push(c.source);
    }
  }
  return result;
}

export function computeTopicDetail(
  keyword: string,
  candidateHistory: CandidateTopic[],
  threadsEngagementRows: ThreadsEngagementDaily[],
  threadsSentimentRows: { keyword: string; date: string; sentiment: SentimentLabel | null }[],
  dates: string[]
): TopicDetailData | null {
  if (candidateHistory.length === 0 && threadsEngagementRows.length === 0) {
    return null;
  }

  const trendingScoreTimeline = dates.map((date) => {
    const dayCandidates = candidateHistory.filter((c) => c.date === date);
    if (dayCandidates.length === 0) return { date, score: null };
    const best = dayCandidates.reduce((max, c) => (c.metric_value > max.metric_value ? c : max));
    return { date, score: computeTrendingScore(best) };
  });

  const engagementTimeline = dates.map((date) => {
    const dayRows = threadsEngagementRows.filter((r) => r.date === date);
    return {
      date,
      totalEngagement: dayRows.reduce((sum, r) => sum + threadsEngagementTotal(r), 0),
      postCount: dayRows.reduce((sum, r) => sum + r.post_count, 0),
    };
  });

  const sentimentTimeline = dates.map((date) => {
    const dayRows = threadsSentimentRows.filter((r) => r.date === date);
    const counts = { positive: 0, negative: 0, neutral: 0 };
    for (const r of dayRows) {
      if (r.sentiment === 'positive' || r.sentiment === 'negative' || r.sentiment === 'neutral') {
        counts[r.sentiment] += 1;
      }
    }
    return { date, ...counts };
  });

  return {
    keyword,
    category: resolveCategory(candidateHistory),
    sources: resolveSources(candidateHistory),
    trendingScoreTimeline,
    engagementTimeline,
    sentimentTimeline,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- topic-detail`
Expected: PASS (7 tests in `topic-detail.test.ts`).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add dashboard/lib/topic-detail.ts dashboard/tests/topic-detail.test.ts
git commit -m "feat: add computeTopicDetail (trending score / engagement / sentiment timelines per keyword)"
```

---

### Task 4: Orchestration — `get-topic-detail.ts`

**Files:**
- Create: `dashboard/lib/get-topic-detail.ts`
- Create: `dashboard/tests/get-topic-detail.test.ts`

**Interfaces:**
- Consumes: `CandidateTopicsReader.getHistoryForKeyword` (Task 1), `ThreadsEngagementReader.getForDateRange` (existing, sub-project B), `ThreadsSentimentReader.getForDateRange` (Task 1), `computeTopicDetail`/`TopicDetailData` (Task 3).
- Produces (used by Task 7): `getTopicDetail(candidateReader, threadsEngagementReader, threadsSentimentReader, keyword: string, latestDate: string): Promise<TopicDetailData | null>`.

- [ ] **Step 1: Write the failing test**

Create `dashboard/tests/get-topic-detail.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { getTopicDetail } from '../lib/get-topic-detail';
import { FakeCandidateTopicsReader } from './fakes/fake-candidate-topics-reader';
import { FakeThreadsEngagementReader } from './fakes/fake-threads-engagement-reader';
import { FakeThreadsSentimentReader } from './fakes/fake-threads-sentiment-reader';
import type { CandidateTopic } from '../lib/types';

function candidate(overrides: Partial<CandidateTopic> = {}): CandidateTopic {
  return {
    id: 'c-1',
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

describe('getTopicDetail', () => {
  it('fetches the 7-day range ending on latestDate and filters engagement/sentiment rows to the requested keyword', async () => {
    const candidateReader = new FakeCandidateTopicsReader([
      candidate({ keyword: 'bitcoin', date: '2026-08-24' }),
      candidate({ keyword: 'bitcoin', date: '2026-08-17' }), // out of range
    ]);
    const threadsReader = new FakeThreadsEngagementReader([
      {
        date: '2026-08-24', keyword: 'bitcoin', category: 'tai_chinh',
        total_like_count: 10, total_reply_count: 0, total_repost_count: 0,
        total_quote_count: 0, total_share_count: 0, total_view_count: 0, post_count: 1,
      },
      {
        date: '2026-08-24', keyword: 'ethereum', category: 'tai_chinh',
        total_like_count: 999, total_reply_count: 0, total_repost_count: 0,
        total_quote_count: 0, total_share_count: 0, total_view_count: 0, post_count: 1,
      },
    ]);
    const sentimentReader = new FakeThreadsSentimentReader([
      { date: '2026-08-24', keyword: 'bitcoin', sentiment: 'positive' },
      { date: '2026-08-24', keyword: 'ethereum', sentiment: 'negative' },
    ]);

    const result = await getTopicDetail(candidateReader, threadsReader, sentimentReader, 'bitcoin', '2026-08-24');

    expect(result?.trendingScoreTimeline).toHaveLength(7);
    expect(result?.trendingScoreTimeline[6]).toEqual({ date: '2026-08-24', score: 50 });
    expect(result?.engagementTimeline[6].totalEngagement).toBe(10);
    expect(result?.sentimentTimeline[6]).toEqual({ date: '2026-08-24', positive: 1, negative: 0, neutral: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- get-topic-detail`
Expected: FAIL — `dashboard/lib/get-topic-detail.ts` doesn't exist yet.

- [ ] **Step 3: Implement `get-topic-detail.ts`**

Create `dashboard/lib/get-topic-detail.ts`:

```typescript
import type { CandidateTopicsReader } from './candidate-topics-reader';
import type { ThreadsEngagementReader } from './threads-engagement-reader';
import type { ThreadsSentimentReader } from './threads-sentiment-reader';
import { computeTopicDetail, type TopicDetailData } from './topic-detail';

function addDaysUTC(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function getTopicDetail(
  candidateReader: CandidateTopicsReader,
  threadsEngagementReader: ThreadsEngagementReader,
  threadsSentimentReader: ThreadsSentimentReader,
  keyword: string,
  latestDate: string
): Promise<TopicDetailData | null> {
  const startDate = addDaysUTC(latestDate, -6);
  const endDateExclusive = addDaysUTC(latestDate, 1);
  const dates = Array.from({ length: 7 }, (_, i) => addDaysUTC(startDate, i));

  const [candidateHistory, threadsRows, sentimentRows] = await Promise.all([
    candidateReader.getHistoryForKeyword(keyword, startDate, endDateExclusive),
    threadsEngagementReader.getForDateRange(startDate, endDateExclusive),
    threadsSentimentReader.getForDateRange(startDate, endDateExclusive),
  ]);

  const keywordThreadsRows = threadsRows.filter((r) => r.keyword === keyword);
  const keywordSentimentRows = sentimentRows.filter((r) => r.keyword === keyword);

  return computeTopicDetail(keyword, candidateHistory, keywordThreadsRows, keywordSentimentRows, dates);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- get-topic-detail`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add dashboard/lib/get-topic-detail.ts dashboard/tests/get-topic-detail.test.ts
git commit -m "feat: add getTopicDetail orchestration"
```

---

### Task 5: Extract shared formatters — `hot-topic-format.ts`

**Files:**
- Create: `dashboard/lib/hot-topic-format.ts`
- Modify: `dashboard/components/HotTopicsSection.tsx`
- Create: `dashboard/tests/hot-topic-format.test.ts`

**Interfaces:**
- Produces (used by Task 6): `SOURCE_LABELS: Record<CandidateTopic['source'], string>`, `formatPercent(value: number | null): string`, `formatTrendingScore(value: number | null): string`, `sentimentBadgeClass(index: number): string`, `formatSentimentBadge(index: number): string` — all moved verbatim from `HotTopicsSection.tsx`, behavior unchanged.

- [ ] **Step 1: Write the failing test**

Create `dashboard/tests/hot-topic-format.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  SOURCE_LABELS,
  formatPercent,
  formatTrendingScore,
  sentimentBadgeClass,
  formatSentimentBadge,
} from '../lib/hot-topic-format';

describe('SOURCE_LABELS', () => {
  it('has a Vietnamese-friendly label for every discovery source', () => {
    expect(SOURCE_LABELS.google_trends).toBe('Google Trends');
    expect(SOURCE_LABELS.youtube).toBe('YouTube');
    expect(SOURCE_LABELS.rss).toBe('RSS');
  });
});

describe('formatPercent', () => {
  it('formats a number to 1 decimal with a % sign', () => {
    expect(formatPercent(12.345)).toBe('12.3%');
  });
  it('renders null as an em dash', () => {
    expect(formatPercent(null)).toBe('—');
  });
});

describe('formatTrendingScore', () => {
  it('formats a normal score to 1 decimal with a % sign', () => {
    expect(formatTrendingScore(50)).toBe('50.0%');
  });
  it('renders the 99900 sentinel as "Mới"', () => {
    expect(formatTrendingScore(99900)).toBe('Mới');
  });
  it('renders null as an em dash', () => {
    expect(formatTrendingScore(null)).toBe('—');
  });
});

describe('sentimentBadgeClass', () => {
  it('returns success classes for a positive index', () => {
    expect(sentimentBadgeClass(5)).toBe('bg-success-bg text-success');
  });
  it('returns danger classes for a negative index', () => {
    expect(sentimentBadgeClass(-5)).toBe('bg-danger-bg text-danger');
  });
  it('returns neutral classes for a zero index', () => {
    expect(sentimentBadgeClass(0)).toBe('bg-muted text-ink-3');
  });
});

describe('formatSentimentBadge', () => {
  it('prefixes a positive index with a plus sign', () => {
    expect(formatSentimentBadge(5)).toBe('Sentiment +5');
  });
  it('shows a negative index as-is (already has a minus sign)', () => {
    expect(formatSentimentBadge(-5)).toBe('Sentiment -5');
  });
  it('shows a zero index as "Sentiment 0"', () => {
    expect(formatSentimentBadge(0)).toBe('Sentiment 0');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- hot-topic-format`
Expected: FAIL — `dashboard/lib/hot-topic-format.ts` doesn't exist yet.

- [ ] **Step 3: Create `hot-topic-format.ts`**

Create `dashboard/lib/hot-topic-format.ts`:

```typescript
import type { CandidateTopic } from './types';

export const SOURCE_LABELS: Record<CandidateTopic['source'], string> = {
  google_trends: 'Google Trends',
  youtube: 'YouTube',
  rss: 'RSS',
};

export function formatPercent(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}%`;
}

// growth_rate = 999 is the ingestion pipeline's sentinel for "no prior-week
// baseline" (see rank-and-select.ts). computeTrendingScore multiplies by
// 100, so it shows up here as exactly 99900. Render it as "Mới" (new)
// instead of a nonsense percentage.
export function formatTrendingScore(value: number | null): string {
  if (value === null) return '—';
  if (value === 99900) return 'Mới';
  return `${value.toFixed(1)}%`;
}

export function sentimentBadgeClass(index: number): string {
  if (index > 0) return 'bg-success-bg text-success';
  if (index < 0) return 'bg-danger-bg text-danger';
  return 'bg-muted text-ink-3';
}

export function formatSentimentBadge(index: number): string {
  if (index > 0) return `Sentiment +${index}`;
  if (index < 0) return `Sentiment ${index}`;
  return 'Sentiment 0';
}
```

- [ ] **Step 4: Update `HotTopicsSection.tsx` to import from the new file**

In `dashboard/components/HotTopicsSection.tsx`, replace the top of the file (everything from the imports through the last local function definition, i.e. lines 1–34) with:

```tsx
import type { EnrichedHotTopicRow } from '../lib/topic-engagement';
import type { CandidateTopic } from '../lib/types';
import { SOURCE_LABELS, formatPercent, formatTrendingScore, sentimentBadgeClass, formatSentimentBadge } from '../lib/hot-topic-format';
```

(Everything from `export function HotTopicsSection({` onward stays exactly as it is — the function bodies already reference `SOURCE_LABELS`, `formatTrendingScore`, `formatPercent`, `sentimentBadgeClass`, `formatSentimentBadge` by name, so once these are imported instead of locally defined, no other line in the file changes.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- hot-topic-format`
Expected: PASS (11 tests).

- [ ] **Step 6: Run the full suite and the build**

Run: `npm test`
Expected: PASS.

Run: `npm run build`
Expected: Succeeds — confirms `HotTopicsSection.tsx` still compiles correctly after the import swap.

- [ ] **Step 7: Commit**

```bash
git add dashboard/lib/hot-topic-format.ts dashboard/components/HotTopicsSection.tsx dashboard/tests/hot-topic-format.test.ts
git commit -m "refactor: extract hot-topic display formatters into a shared module"
```

---

### Task 6: UI components — `TrendingTable.tsx`, `SingleLineChart.tsx`

**Files:**
- Create: `dashboard/components/TrendingTable.tsx`
- Create: `dashboard/components/SingleLineChart.tsx`

**Interfaces:**
- Consumes: `EnrichedHotTopicRow` (with the new optional `categoryHint` from Task 2), `CATEGORIES` (existing), `SOURCE_LABELS`/`formatTrendingScore`/`sentimentBadgeClass`/`formatSentimentBadge` (Task 5).
- Produces (used by Task 7): `<TrendingTable rows={EnrichedHotTopicRow[]} />`, `<SingleLineChart data={{date:string; value:number|null}[]} color={string} />`.
- No tests for this task — components are not unit-tested in this project (see `dashboard/components/DonutChart.tsx`, `BuzzTrendChart.tsx`, neither has a test file).

**Design note (category badge, WCAG):** same pattern as `TopicMoversSection.tsx` (sub-project B) — category color goes ONLY on a small decorative dot, never as text color, to avoid the WCAG contrast bug this project has hit repeatedly (`tai_chinh`'s raw color fails AA as text).

**Design note (`SingleLineChart` NaN guard):** must guard `data.length <= 1` in its empty-state check, not just `=== 0` — see this plan's Global Constraints (mirrors the fix already applied to `BuzzTrendChart.tsx` in sub-project B).

- [ ] **Step 1: Create `TrendingTable.tsx`**

Create `dashboard/components/TrendingTable.tsx`:

```tsx
import Link from 'next/link';
import { CATEGORIES } from '../lib/categories';
import { SOURCE_LABELS, formatTrendingScore, sentimentBadgeClass, formatSentimentBadge } from '../lib/hot-topic-format';
import type { EnrichedHotTopicRow } from '../lib/topic-engagement';

function categoryMeta(categoryHint: string[] | undefined) {
  const value = categoryHint?.[0];
  return CATEGORIES.find((c) => c.value === value);
}

export function TrendingTable({ rows }: { rows: EnrichedHotTopicRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-ink-3 text-center py-12">Chưa có dữ liệu trending.</p>;
  }

  return (
    <div className="bg-surface border border-line rounded-card shadow-card overflow-hidden">
      <div className="divide-y divide-line">
        {rows.map((row, i) => {
          const meta = categoryMeta(row.categoryHint);
          return (
            <Link
              key={row.id}
              href={`/topic/${encodeURIComponent(row.keyword)}`}
              className="flex items-center gap-4 px-6 py-4 hover:bg-muted transition-colors group"
            >
              <span className="w-6 text-center text-xs font-bold text-ink-3 flex-shrink-0">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-ink truncate group-hover:text-brand transition-colors">
                  {row.keyword}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  {meta && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-ink-3">
                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: meta.color }} />
                      {meta.label}
                    </span>
                  )}
                  <span className="text-[11px] text-ink-3">{SOURCE_LABELS[row.source]}</span>
                </div>
              </div>
              <span className="text-xs font-bold text-ink-2 whitespace-nowrap flex-shrink-0">
                {formatTrendingScore(row.trendingScore)}
              </span>
              {row.engagement && row.engagement.sentimentIndex !== null ? (
                <span
                  className={`text-xs rounded-full px-2 py-0.5 whitespace-nowrap flex-shrink-0 ${sentimentBadgeClass(row.engagement.sentimentIndex)}`}
                >
                  {formatSentimentBadge(row.engagement.sentimentIndex)}
                </span>
              ) : (
                <span className="text-xs text-ink-3 w-20 text-right flex-shrink-0">—</span>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `SingleLineChart.tsx`**

Create `dashboard/components/SingleLineChart.tsx`:

```tsx
const H = 100;
const W = 400;
const PAD = { top: 6, bottom: 20, left: 4, right: 4 };

export function SingleLineChart({
  data,
  color,
}: {
  data: { date: string; value: number | null }[];
  color: string;
}) {
  if (data.length <= 1 || data.every((d) => d.value === null)) {
    return (
      <div className="flex items-center justify-center text-sm text-ink-3" style={{ height: H + 26 }}>
        Chưa có dữ liệu
      </div>
    );
  }

  const values = data.map((d) => d.value).filter((v): v is number => v !== null);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;

  const chartH = H - PAD.top - PAD.bottom;
  const chartW = W - PAD.left - PAD.right;
  const toX = (i: number) => PAD.left + (i / (data.length - 1)) * chartW;
  const toY = (v: number) => PAD.top + chartH - ((v - min) / range) * chartH;

  // Build the line path from only the non-null points, so a day with no
  // data leaves a visible gap in the line instead of being drawn as 0.
  let path = '';
  data.forEach((d, i) => {
    if (d.value === null) return;
    path += `${path === '' ? 'M' : 'L'} ${toX(i)} ${toY(d.value)} `;
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H + 6 }} aria-hidden="true">
      <path d={path.trim()} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {data.map((d, i) =>
        d.value === null ? null : <circle key={i} cx={toX(i)} cy={toY(d.value)} r={2} fill={color} />
      )}
      {data.map((d, i) => (
        <text key={i} x={toX(i)} y={H - 2} textAnchor="middle" fontSize={9} fill="var(--color-ink-3)">
          {d.date.slice(5)}
        </text>
      ))}
    </svg>
  );
}
```

- [ ] **Step 3: Run the full test suite and the build**

Run: `npm test`
Expected: PASS — no new tests, nothing else should be affected.

Run: `npm run build`
Expected: Succeeds — no TypeScript/JSX errors in either new component (both are currently unused by any page, which is fine — Task 7 wires them in).

- [ ] **Step 4: Commit**

```bash
git add dashboard/components/TrendingTable.tsx dashboard/components/SingleLineChart.tsx
git commit -m "feat: add TrendingTable and SingleLineChart components"
```

---

### Task 7: Pages — `/trending`, `/topic/[keyword]`, Sidebar nav, `TopicMoversSection` link update

**Files:**
- Create: `dashboard/app/trending/page.tsx`
- Create: `dashboard/app/topic/[keyword]/page.tsx`
- Modify: `dashboard/components/layout/Sidebar.tsx`
- Modify: `dashboard/components/TopicMoversSection.tsx`

**Interfaces:**
- Consumes: `getHotTopics`/`enrichHotTopicsWithThreadsData`/`withoutEngagement` (existing), `flattenAndRankHotTopics` (Task 2), `getTopicDetail`/`TopicDetailData` (Tasks 3–4), `TrendingTable`/`SingleLineChart` (Task 6), `computeSentimentIndex` (existing, `dashboard/lib/topic-engagement.ts`), `SOURCE_LABELS` (Task 5), `CATEGORIES`/`getCategoryBySlug` (existing).
- No tests for this task — Server Component pages are not unit-tested (matches `app/page.tsx`, `app/[slug]/page.tsx`, `app/analytics/page.tsx`, none of which have a test file).

- [ ] **Step 1: Create `dashboard/app/trending/page.tsx`**

```tsx
import Link from 'next/link';
import { createServerSupabaseClient } from '../../lib/supabase';
import { SupabaseCandidateTopicsReader } from '../../lib/candidate-topics-reader';
import { SupabaseThreadsEngagementReader } from '../../lib/threads-engagement-reader';
import { SupabaseThreadsSentimentReader } from '../../lib/threads-sentiment-reader';
import { getHotTopics, type HotTopicsResult } from '../../lib/get-hot-topics';
import { enrichHotTopicsWithThreadsData } from '../../lib/get-topic-engagement';
import { withoutEngagement } from '../../lib/topic-engagement';
import { flattenAndRankHotTopics } from '../../lib/trending';
import { CATEGORIES } from '../../lib/categories';
import { TrendingTable } from '../../components/TrendingTable';
import { Topbar } from '../../components/layout/Topbar';
import type { CandidateTopic } from '../../lib/types';
import type { HotTopicRow } from '../../lib/hot-topics';

export const dynamic = 'force-dynamic';

const FILTER_OPTIONS: { value: string | null; label: string }[] = [
  { value: null, label: 'Tất cả' },
  ...CATEGORIES.map((c) => ({ value: c.value, label: c.label })),
];

async function loadHotTopics(category: string | null): Promise<HotTopicsResult | { error: string }> {
  try {
    const client = createServerSupabaseClient();
    return await getHotTopics(new SupabaseCandidateTopicsReader(client), category);
  } catch (err) {
    console.error(err);
    return { error: 'Không tải được dữ liệu trending, vui lòng thử lại sau.' };
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

export default async function TrendingPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const { category: categoryParam } = await searchParams;
  const category = CATEGORIES.some((c) => c.value === categoryParam) ? (categoryParam as string) : null;

  const hotTopics = await loadHotTopics(category);

  const threadsEnrichedBySource =
    'error' in hotTopics ? null : await loadThreadsEngagement(hotTopics.bySource, hotTopics.date);

  return (
    <>
      <Topbar title="Trending Now" />
      <main className="max-w-4xl mx-auto p-6">
        <div className="flex gap-2 flex-wrap mb-6">
          {FILTER_OPTIONS.map((opt) => (
            <Link
              key={opt.label}
              href={opt.value === null ? '/trending' : `/trending?category=${opt.value}`}
              className={`px-4 py-1.5 rounded-btn text-sm font-semibold border transition-colors ${
                category === opt.value
                  ? 'bg-brand text-white border-brand'
                  : 'bg-surface text-ink-2 border-line hover:bg-muted'
              }`}
            >
              {opt.label}
            </Link>
          ))}
        </div>
        {'error' in hotTopics ? (
          <p className="text-red-600">{hotTopics.error}</p>
        ) : (
          <TrendingTable
            rows={flattenAndRankHotTopics(threadsEnrichedBySource ?? withoutEngagement(hotTopics.bySource))}
          />
        )}
      </main>
    </>
  );
}
```

- [ ] **Step 2: Create `dashboard/app/topic/[keyword]/page.tsx`**

```tsx
import { createServerSupabaseClient } from '../../../lib/supabase';
import { SupabaseCandidateTopicsReader } from '../../../lib/candidate-topics-reader';
import { SupabaseThreadsEngagementReader } from '../../../lib/threads-engagement-reader';
import { SupabaseThreadsSentimentReader } from '../../../lib/threads-sentiment-reader';
import { getTopicDetail } from '../../../lib/get-topic-detail';
import type { TopicDetailData } from '../../../lib/topic-detail';
import { computeSentimentIndex } from '../../../lib/topic-engagement';
import { CATEGORIES } from '../../../lib/categories';
import { SOURCE_LABELS } from '../../../lib/hot-topic-format';
import { SingleLineChart } from '../../../components/SingleLineChart';
import { Topbar } from '../../../components/layout/Topbar';

export const dynamic = 'force-dynamic';

async function loadTopicDetail(keyword: string): Promise<TopicDetailData | null | { error: string }> {
  try {
    const client = createServerSupabaseClient();
    const candidateReader = new SupabaseCandidateTopicsReader(client);
    const latestDate = await candidateReader.getLatestDate();
    if (latestDate === null) return null;
    return await getTopicDetail(
      candidateReader,
      new SupabaseThreadsEngagementReader(client),
      new SupabaseThreadsSentimentReader(client),
      keyword,
      latestDate
    );
  } catch (err) {
    console.error(err);
    return { error: 'Không tải được dữ liệu topic, vui lòng thử lại sau.' };
  }
}

export default async function TopicDetailPage({ params }: { params: Promise<{ keyword: string }> }) {
  const { keyword: encodedKeyword } = await params;
  const keyword = decodeURIComponent(encodedKeyword);
  const detail = await loadTopicDetail(keyword);

  if (detail !== null && 'error' in detail) {
    return (
      <>
        <Topbar title={keyword} />
        <main className="max-w-4xl mx-auto p-6">
          <p className="text-red-600">{detail.error}</p>
        </main>
      </>
    );
  }

  if (detail === null) {
    return (
      <>
        <Topbar title={keyword} />
        <main className="max-w-4xl mx-auto p-6">
          <p className="text-sm text-ink-3">Không tìm thấy topic này.</p>
        </main>
      </>
    );
  }

  const categoryMeta = CATEGORIES.find((c) => c.value === detail.category);

  return (
    <>
      <Topbar title={keyword} color={categoryMeta?.color} />
      <main className="max-w-4xl mx-auto p-6 space-y-6">
        <div className="flex items-center gap-3 flex-wrap">
          {categoryMeta && (
            <span
              className="inline-flex items-center h-6 px-2.5 rounded-badge text-xs font-semibold"
              style={{ background: `${categoryMeta.color}18`, color: categoryMeta.color }}
            >
              {categoryMeta.label}
            </span>
          )}
          {detail.sources.map((source) => (
            <span key={source} className="text-xs text-ink-3">
              {SOURCE_LABELS[source]}
            </span>
          ))}
        </div>

        <div className="bg-surface border border-line rounded-card shadow-card p-6">
          <h2 className="text-base font-bold text-ink mb-4">Trending Score — 7 ngày qua</h2>
          <SingleLineChart
            data={detail.trendingScoreTimeline.map((p) => ({ date: p.date, value: p.score }))}
            color="var(--color-brand)"
          />
        </div>

        <div className="bg-surface border border-line rounded-card shadow-card p-6">
          <h2 className="text-base font-bold text-ink mb-4">Engagement Threads — 7 ngày qua</h2>
          <SingleLineChart
            data={detail.engagementTimeline.map((p) => ({ date: p.date, value: p.totalEngagement }))}
            color="var(--color-brand)"
          />
        </div>

        <div className="bg-surface border border-line rounded-card shadow-card p-6">
          <h2 className="text-base font-bold text-ink mb-4">Sentiment Threads — 7 ngày qua</h2>
          <SingleLineChart
            data={detail.sentimentTimeline.map((p) => ({ date: p.date, value: computeSentimentIndex(p) }))}
            color="var(--color-brand)"
          />
        </div>
      </main>
    </>
  );
}
```

Note: `categoryMeta.color` used as `Topbar`'s `color` prop on a `text-xl font-bold` heading, and as a badge's text color on a tinted background — both patterns are pre-existing and already reviewed elsewhere in this codebase (`Topbar`'s `color` prop: `app/[slug]/page.tsx`; the tinted badge: ver1-parity precedent already accepted for the trending-score badge context in sub-project A's design discussions) — WCAG-safe because the Topbar heading text is large/bold (WCAG large-text 3:1 exemption) and the badge follows the same `${color}18` background convention already used elsewhere in this codebase's category badges. Do not change these two specific usages during review unless a reviewer demonstrates an actual contrast failure with numbers — the badge context here mirrors an already-accepted pattern in this codebase's category chips (`app/[slug]/page.tsx`-style, not the flagged `TopicMoversSection`/`TrendingTable` "dot-only" pattern, which exists specifically because THOSE badges sit inline in dense list rows where the dot-only pattern was chosen — this single header badge is a different, larger, more isolated UI element, closer to a page-level label than a dense-list item).

- [ ] **Step 3: Add the Trending Now nav entry to `Sidebar.tsx`**

In `dashboard/components/layout/Sidebar.tsx`, insert a new `<Link>` between the closing `</Link>` of the Overview link and the opening `<Link href="/analytics"` of the Analytics link (i.e. right after line 46, before the existing Analytics link):

```tsx
          <Link
            href="/trending"
            aria-current={pathname === '/trending' ? 'page' : undefined}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-[10px] text-sm font-medium transition-colors ${
              pathname === '/trending'
                ? 'bg-brand-faint text-brand font-semibold'
                : 'text-ink-2 hover:bg-muted hover:text-ink'
            }`}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" />
            </svg>
            Trending Now
          </Link>
```

(This matches ver1's Sidebar order exactly: Overview, Trending Now, Analytics, all in the "Tổng quan" group.)

- [ ] **Step 4: Update `TopicMoversSection.tsx`'s link to point to Topic Detail**

In `dashboard/components/TopicMoversSection.tsx`, find:

```tsx
          <Link
            key={m.keyword}
            href={meta ? `/${meta.slug}` : '/'}
            className="flex items-center gap-3 p-3 rounded-[10px] hover:bg-muted transition-colors group"
          >
```

Replace with:

```tsx
          <Link
            key={m.keyword}
            href={`/topic/${encodeURIComponent(m.keyword)}`}
            className="flex items-center gap-3 p-3 rounded-[10px] hover:bg-muted transition-colors group"
          >
```

(`meta` is still used elsewhere in the same component for the category dot/label — only this `href` line changes.)

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Run the build**

Run: `npm run build`
Expected: Succeeds, and the build output lists both `/trending` and `/topic/[keyword]` as routes.

- [ ] **Step 7: Commit**

```bash
git add dashboard/app/trending/page.tsx "dashboard/app/topic/[keyword]/page.tsx" dashboard/components/layout/Sidebar.tsx dashboard/components/TopicMoversSection.tsx
git commit -m "feat: add /trending and /topic/[keyword] pages, nav entry, cross-link from Topic Movers"
```

---

## Self-Review Notes (for the plan author, already applied above)

- **Spec coverage:** §1 Trending Now → Task 2 (data) + Task 6/7 (UI/page). §1 Topic Detail → Tasks 1/3/4 (data/logic/orchestration) + Task 6/7 (UI/page). §1 TopicMoversSection link update → Task 7 Step 4. §2 (Trending Now reuse) → Task 2. §3 (Topic Detail readers) → Task 1. §4 (topic-detail.ts) → Task 3, including explicit order-independent category resolution. §5 (UI, incl. shared formatter extraction) → Tasks 5–7. §6 (error handling) → Task 7's try/catch + not-found branch. §7 (testing) → every pure/orchestration task includes its test step; components/pages explicitly note the no-test convention.
- **Placeholder scan:** no TBD/TODO; every step has literal code.
- **Type consistency:** `TopicDetailData`, `HotTopicRow.categoryHint`, and every reader method signature defined once (Tasks 1–3) and reused verbatim in later tasks (Tasks 4, 6, 7) — checked by hand across all 7 tasks.
- **Known, deliberate additions beyond the spec's literal text (both closing real gaps found while writing this plan, not scope creep):**
  1. `HotTopicRow.categoryHint` (Task 2) — the spec's Trending Now table design assumed a category badge per row, but `HotTopicRow` never carried category info (it's stripped out upstream in `buildHotTopicsForCategory`/`buildHotTopicsOverview`). Added as an OPTIONAL field, verified non-breaking against the existing `groupBySource` test's inline literals.
  2. Sidebar nav entry for `/trending` (Task 7 Step 3) — the spec's UI section didn't explicitly list a Sidebar change, but a page with no nav entry is unreachable through normal navigation, which defeats the ver1-parity goal this whole 5-piece plan serves; ver1's own Sidebar has this exact entry in this exact position.
