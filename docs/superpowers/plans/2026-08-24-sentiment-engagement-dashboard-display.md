# Sentiment + Engagement Dashboard Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show sentiment + engagement context (from sub-project 3 phần 1's data) on the existing dashboard — a compact sentiment badge on hot-topic rows that have Threads deep-crawl data, and a Facebook sentiment/engagement summary card on sector pages.

**Architecture:** Dashboard reads raw data live from `threads_engagement_daily`/`facebook_engagement_daily`/`topic_social_data`/`facebook_page_data` via 4 new readers (no backend changes), computes sentiment breakdown + a `-100..+100` sentiment index in pure TypeScript, and attaches it to already-rendered hot-topic rows / a new Facebook summary card.

**Tech Stack:** Next.js 15 (App Router), React 19, Tailwind CSS v4, TypeScript, Vitest, `@supabase/supabase-js`.

**Spec:** `docs/superpowers/specs/2026-08-24-sentiment-engagement-dashboard-display-design.md`

## Global Constraints

- Working directory for all tasks: `dashboard/` (the Next.js app), not the repo root.
- **No backend/migration/GitHub Actions changes** — every task in this plan only reads data sub-project 3 phần 1 already writes.
- **No section/page dedicated to sentiment** — only augment what's already displayed (hot topic rows, a new card on sector pages only — never Overview).
- **Facebook summary card never appears on `app/page.tsx` (Overview)** — only on `app/[slug]/page.tsx` (sector pages), because Facebook data has no per-topic granularity, only per-category.
- **Date used for all 4 new readers is `hotTopics.date`** (already fetched by the existing `getHotTopics()` call) — never a separate "latest date" query against the new tables.
- **Engagement/sentiment load failures never show a red error banner** — unlike `loadHotTopics`/`loadArticles`, a failure here degrades silently to "no engagement data" (`engagement: null` / `summary: null`), only `console.error`'d for debugging.
- **No component tests** — this codebase only unit-tests pure logic and orchestration functions (no `@testing-library/react`, and — specific to this dashboard sub-project, verified in `dashboard/tests/` — no dedicated test file per Fake reader either; fakes are only exercised indirectly through the orchestration function's own test file, exactly like the existing `FakeCandidateTopicsReader`/`get-hot-topics.test.ts` pair).
- **Threads "total engagement" = `like + reply + repost + quote + share`, excluding `view_count`.** **Facebook "total engagement" = `like + comment + share`.**
- New `@theme` tokens (`--color-success`, `--color-success-bg`, `--color-danger`, `--color-danger-bg`) use these exact values, copied from ver1's design-system: `#16a34a` / `#f0fdf4` / `#dc2626` / `#fff1f2`.

---

### Task 1: Types + design tokens

**Files:**
- Modify: `dashboard/lib/types.ts`
- Modify: `dashboard/app/globals.css`

**Interfaces:**
- Produces: `SentimentLabel`, `ThreadsEngagementDaily`, `FacebookEngagementDaily` types — every later task in this plan depends on these existing. Produces `--color-success`/`--color-success-bg`/`--color-danger`/`--color-danger-bg` tokens — Task 8's sentiment badge depends on these.

No test cycle — types + CSS only, verified by `npm run typecheck` and `npm run build`.

- [ ] **Step 1: Add the types**

Add to the end of `dashboard/lib/types.ts`:

```typescript
export type SentimentLabel = 'positive' | 'negative' | 'neutral';

export interface ThreadsEngagementDaily {
  date: string;
  keyword: string;
  category: string | null;
  total_like_count: number;
  total_reply_count: number;
  total_repost_count: number;
  total_quote_count: number;
  total_share_count: number;
  total_view_count: number;
  post_count: number;
}

export interface FacebookEngagementDaily {
  date: string;
  category: string;
  total_like_count: number;
  total_comment_count: number;
  total_share_count: number;
  post_count: number;
}
```

- [ ] **Step 2: Add the design tokens**

In `dashboard/app/globals.css`, inside the existing `@theme { ... }` block, add these 4 lines right after `--color-ink-3: var(--color-text-muted);` and before the blank line that precedes `--radius-card: 16px;`:

```css
  --color-success: #16a34a;
  --color-success-bg: #f0fdf4;
  --color-danger: #dc2626;
  --color-danger-bg: #fff1f2;
```

The `@theme` block must read exactly:

```css
@theme {
  --color-brand: var(--color-brand-primary);
  --color-brand-hover: var(--color-brand-primary-hover);
  --color-brand-faint: var(--color-brand-primary-faint);
  --color-canvas: var(--color-bg-base);
  --color-subtle: var(--color-bg-subtle);
  --color-muted: var(--color-bg-muted);
  --color-surface: var(--color-surface-1);
  --color-line: var(--color-border-light);
  --color-ink: var(--color-text-primary);
  --color-ink-2: var(--color-text-secondary);
  --color-ink-3: var(--color-text-muted);
  --color-success: #16a34a;
  --color-success-bg: #f0fdf4;
  --color-danger: #dc2626;
  --color-danger-bg: #fff1f2;

  --radius-card: 16px;
  --radius-btn: 9999px;

  --shadow-card: 0 1px 3px 0 rgba(0,0,0,.08), 0 1px 2px -1px rgba(0,0,0,.06);
  --shadow-card-hover: 0 4px 6px -1px rgba(0,0,0,.08), 0 2px 4px -2px rgba(0,0,0,.06);

  --spacing-sidebar: 232px;
  --spacing-topbar: 64px;
}
```

Do not change anything else in the file.

- [ ] **Step 3: Verify**

Run (from `dashboard/`): `npm run typecheck && npm run build`
Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
git add dashboard/lib/types.ts dashboard/app/globals.css
git commit -m "feat(dashboard): add sentiment/engagement types and success/danger tokens"
```

---

### Task 2: Threads readers (engagement + sentiment) + fakes

**Files:**
- Create: `dashboard/lib/threads-engagement-reader.ts`
- Create: `dashboard/lib/threads-sentiment-reader.ts`
- Create: `dashboard/tests/fakes/fake-threads-engagement-reader.ts`
- Create: `dashboard/tests/fakes/fake-threads-sentiment-reader.ts`

**Interfaces:**
- Consumes: `ThreadsEngagementDaily`, `SentimentLabel` (Task 1).
- Produces: `ThreadsEngagementReader`/`SupabaseThreadsEngagementReader`/`FakeThreadsEngagementReader`, `ThreadsSentimentReader`/`SupabaseThreadsSentimentReader`/`FakeThreadsSentimentReader` — Task 5's orchestration function and Task 9's page wiring depend on these exact names/signatures.

No test cycle for the Supabase classes (matches this dashboard's existing convention — `SupabaseCandidateTopicsReader`/`SupabaseArticlesReader` have no dedicated test either). The Fakes get exercised in Task 5's test, not their own test file (also matches existing convention — no `fake-candidate-topics-reader.test.ts` exists in this codebase). Verified by `npm run typecheck`.

- [ ] **Step 1: Write `threads-engagement-reader.ts`**

Create `dashboard/lib/threads-engagement-reader.ts`:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ThreadsEngagementDaily } from './types';

export interface ThreadsEngagementReader {
  getForDate(date: string): Promise<ThreadsEngagementDaily[]>;
}

export class SupabaseThreadsEngagementReader implements ThreadsEngagementReader {
  constructor(private client: SupabaseClient) {}

  async getForDate(date: string): Promise<ThreadsEngagementDaily[]> {
    const { data, error } = await this.client
      .from('threads_engagement_daily')
      .select(
        'date, keyword, category, total_like_count, total_reply_count, total_repost_count, total_quote_count, total_share_count, total_view_count, post_count'
      )
      .eq('date', date);
    if (error) throw new Error(error.message);
    return (data ?? []) as ThreadsEngagementDaily[];
  }
}
```

- [ ] **Step 2: Write `threads-sentiment-reader.ts`**

Create `dashboard/lib/threads-sentiment-reader.ts`:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SentimentLabel } from './types';

export interface ThreadsSentimentReader {
  getForDate(date: string): Promise<{ keyword: string; sentiment: SentimentLabel | null }[]>;
}

export class SupabaseThreadsSentimentReader implements ThreadsSentimentReader {
  constructor(private client: SupabaseClient) {}

  async getForDate(date: string): Promise<{ keyword: string; sentiment: SentimentLabel | null }[]> {
    const { data, error } = await this.client
      .from('topic_social_data')
      .select('keyword, sentiment')
      .eq('date', date)
      .limit(5000);
    if (error) throw new Error(error.message);
    return (data ?? []) as { keyword: string; sentiment: SentimentLabel | null }[];
  }
}
```

- [ ] **Step 3: Write `FakeThreadsEngagementReader`**

Create `dashboard/tests/fakes/fake-threads-engagement-reader.ts`:

```typescript
import type { ThreadsEngagementReader } from '../../lib/threads-engagement-reader';
import type { ThreadsEngagementDaily } from '../../lib/types';

export class FakeThreadsEngagementReader implements ThreadsEngagementReader {
  constructor(private rows: ThreadsEngagementDaily[] = []) {}

  async getForDate(date: string): Promise<ThreadsEngagementDaily[]> {
    return this.rows.filter((r) => r.date === date);
  }
}
```

- [ ] **Step 4: Write `FakeThreadsSentimentReader`**

Create `dashboard/tests/fakes/fake-threads-sentiment-reader.ts`:

```typescript
import type { ThreadsSentimentReader } from '../../lib/threads-sentiment-reader';
import type { SentimentLabel } from '../../lib/types';

export class FakeThreadsSentimentReader implements ThreadsSentimentReader {
  constructor(private rows: { date: string; keyword: string; sentiment: SentimentLabel | null }[] = []) {}

  async getForDate(date: string): Promise<{ keyword: string; sentiment: SentimentLabel | null }[]> {
    return this.rows
      .filter((r) => r.date === date)
      .map((r) => ({ keyword: r.keyword, sentiment: r.sentiment }));
  }
}
```

- [ ] **Step 5: Verify**

Run (from `dashboard/`): `npm run typecheck`
Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add dashboard/lib/threads-engagement-reader.ts dashboard/lib/threads-sentiment-reader.ts dashboard/tests/fakes/fake-threads-engagement-reader.ts dashboard/tests/fakes/fake-threads-sentiment-reader.ts
git commit -m "feat(dashboard): add Threads engagement/sentiment readers and fakes"
```

---

### Task 3: Facebook readers (engagement + sentiment) + fakes

**Files:**
- Create: `dashboard/lib/facebook-engagement-reader.ts`
- Create: `dashboard/lib/facebook-sentiment-reader.ts`
- Create: `dashboard/tests/fakes/fake-facebook-engagement-reader.ts`
- Create: `dashboard/tests/fakes/fake-facebook-sentiment-reader.ts`

**Interfaces:**
- Consumes: `FacebookEngagementDaily`, `SentimentLabel` (Task 1).
- Produces: `FacebookEngagementReader`/`SupabaseFacebookEngagementReader`/`FakeFacebookEngagementReader`, `FacebookSentimentReader`/`SupabaseFacebookSentimentReader`/`FakeFacebookSentimentReader` — Task 7's orchestration function and Task 9's page wiring depend on these.

Same testing rationale as Task 2 — no dedicated test file for these classes.

- [ ] **Step 1: Write `facebook-engagement-reader.ts`**

Create `dashboard/lib/facebook-engagement-reader.ts`:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FacebookEngagementDaily } from './types';

export interface FacebookEngagementReader {
  getForDate(date: string): Promise<FacebookEngagementDaily[]>;
}

export class SupabaseFacebookEngagementReader implements FacebookEngagementReader {
  constructor(private client: SupabaseClient) {}

  async getForDate(date: string): Promise<FacebookEngagementDaily[]> {
    const { data, error } = await this.client
      .from('facebook_engagement_daily')
      .select('date, category, total_like_count, total_comment_count, total_share_count, post_count')
      .eq('date', date);
    if (error) throw new Error(error.message);
    return (data ?? []) as FacebookEngagementDaily[];
  }
}
```

- [ ] **Step 2: Write `facebook-sentiment-reader.ts`**

Create `dashboard/lib/facebook-sentiment-reader.ts`:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SentimentLabel } from './types';

export interface FacebookSentimentReader {
  getForDate(date: string): Promise<{ category: string; sentiment: SentimentLabel | null }[]>;
}

export class SupabaseFacebookSentimentReader implements FacebookSentimentReader {
  constructor(private client: SupabaseClient) {}

  async getForDate(date: string): Promise<{ category: string; sentiment: SentimentLabel | null }[]> {
    const { data, error } = await this.client
      .from('facebook_page_data')
      .select('category, sentiment')
      .eq('date', date)
      .limit(5000);
    if (error) throw new Error(error.message);
    return (data ?? []) as { category: string; sentiment: SentimentLabel | null }[];
  }
}
```

- [ ] **Step 3: Write `FakeFacebookEngagementReader`**

Create `dashboard/tests/fakes/fake-facebook-engagement-reader.ts`:

```typescript
import type { FacebookEngagementReader } from '../../lib/facebook-engagement-reader';
import type { FacebookEngagementDaily } from '../../lib/types';

export class FakeFacebookEngagementReader implements FacebookEngagementReader {
  constructor(private rows: FacebookEngagementDaily[] = []) {}

  async getForDate(date: string): Promise<FacebookEngagementDaily[]> {
    return this.rows.filter((r) => r.date === date);
  }
}
```

- [ ] **Step 4: Write `FakeFacebookSentimentReader`**

Create `dashboard/tests/fakes/fake-facebook-sentiment-reader.ts`:

```typescript
import type { FacebookSentimentReader } from '../../lib/facebook-sentiment-reader';
import type { SentimentLabel } from '../../lib/types';

export class FakeFacebookSentimentReader implements FacebookSentimentReader {
  constructor(private rows: { date: string; category: string; sentiment: SentimentLabel | null }[] = []) {}

  async getForDate(date: string): Promise<{ category: string; sentiment: SentimentLabel | null }[]> {
    return this.rows
      .filter((r) => r.date === date)
      .map((r) => ({ category: r.category, sentiment: r.sentiment }));
  }
}
```

- [ ] **Step 5: Verify**

Run (from `dashboard/`): `npm run typecheck`
Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add dashboard/lib/facebook-engagement-reader.ts dashboard/lib/facebook-sentiment-reader.ts dashboard/tests/fakes/fake-facebook-engagement-reader.ts dashboard/tests/fakes/fake-facebook-sentiment-reader.ts
git commit -m "feat(dashboard): add Facebook engagement/sentiment readers and fakes"
```

---

### Task 4: Pure logic — `topic-engagement.ts`

**Files:**
- Create: `dashboard/lib/topic-engagement.ts`
- Create: `dashboard/tests/topic-engagement.test.ts`

**Interfaces:**
- Consumes: `HotTopicRow` (existing, `dashboard/lib/hot-topics.ts`), `SentimentLabel`, `ThreadsEngagementDaily` (Task 1), `CandidateTopic` (existing, `dashboard/lib/types.ts`).
- Produces: `SentimentCounts`, `TopicEngagement`, `EnrichedHotTopicRow` types; `groupSentimentCounts`, `computeSentimentIndex`, `attachEngagement`, `withoutEngagement` functions — Tasks 5, 6, 7, 8, 10 all depend on these exact names/signatures.

- [ ] **Step 1: Write the failing tests**

Create `dashboard/tests/topic-engagement.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  groupSentimentCounts,
  computeSentimentIndex,
  attachEngagement,
  withoutEngagement,
} from '../lib/topic-engagement';
import type { HotTopicRow } from '../lib/hot-topics';
import type { ThreadsEngagementDaily } from '../lib/types';

function hotTopicRow(overrides: Partial<HotTopicRow> = {}): HotTopicRow {
  return {
    id: 'id-1',
    source: 'rss',
    keyword: 'bitcoin',
    metricValue: 10,
    trendingScore: 5,
    shareOfVoice: 2,
    ...overrides,
  };
}

function engagementRow(overrides: Partial<ThreadsEngagementDaily> = {}): ThreadsEngagementDaily {
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

describe('groupSentimentCounts', () => {
  it('counts positive/negative/neutral per key', () => {
    const result = groupSentimentCounts([
      { key: 'bitcoin', sentiment: 'positive' },
      { key: 'bitcoin', sentiment: 'positive' },
      { key: 'bitcoin', sentiment: 'negative' },
      { key: 'ethereum', sentiment: 'neutral' },
    ]);
    expect(result.get('bitcoin')).toEqual({ positive: 2, negative: 1, neutral: 0 });
    expect(result.get('ethereum')).toEqual({ positive: 0, negative: 0, neutral: 1 });
  });

  it('ignores null sentiment and unknown labels', () => {
    const result = groupSentimentCounts([
      { key: 'bitcoin', sentiment: null },
      { key: 'bitcoin', sentiment: 'happy' as any },
      { key: 'bitcoin', sentiment: 'positive' },
    ]);
    expect(result.get('bitcoin')).toEqual({ positive: 1, negative: 0, neutral: 0 });
  });
});

describe('computeSentimentIndex', () => {
  it('returns null when total is 0', () => {
    expect(computeSentimentIndex({ positive: 0, negative: 0, neutral: 0 })).toBeNull();
  });

  it('computes (positive-negative)/total*100, rounded', () => {
    expect(computeSentimentIndex({ positive: 6, negative: 2, neutral: 2 })).toBe(40);
  });

  it('returns a negative number when negative dominates', () => {
    expect(computeSentimentIndex({ positive: 1, negative: 4, neutral: 0 })).toBe(-60);
  });

  it('returns 0 when positive and negative are equal', () => {
    expect(computeSentimentIndex({ positive: 3, negative: 3, neutral: 4 })).toBe(0);
  });
});

describe('attachEngagement', () => {
  it('attaches engagement + sentiment index when a matching keyword exists', () => {
    const rows = [hotTopicRow({ keyword: 'bitcoin' })];
    const engagementByKeyword = new Map([['bitcoin', engagementRow()]]);
    const sentimentByKeyword = new Map([['bitcoin', { positive: 3, negative: 1, neutral: 1 }]]);

    const result = attachEngagement(rows, engagementByKeyword, sentimentByKeyword);

    expect(result[0].engagement).toEqual({
      totalEngagement: 16, // 10+1+2+0+3, view_count excluded
      postCount: 2,
      sentiment: { positive: 3, negative: 1, neutral: 1 },
      sentimentIndex: 40, // (3-1)/5*100
    });
  });

  it('sets engagement to null when no matching keyword exists', () => {
    const rows = [hotTopicRow({ keyword: 'ethereum' })];
    const result = attachEngagement(rows, new Map(), new Map());
    expect(result[0].engagement).toBeNull();
  });

  it('defaults sentiment to all-zero counts when engagement exists but no sentiment data does', () => {
    const rows = [hotTopicRow({ keyword: 'bitcoin' })];
    const engagementByKeyword = new Map([['bitcoin', engagementRow()]]);
    const result = attachEngagement(rows, engagementByKeyword, new Map());
    expect(result[0].engagement?.sentiment).toEqual({ positive: 0, negative: 0, neutral: 0 });
    expect(result[0].engagement?.sentimentIndex).toBeNull();
  });

  it('preserves all original HotTopicRow fields', () => {
    const rows = [
      hotTopicRow({ id: 'xyz', source: 'youtube', keyword: 'bitcoin', metricValue: 99, trendingScore: 12, shareOfVoice: 4 }),
    ];
    const result = attachEngagement(rows, new Map(), new Map());
    expect(result[0]).toMatchObject({
      id: 'xyz',
      source: 'youtube',
      keyword: 'bitcoin',
      metricValue: 99,
      trendingScore: 12,
      shareOfVoice: 4,
    });
  });
});

describe('withoutEngagement', () => {
  it('sets engagement to null for every row across every source group', () => {
    const bySource = {
      google_trends: [hotTopicRow({ id: 'a' })],
      youtube: [] as HotTopicRow[],
      rss: [hotTopicRow({ id: 'b' })],
    };
    const result = withoutEngagement(bySource);
    expect(result.google_trends[0].engagement).toBeNull();
    expect(result.youtube).toEqual([]);
    expect(result.rss[0].engagement).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/topic-engagement.test.ts`
Expected: FAIL — `Cannot find module '../lib/topic-engagement'`

- [ ] **Step 3: Write the implementation**

Create `dashboard/lib/topic-engagement.ts`:

```typescript
import type { HotTopicRow } from './hot-topics';
import type { CandidateTopic, SentimentLabel, ThreadsEngagementDaily } from './types';

export interface SentimentCounts {
  positive: number;
  negative: number;
  neutral: number;
}

export interface TopicEngagement {
  totalEngagement: number; // like+reply+repost+quote+share, view_count excluded
  postCount: number;
  sentiment: SentimentCounts;
  sentimentIndex: number | null;
}

export interface EnrichedHotTopicRow extends HotTopicRow {
  engagement: TopicEngagement | null;
}

export function groupSentimentCounts(
  rows: { key: string; sentiment: SentimentLabel | null }[]
): Map<string, SentimentCounts> {
  const result = new Map<string, SentimentCounts>();
  for (const row of rows) {
    if (row.sentiment !== 'positive' && row.sentiment !== 'negative' && row.sentiment !== 'neutral') continue;
    const counts = result.get(row.key) ?? { positive: 0, negative: 0, neutral: 0 };
    counts[row.sentiment] += 1;
    result.set(row.key, counts);
  }
  return result;
}

// Adapted from ver1's lib/sentiment-index.ts: round((positive-negative)/total*100),
// thang -100..+100. Input here is a count of individual posts for one
// keyword/category on one day, rather than an average of per-day
// percentage records across a period — mathematically equivalent when
// every post carries equal weight.
export function computeSentimentIndex(counts: SentimentCounts): number | null {
  const total = counts.positive + counts.negative + counts.neutral;
  if (total === 0) return null;
  return Math.round(((counts.positive - counts.negative) / total) * 100);
}

function threadsEngagementTotal(row: ThreadsEngagementDaily): number {
  return (
    row.total_like_count +
    row.total_reply_count +
    row.total_repost_count +
    row.total_quote_count +
    row.total_share_count
  );
}

export function attachEngagement(
  rows: HotTopicRow[],
  engagementByKeyword: Map<string, ThreadsEngagementDaily>,
  sentimentByKeyword: Map<string, SentimentCounts>
): EnrichedHotTopicRow[] {
  return rows.map((row) => {
    const engagementRow = engagementByKeyword.get(row.keyword);
    if (!engagementRow) {
      return { ...row, engagement: null };
    }
    const sentiment = sentimentByKeyword.get(row.keyword) ?? { positive: 0, negative: 0, neutral: 0 };
    return {
      ...row,
      engagement: {
        totalEngagement: threadsEngagementTotal(engagementRow),
        postCount: engagementRow.post_count,
        sentiment,
        sentimentIndex: computeSentimentIndex(sentiment),
      },
    };
  });
}

// Fallback for when the Threads engagement/sentiment fetch fails or there's
// no date to query yet — every row gets engagement: null, same shape as if
// attachEngagement had found no match for any keyword.
export function withoutEngagement(
  bySource: Record<CandidateTopic['source'], HotTopicRow[]>
): Record<CandidateTopic['source'], EnrichedHotTopicRow[]> {
  const sources = Object.keys(bySource) as CandidateTopic['source'][];
  const result = {} as Record<CandidateTopic['source'], EnrichedHotTopicRow[]>;
  for (const source of sources) {
    result[source] = bySource[source].map((row) => ({ ...row, engagement: null }));
  }
  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/topic-engagement.test.ts`
Expected: PASS, 9/9 tests.

- [ ] **Step 5: Run the full test suite and typecheck**

Run: `npm run typecheck && npm test`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add dashboard/lib/topic-engagement.ts dashboard/tests/topic-engagement.test.ts
git commit -m "feat(dashboard): add sentiment/engagement pure logic (topic-engagement.ts)"
```

---

### Task 5: Orchestration — `get-topic-engagement.ts`

**Files:**
- Create: `dashboard/lib/get-topic-engagement.ts`
- Create: `dashboard/tests/get-topic-engagement.test.ts`

**Interfaces:**
- Consumes: `ThreadsEngagementReader`, `ThreadsSentimentReader` (Task 2), `groupSentimentCounts`, `attachEngagement`, `EnrichedHotTopicRow` (Task 4), `HotTopicRow` (existing), `CandidateTopic` (existing).
- Produces: `enrichHotTopicsWithThreadsData(bySource, engagementReader, sentimentReader, date): Promise<Record<CandidateTopic['source'], EnrichedHotTopicRow[]>>` — Task 9's page wiring depends on this exact name/signature.

- [ ] **Step 1: Write the failing tests**

Create `dashboard/tests/get-topic-engagement.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { enrichHotTopicsWithThreadsData } from '../lib/get-topic-engagement';
import { FakeThreadsEngagementReader } from './fakes/fake-threads-engagement-reader';
import { FakeThreadsSentimentReader } from './fakes/fake-threads-sentiment-reader';
import type { HotTopicRow } from '../lib/hot-topics';

function hotTopicRow(overrides: Partial<HotTopicRow> = {}): HotTopicRow {
  return {
    id: 'id-1',
    source: 'rss',
    keyword: 'bitcoin',
    metricValue: 10,
    trendingScore: 5,
    shareOfVoice: 2,
    ...overrides,
  };
}

describe('enrichHotTopicsWithThreadsData', () => {
  it('attaches engagement to matching rows across every source group', async () => {
    const bySource = {
      google_trends: [hotTopicRow({ id: 'a', source: 'google_trends', keyword: 'bitcoin' })],
      youtube: [hotTopicRow({ id: 'b', source: 'youtube', keyword: 'ethereum' })],
      rss: [] as HotTopicRow[],
    };
    const engagementReader = new FakeThreadsEngagementReader([
      {
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
      },
    ]);
    const sentimentReader = new FakeThreadsSentimentReader([
      { date: '2026-08-24', keyword: 'bitcoin', sentiment: 'positive' },
    ]);

    const result = await enrichHotTopicsWithThreadsData(bySource, engagementReader, sentimentReader, '2026-08-24');

    expect(result.google_trends[0].engagement?.totalEngagement).toBe(10);
    expect(result.google_trends[0].engagement?.sentimentIndex).toBe(100);
    expect(result.youtube[0].engagement).toBeNull();
    expect(result.rss).toEqual([]);
  });

  it('only pulls data for the given date', async () => {
    const bySource = { google_trends: [hotTopicRow({ keyword: 'bitcoin' })], youtube: [], rss: [] };
    const engagementReader = new FakeThreadsEngagementReader([
      {
        date: '2026-08-23',
        keyword: 'bitcoin',
        category: null,
        total_like_count: 10,
        total_reply_count: 0,
        total_repost_count: 0,
        total_quote_count: 0,
        total_share_count: 0,
        total_view_count: 0,
        post_count: 1,
      },
    ]);
    const sentimentReader = new FakeThreadsSentimentReader([]);

    const result = await enrichHotTopicsWithThreadsData(bySource, engagementReader, sentimentReader, '2026-08-24');

    expect(result.google_trends[0].engagement).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/get-topic-engagement.test.ts`
Expected: FAIL — `Cannot find module '../lib/get-topic-engagement'`

- [ ] **Step 3: Write the implementation**

Create `dashboard/lib/get-topic-engagement.ts`:

```typescript
import type { ThreadsEngagementReader } from './threads-engagement-reader';
import type { ThreadsSentimentReader } from './threads-sentiment-reader';
import { groupSentimentCounts, attachEngagement, type EnrichedHotTopicRow } from './topic-engagement';
import type { HotTopicRow } from './hot-topics';
import type { CandidateTopic } from './types';

export async function enrichHotTopicsWithThreadsData(
  bySource: Record<CandidateTopic['source'], HotTopicRow[]>,
  engagementReader: ThreadsEngagementReader,
  sentimentReader: ThreadsSentimentReader,
  date: string
): Promise<Record<CandidateTopic['source'], EnrichedHotTopicRow[]>> {
  const [engagementRows, sentimentRows] = await Promise.all([
    engagementReader.getForDate(date),
    sentimentReader.getForDate(date),
  ]);

  const engagementByKeyword = new Map(engagementRows.map((r) => [r.keyword, r]));
  const sentimentByKeyword = groupSentimentCounts(
    sentimentRows.map((r) => ({ key: r.keyword, sentiment: r.sentiment }))
  );

  const sources = Object.keys(bySource) as CandidateTopic['source'][];
  const result = {} as Record<CandidateTopic['source'], EnrichedHotTopicRow[]>;
  for (const source of sources) {
    result[source] = attachEngagement(bySource[source], engagementByKeyword, sentimentByKeyword);
  }
  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/get-topic-engagement.test.ts`
Expected: PASS, 2/2 tests.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: all pass, no regressions.

- [ ] **Step 6: Commit**

```bash
git add dashboard/lib/get-topic-engagement.ts dashboard/tests/get-topic-engagement.test.ts
git commit -m "feat(dashboard): add enrichHotTopicsWithThreadsData orchestration"
```

---

### Task 6: Pure logic — `facebook-summary.ts`

**Files:**
- Create: `dashboard/lib/facebook-summary.ts`
- Create: `dashboard/tests/facebook-summary.test.ts`

**Interfaces:**
- Consumes: `SentimentCounts`, `computeSentimentIndex` (Task 4), `FacebookEngagementDaily` (Task 1).
- Produces: `FacebookSummary` type, `buildFacebookSummary(category, engagementRows, sentimentByCategory): FacebookSummary | null` — Tasks 7 and 9 depend on this exact name/signature.

- [ ] **Step 1: Write the failing tests**

Create `dashboard/tests/facebook-summary.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildFacebookSummary } from '../lib/facebook-summary';
import type { FacebookEngagementDaily } from '../lib/types';

function engagementRow(overrides: Partial<FacebookEngagementDaily> = {}): FacebookEngagementDaily {
  return {
    date: '2026-08-24',
    category: 'tai_chinh',
    total_like_count: 10,
    total_comment_count: 3,
    total_share_count: 2,
    post_count: 5,
    ...overrides,
  };
}

describe('buildFacebookSummary', () => {
  it('builds a summary when a matching category row exists', () => {
    const result = buildFacebookSummary(
      'tai_chinh',
      [engagementRow()],
      new Map([['tai_chinh', { positive: 4, negative: 1, neutral: 0 }]])
    );
    expect(result).toEqual({
      totalEngagement: 15, // 10+3+2
      postCount: 5,
      sentiment: { positive: 4, negative: 1, neutral: 0 },
      sentimentIndex: 60, // (4-1)/5*100
    });
  });

  it('returns null when no engagement row matches the category', () => {
    const result = buildFacebookSummary('du_lich', [engagementRow({ category: 'tai_chinh' })], new Map());
    expect(result).toBeNull();
  });

  it('defaults sentiment to all-zero counts when no sentiment data exists', () => {
    const result = buildFacebookSummary('tai_chinh', [engagementRow()], new Map());
    expect(result?.sentiment).toEqual({ positive: 0, negative: 0, neutral: 0 });
    expect(result?.sentimentIndex).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/facebook-summary.test.ts`
Expected: FAIL — `Cannot find module '../lib/facebook-summary'`

- [ ] **Step 3: Write the implementation**

Create `dashboard/lib/facebook-summary.ts`:

```typescript
import { computeSentimentIndex, type SentimentCounts } from './topic-engagement';
import type { FacebookEngagementDaily } from './types';

export interface FacebookSummary {
  totalEngagement: number; // like+comment+share
  postCount: number;
  sentiment: SentimentCounts;
  sentimentIndex: number | null;
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
    totalEngagement: engagementRow.total_like_count + engagementRow.total_comment_count + engagementRow.total_share_count,
    postCount: engagementRow.post_count,
    sentiment,
    sentimentIndex: computeSentimentIndex(sentiment),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/facebook-summary.test.ts`
Expected: PASS, 3/3 tests.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: all pass, no regressions.

- [ ] **Step 6: Commit**

```bash
git add dashboard/lib/facebook-summary.ts dashboard/tests/facebook-summary.test.ts
git commit -m "feat(dashboard): add buildFacebookSummary pure logic"
```

---

### Task 7: Orchestration — `get-facebook-summary.ts`

**Files:**
- Create: `dashboard/lib/get-facebook-summary.ts`
- Create: `dashboard/tests/get-facebook-summary.test.ts`

**Interfaces:**
- Consumes: `FacebookEngagementReader`, `FacebookSentimentReader` (Task 3), `groupSentimentCounts` (Task 4), `buildFacebookSummary`, `FacebookSummary` (Task 6).
- Produces: `getFacebookSummary(category, engagementReader, sentimentReader, date): Promise<FacebookSummary | null>` — Task 9's page wiring depends on this exact name/signature.

- [ ] **Step 1: Write the failing tests**

Create `dashboard/tests/get-facebook-summary.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { getFacebookSummary } from '../lib/get-facebook-summary';
import { FakeFacebookEngagementReader } from './fakes/fake-facebook-engagement-reader';
import { FakeFacebookSentimentReader } from './fakes/fake-facebook-sentiment-reader';

describe('getFacebookSummary', () => {
  it('returns a summary for the given category and date', async () => {
    const engagementReader = new FakeFacebookEngagementReader([
      { date: '2026-08-24', category: 'tai_chinh', total_like_count: 10, total_comment_count: 3, total_share_count: 2, post_count: 5 },
    ]);
    const sentimentReader = new FakeFacebookSentimentReader([
      { date: '2026-08-24', category: 'tai_chinh', sentiment: 'positive' },
      { date: '2026-08-24', category: 'tai_chinh', sentiment: 'negative' },
    ]);

    const result = await getFacebookSummary('tai_chinh', engagementReader, sentimentReader, '2026-08-24');

    expect(result?.totalEngagement).toBe(15);
    expect(result?.sentiment).toEqual({ positive: 1, negative: 1, neutral: 0 });
  });

  it('returns null when there is no engagement data for that category/date', async () => {
    const engagementReader = new FakeFacebookEngagementReader([]);
    const sentimentReader = new FakeFacebookSentimentReader([]);

    const result = await getFacebookSummary('tai_chinh', engagementReader, sentimentReader, '2026-08-24');

    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/get-facebook-summary.test.ts`
Expected: FAIL — `Cannot find module '../lib/get-facebook-summary'`

- [ ] **Step 3: Write the implementation**

Create `dashboard/lib/get-facebook-summary.ts`:

```typescript
import type { FacebookEngagementReader } from './facebook-engagement-reader';
import type { FacebookSentimentReader } from './facebook-sentiment-reader';
import { groupSentimentCounts } from './topic-engagement';
import { buildFacebookSummary, type FacebookSummary } from './facebook-summary';

export async function getFacebookSummary(
  category: string,
  engagementReader: FacebookEngagementReader,
  sentimentReader: FacebookSentimentReader,
  date: string
): Promise<FacebookSummary | null> {
  const [engagementRows, sentimentRows] = await Promise.all([
    engagementReader.getForDate(date),
    sentimentReader.getForDate(date),
  ]);

  const sentimentByCategory = groupSentimentCounts(
    sentimentRows.map((r) => ({ key: r.category, sentiment: r.sentiment }))
  );

  return buildFacebookSummary(category, engagementRows, sentimentByCategory);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/get-facebook-summary.test.ts`
Expected: PASS, 2/2 tests.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: all pass, no regressions.

- [ ] **Step 6: Commit**

```bash
git add dashboard/lib/get-facebook-summary.ts dashboard/tests/get-facebook-summary.test.ts
git commit -m "feat(dashboard): add getFacebookSummary orchestration"
```

---

### Task 8: `FacebookSummarySection` component

**Files:**
- Create: `dashboard/components/FacebookSummarySection.tsx`

**Interfaces:**
- Consumes: `FacebookSummary` (Task 6).
- Produces: `FacebookSummarySection({ summary }: { summary: FacebookSummary | null })` — Task 9's sector-page wiring depends on this exact name/signature.

No test cycle (JSX). Verified by `npm run build`.

- [ ] **Step 1: Write the component**

Create `dashboard/components/FacebookSummarySection.tsx`:

```tsx
import type { FacebookSummary } from '../lib/facebook-summary';

function SentimentBar({
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

export function FacebookSummarySection({ summary }: { summary: FacebookSummary | null }) {
  if (summary === null) {
    return (
      <section className="bg-surface border border-line rounded-card shadow-card p-6 mb-8">
        <h2 className="text-base font-bold text-ink mb-2">Facebook</h2>
        <p className="text-sm text-ink-3">Chưa có dữ liệu Facebook hôm nay.</p>
      </section>
    );
  }

  const total = summary.sentiment.positive + summary.sentiment.negative + summary.sentiment.neutral;

  return (
    <section className="bg-surface border border-line rounded-card shadow-card p-6 mb-8">
      <h2 className="text-base font-bold text-ink mb-4">
        Facebook hôm nay: {summary.postCount} bài · {summary.totalEngagement} tương tác
      </h2>
      <SentimentBar label="Tích cực" count={summary.sentiment.positive} total={total} colorClass="bg-success" />
      <SentimentBar label="Trung lập" count={summary.sentiment.neutral} total={total} colorClass="bg-ink-3" />
      <SentimentBar label="Tiêu cực" count={summary.sentiment.negative} total={total} colorClass="bg-danger" />
    </section>
  );
}
```

- [ ] **Step 2: Verify the build**

Run (from `dashboard/`): `npm run build`
Expected: exits 0 — this is a new, standalone, unused-so-far component; nothing else references it yet.

- [ ] **Step 3: Commit**

```bash
git add dashboard/components/FacebookSummarySection.tsx
git commit -m "feat(dashboard): add FacebookSummarySection component"
```

---

### Task 9: `HotTopicsSection` sentiment badge + wire everything into the pages

**Files:**
- Modify: `dashboard/components/HotTopicsSection.tsx`
- Modify: `dashboard/app/page.tsx`
- Modify: `dashboard/app/[slug]/page.tsx`

**Interfaces:**
- Consumes: `EnrichedHotTopicRow` (Task 4), and everything from Tasks 1–8 needed by the pages (`SupabaseThreadsEngagementReader`, `SupabaseThreadsSentimentReader`, `SupabaseFacebookEngagementReader`, `SupabaseFacebookSentimentReader`, `enrichHotTopicsWithThreadsData`, `withoutEngagement`, `getFacebookSummary`, `FacebookSummary`, `FacebookSummarySection`).

**This is one task, not two, on purpose:** changing `HotTopicsSection`'s `bySource` prop type from `Record<source, HotTopicRow[]>` to `Record<source, EnrichedHotTopicRow[]>` alone would break `npm run build` until the pages are updated to pass the new shape — same reasoning as the visual-redesign plan's Task 4 (Sidebar/Topbar + pages + CategoryNav deletion bundled into one task to avoid a broken intermediate commit). Splitting this into 2 tasks would mean committing a build that doesn't compile.

No test cycle for any of the 3 files (JSX/page wiring, matches this codebase's convention). Verified by `npm run build && npm run typecheck && npm test` (full regression check, since this touches the pages `loadHotTopics`/`loadArticles` live in).

- [ ] **Step 1: Replace `HotTopicsSection.tsx`**

Replace `dashboard/components/HotTopicsSection.tsx` entirely with:

```tsx
import type { EnrichedHotTopicRow } from '../lib/topic-engagement';
import type { CandidateTopic } from '../lib/types';

const SOURCE_LABELS: Record<CandidateTopic['source'], string> = {
  google_trends: 'Google Trends',
  youtube: 'YouTube',
  rss: 'RSS',
};

function formatPercent(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}%`;
}

// growth_rate = 999 is the ingestion pipeline's sentinel for "no prior-week
// baseline" (see rank-and-select.ts). computeTrendingScore multiplies by
// 100, so it shows up here as exactly 99900. Render it as "Mới" (new)
// instead of a nonsense percentage.
function formatTrendingScore(value: number | null): string {
  if (value === null) return '—';
  if (value === 99900) return 'Mới';
  return `${value.toFixed(1)}%`;
}

function sentimentBadgeClass(index: number): string {
  if (index > 0) return 'bg-success-bg text-success';
  if (index < 0) return 'bg-danger-bg text-danger';
  return 'bg-muted text-ink-3';
}

function formatSentimentBadge(index: number): string {
  if (index > 0) return `Sentiment +${index}`;
  if (index < 0) return `Sentiment ${index}`;
  return 'Sentiment 0';
}

export function HotTopicsSection({
  date,
  bySource,
}: {
  date: string | null;
  bySource: Record<CandidateTopic['source'], EnrichedHotTopicRow[]>;
}) {
  if (date === null) {
    return (
      <section className="bg-surface border border-line rounded-card shadow-card p-6">
        <h2 className="text-base font-bold text-ink mb-2">Topic đang hot</h2>
        <p className="text-sm text-ink-3">Chưa có dữ liệu — chờ lần chạy discovery layer tiếp theo.</p>
      </section>
    );
  }

  const sources = Object.keys(bySource) as CandidateTopic['source'][];
  const hasAny = sources.some((s) => bySource[s].length > 0);

  return (
    <section className="bg-surface border border-line rounded-card shadow-card p-6">
      <h2 className="text-base font-bold text-ink mb-4">Topic đang hot ({date})</h2>
      {!hasAny && <p className="text-sm text-ink-3">Không có topic nào được shortlist hôm nay.</p>}
      <div className="grid gap-6 md:grid-cols-3">
        {sources.map((source) => (
          <div key={source}>
            <p className="text-[11px] font-semibold text-ink-3 tracking-wider uppercase mb-2">
              {SOURCE_LABELS[source]}
            </p>
            <ul className="space-y-0.5">
              {bySource[source].map((row, i) => (
                <li key={row.id} className="px-3 py-2 rounded-[10px] hover:bg-muted transition-colors">
                  <div className="flex items-center gap-3">
                    <span className="w-4 text-center text-xs font-bold text-ink-3 flex-shrink-0">{i + 1}</span>
                    <span className="flex-1 min-w-0 text-sm text-ink truncate">{row.keyword}</span>
                    <span className="text-xs text-ink-3 whitespace-nowrap flex-shrink-0">
                      {formatTrendingScore(row.trendingScore)} · {formatPercent(row.shareOfVoice)}
                    </span>
                  </div>
                  {row.engagement && (
                    <div className="flex items-center gap-2 mt-1 pl-7">
                      <span className="text-xs text-ink-3">💬 {row.engagement.totalEngagement} tương tác</span>
                      {row.engagement.sentimentIndex !== null && (
                        <span
                          className={`text-xs rounded-full px-2 py-0.5 ${sentimentBadgeClass(row.engagement.sentimentIndex)}`}
                        >
                          {formatSentimentBadge(row.engagement.sentimentIndex)}
                        </span>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Replace the Overview page**

Replace `dashboard/app/page.tsx` entirely with:

```tsx
import { createServerSupabaseClient } from '../lib/supabase';
import { SupabaseCandidateTopicsReader } from '../lib/candidate-topics-reader';
import { SupabaseArticlesReader } from '../lib/articles-reader';
import { SupabaseThreadsEngagementReader } from '../lib/threads-engagement-reader';
import { SupabaseThreadsSentimentReader } from '../lib/threads-sentiment-reader';
import { getHotTopics, type HotTopicsResult } from '../lib/get-hot-topics';
import { enrichHotTopicsWithThreadsData, withoutEngagement } from '../lib/get-topic-engagement';
import { HotTopicsSection } from '../components/HotTopicsSection';
import { ArticlesSection } from '../components/ArticlesSection';
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

// Errors/missing data here are swallowed on purpose (spec §5): engagement +
// sentiment is supplementary context, not primary content — a failure must
// not block hot topics from rendering, and degrades silently to "no
// engagement data" rather than a red error banner.
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

export default async function OverviewPage() {
  const [hotTopics, articles] = await Promise.all([loadHotTopics(), loadArticles()]);

  const hotTopicsWithEngagement =
    'error' in hotTopics
      ? hotTopics
      : { ...hotTopics, bySource: await loadThreadsEngagement(hotTopics.bySource, hotTopics.date) };

  return (
    <>
      <Topbar title="Overview" />
      <main className="max-w-4xl mx-auto p-6">
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

- [ ] **Step 3: Replace the sector page**

Replace `dashboard/app/[slug]/page.tsx` entirely with:

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
import { enrichHotTopicsWithThreadsData, withoutEngagement } from '../../lib/get-topic-engagement';
import { getFacebookSummary } from '../../lib/get-facebook-summary';
import type { FacebookSummary } from '../../lib/facebook-summary';
import { getCategoryBySlug } from '../../lib/categories';
import { HotTopicsSection } from '../../components/HotTopicsSection';
import { ArticlesSection } from '../../components/ArticlesSection';
import { FacebookSummarySection } from '../../components/FacebookSummarySection';
import { Topbar } from '../../components/layout/Topbar';
import type { Article, CandidateTopic } from '../../lib/types';
import type { HotTopicRow } from '../../lib/hot-topics';

export const dynamic = 'force-dynamic';

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

// Errors/missing data here are swallowed on purpose (spec §5) — see
// app/page.tsx's identical comment.
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
    return await getFacebookSummary(
      category,
      new SupabaseFacebookEngagementReader(client),
      new SupabaseFacebookSentimentReader(client),
      date
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

  const [threadsEnrichedBySource, facebookSummary] = await Promise.all([
    'error' in hotTopics ? Promise.resolve(null) : loadThreadsEngagement(hotTopics.bySource, hotTopics.date),
    'error' in hotTopics ? Promise.resolve(null) : loadFacebookSummary(categoryDef.value, hotTopics.date),
  ]);

  const hotTopicsWithEngagement =
    'error' in hotTopics
      ? hotTopics
      : { ...hotTopics, bySource: threadsEnrichedBySource ?? withoutEngagement(hotTopics.bySource) };

  return (
    <>
      <Topbar title={categoryDef.label} color={categoryDef.color} />
      <main className="max-w-4xl mx-auto p-6">
        <FacebookSummarySection summary={facebookSummary} />
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

- [ ] **Step 4: Verify**

Run (from `dashboard/`): `npm run build && npm run typecheck && npm test`
Expected: all exit 0.

- [ ] **Step 5: Commit**

```bash
git add dashboard/components/HotTopicsSection.tsx dashboard/app/page.tsx "dashboard/app/[slug]/page.tsx"
git commit -m "feat(dashboard): show sentiment badge and wire engagement data into Overview and sector pages"
```

---

### Task 10: Final full-suite verification

**Files:** none (verification-only task).

- [ ] **Step 1: Run the full check from `dashboard/`**

Run: `npm run build && npm run typecheck && npm test`
Expected: all exit 0.

- [ ] **Step 2: Manual/structural check**

Start the dev server (`npm run dev`) and either open a browser or fetch the rendered HTML (`curl http://localhost:3000/` and `curl http://localhost:3000/tai-chinh`) to confirm:
- Overview page: hot topics render, no Facebook summary card anywhere on the page.
- Sector page (e.g. `/tai-chinh`): a Facebook summary card renders above "Topic đang hot" — either real data (if Supabase env vars are configured and `threads_engagement_daily`/`facebook_engagement_daily` have rows for today) or the "Chưa có dữ liệu Facebook hôm nay." empty state.
- No console/server errors beyond the expected "Không tải được..." messages if Supabase credentials aren't configured in this environment (matches this dashboard's existing local-dev behavior).

Stop the dev server afterward. This step has no pass/fail command output to paste — consistent with this project's established convention (see the visual-redesign plan's identical final task) of no automated visual test existing for this dashboard.
