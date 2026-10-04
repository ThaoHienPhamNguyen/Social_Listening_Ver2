# Topic Content Summary + "Bản tin hôm nay" Daily Brief Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For every shortlisted RSS/Threads topic, generate and store a short Vietnamese summary of what the underlying articles/posts actually say, and surface it on a new "Bản tin hôm nay" dashboard page and on the existing topic detail page.

**Architecture:** A new table (`topic_article_data`) captures RSS keyword→article links the same way `topic_social_data` already does for Threads. A new daily pipeline job (`summarize-topics`), running after `rank-and-select` and `deep-crawl`, reads that linked text per shortlisted RSS/Threads topic and calls an LLM (reusing the existing `OPENAI_API_KEY`) to write a 1-2 sentence summary into a new `candidate_topics.summary` column. The dashboard threads that column through its existing read paths and adds one new page plus one new section on the topic detail page.

**Tech Stack:** TypeScript, tsx, Supabase/Postgres, vitest, Next.js App Router, native `fetch` to OpenAI's Chat Completions API (`gpt-5-nano`) — all matching the existing root-ingestion (`src/`) and dashboard (`dashboard/`) stacks.

**Spec:** `docs/superpowers/specs/2026-10-04-topic-summary-daily-brief-design.md`

## Global Constraints

- Model for summarization: `gpt-5-nano` (same model already used by `OpenAiCandidateClassifier` and `OpenAiTopicExtractor`).
- `MAX_TEXTS_PER_TOPIC = 5`, `MAX_CHARS_PER_TEXT = 500` in the summarizer (bounds prompt size per topic).
- Summarization chunk size: `CHUNK_SIZE = 10` topics per LLM call in `summarize-topics.ts`.
- Only `source: 'rss'` and `source: 'threads'` candidates are ever summarized. `google_trends`/`youtube`/`facebook` rows always keep `summary: null`.
- New table: `topic_article_data` with `unique (source, keyword, article_url)` (no `date` in the unique key — same convention as `topic_social_data`'s `unique (source, keyword, post_url)`).
- New column: `candidate_topics.summary text` (nullable, no default).
- No new GitHub secret — `OPENAI_API_KEY` already exists and is reused.
- Daily brief page shows the overall top 10 ranked topics plus, per sector (Tài chính / Giải trí / Du lịch, in that order), the top 5 ranked topics within that category.
- Migration file: `supabase/migrations/0009_topic_summary.sql` — applied manually by the user in Supabase's SQL Editor (this project has no automated migration runner; same process as every prior migration).

## Review Focus

1. **RSS link-write failure must not block that day's RSS candidates.** `rss-topic-source.ts`'s `fetchCandidates()` must still return candidates even when `articleLinkRepo.upsertLinks` rejects or returns an `{error}` — Task 3 pins this.
2. **A shortlisted topic with zero linked source text must never reach the summarizer.** Sending an empty-text prompt wastes a call and can't produce a grounded summary — Task 5 pins this (topic is skipped, `summary` stays `null`).
3. **One summarization chunk's LLM failure must not block any other chunk's topics.** Unlike RSS keyword extraction, there is no regex fallback here — a failed chunk's topics simply stay unsummarized, but every other chunk must still succeed — Task 5 pins this.
4. **A single malformed entry in the summarizer's JSON response must null out only that topic, not the whole chunk.** Mirrors `parseTopicsResponse`'s existing two-tier failure model — Task 4 pins this.
5. **Merging same-keyword rows across sources must not lose a real summary to a `null` one.** When `compareByRank` picks a better-tier row as the merge representative but that row has no summary while a lower-tier sibling does, the merged row must still show the real summary — Task 7 pins this.

---

### Task 1: Migration + shared types

**Files:**
- Create: `supabase/migrations/0009_topic_summary.sql`
- Modify: `src/types.ts`
- Modify: `dashboard/lib/types.ts`

**Interfaces:**
- Produces: `CandidateTopic.summary?: string | null` (both `src/types.ts` and `dashboard/lib/types.ts`), `TopicArticleSourceName = 'rss'`, `TopicArticleData` (in `src/types.ts`) — every later task in this plan consumes these.

This task has no test file of its own — it's pure type/schema setup consumed by every later task's tests. Verification is `npm run typecheck` passing in both the root project and `dashboard/`.

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/0009_topic_summary.sql

-- Stores a short LLM-generated summary of what's actually being said about
-- a shortlisted topic. Null means "not summarized yet" — either the source
-- (google_trends/youtube) has no underlying text to summarize, or the
-- summarization job hasn't run yet / failed for this row.
alter table candidate_topics add column summary text;

-- RSS has no existing link between an extracted keyword and the article(s)
-- that produced it. This captures that mapping the same way
-- topic_social_data already does for Threads (keyword <-> post), so the
-- summarization job can find real source text for an RSS topic.
create table if not exists topic_article_data (
  id uuid primary key default gen_random_uuid(),
  keyword text not null,
  source text not null check (source in ('rss')),
  date date not null,
  article_url text not null,
  article_title text not null,
  article_snippet text not null default '',
  fetched_at timestamptz not null default now(),
  unique (source, keyword, article_url)
);

create index if not exists topic_article_data_date_idx
  on topic_article_data (date);

alter table topic_article_data enable row level security;
```

- [ ] **Step 2: Add `summary` to `CandidateTopic` and the new `TopicArticleData` type in `src/types.ts`**

Add inside the existing `CandidateTopic` interface (after `is_shortlisted: boolean;`):

```ts
  summary?: string | null;
```

Add after the existing `TopicSocialData` interface:

```ts
export type TopicArticleSourceName = 'rss';

export interface TopicArticleData {
  id?: string;
  keyword: string;
  source: TopicArticleSourceName;
  date: string;
  article_url: string;
  article_title: string;
  article_snippet: string;
  fetched_at?: string;
}
```

- [ ] **Step 3: Add the same `summary` field to `dashboard/lib/types.ts`**

Add inside the existing `CandidateTopic` interface there (after `is_shortlisted: boolean;`):

```ts
  summary?: string | null; // null = not summarized (google_trends/youtube rows,
  // or an rss/threads row the summarize-topics job hasn't reached/succeeded for yet)
```

- [ ] **Step 4: Verify typecheck passes in both projects**

Run: `npm run typecheck` (from the repo root)
Run: `cd dashboard && npm run typecheck`
Expected: both PASS (no other file references these types yet, so nothing can be broken by an additive optional field).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0009_topic_summary.sql src/types.ts dashboard/lib/types.ts
git commit -m "feat: add topic_article_data table and candidate_topics.summary column"
```

**Note for whoever runs this in production:** this migration must be pasted into Supabase's SQL Editor and run manually before task 6's pipeline job is deployed — same process used for every prior migration in this project (e.g. `0008_apify_discovery_redesign.sql`).

---

### Task 2: `TopicArticleDataRepository` and `CandidateTopicRepository` additions

**Files:**
- Create: `src/lib/topic-article-data-repository.ts`
- Create: `tests/fakes/fake-topic-article-data-repository.ts`
- Create: `tests/fake-topic-article-data-repository.test.ts`
- Modify: `src/lib/candidate-topic-repository.ts`
- Modify: `tests/fakes/fake-candidate-topic-repository.ts`
- Modify: `tests/fake-candidate-topic-repository.test.ts`

**Interfaces:**
- Consumes: `TopicArticleData` from Task 1 (`src/types.ts`).
- Produces: `TopicArticleDataRepository { upsertLinks(rows): Promise<{error, count}>; getArticlesForDate(date): Promise<TopicArticleData[]> }`, `SupabaseTopicArticleDataRepository`, `FakeTopicArticleDataRepository` — consumed by Task 3 (RssTopicSource) and Task 5 (summarize-topics.ts). `CandidateTopicRepository.getShortlistedCandidates(date)` and `.updateSummary(id, summary)` — consumed by Task 5.

- [ ] **Step 1: Write the failing test for `FakeTopicArticleDataRepository`**

Create `tests/fake-topic-article-data-repository.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { FakeTopicArticleDataRepository } from './fakes/fake-topic-article-data-repository';

describe('FakeTopicArticleDataRepository', () => {
  it('upsertLinks adds every row in the batch', async () => {
    const repo = new FakeTopicArticleDataRepository();
    const { error, count } = await repo.upsertLinks([
      { keyword: 'vàng', source: 'rss', date: '2026-10-04', article_url: 'https://a.com/1', article_title: 'Giá vàng tăng', article_snippet: '' },
      { keyword: 'vàng', source: 'rss', date: '2026-10-04', article_url: 'https://a.com/2', article_title: 'Vàng SJC vượt mốc', article_snippet: '' },
    ]);
    expect(error).toBeNull();
    expect(count).toBe(2);
    expect(repo.links).toHaveLength(2);
  });

  it('upsertLinks returns the configured error and adds nothing when upsertError is set', async () => {
    const repo = new FakeTopicArticleDataRepository();
    repo.upsertError = 'simulated failure';
    const { error, count } = await repo.upsertLinks([
      { keyword: 'vàng', source: 'rss', date: '2026-10-04', article_url: 'https://a.com/1', article_title: 't', article_snippet: '' },
    ]);
    expect(error).toBe('simulated failure');
    expect(count).toBe(0);
    expect(repo.links).toHaveLength(0);
  });

  it('getArticlesForDate returns only rows matching that date', async () => {
    const repo = new FakeTopicArticleDataRepository();
    await repo.upsertLinks([
      { keyword: 'vàng', source: 'rss', date: '2026-10-04', article_url: 'https://a.com/1', article_title: 't1', article_snippet: '' },
      { keyword: 'vàng', source: 'rss', date: '2026-10-03', article_url: 'https://a.com/2', article_title: 't2', article_snippet: '' },
    ]);
    const result = await repo.getArticlesForDate('2026-10-04');
    expect(result.map((r) => r.article_url)).toEqual(['https://a.com/1']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- fake-topic-article-data-repository`
Expected: FAIL — `Cannot find module './fakes/fake-topic-article-data-repository'`

- [ ] **Step 3: Write `src/lib/topic-article-data-repository.ts`**

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { TopicArticleData } from '../types';

export interface TopicArticleDataRepository {
  upsertLinks(rows: Partial<TopicArticleData>[]): Promise<{ error: string | null; count: number }>;
  getArticlesForDate(date: string): Promise<TopicArticleData[]>;
}

export class SupabaseTopicArticleDataRepository implements TopicArticleDataRepository {
  constructor(private client: SupabaseClient) {}

  async upsertLinks(rows: Partial<TopicArticleData>[]) {
    if (rows.length === 0) return { error: null, count: 0 };
    const { error } = await this.client
      .from('topic_article_data')
      .upsert(rows, { onConflict: 'source,keyword,article_url' });
    return { error: error?.message ?? null, count: error ? 0 : rows.length };
  }

  async getArticlesForDate(date: string) {
    const { data, error } = await this.client
      .from('topic_article_data')
      .select('*')
      .eq('date', date)
      .limit(5000);
    if (error) throw new Error(error.message);
    return (data ?? []) as TopicArticleData[];
  }
}
```

- [ ] **Step 4: Write `tests/fakes/fake-topic-article-data-repository.ts`**

```ts
import type { TopicArticleDataRepository } from '../../src/lib/topic-article-data-repository';
import type { TopicArticleData } from '../../src/types';

export class FakeTopicArticleDataRepository implements TopicArticleDataRepository {
  public links: TopicArticleData[] = [];
  public upsertError: string | null = null;

  async upsertLinks(rows: Partial<TopicArticleData>[]) {
    if (this.upsertError) return { error: this.upsertError, count: 0 };
    for (const row of rows) {
      this.links.push({
        id: row.id ?? crypto.randomUUID(),
        keyword: row.keyword!,
        source: row.source ?? 'rss',
        date: row.date!,
        article_url: row.article_url!,
        article_title: row.article_title ?? '',
        article_snippet: row.article_snippet ?? '',
      });
    }
    return { error: null, count: rows.length };
  }

  async getArticlesForDate(date: string) {
    return this.links.filter((l) => l.date === date);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- fake-topic-article-data-repository`
Expected: PASS (3 tests)

- [ ] **Step 6: Write the failing tests for `CandidateTopicRepository`'s new methods**

Add to `tests/fake-candidate-topic-repository.test.ts` (after the last existing `it` block, before the closing `});`):

```ts
  it('getShortlistedCandidates returns only is_shortlisted rows matching the given date', async () => {
    const repo = new FakeCandidateTopicRepository();
    repo.candidates.push(
      { id: '1', source: 'rss', keyword: 'a', date: '2026-10-04', metric_value: 1, growth_rate: null, category_hint: [], is_shortlisted: true },
      { id: '2', source: 'rss', keyword: 'b', date: '2026-10-04', metric_value: 1, growth_rate: null, category_hint: [], is_shortlisted: false },
      { id: '3', source: 'rss', keyword: 'c', date: '2026-10-03', metric_value: 1, growth_rate: null, category_hint: [], is_shortlisted: true }
    );
    const result = await repo.getShortlistedCandidates('2026-10-04');
    expect(result.map((c) => c.id)).toEqual(['1']);
  });

  it('updateSummary sets the summary on the matching row', async () => {
    const repo = new FakeCandidateTopicRepository();
    repo.candidates.push({ id: '1', source: 'rss', keyword: 'a', date: '2026-10-04', metric_value: 1, growth_rate: null, category_hint: [], is_shortlisted: true });
    const { error } = await repo.updateSummary('1', 'Tóm tắt test.');
    expect(error).toBeNull();
    expect(repo.candidates[0].summary).toBe('Tóm tắt test.');
  });
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npm test -- fake-candidate-topic-repository`
Expected: FAIL — `repo.getShortlistedCandidates is not a function`

- [ ] **Step 8: Add the two methods to `CandidateTopicRepository`'s interface and `SupabaseCandidateTopicRepository`**

In `src/lib/candidate-topic-repository.ts`, add to the `CandidateTopicRepository` interface (after `resetShortlisted`):

```ts
  // Every is_shortlisted candidate_topics row for the given date, regardless
  // of source — used by summarize-topics.ts, which filters to rss/threads
  // itself (this repository has no opinion on which sources get summarized).
  getShortlistedCandidates(date: string): Promise<CandidateTopic[]>;
  updateSummary(id: string, summary: string): Promise<{ error: string | null }>;
```

Add to the `SupabaseCandidateTopicRepository` class (after `resetShortlisted`):

```ts
  async getShortlistedCandidates(date: string) {
    const { data, error } = await this.client
      .from('candidate_topics')
      .select('*')
      .eq('date', date)
      .eq('is_shortlisted', true)
      .limit(5000);
    if (error) throw new Error(error.message);
    return (data ?? []) as CandidateTopic[];
  }

  async updateSummary(id: string, summary: string) {
    const { error } = await this.client
      .from('candidate_topics')
      .update({ summary })
      .eq('id', id);
    return { error: error?.message ?? null };
  }
```

- [ ] **Step 9: Add the two methods to `FakeCandidateTopicRepository`**

In `tests/fakes/fake-candidate-topic-repository.ts`, add after `resetShortlisted`:

```ts
  async getShortlistedCandidates(date: string) {
    return this.candidates.filter((c) => c.date === date && c.is_shortlisted);
  }

  async updateSummary(id: string, summary: string) {
    const c = this.candidates.find((x) => x.id === id);
    if (c) c.summary = summary;
    return { error: null };
  }
```

- [ ] **Step 10: Run tests to verify they pass**

Run: `npm test -- fake-candidate-topic-repository`
Expected: PASS (all tests in the file, including the 2 new ones)

- [ ] **Step 11: Run the full test suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS

- [ ] **Step 12: Commit**

```bash
git add src/lib/topic-article-data-repository.ts tests/fakes/fake-topic-article-data-repository.ts tests/fake-topic-article-data-repository.test.ts src/lib/candidate-topic-repository.ts tests/fakes/fake-candidate-topic-repository.ts tests/fake-candidate-topic-repository.test.ts
git commit -m "feat: add TopicArticleDataRepository and CandidateTopicRepository summary methods"
```

---

### Task 3: RSS keyword → article link capture

**Files:**
- Modify: `src/lib/article-repository.ts`
- Modify: `tests/fakes/fake-article-repository.ts`
- Modify: `tests/fake-article-repository.test.ts`
- Modify: `src/lib/rss-topic-source.ts`
- Modify: `tests/rss-topic-source.test.ts`
- Modify: `src/run-discovery-ingest.ts`

**Interfaces:**
- Consumes: `TopicArticleDataRepository` from Task 2.
- Produces: `RecentArticleTitle { title, categories, url, snippet }` — no other task consumes this directly, but it must stay backward compatible (additive fields only).

- [ ] **Step 1: Update the existing `getRecentTitles` test and add a new one for `url`/`snippet`**

`tests/fake-article-repository.test.ts` already has an exact-shape test for `getRecentTitles` at its end (`it('getRecentTitles returns titles with their categories, for articles created within the given number of days', ...)`), asserting `toEqual([{ title: 'Bài mới', categories: ['tai_chinh'] }])`. `toEqual` fails on extra keys, so once Step 4 below adds `url`/`snippet` to the fake's output this exact test will break — update it in place rather than leaving it to fail. Replace that one `it` block with:

```ts
  it('getRecentTitles returns titles with their categories, url, and snippet, for articles created within the given number of days', async () => {
    const repo = new FakeArticleRepository();
    const now = Date.now();
    repo.articles.push(
      { id: '1', url: 'https://example.com/moi', title: 'Bài mới', published_at: '', source_id: 's', categories: ['tai_chinh'], snippet: 'Tóm tắt bài mới.', full_content: null, content_fetch_status: 'pending', fetch_attempts: 0, created_at: new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString() },
      { id: '2', url: 'https://example.com/cu', title: 'Bài cũ', published_at: '', source_id: 's', categories: [], snippet: '', full_content: null, content_fetch_status: 'pending', fetch_attempts: 0, created_at: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString() }
    );
    const titles = await repo.getRecentTitles(5);
    expect(titles).toEqual([
      { title: 'Bài mới', categories: ['tai_chinh'], url: 'https://example.com/moi', snippet: 'Tóm tắt bài mới.' },
    ]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- fake-article-repository`
Expected: FAIL — `titles[0]` is missing the `url`/`snippet` keys the updated expectation now requires

- [ ] **Step 3: Extend `RecentArticleTitle` and `getRecentTitles` in `src/lib/article-repository.ts`**

Change the interface:

```ts
export interface RecentArticleTitle {
  title: string;
  categories: string[];
  url: string;
  snippet: string;
}
```

Change `SupabaseArticleRepository.getRecentTitles`'s body:

```ts
  async getRecentTitles(days: number) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await this.client
      .from('articles')
      .select('title, categories, url, snippet')
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .limit(5000);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => ({
      title: row.title as string,
      categories: (row.categories as string[] | null) ?? [],
      url: row.url as string,
      snippet: row.snippet as string,
    }));
  }
```

- [ ] **Step 4: Update `FakeArticleRepository.getRecentTitles` in `tests/fakes/fake-article-repository.ts`**

```ts
  async getRecentTitles(days: number) {
    const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;
    return this.articles
      .filter((a) => a.created_at && new Date(a.created_at).getTime() >= sinceMs)
      .map((a) => ({ title: a.title, categories: a.categories, url: a.url, snippet: a.snippet }));
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- fake-article-repository`
Expected: PASS

- [ ] **Step 6: Write the failing tests for `RssTopicSource` writing link rows**

Add to `tests/rss-topic-source.test.ts` (add the import at the top alongside the existing ones, then add these `it` blocks inside the existing `describe('RssTopicSource', ...)`):

```ts
import { FakeTopicArticleDataRepository } from './fakes/fake-topic-article-data-repository';
```

```ts
  it('writes one topic_article_data link row per (article, extracted topic) pair', async () => {
    const repo = new FakeArticleRepository();
    repo.articles.push(makeArticle('1', 'Novaland chào bán cổ phiếu tỉ lệ 3:1'));
    const extractor = new FakeTopicExtractor();
    extractor.topicsByText['Novaland chào bán cổ phiếu tỉ lệ 3:1'] = ['novaland', 'chào bán cổ phiếu'];
    const articleLinkRepo = new FakeTopicArticleDataRepository();
    const source = new RssTopicSource(repo, extractor, articleLinkRepo, () => new Date('2026-10-04T10:00:00Z'));

    await source.fetchCandidates();

    expect(articleLinkRepo.links.map((l) => l.keyword).sort()).toEqual(['chào bán cổ phiếu', 'novaland']);
    expect(articleLinkRepo.links.every((l) => l.article_url === 'https://example.com/1')).toBe(true);
    expect(articleLinkRepo.links.every((l) => l.date === '2026-10-04')).toBe(true);
  });

  it('writes no link rows for an article that produced no topics', async () => {
    const repo = new FakeArticleRepository();
    repo.articles.push(makeArticle('1', 'Tiêu đề không rõ chủ đề'));
    const extractor = new FakeTopicExtractor(); // topicsByText has no entry -> []
    const articleLinkRepo = new FakeTopicArticleDataRepository();
    const source = new RssTopicSource(repo, extractor, articleLinkRepo);

    await source.fetchCandidates();

    expect(articleLinkRepo.links).toEqual([]);
  });

  it('still returns candidates when the link-write fails', async () => {
    const repo = new FakeArticleRepository();
    repo.articles.push(makeArticle('1', 'Giá vàng tăng mạnh'));
    const articleLinkRepo = new FakeTopicArticleDataRepository();
    articleLinkRepo.upsertError = 'simulated failure';
    const source = new RssTopicSource(repo, undefined, articleLinkRepo);

    const candidates = await source.fetchCandidates();

    expect(candidates.some((c) => c.keyword === 'giá vàng')).toBe(true);
  });

  it('still returns candidates when articleLinkRepo.upsertLinks throws', async () => {
    const repo = new FakeArticleRepository();
    repo.articles.push(makeArticle('1', 'Giá vàng tăng mạnh'));
    const articleLinkRepo = {
      upsertLinks: async () => {
        throw new Error('network error');
      },
      getArticlesForDate: async () => [],
    };
    const source = new RssTopicSource(repo, undefined, articleLinkRepo);

    const candidates = await source.fetchCandidates();

    expect(candidates.some((c) => c.keyword === 'giá vàng')).toBe(true);
  });

  it('works with no articleLinkRepo at all (optional dependency)', async () => {
    const repo = new FakeArticleRepository();
    repo.articles.push(makeArticle('1', 'Giá vàng tăng mạnh'));
    const source = new RssTopicSource(repo);

    const candidates = await source.fetchCandidates();

    expect(candidates.some((c) => c.keyword === 'giá vàng')).toBe(true);
  });
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npm test -- rss-topic-source`
Expected: FAIL — `RssTopicSource` constructor doesn't accept a 3rd/4th argument yet, `articleLinkRepo.links` stays undefined/empty

- [ ] **Step 8: Modify `src/lib/rss-topic-source.ts`**

Replace the full file:

```ts
import type { DiscoverySource } from './discovery-source';
import type { RawCandidate, TopicArticleData } from '../types';
import type { ArticleRepository } from './article-repository';
import type { TopicExtractor } from './topic-extractor';
import type { TopicArticleDataRepository } from './topic-article-data-repository';
import { aggregateRssKeywords } from './aggregate-rss-keywords';
import { extractKeywords } from './keyword-extractor';

// metric_value should reflect one day's frequency (per spec §4), not a
// multi-day rolling count — the 7-day growth_rate baseline (rank-and-select.ts)
// already handles the multi-day comparison from candidate_topics' own history.
const LOOKBACK_DAYS = 1;

// Titles per LLM call — full sentences are heavier than the single keywords
// candidate-classifier.ts batches at 50/call, so this stays smaller, matching
// the same-shaped precedent already established for per-article text calls
// (sentiment-engagement-metrics-design.md's 20 bài/lần gọi).
const CHUNK_SIZE = 20;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export class RssTopicSource implements DiscoverySource {
  name = 'rss' as const;

  constructor(
    private repo: Pick<ArticleRepository, 'getRecentTitles'>,
    private extractor?: TopicExtractor,
    private articleLinkRepo?: Pick<TopicArticleDataRepository, 'upsertLinks'>,
    private now: () => Date = () => new Date()
  ) {}

  async fetchCandidates(): Promise<RawCandidate[]> {
    const articles = await this.repo.getRecentTitles(LOOKBACK_DAYS);
    const withTopics: { topics: string[]; categories: string[] }[] = [];
    const linkRows: Partial<TopicArticleData>[] = [];
    const date = this.now().toISOString().slice(0, 10);

    for (const batch of chunk(articles, CHUNK_SIZE)) {
      const titles = batch.map((a) => a.title);
      let topicsPerTitle: string[][];

      if (this.extractor) {
        try {
          topicsPerTitle = await this.extractor.extractTopics(titles);
        } catch (err) {
          // One chunk's LLM failure must not drop or block any other chunk,
          // or RSS's candidates for the day entirely — fall back to the
          // regex extractor for exactly this chunk's titles. Logged (not
          // pushed to result.errors — that's a deliberate scope boundary for
          // this fix wave, see final-fix-report.md finding 3) so a silently
          // failing API key/quota/model doesn't run 100% on regex forever
          // with zero production visibility.
          console.error(
            `RSS topic extraction failed for a chunk of ${titles.length} titles, falling back to regex: ${(err as Error).message}`
          );
          topicsPerTitle = titles.map((t) => extractKeywords(t));
        }
      } else {
        topicsPerTitle = titles.map((t) => extractKeywords(t));
      }

      batch.forEach((article, i) => {
        const topics = topicsPerTitle[i] ?? [];
        withTopics.push({ topics, categories: article.categories });
        for (const topic of topics) {
          linkRows.push({
            keyword: topic,
            source: 'rss',
            date,
            article_url: article.url,
            article_title: article.title,
            article_snippet: article.snippet,
          });
        }
      });
    }

    if (this.articleLinkRepo && linkRows.length > 0) {
      // Best-effort: a failure here must never block RSS's candidates for
      // the day from being discovered — it only means those keywords have
      // no linked source text for the summarize-topics job to find later,
      // which already degrades gracefully (that topic stays unsummarized).
      try {
        const { error } = await this.articleLinkRepo.upsertLinks(linkRows);
        if (error) console.error(`Failed to persist RSS topic→article links: ${error}`);
      } catch (err) {
        console.error(`Failed to persist RSS topic→article links: ${(err as Error).message}`);
      }
    }

    return aggregateRssKeywords(withTopics);
  }
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npm test -- rss-topic-source`
Expected: PASS (all tests in the file, including the 5 new ones)

- [ ] **Step 10: Wire the new repo into `src/run-discovery-ingest.ts`**

Add the import (alongside the other repository imports):

```ts
import { SupabaseTopicArticleDataRepository } from './lib/topic-article-data-repository';
```

Add the construction (after `const articleRepo = new SupabaseArticleRepository(client);`):

```ts
  const articleLinkRepo = new SupabaseTopicArticleDataRepository(client);
```

Change the `RssTopicSource` construction inside the `sources` array:

```ts
    new RssTopicSource(articleRepo, rssTopicExtractor, articleLinkRepo),
```

- [ ] **Step 11: Run the full test suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS

- [ ] **Step 12: Commit**

```bash
git add src/lib/article-repository.ts tests/fakes/fake-article-repository.ts tests/fake-article-repository.test.ts src/lib/rss-topic-source.ts tests/rss-topic-source.test.ts src/run-discovery-ingest.ts
git commit -m "feat: capture RSS keyword-to-article links for later summarization"
```

---

### Task 4: `TopicSummarizer`

**Files:**
- Create: `src/lib/topic-summarizer.ts`
- Create: `tests/fakes/fake-topic-summarizer.ts`
- Create: `tests/topic-summarizer.test.ts`

**Interfaces:**
- Produces: `TopicSummaryInput { keyword: string; texts: string[] }`, `TopicSummarizer { summarizeTopics(inputs): Promise<(string | null)[]> }`, `parseSummaryResponse(content, topicCount): (string | null)[]`, `OpenAiTopicSummarizer`, `FakeTopicSummarizer` — all consumed by Task 5.

- [ ] **Step 1: Write the failing tests for `parseSummaryResponse`**

Create `tests/topic-summarizer.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseSummaryResponse } from '../src/lib/topic-summarizer';

describe('parseSummaryResponse', () => {
  it('parses a valid response into a positional array of summaries', () => {
    const content = JSON.stringify({ '0': 'Giá vàng tăng do nhu cầu trú ẩn.', '1': 'Ngân hàng siết room tín dụng.' });
    expect(parseSummaryResponse(content, 2)).toEqual([
      'Giá vàng tăng do nhu cầu trú ẩn.',
      'Ngân hàng siết room tín dụng.',
    ]);
  });

  it('throws on empty content', () => {
    expect(() => parseSummaryResponse('', 2)).toThrow('Topic summarization returned empty content');
  });

  it('throws on unparseable JSON', () => {
    expect(() => parseSummaryResponse('not json', 2)).toThrow();
  });

  it('throws when no index key is usable for any topic', () => {
    const content = JSON.stringify({ foo: 'bar' });
    expect(() => parseSummaryResponse(content, 2)).toThrow('no usable entries');
  });

  it('nulls out only the malformed index, leaving the others intact', () => {
    const content = JSON.stringify({ '0': 'Tóm tắt hợp lệ.', '1': 42, '2': 'Tóm tắt khác.' });
    expect(parseSummaryResponse(content, 3)).toEqual(['Tóm tắt hợp lệ.', null, 'Tóm tắt khác.']);
  });

  it('treats a blank string value as null', () => {
    const content = JSON.stringify({ '0': '   ' });
    expect(parseSummaryResponse(content, 1)).toEqual([null]);
  });

  it('trims whitespace from a valid summary', () => {
    const content = JSON.stringify({ '0': '  Có khoảng trắng.  ' });
    expect(parseSummaryResponse(content, 1)).toEqual(['Có khoảng trắng.']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- topic-summarizer`
Expected: FAIL — `Cannot find module '../src/lib/topic-summarizer'`

- [ ] **Step 3: Write `src/lib/topic-summarizer.ts`**

```ts
export interface TopicSummaryInput {
  keyword: string;
  texts: string[];
}

export interface TopicSummarizer {
  summarizeTopics(inputs: TopicSummaryInput[]): Promise<(string | null)[]>;
}

const FETCH_TIMEOUT_MS = 60000;
const MODEL = 'gpt-5-nano';
const MAX_TEXTS_PER_TOPIC = 5;
const MAX_CHARS_PER_TEXT = 500;

// Same two-tier failure model as parseTopicsResponse (topic-extractor.ts):
// the WHOLE response being unusable (empty/unparseable, no usable index)
// throws so the caller can skip the whole chunk with a loud log line;
// a single index's value being the wrong shape degrades to null for that
// topic only.
export function parseSummaryResponse(content: string, topicCount: number): (string | null)[] {
  if (!content) {
    throw new Error('Topic summarization returned empty content');
  }

  const parsed = JSON.parse(content) as Record<string, unknown>;

  const hasUsableEntry = Array.from({ length: topicCount }, (_, i) => String(i)).some(
    (key) => key in parsed
  );
  if (!hasUsableEntry) {
    throw new Error('Topic summarization response had no usable entries for any topic');
  }

  return Array.from({ length: topicCount }, (_, i) => {
    const value = parsed[String(i)];
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  });
}

// Real adapter over OpenAI's Chat Completions API, called via native fetch —
// same convention as OpenAiCandidateClassifier/OpenAiTopicExtractor (no
// `openai` npm dependency). Reads a batch of topics, each with up to
// MAX_TEXTS_PER_TOPIC real source texts (article titles+snippets, or Threads
// posts) already truncated to MAX_CHARS_PER_TEXT, and asks for a 1-2
// sentence Vietnamese summary of what's actually being said about each.
// Not unit-tested — verified manually against the live API once deployed,
// same convention as every other real-network adapter in this codebase.
export class OpenAiTopicSummarizer implements TopicSummarizer {
  constructor(private apiKey: string) {}

  async summarizeTopics(inputs: TopicSummaryInput[]): Promise<(string | null)[]> {
    if (inputs.length === 0) return [];

    const numbered = inputs
      .map((input, i) => {
        const texts = input.texts.slice(0, MAX_TEXTS_PER_TOPIC).map((t) => t.slice(0, MAX_CHARS_PER_TEXT));
        return `${i}. Chủ đề "${input.keyword}":\n${texts.map((t) => `- "${t}"`).join('\n')}`;
      })
      .join('\n\n');

    const prompt =
      'Dưới đây là một số chủ đề đang được quan tâm (đánh số), mỗi chủ đề kèm các đoạn trích ' +
      'từ bài báo/bài đăng mạng xã hội thật đã nói về nó. Với mỗi chủ đề, viết 1-2 câu tiếng ' +
      'Việt tóm tắt NỘI DUNG THẬT đang được nói đến (không phải định nghĩa chung về cụm từ đó). ' +
      'Chỉ dựa trên các đoạn trích được cung cấp — không suy diễn thêm.\n\n' +
      'Trả lời bằng đúng 1 JSON object, key là số thứ tự (dạng chuỗi "0", "1", ...), value là ' +
      'một chuỗi tóm tắt. Không thêm giải thích.\n\n' +
      `${numbered}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: MODEL,
          response_format: { type: 'json_object' },
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!response.ok) {
        throw new Error(`OpenAI API request failed: ${response.status}`);
      }
      const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const content = body.choices?.[0]?.message?.content;
      return parseSummaryResponse(content ?? '', inputs.length);
    } finally {
      clearTimeout(timeout);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- topic-summarizer`
Expected: PASS (7 tests)

- [ ] **Step 5: Write `tests/fakes/fake-topic-summarizer.ts`**

```ts
import type { TopicSummarizer, TopicSummaryInput } from '../../src/lib/topic-summarizer';

export class FakeTopicSummarizer implements TopicSummarizer {
  public calls: TopicSummaryInput[][] = [];
  public summaryByKeyword: Record<string, string> = {};
  public shouldThrow = false;

  async summarizeTopics(inputs: TopicSummaryInput[]): Promise<(string | null)[]> {
    this.calls.push(inputs);
    if (this.shouldThrow) {
      throw new Error('FakeTopicSummarizer: summarizeTopics failed');
    }
    return inputs.map((i) => this.summaryByKeyword[i.keyword] ?? null);
  }
}
```

- [ ] **Step 6: Write a small test file to pin the fake's own behavior**

Create `tests/fake-topic-summarizer.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { FakeTopicSummarizer } from './fakes/fake-topic-summarizer';

describe('FakeTopicSummarizer', () => {
  it('returns the configured summary for a matching keyword, null otherwise', async () => {
    const fake = new FakeTopicSummarizer();
    fake.summaryByKeyword['vàng'] = 'Giá vàng tăng.';

    const result = await fake.summarizeTopics([{ keyword: 'vàng', texts: ['t'] }, { keyword: 'khác', texts: ['t'] }]);

    expect(result).toEqual(['Giá vàng tăng.', null]);
    expect(fake.calls).toHaveLength(1);
  });

  it('throws when shouldThrow is set', async () => {
    const fake = new FakeTopicSummarizer();
    fake.shouldThrow = true;
    await expect(fake.summarizeTopics([{ keyword: 'x', texts: [] }])).rejects.toThrow();
  });
});
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npm test -- fake-topic-summarizer`
Expected: PASS (2 tests)

- [ ] **Step 8: Run the full test suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/lib/topic-summarizer.ts tests/fakes/fake-topic-summarizer.ts tests/topic-summarizer.test.ts tests/fake-topic-summarizer.test.ts
git commit -m "feat: add TopicSummarizer for LLM-based topic content summaries"
```

---

### Task 5: `summarize-topics.ts` orchestration

**Files:**
- Create: `src/summarize-topics.ts`
- Create: `tests/summarize-topics.test.ts`

**Interfaces:**
- Consumes: `CandidateTopicRepository.getShortlistedCandidates`/`.updateSummary` (Task 2), `TopicArticleDataRepository.getArticlesForDate` (Task 2), `TopicSocialDataRepository.getPostsForDate` (already exists), `TopicSummarizer.summarizeTopics` (Task 4).
- Produces: `summarizeTopics(deps: SummarizeDeps): Promise<SummarizeResult>`, `SummarizeDeps { candidateRepo, articleLinkRepo, socialRepo, summarizer, now? }`, `SummarizeResult { evaluated, summarized, errors }` — consumed by Task 6's entry point.

- [ ] **Step 1: Write the failing tests**

Create `tests/summarize-topics.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { summarizeTopics } from '../src/summarize-topics';
import { FakeCandidateTopicRepository } from './fakes/fake-candidate-topic-repository';
import { FakeTopicArticleDataRepository } from './fakes/fake-topic-article-data-repository';
import { FakeTopicSocialDataRepository } from './fakes/fake-topic-social-data-repository';
import { FakeTopicSummarizer } from './fakes/fake-topic-summarizer';
import type { CandidateTopic } from '../src/types';

const TODAY = '2026-10-04';

function candidate(overrides: Partial<CandidateTopic> = {}): CandidateTopic {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    source: 'rss',
    keyword: 'vàng',
    date: TODAY,
    metric_value: 1,
    growth_rate: null,
    category_hint: [],
    is_shortlisted: true,
    ...overrides,
  };
}

function makeDeps() {
  return {
    candidateRepo: new FakeCandidateTopicRepository(),
    articleLinkRepo: new FakeTopicArticleDataRepository(),
    socialRepo: new FakeTopicSocialDataRepository(),
    summarizer: new FakeTopicSummarizer(),
    now: () => new Date(`${TODAY}T10:00:00Z`),
  };
}

describe('summarizeTopics', () => {
  it('summarizes an RSS topic using its linked article text', async () => {
    const deps = makeDeps();
    deps.candidateRepo.candidates.push(candidate({ id: '1', source: 'rss', keyword: 'vàng' }));
    deps.articleLinkRepo.links.push({
      keyword: 'vàng',
      source: 'rss',
      date: TODAY,
      article_url: 'https://a.com/1',
      article_title: 'Giá vàng tăng mạnh',
      article_snippet: 'Vàng SJC tăng 2 triệu đồng/lượng.',
    });
    deps.summarizer.summaryByKeyword['vàng'] = 'Giá vàng SJC tăng mạnh trong ngày.';

    const result = await summarizeTopics(deps);

    expect(result).toEqual({ evaluated: 1, summarized: 1, errors: [] });
    expect(deps.candidateRepo.candidates[0].summary).toBe('Giá vàng SJC tăng mạnh trong ngày.');
    expect(deps.summarizer.calls[0]).toEqual([
      { keyword: 'vàng', texts: ['Giá vàng tăng mạnh. Vàng SJC tăng 2 triệu đồng/lượng.'] },
    ]);
  });

  it('summarizes a Threads topic using its linked post text', async () => {
    const deps = makeDeps();
    deps.candidateRepo.candidates.push(candidate({ id: '1', source: 'threads', keyword: 'ngân hàng' }));
    deps.socialRepo.posts.push({
      id: 'p1',
      keyword: 'ngân hàng',
      source: 'threads',
      date: TODAY,
      post_url: 'https://threads.net/p/1',
      text_content: 'Ngân hàng X vừa tăng lãi suất tiết kiệm.',
      like_count: null,
      reply_count: null,
      repost_count: null,
      quote_count: null,
      share_count: null,
      view_count: null,
      posted_at: null,
    });
    deps.summarizer.summaryByKeyword['ngân hàng'] = 'Một ngân hàng tăng lãi suất tiết kiệm.';

    const result = await summarizeTopics(deps);

    expect(result.summarized).toBe(1);
    expect(deps.candidateRepo.candidates[0].summary).toBe('Một ngân hàng tăng lãi suất tiết kiệm.');
  });

  it('never summarizes a google_trends or youtube candidate', async () => {
    const deps = makeDeps();
    deps.candidateRepo.candidates.push(
      candidate({ id: '1', source: 'google_trends', keyword: 'bitcoin' }),
      candidate({ id: '2', source: 'youtube', keyword: 'minecraft' })
    );

    const result = await summarizeTopics(deps);

    expect(result).toEqual({ evaluated: 0, summarized: 0, errors: [] });
    expect(deps.summarizer.calls).toEqual([]);
  });

  it('skips a shortlisted rss/threads topic with no linked source text, without calling the summarizer for it', async () => {
    const deps = makeDeps();
    deps.candidateRepo.candidates.push(
      candidate({ id: '1', source: 'rss', keyword: 'no-text-topic' }),
      candidate({ id: '2', source: 'rss', keyword: 'has-text-topic' })
    );
    deps.articleLinkRepo.links.push({
      keyword: 'has-text-topic',
      source: 'rss',
      date: TODAY,
      article_url: 'https://a.com/1',
      article_title: 'Bài có nội dung',
      article_snippet: '',
    });
    deps.summarizer.summaryByKeyword['has-text-topic'] = 'Tóm tắt.';

    const result = await summarizeTopics(deps);

    expect(result.evaluated).toBe(2);
    expect(result.summarized).toBe(1);
    const calledKeywords = deps.summarizer.calls.flat().map((i) => i.keyword);
    expect(calledKeywords).toEqual(['has-text-topic']);
    expect(deps.candidateRepo.candidates.find((c) => c.keyword === 'no-text-topic')?.summary).toBeUndefined();
  });

  it('does not block other chunks when one chunk throws', async () => {
    const deps = makeDeps();
    // CHUNK_SIZE is 10 — 11 summarizable topics split across 2 chunks.
    for (let i = 0; i < 11; i++) {
      deps.candidateRepo.candidates.push(candidate({ id: `c${i}`, source: 'rss', keyword: `topic-${i}` }));
      deps.articleLinkRepo.links.push({
        keyword: `topic-${i}`,
        source: 'rss',
        date: TODAY,
        article_url: `https://a.com/${i}`,
        article_title: `Bài ${i}`,
        article_snippet: '',
      });
      deps.summarizer.summaryByKeyword[`topic-${i}`] = `Tóm tắt ${i}.`;
    }
    let callCount = 0;
    const originalSummarize = deps.summarizer.summarizeTopics.bind(deps.summarizer);
    deps.summarizer.summarizeTopics = async (inputs) => {
      callCount += 1;
      if (callCount === 1) throw new Error('first chunk failed');
      return originalSummarize(inputs);
    };

    const result = await summarizeTopics(deps);

    expect(callCount).toBe(2);
    expect(result.summarized).toBe(1); // only the second chunk's 1 topic succeeded
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('summarization failed for a chunk');
  });

  it('records an error but keeps other topics unaffected when updateSummary fails for one row', async () => {
    const deps = makeDeps();
    deps.candidateRepo.candidates.push(
      candidate({ id: '1', source: 'rss', keyword: 'a' }),
      candidate({ id: '2', source: 'rss', keyword: 'b' })
    );
    deps.articleLinkRepo.links.push(
      { keyword: 'a', source: 'rss', date: TODAY, article_url: 'https://a.com/1', article_title: 'A', article_snippet: '' },
      { keyword: 'b', source: 'rss', date: TODAY, article_url: 'https://a.com/2', article_title: 'B', article_snippet: '' }
    );
    deps.summarizer.summaryByKeyword['a'] = 'Tóm tắt A.';
    deps.summarizer.summaryByKeyword['b'] = 'Tóm tắt B.';
    const originalUpdateSummary = deps.candidateRepo.updateSummary.bind(deps.candidateRepo);
    deps.candidateRepo.updateSummary = async (id: string, summary: string) => {
      if (id === '1') return { error: 'simulated db failure' };
      return originalUpdateSummary(id, summary);
    };

    const result = await summarizeTopics(deps);

    expect(result.summarized).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(deps.candidateRepo.candidates.find((c) => c.id === '2')?.summary).toBe('Tóm tắt B.');
  });

  it('returns an empty result when nothing is shortlisted today, without calling the summarizer', async () => {
    const deps = makeDeps();
    const result = await summarizeTopics(deps);
    expect(result).toEqual({ evaluated: 0, summarized: 0, errors: [] });
    expect(deps.summarizer.calls).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- summarize-topics`
Expected: FAIL — `Cannot find module '../src/summarize-topics'`

- [ ] **Step 3: Write `src/summarize-topics.ts`**

```ts
import type { CandidateTopicRepository } from './lib/candidate-topic-repository';
import type { TopicArticleDataRepository } from './lib/topic-article-data-repository';
import type { TopicSocialDataRepository } from './lib/topic-social-data-repository';
import type { TopicSummarizer } from './lib/topic-summarizer';
import type { CandidateTopic } from './types';

const SUMMARIZABLE_SOURCES = new Set<CandidateTopic['source']>(['rss', 'threads']);
const CHUNK_SIZE = 10;

export interface SummarizeDeps {
  candidateRepo: CandidateTopicRepository;
  articleLinkRepo: TopicArticleDataRepository;
  socialRepo: TopicSocialDataRepository;
  summarizer: TopicSummarizer;
  now?: () => Date;
}

export interface SummarizeResult {
  evaluated: number;
  summarized: number;
  errors: string[];
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

export async function summarizeTopics(deps: SummarizeDeps): Promise<SummarizeResult> {
  const now = deps.now ?? (() => new Date());
  const today = now().toISOString().slice(0, 10);
  const result: SummarizeResult = { evaluated: 0, summarized: 0, errors: [] };

  const candidates = (await deps.candidateRepo.getShortlistedCandidates(today)).filter((c) =>
    SUMMARIZABLE_SOURCES.has(c.source)
  );
  if (candidates.length === 0) return result;
  result.evaluated = candidates.length;

  const [articles, posts] = await Promise.all([
    deps.articleLinkRepo.getArticlesForDate(today),
    deps.socialRepo.getPostsForDate(today),
  ]);

  const articlesByKeyword = new Map<string, string[]>();
  for (const a of articles) {
    const list = articlesByKeyword.get(a.keyword) ?? [];
    list.push(`${a.article_title}. ${a.article_snippet}`.trim());
    articlesByKeyword.set(a.keyword, list);
  }
  const postsByKeyword = new Map<string, string[]>();
  for (const p of posts) {
    const list = postsByKeyword.get(p.keyword) ?? [];
    list.push(p.text_content);
    postsByKeyword.set(p.keyword, list);
  }

  const inputs = candidates.map((c) => ({
    candidate: c,
    texts: c.source === 'rss' ? articlesByKeyword.get(c.keyword) ?? [] : postsByKeyword.get(c.keyword) ?? [],
  }));
  // A candidate with no linked source text (link write failed earlier, or
  // data from before this feature existed) can't be grounded in anything
  // real — skip it rather than sending an empty-text prompt.
  const summarizable = inputs.filter((i) => i.texts.length > 0);

  for (const batch of chunk(summarizable, CHUNK_SIZE)) {
    try {
      const summaries = await deps.summarizer.summarizeTopics(
        batch.map((b) => ({ keyword: b.candidate.keyword, texts: b.texts }))
      );
      for (let i = 0; i < batch.length; i++) {
        const summary = summaries[i];
        if (!summary) continue;
        const { error } = await deps.candidateRepo.updateSummary(batch[i].candidate.id!, summary);
        if (error) {
          result.errors.push(`update failed for "${batch[i].candidate.keyword}": ${error}`);
        } else {
          result.summarized++;
        }
      }
    } catch (err) {
      // One chunk's LLM failure must not block any other chunk's topics —
      // same isolation principle as rss-topic-source.ts's chunk fallback.
      // There is no regex fallback for "what is this about" (unlike keyword
      // extraction) — these topics simply stay unsummarized (summary: null)
      // until tomorrow's run.
      result.errors.push(
        `summarization failed for a chunk of ${batch.length} topic(s): ${(err as Error).message}`
      );
    }
  }

  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- summarize-topics`
Expected: PASS (8 tests)

- [ ] **Step 5: Run the full test suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/summarize-topics.ts tests/summarize-topics.test.ts
git commit -m "feat: orchestrate daily topic summarization for rss/threads candidates"
```

---

### Task 6: Pipeline entry point + workflow job

**Files:**
- Create: `src/run-summarize-topics.ts`
- Modify: `package.json`
- Modify: `.github/workflows/discovery-ingestion.yml`
- Modify: `tests/discovery-workflow.test.ts`

**Interfaces:**
- Consumes: `summarizeTopics` (Task 5), `SupabaseTopicArticleDataRepository` (Task 2), `SupabaseTopicSocialDataRepository` (existing), `OpenAiTopicSummarizer` (Task 4).

- [ ] **Step 1: Write the failing test for the workflow**

In `tests/discovery-workflow.test.ts`, replace the first `it` block (`'defines all four jobs'`) and add 2 new ones. The full updated describe block:

```ts
describe('.github/workflows/discovery-ingestion.yml', () => {
  const doc = load(readFileSync('.github/workflows/discovery-ingestion.yml', 'utf8')) as any;

  it('defines all five jobs', () => {
    expect(Object.keys(doc.jobs)).toEqual([
      'discovery-ingest',
      'deep-crawl',
      'rank-and-select',
      'aggregate-engagement',
      'summarize-topics',
    ]);
  });

  // ...existing it blocks for discovery-ingest/deep-crawl/rank-and-select/aggregate-engagement stay unchanged...

  it('gates summarize-topics on rank-and-select and deep-crawl via needs', () => {
    expect(doc['jobs']['summarize-topics']['needs']).toEqual(['rank-and-select', 'deep-crawl']);
  });

  it('runs summarize-topics even if an earlier job failed, as long as it was not cancelled', () => {
    expect(doc['jobs']['summarize-topics']['if']).toBe('${{ !cancelled() }}');
  });

  it('passes OPENAI_API_KEY through to summarize-topics', () => {
    const step = doc['jobs']['summarize-topics']['steps'].find((s: any) => s.run === 'npm run summarize-topics');
    expect(step?.env?.OPENAI_API_KEY).toBe('${{ secrets.OPENAI_API_KEY }}');
  });
});
```

(Keep every existing `it` block in the file exactly as-is other than the `'defines all four jobs'` one — only that one's name/assertion changes to `'defines all five jobs'` with the 5-item array above.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- discovery-workflow`
Expected: FAIL — only 4 jobs exist, `summarize-topics` job is undefined

- [ ] **Step 3: Add the `summarize-topics` job to `.github/workflows/discovery-ingestion.yml`**

Add after the existing `aggregate-engagement` job (at the end of the `jobs:` map):

```yaml
  summarize-topics:
    needs: [rank-and-select, deep-crawl]
    if: ${{ !cancelled() }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run summarize-topics
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- discovery-workflow`
Expected: PASS

- [ ] **Step 5: Add the npm script to `package.json`**

Add to the `"scripts"` object (after `"aggregate-engagement"`):

```json
    "summarize-topics": "tsx src/run-summarize-topics.ts"
```

- [ ] **Step 6: Write `src/run-summarize-topics.ts`**

```ts
import { createClient } from '@supabase/supabase-js';
import { getRequiredEnv } from './lib/env';
import { SupabaseCandidateTopicRepository } from './lib/candidate-topic-repository';
import { SupabaseTopicArticleDataRepository } from './lib/topic-article-data-repository';
import { SupabaseTopicSocialDataRepository } from './lib/topic-social-data-repository';
import { OpenAiTopicSummarizer } from './lib/topic-summarizer';
import { summarizeTopics } from './summarize-topics';

async function main() {
  const client = createClient(getRequiredEnv('SUPABASE_URL'), getRequiredEnv('SUPABASE_SERVICE_KEY'));
  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    console.log('OPENAI_API_KEY not set — skipping topic summarization.');
    return;
  }

  const result = await summarizeTopics({
    candidateRepo: new SupabaseCandidateTopicRepository(client),
    articleLinkRepo: new SupabaseTopicArticleDataRepository(client),
    socialRepo: new SupabaseTopicSocialDataRepository(client),
    summarizer: new OpenAiTopicSummarizer(openaiApiKey),
  });

  console.log(`evaluated=${result.evaluated} summarized=${result.summarized} errors=${result.errors.length}`);
  if (result.errors.length > 0) {
    result.errors.forEach((e) => console.error(`  - ${e}`));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
```

- [ ] **Step 7: Run the full test suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/run-summarize-topics.ts package.json .github/workflows/discovery-ingestion.yml tests/discovery-workflow.test.ts
git commit -m "feat: add summarize-topics pipeline entry point and workflow job"
```

---

### Task 7: Dashboard read path — `hot-topics.ts`, `trending.ts`, `candidate-topics-reader.ts`

**Files:**
- Modify: `dashboard/lib/hot-topics.ts`
- Modify: `dashboard/lib/trending.ts`
- Modify: `dashboard/lib/candidate-topics-reader.ts`
- Modify: `dashboard/tests/hot-topics.test.ts`
- Modify: `dashboard/tests/trending.test.ts`

**Interfaces:**
- Consumes: `CandidateTopic.summary` (Task 1).
- Produces: `HotTopicRow.summary?: string | null`, `flattenAndRankHotTopics` carrying/falling back on `summary` through its merge — consumed by Task 8 (`topics-api.ts`) and Task 9 (the new page).

- [ ] **Step 1: Write the failing tests**

Add to `dashboard/tests/hot-topics.test.ts` (inside `describe('buildHotTopicsForCategory', ...)` and `describe('buildHotTopicsOverview', ...)` respectively, as new `it` blocks):

```ts
  it('carries the candidate summary through onto the row', () => {
    const c = candidate({ id: 'a', summary: 'Tóm tắt test.' });
    const result = buildHotTopicsForCategory([c], 'tai_chinh');
    expect(result.rss[0].summary).toBe('Tóm tắt test.');
  });

  it('defaults summary to null when the candidate has none', () => {
    const c = candidate({ id: 'a' });
    const result = buildHotTopicsForCategory([c], 'tai_chinh');
    expect(result.rss[0].summary).toBeNull();
  });
```

```ts
  it('carries the candidate summary through onto the row', () => {
    const c = candidate({ id: 'a', category_hint: ['tai_chinh'], is_shortlisted: true, summary: 'Tóm tắt test.' });
    const result = buildHotTopicsOverview([c], ['tai_chinh', 'giai_tri', 'du_lich']);
    expect(result.rss[0].summary).toBe('Tóm tắt test.');
  });
```

Add to `dashboard/tests/trending.test.ts`, inside `describe('merging the same keyword found by more than one source', ...)`:

```ts
    it('keeps the non-null summary when the best-tier merge representative has none', () => {
      const bySource = {
        google_trends: [row({ id: 'gt', keyword: 'ngân hàng', trendingScore: 1000, summary: null })],
        youtube: [],
        threads: [row({ id: 'th', keyword: 'ngân hàng', trendingScore: 100, summary: 'Một ngân hàng tăng lãi suất.' })],
        rss: [],
        facebook: [],
      };
      const result = flattenAndRankHotTopics(bySource);
      expect(result).toHaveLength(1);
      // google_trends ranks better (real % tier), so it's the representative...
      expect(result[0].source).toBe('google_trends');
      // ...but the merged row must still carry the real summary from threads.
      expect(result[0].summary).toBe('Một ngân hàng tăng lãi suất.');
    });

    it('keeps the representative\'s own summary when it already has one', () => {
      const bySource = {
        google_trends: [row({ id: 'gt', keyword: 'ngân hàng', trendingScore: 1000, summary: 'Tóm tắt từ Google Trends.' })],
        youtube: [],
        threads: [row({ id: 'th', keyword: 'ngân hàng', trendingScore: 100, summary: 'Tóm tắt từ Threads.' })],
        rss: [],
        facebook: [],
      };
      const result = flattenAndRankHotTopics(bySource);
      expect(result[0].summary).toBe('Tóm tắt từ Google Trends.');
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd dashboard && npm test -- hot-topics trending`
Expected: FAIL — `result.rss[0].summary` is `undefined`, not `'Tóm tắt test.'`/`null`; the merge test's `summary` property doesn't exist on `row()`'s return type usage

- [ ] **Step 3: Add `summary` to `HotTopicRow` and thread it through in `dashboard/lib/hot-topics.ts`**

Add to the `HotTopicRow` interface (after `sources?: CandidateTopic['source'][];`):

```ts
  summary?: string | null; // candidate_topics.summary — a short LLM-generated
  // description of what's actually being said about this topic. null for
  // google_trends/youtube rows (no source text exists to summarize) or an
  // rss/threads row the daily summarize-topics job hasn't reached yet.
```

In `buildHotTopicsForCategory`, add `summary: c.summary ?? null,` to the `rows` map's returned object (alongside `categoryHint`/`createdAt`).

In `buildHotTopicsOverview`, add the same `summary: c.summary ?? null,` to its `rows` map's returned object.

- [ ] **Step 4: Add the merge fallback in `dashboard/lib/trending.ts`**

In `mergeSameKeyword`, change the `merged.push({...})` call to add one more field:

```ts
    merged.push({
      ...representative,
      source: dominant.source,
      sources: Array.from(new Set(group.map((r) => r.source))).sort(),
      metricValue: group.reduce((sum, r) => sum + r.metricValue, 0),
      shareOfVoice: null,
      categoryHint: Array.from(new Set(group.flatMap((r) => r.categoryHint ?? []))),
      createdAt,
      summary: representative.summary ?? group.map((r) => r.summary).find((s) => s != null) ?? null,
    });
```

- [ ] **Step 5: Add `summary` to the 3 explicit column lists in `dashboard/lib/candidate-topics-reader.ts`**

In `getCandidatesForDate`, `getHistoryForKeyword`, and `getShortlistedForDateRange`, change each `.select('id, source, keyword, date, metric_value, growth_rate, category_hint, is_shortlisted, created_at')` to:

```ts
        .select('id, source, keyword, date, metric_value, growth_rate, category_hint, is_shortlisted, created_at, summary')
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd dashboard && npm test -- hot-topics trending`
Expected: PASS

- [ ] **Step 7: Run the full dashboard test suite and typecheck**

Run: `cd dashboard && npm test && npm run typecheck`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add dashboard/lib/hot-topics.ts dashboard/lib/trending.ts dashboard/lib/candidate-topics-reader.ts dashboard/tests/hot-topics.test.ts dashboard/tests/trending.test.ts
git commit -m "feat: thread candidate_topics.summary through the hot-topics read path"
```

---

### Task 8: Public API + topic detail page summary

**Files:**
- Modify: `dashboard/lib/topics-api.ts`
- Modify: `dashboard/tests/topics-api.test.ts`
- Modify: `dashboard/lib/topic-detail.ts`
- Modify: `dashboard/tests/topic-detail.test.ts`
- Modify: `dashboard/app/topic/[keyword]/page.tsx`

**Interfaces:**
- Consumes: `HotTopicRow.summary` (Task 7).
- Produces: `TopicApiItem.summary: string | null`, `TopicDetailData.summary: string | null` — `TopicApiItem` is consumed by the already-live `/api/topics` public endpoint (backward-compatible additive field); `TopicDetailData.summary` is consumed by the page render in this same task.

- [ ] **Step 1: Write the failing test for `topics-api.ts`**

In `dashboard/tests/topics-api.test.ts`, update the exact-shape test (`'shapes each topic with keyword/source/sources/category/metricValue/trendingScore/shareOfVoice'`) to also expect `summary`:

```ts
  it('shapes each topic with keyword/source/sources/category/metricValue/trendingScore/shareOfVoice/summary', async () => {
    const reader = new FakeCandidateTopicsReader([candidate()]);
    const result = await getTopicsForDate(reader, 'tai_chinh');
    expect(result.topics).toEqual([
      {
        keyword: 'bitcoin',
        source: 'rss',
        sources: ['rss'],
        category: ['tai_chinh'],
        metricValue: 10,
        trendingScore: 50,
        shareOfVoice: 100,
        summary: null,
      },
    ]);
  });
```

Add one new test right after it:

```ts
  it('passes a non-null summary through', async () => {
    const reader = new FakeCandidateTopicsReader([candidate({ summary: 'Tóm tắt test.' })]);
    const result = await getTopicsForDate(reader, 'tai_chinh');
    expect(result.topics[0].summary).toBe('Tóm tắt test.');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd dashboard && npm test -- topics-api`
Expected: FAIL — `result.topics[0]` has no `summary` key

- [ ] **Step 3: Add `summary` to `TopicApiItem` and thread it through in `dashboard/lib/topics-api.ts`**

Add to the `TopicApiItem` interface (after `shareOfVoice: number | null;`):

```ts
  summary: string | null; // what's actually being said about this topic —
  // null for google_trends/youtube (no source text exists to summarize)
  // or an rss/threads topic the daily summarization job hasn't reached yet.
```

Add to the `topics` map in `getTopicsForDate` (after `shareOfVoice: row.shareOfVoice,`):

```ts
    summary: row.summary ?? null,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd dashboard && npm test -- topics-api`
Expected: PASS

- [ ] **Step 5: Write the failing tests for `topic-detail.ts`**

Add to `dashboard/tests/topic-detail.test.ts`, inside `describe('computeTopicDetail', ...)`:

```ts
  it('resolves summary from the latest-dated candidate row that has one', () => {
    const result = computeTopicDetail(
      'bitcoin',
      [
        candidate({ id: 'a', date: '2026-08-17', summary: 'Tóm tắt cũ.' }),
        candidate({ id: 'b', date: '2026-08-18', summary: 'Tóm tắt mới nhất.' }),
      ],
      [],
      ['2026-08-17', '2026-08-18']
    );
    expect(result?.summary).toBe('Tóm tắt mới nhất.');
  });

  it('skips a null/empty summary in favor of an earlier non-empty one', () => {
    const result = computeTopicDetail(
      'bitcoin',
      [
        candidate({ id: 'a', date: '2026-08-17', summary: 'Tóm tắt có nội dung.' }),
        candidate({ id: 'b', date: '2026-08-18', summary: '' }),
      ],
      [],
      ['2026-08-17', '2026-08-18']
    );
    expect(result?.summary).toBe('Tóm tắt có nội dung.');
  });

  it('returns null summary when no row has one', () => {
    const result = computeTopicDetail('bitcoin', [candidate({ date: '2026-08-18' })], [], ['2026-08-18']);
    expect(result?.summary).toBeNull();
  });
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd dashboard && npm test -- topic-detail`
Expected: FAIL — `result?.summary` is `undefined`

- [ ] **Step 7: Add `resolveSummary` and wire it into `TopicDetailData`/`computeTopicDetail` in `dashboard/lib/topic-detail.ts`**

Add to the `TopicDetailData` interface (after `sources: CandidateTopic['source'][];`):

```ts
  summary: string | null;
```

Add the function (after `resolveSources`):

```ts
// Same "latest date wins" resolution convention as resolveCategory, but
// skipping any row whose summary is null/empty rather than tracking "the
// date of whichever row last supplied a value" — a topic can have several
// same-day rows (one per source) and only some of them get summarized.
function resolveSummary(candidateHistory: CandidateTopic[]): string | null {
  const withSummary = candidateHistory.filter((c) => c.summary != null && c.summary !== '');
  if (withSummary.length === 0) return null;
  return [...withSummary].sort((a, b) => b.date.localeCompare(a.date))[0].summary!;
}
```

Add `summary: resolveSummary(candidateHistory),` to the object returned by `computeTopicDetail` (after `sources: resolveSources(candidateHistory),`).

- [ ] **Step 8: Run test to verify it passes**

Run: `cd dashboard && npm test -- topic-detail`
Expected: PASS

- [ ] **Step 9: Render the summary on the topic detail page**

In `dashboard/app/topic/[keyword]/page.tsx`, add a new section right after the opening `<div className="flex items-center gap-3 flex-wrap">...</div>` block and before the "Trending Score" `<div>`:

```tsx
        {detail.summary && (
          <div className="bg-surface border border-line rounded-card shadow-card p-6">
            <h2 className="text-base font-bold text-ink mb-2">Nội dung đang nói gì</h2>
            <p className="text-sm text-ink-2">{detail.summary}</p>
          </div>
        )}
```

- [ ] **Step 10: Run the full dashboard test suite and typecheck**

Run: `cd dashboard && npm test && npm run typecheck`
Expected: PASS

- [ ] **Step 11: Commit**

```bash
git add dashboard/lib/topics-api.ts dashboard/tests/topics-api.test.ts dashboard/lib/topic-detail.ts dashboard/tests/topic-detail.test.ts dashboard/app/topic/[keyword]/page.tsx
git commit -m "feat: surface topic summary on the public API and topic detail page"
```

---

### Task 9: "Bản tin hôm nay" daily brief page

**Files:**
- Create: `dashboard/components/TopicBriefCard.tsx`
- Create: `dashboard/app/ban-tin/page.tsx`
- Modify: `dashboard/components/layout/Sidebar.tsx`
- Create: `dashboard/tests/topic-brief-card.test.tsx` (if the project has component-render tests already — see Step 1 check)

**Interfaces:**
- Consumes: `getHotTopics` (existing), `flattenAndRankHotTopics` (existing, now carries `summary` per Task 7), `CATEGORIES` (existing), `HotTopicRow.summary` (Task 7).

This task is UI-only. Check first whether this project has any existing `.test.tsx` component-render test (e.g. via `grep -rl "render(" dashboard/tests` or checking `dashboard/package.json`'s dev dependencies for `@testing-library/react`). Every component in this codebase so far (`TrendingTable.tsx`, `KpiCard.tsx`, etc.) has **no** render test — only the pure data-shaping functions they consume (`flattenAndRankHotTopics`, `buildHotTopicsForCategory`, etc.) are unit-tested, and those are already covered by Task 7. Follow that existing convention: no new test file for `TopicBriefCard.tsx` or the page itself. Verification for this task is `npm run typecheck`, `npm run build` succeeding, and a manual check (Step 6 below) using the `run` skill.

- [ ] **Step 1: Confirm there is no existing component-test convention to break**

Run: `cd dashboard && grep -rl "@testing-library" package.json || echo "no component-render testing library in use"`
Expected: `no component-render testing library in use` (confirms following the "no render tests" convention is correct, not a gap)

- [ ] **Step 2: Write `dashboard/components/TopicBriefCard.tsx`**

```tsx
import Link from 'next/link';
import { formatTrendingScore } from '../lib/hot-topic-format';
import type { HotTopicRow } from '../lib/hot-topics';

export function TopicBriefCard({ row }: { row: HotTopicRow }) {
  return (
    <Link
      href={`/topic/${encodeURIComponent(row.keyword)}`}
      className="block bg-surface border border-line rounded-card shadow-card p-5 hover:border-brand transition-colors"
    >
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <h3 className="text-sm font-bold text-ink truncate">{row.keyword}</h3>
        <span className="text-xs font-bold text-ink-2 whitespace-nowrap flex-shrink-0">
          {formatTrendingScore(row.trendingScore)}
        </span>
      </div>
      {row.summary ? (
        <p className="text-sm text-ink-2 line-clamp-2">{row.summary}</p>
      ) : (
        <p className="text-xs text-ink-3">{row.metricValue.toLocaleString('vi-VN')} lượt</p>
      )}
    </Link>
  );
}
```

- [ ] **Step 3: Write `dashboard/app/ban-tin/page.tsx`**

```tsx
import { createServerSupabaseClient } from '../../lib/supabase';
import { SupabaseCandidateTopicsReader } from '../../lib/candidate-topics-reader';
import { getHotTopics, type HotTopicsResult } from '../../lib/get-hot-topics';
import { flattenAndRankHotTopics } from '../../lib/trending';
import { CATEGORIES } from '../../lib/categories';
import { TopicBriefCard } from '../../components/TopicBriefCard';
import { Topbar } from '../../components/layout/Topbar';
import type { HotTopicRow } from '../../lib/hot-topics';

export const dynamic = 'force-dynamic';

const OVERALL_LIMIT = 10;
const SECTOR_LIMIT = 5;

async function loadOverall(): Promise<{ date: string | null; rows: HotTopicRow[] } | { error: string }> {
  try {
    const client = createServerSupabaseClient();
    const reader = new SupabaseCandidateTopicsReader(client);
    const result: HotTopicsResult = await getHotTopics(reader, null);
    const ranked = flattenAndRankHotTopics(result.bySource);
    return { date: result.date, rows: ranked.slice(0, OVERALL_LIMIT) };
  } catch (err) {
    console.error(err);
    return { error: 'Không tải được dữ liệu, vui lòng thử lại sau.' };
  }
}

async function loadSector(category: string, date: string | null): Promise<HotTopicRow[]> {
  if (date === null) return [];
  try {
    const client = createServerSupabaseClient();
    const reader = new SupabaseCandidateTopicsReader(client);
    const result = await getHotTopics(reader, category, date);
    return flattenAndRankHotTopics(result.bySource).slice(0, SECTOR_LIMIT);
  } catch (err) {
    console.error(err);
    return [];
  }
}

export default async function BanTinPage() {
  const overall = await loadOverall();
  const date = 'error' in overall ? null : overall.date;

  const sectorRows = await Promise.all(CATEGORIES.map((c) => loadSector(c.value, date)));

  return (
    <>
      <Topbar title="Bản tin hôm nay" />
      <main className="max-w-4xl mx-auto p-6 space-y-8">
        <section>
          <h2 className="text-base font-bold text-ink mb-4">Tổng hợp</h2>
          {'error' in overall ? (
            <p className="text-red-600">{overall.error}</p>
          ) : overall.rows.length === 0 ? (
            <p className="text-sm text-ink-3">Chưa có dữ liệu.</p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {overall.rows.map((row) => (
                <TopicBriefCard key={row.id} row={row} />
              ))}
            </div>
          )}
        </section>

        {CATEGORIES.map((categoryDef, i) => {
          const rows = sectorRows[i];
          return (
            <section key={categoryDef.value}>
              <h2 className="text-base font-bold text-ink mb-4 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: categoryDef.color }} />
                {categoryDef.label}
              </h2>
              {rows.length === 0 ? (
                <p className="text-sm text-ink-3">Chưa có dữ liệu.</p>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {rows.map((row) => (
                    <TopicBriefCard key={row.id} row={row} />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </main>
    </>
  );
}
```

- [ ] **Step 4: Add the Sidebar nav link**

In `dashboard/components/layout/Sidebar.tsx`, add a new `<Link>` between the existing "Overview" and "Trending Now" links (same structure, swap the icon path and label/href):

```tsx
          <Link
            href="/ban-tin"
            aria-current={pathname === '/ban-tin' ? 'page' : undefined}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-[10px] text-sm font-medium transition-colors ${
              pathname === '/ban-tin'
                ? 'bg-brand-faint text-brand font-semibold'
                : 'text-ink-2 hover:bg-muted hover:text-ink'
            }`}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 4h16v12H8l-4 4V4z" />
              <line x1="7" y1="8" x2="17" y2="8" />
              <line x1="7" y1="11" x2="17" y2="11" />
              <line x1="7" y1="14" x2="13" y2="14" />
            </svg>
            Bản tin hôm nay
          </Link>
```

- [ ] **Step 5: Run typecheck and the full dashboard test suite**

Run: `cd dashboard && npm run typecheck && npm test`
Expected: PASS (this task adds no new test files, but must not break any existing one)

- [ ] **Step 6: Launch the dashboard and visually verify the new page**

Use the `run` skill to start the dashboard's dev server and navigate to `/ban-tin`, confirming:
- The page loads without a server error.
- The "Tổng hợp" section and all 3 sector sections render.
- At least one card shows a summary paragraph (if any shortlisted rss/threads topic already has `summary` populated in the database) and cards without one show the fallback "lượt" count instead of a blank body.
- The new Sidebar link appears between "Overview" and "Trending Now" and highlights as active on `/ban-tin`.

- [ ] **Step 7: Commit**

```bash
git add dashboard/components/TopicBriefCard.tsx dashboard/app/ban-tin/page.tsx dashboard/components/layout/Sidebar.tsx
git commit -m "feat: add Bản tin hôm nay daily brief page"
```

---

## After all tasks: finishing

Once Task 9 is committed and its manual verification passes, run the full test suite one more time at the repo root and in `dashboard/`, then use **superpowers:requesting-code-review** for the final whole-branch review, followed by **superpowers:finishing-a-development-branch** to integrate.

Remind the user after merge: **migration `supabase/migrations/0009_topic_summary.sql` must be run manually in Supabase's SQL Editor before the next scheduled pipeline run** — the `summarize-topics` job and the dashboard's new `summary` column reads will error against the live database until that's done (same one-time step as every prior migration in this project).
