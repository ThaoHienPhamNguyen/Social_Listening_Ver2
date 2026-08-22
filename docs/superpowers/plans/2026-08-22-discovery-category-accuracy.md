# Discovery Category Accuracy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `candidate_topics.category_hint` accurate enough that the dashboard's 3 sector pages (Tài chính/Giải trí/Du lịch) reliably have candidates, by propagating known categories from RSS/YouTube instead of relying only on static keyword matching, classifying the remainder with an LLM, and giving each (source, category) pair its own shortlist floor.

**Architecture:** `RawCandidate` gains an optional `knownCategories` field that RSS (ground truth from `articles.categories`) and a new YouTube seed-driven `search.list` fetch stamp directly, bypassing guesswork for those candidates. `discovery-ingest.ts` unions this with the existing `matchCategories()` substring match, then runs any still-uncategorized keywords through a batched OpenAI classification call. `rank-and-select.ts` adds a per-(source, category) top-10 shortlist floor, additive to the existing per-source top-10.

**Tech Stack:** Same as the rest of this repo — Node >=22, TypeScript, `tsx`, `vitest`, native `fetch` for all external HTTP (no new npm dependency — OpenAI is called via its REST API directly, matching how YouTube/Google Trends are already called).

**Spec:** `docs/superpowers/specs/2026-08-22-discovery-category-accuracy-design.md`

## Global Constraints

- No new Supabase migration — `category_hint` and `is_shortlisted` already exist on `candidate_topics` from migration `0003`.
- LLM classification model: `gpt-5-nano` (OpenAI), called via native `fetch` to `https://api.openai.com/v1/chat/completions` — no `openai` npm package.
- New GitHub secret: `OPENAI_API_KEY`.
- YouTube seed keywords: exactly 2 per category, curated by hand in `config/categories.config.ts` (not derived programmatically): `tai_chinh: ['chứng khoán', 'tài chính']`, `giai_tri: ['showbiz', 'âm nhạc']`, `du_lich: ['du lịch', 'tour']`.
- Shortlist floor per (source, category): top **10**, reusing the existing `DEFAULT_TOP_PER_SOURCE` constant/value in `rank-and-select.ts` — no new option, no new constant.
- All existing tests must keep passing unmodified except where a step below explicitly says to change one — most interface changes are additive/optional to avoid unrelated churn.
- TDD throughout: write the failing test, verify it fails, implement, verify it passes, commit.
- `npm run typecheck` and `npm test` must both pass before every commit that touches `src/` or `config/`.

---

## File Structure

```
config/
  categories.config.ts        # MODIFY — add youtubeSeedKeywords
src/
  types.ts                    # MODIFY — RawCandidate gains knownCategories?
  discovery-ingest.ts         # MODIFY — union knownCategories, call classifier for empties
  rank-and-select.ts          # MODIFY — add per-(source,category) shortlist floor
  run-discovery-ingest.ts     # MODIFY — wire RealYouTubeSearchClient + OpenAiCandidateClassifier
  lib/
    article-repository.ts     # MODIFY — getRecentTitles returns {title, categories}[]
    aggregate-rss-keywords.ts # MODIFY — accept articles with categories, set knownCategories
    rss-topic-source.ts       # MODIFY — cosmetic passthrough of new shape
    youtube-source.ts         # MODIFY — merge mostPopular + seeded fetch
    youtube-search-client.ts  # CREATE — YouTubeSearchClient interface + RealYouTubeSearchClient
    candidate-classifier.ts   # CREATE — CandidateClassifier interface + OpenAiCandidateClassifier
tests/
  fakes/
    fake-article-repository.ts       # MODIFY — getRecentTitles new return shape
    fake-candidate-classifier.ts     # CREATE
  fake-article-repository.test.ts    # MODIFY — 1 test updated
  aggregate-rss-keywords.test.ts     # MODIFY — new input shape + knownCategories tests
  youtube-source.test.ts             # CREATE
  fake-candidate-classifier.test.ts  # CREATE
  discovery-ingest.test.ts           # MODIFY — classifier wiring tests
  rank-and-select.test.ts            # MODIFY — per-category floor tests
  discovery-workflow.test.ts         # MODIFY — OPENAI_API_KEY env assertion
.github/workflows/
  discovery-ingestion.yml     # MODIFY — pass OPENAI_API_KEY secret
README.md                     # MODIFY — document OPENAI_API_KEY setup + new status
```

---

### Task 1: RSS ground-truth category propagation

**Files:**
- Modify: `src/types.ts`
- Modify: `src/lib/article-repository.ts`
- Modify: `tests/fakes/fake-article-repository.ts`
- Modify: `tests/fake-article-repository.test.ts`
- Modify: `src/lib/aggregate-rss-keywords.ts`
- Modify: `tests/aggregate-rss-keywords.test.ts`
- Modify: `src/lib/rss-topic-source.ts`

**Interfaces:**
- Consumes: nothing new
- Produces:
  - `RawCandidate.knownCategories?: Category[]` — used by Task 2, Task 4
  - `ArticleRepository.getRecentTitles(days): Promise<{ title: string; categories: string[] }[]>` (breaking change to the existing method's return type)
  - `aggregateRssKeywords(articles: { title: string; categories: string[] }[]): RawCandidate[]` (breaking change to the existing function's parameter type)

- [ ] **Step 1: Add `knownCategories` to `RawCandidate`**

In `src/types.ts`, find:
```ts
export interface RawCandidate {
  keyword: string;
  metric_value: number;
  growth_rate: number | null;
}
```
Replace with:
```ts
export interface RawCandidate {
  keyword: string;
  metric_value: number;
  growth_rate: number | null;
  // Category already known from the source itself (RSS: the article's real
  // `categories`; YouTube: which seed keyword's category produced this
  // candidate) — bypasses matchCategories()'s substring guessing for these.
  knownCategories?: Category[];
}
```

- [ ] **Step 2: Write the failing test for `getRecentTitles`'s new shape**

In `tests/fake-article-repository.test.ts`, find:
```ts
  it('getRecentTitles returns titles of articles created within the given number of days', async () => {
    const repo = new FakeArticleRepository();
    const now = Date.now();
    repo.articles.push(
      { id: '1', url: 'u1', title: 'Bài mới', published_at: '', source_id: 's', categories: [], snippet: '', full_content: null, content_fetch_status: 'pending', fetch_attempts: 0, created_at: new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString() },
      { id: '2', url: 'u2', title: 'Bài cũ', published_at: '', source_id: 's', categories: [], snippet: '', full_content: null, content_fetch_status: 'pending', fetch_attempts: 0, created_at: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString() }
    );
    const titles = await repo.getRecentTitles(5);
    expect(titles).toEqual(['Bài mới']);
  });
```
Replace with:
```ts
  it('getRecentTitles returns titles with their categories, for articles created within the given number of days', async () => {
    const repo = new FakeArticleRepository();
    const now = Date.now();
    repo.articles.push(
      { id: '1', url: 'u1', title: 'Bài mới', published_at: '', source_id: 's', categories: ['tai_chinh'], snippet: '', full_content: null, content_fetch_status: 'pending', fetch_attempts: 0, created_at: new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString() },
      { id: '2', url: 'u2', title: 'Bài cũ', published_at: '', source_id: 's', categories: [], snippet: '', full_content: null, content_fetch_status: 'pending', fetch_attempts: 0, created_at: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString() }
    );
    const titles = await repo.getRecentTitles(5);
    expect(titles).toEqual([{ title: 'Bài mới', categories: ['tai_chinh'] }]);
  });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/fake-article-repository.test.ts`
Expected: FAIL — `expected ['Bài mới'] to equal [{ title: 'Bài mới', categories: ['tai_chinh'] }]`

- [ ] **Step 4: Update `FakeArticleRepository.getRecentTitles`**

In `tests/fakes/fake-article-repository.ts`, find:
```ts
  async getRecentTitles(days: number) {
    const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;
    return this.articles
      .filter((a) => a.created_at && new Date(a.created_at).getTime() >= sinceMs)
      .map((a) => a.title);
  }
```
Replace with:
```ts
  async getRecentTitles(days: number) {
    const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;
    return this.articles
      .filter((a) => a.created_at && new Date(a.created_at).getTime() >= sinceMs)
      .map((a) => ({ title: a.title, categories: a.categories }));
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/fake-article-repository.test.ts`
Expected: PASS

- [ ] **Step 6: Update the `ArticleRepository` interface and `SupabaseArticleRepository`**

In `src/lib/article-repository.ts`, find:
```ts
export interface ArticleRepository {
  upsertArticle(article: Partial<Article>): Promise<{ error: string | null }>;
  /** Throws if the underlying query fails — a caller should not treat a
   *  thrown error the same as "nothing pending". */
  getPendingArticles(limit: number, maxAttempts: number): Promise<PendingArticle[]>;
  markDone(id: string, fullContent: string, attempts: number, categories: string[]): Promise<{ error: string | null }>;
  markRetryOrFailed(id: string, attempts: number, maxAttempts: number): Promise<{ error: string | null }>;
  getRecentTitles(days: number): Promise<string[]>;
}
```
Replace with:
```ts
export interface RecentArticleTitle {
  title: string;
  categories: string[];
}

export interface ArticleRepository {
  upsertArticle(article: Partial<Article>): Promise<{ error: string | null }>;
  /** Throws if the underlying query fails — a caller should not treat a
   *  thrown error the same as "nothing pending". */
  getPendingArticles(limit: number, maxAttempts: number): Promise<PendingArticle[]>;
  markDone(id: string, fullContent: string, attempts: number, categories: string[]): Promise<{ error: string | null }>;
  markRetryOrFailed(id: string, attempts: number, maxAttempts: number): Promise<{ error: string | null }>;
  getRecentTitles(days: number): Promise<RecentArticleTitle[]>;
}
```

Then find:
```ts
  async getRecentTitles(days: number) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    // Supabase-hosted PostgREST applies a project-level "Max rows" cap
    // (commonly 1000 by default) that silently truncates unbounded reads.
    // 5000 is a generous safety net, not a tuned value — this table's
    // keyword-cardinality is already a known follow-up concern separately.
    const { data, error } = await this.client
      .from('articles')
      .select('title')
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .limit(5000);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => row.title as string);
  }
```
Replace with:
```ts
  async getRecentTitles(days: number) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    // Supabase-hosted PostgREST applies a project-level "Max rows" cap
    // (commonly 1000 by default) that silently truncates unbounded reads.
    // 5000 is a generous safety net, not a tuned value — this table's
    // keyword-cardinality is already a known follow-up concern separately.
    const { data, error } = await this.client
      .from('articles')
      .select('title, categories')
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .limit(5000);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => ({
      title: row.title as string,
      categories: (row.categories as string[] | null) ?? [],
    }));
  }
```

- [ ] **Step 7: Run full test suite and typecheck**

Run: `npm run typecheck && npm test`
Expected: PASS (this step only changes types/wiring already covered by Step 2-5's test)

- [ ] **Step 8: Write the failing tests for `aggregateRssKeywords`'s new shape**

Replace the entire contents of `tests/aggregate-rss-keywords.test.ts` with:
```ts
import { describe, it, expect } from 'vitest';
import { aggregateRssKeywords } from '../src/lib/aggregate-rss-keywords';

function article(title: string, categories: string[] = []) {
  return { title, categories };
}

describe('aggregateRssKeywords', () => {
  it('counts how many titles each keyword appears in', () => {
    const result = aggregateRssKeywords([
      article('Giá vàng tăng mạnh'),
      article('Vàng lập đỉnh mới'),
      article('Chứng khoán giảm'),
    ]);
    const vang = result.find((r) => r.keyword === 'vàng');
    expect(vang).toBeDefined();
    expect(vang!.metric_value).toBe(2);
  });

  it('counts a keyword at most once per title even if it repeats within that title', () => {
    const result = aggregateRssKeywords([article('vàng vàng vàng')]);
    const vang = result.find((r) => r.keyword === 'vàng');
    expect(vang!.metric_value).toBe(1);
  });

  it('leaves growth_rate null for every keyword', () => {
    const result = aggregateRssKeywords([article('Một tiêu đề bất kỳ')]);
    expect(result.every((r) => r.growth_rate === null)).toBe(true);
  });

  it('caps the result to the top 200 keywords by metric_value', () => {
    // 210 titles, each containing a unique 3+ char keyword that appears only
    // once — aggregateRssKeywords would otherwise emit 210 distinct keywords.
    const articles = Array.from({ length: 210 }, (_, i) => article(`duy nhat tukhoa${i}`));
    const result = aggregateRssKeywords(articles);
    expect(result.length).toBeLessThanOrEqual(200);
  });

  it('unions categories from every article a keyword appears in', () => {
    const result = aggregateRssKeywords([
      article('Chứng khoán tăng vọt hôm nay', ['tai_chinh']),
      article('Ca sĩ nổi tiếng đầu tư chứng khoán', ['giai_tri']),
    ]);
    const chungKhoan = result.find((r) => r.keyword === 'chứng khoán');
    expect(chungKhoan).toBeDefined();
    expect(new Set(chungKhoan!.knownCategories)).toEqual(new Set(['tai_chinh', 'giai_tri']));
  });

  it('leaves knownCategories empty when the source article has no categories', () => {
    const result = aggregateRssKeywords([article('Một tiêu đề bất kỳ', [])]);
    expect(result.every((r) => (r.knownCategories ?? []).length === 0)).toBe(true);
  });
});
```

- [ ] **Step 9: Run tests to verify they fail**

Run: `npx vitest run tests/aggregate-rss-keywords.test.ts`
Expected: FAIL — first tests fail because `aggregateRssKeywords` still expects `string[]`, not `{title, categories}[]` (TypeScript compile error surfaces as a vitest failure since `tsx` type-strips without checking, but `npm run typecheck` would also fail; run `npx vitest run` here specifically to confirm the *behavioral* failures — the `knownCategories` tests fail with `undefined` where `Set(['tai_chinh','giai_tri'])` is expected).

- [ ] **Step 10: Implement the new `aggregateRssKeywords`**

Replace the entire contents of `src/lib/aggregate-rss-keywords.ts` with:
```ts
import { extractKeywords } from './keyword-extractor';
import { capCandidates } from './cap-candidates';
import type { Category, RawCandidate } from '../types';

// Only the top MAX_CANDIDATES survive into candidate_topics — anything ranked
// below this never has a chance at the top-N shortlist anyway, so capping
// here bounds per-day row volume and write cost without affecting outcomes.
const MAX_CANDIDATES = 200;

export function aggregateRssKeywords(
  articles: { title: string; categories: string[] }[]
): RawCandidate[] {
  const counts = new Map<string, number>();
  const categoriesByKeyword = new Map<string, Set<Category>>();

  for (const article of articles) {
    for (const keyword of new Set(extractKeywords(article.title))) {
      counts.set(keyword, (counts.get(keyword) ?? 0) + 1);
      const existing = categoriesByKeyword.get(keyword) ?? new Set<Category>();
      for (const category of article.categories) {
        existing.add(category as Category);
      }
      categoriesByKeyword.set(keyword, existing);
    }
  }

  const candidates = Array.from(counts.entries()).map(([keyword, metric_value]) => ({
    keyword,
    metric_value,
    growth_rate: null,
    knownCategories: Array.from(categoriesByKeyword.get(keyword) ?? []),
  }));

  return capCandidates(candidates, MAX_CANDIDATES);
}
```

- [ ] **Step 11: Run tests to verify they pass**

Run: `npx vitest run tests/aggregate-rss-keywords.test.ts`
Expected: 6 tests, PASS

- [ ] **Step 12: Update `RssTopicSource` to pass through the new shape**

In `src/lib/rss-topic-source.ts`, find:
```ts
  async fetchCandidates(): Promise<RawCandidate[]> {
    const titles = await this.repo.getRecentTitles(LOOKBACK_DAYS);
    return aggregateRssKeywords(titles);
  }
```
Replace with:
```ts
  async fetchCandidates(): Promise<RawCandidate[]> {
    const articles = await this.repo.getRecentTitles(LOOKBACK_DAYS);
    return aggregateRssKeywords(articles);
  }
```

- [ ] **Step 13: Run full test suite and typecheck**

Run: `npm run typecheck && npm test`
Expected: all tests PASS, no type errors (including `tests/rss-topic-source.test.ts`, unchanged and still passing since its fixtures already include `categories: []`/`[]` return values compatible with the new shape)

- [ ] **Step 14: Commit**

```bash
git add src/types.ts src/lib/article-repository.ts tests/fakes/fake-article-repository.ts tests/fake-article-repository.test.ts src/lib/aggregate-rss-keywords.ts tests/aggregate-rss-keywords.test.ts src/lib/rss-topic-source.ts
git commit -m "feat: propagate RSS articles' real categories into discovery candidates"
```

---

### Task 2: YouTube seed-driven fetch

**Files:**
- Modify: `config/categories.config.ts`
- Create: `src/lib/youtube-search-client.ts`
- Modify: `src/lib/youtube-source.ts`
- Create: `tests/youtube-source.test.ts`

**Interfaces:**
- Consumes: `RawCandidate.knownCategories` (Task 1), `aggregateYouTubeKeywords` (existing, unchanged)
- Produces:
  - `youtubeSeedKeywords: Record<Category, string[]>` — used by `youtube-source.ts` in this task
  - `interface YouTubeSearchClient { searchByKeyword(keyword: string): Promise<YouTubeSearchResultItem[]> }` and `class RealYouTubeSearchClient` — used by Task 6
  - `YouTubeTrendingSource` constructor becomes `(apiKey: string, searchClient: YouTubeSearchClient)` (breaking change) — used by Task 6
  - `mergeCandidates(a: RawCandidate[], b: RawCandidate[]): RawCandidate[]` — exported for its own tests

- [ ] **Step 1: Add `youtubeSeedKeywords` to the category config**

In `config/categories.config.ts`, find:
```ts
export const categoryKeywords: Record<Category, string[]> = {
  tai_chinh: [
    'chứng khoán', 'ngân hàng', 'lãi suất', 'cổ phiếu', 'tài chính',
    'đầu tư', 'vàng', 'tỷ giá', 'lạm phát', 'gdp', 'doanh nghiệp', 'kinh doanh',
  ],
  giai_tri: [
    'ca sĩ', 'diễn viên', 'phim', 'showbiz', 'âm nhạc', 'nghệ sĩ',
    'hoa hậu', 'concert', 'mv', 'chương trình truyền hình',
  ],
  du_lich: [
    'du lịch', 'tour', 'khách sạn', 'resort', 'điểm đến', 'vé máy bay',
    'homestay', 'phượt', 'check in', 'lữ hành',
  ],
};
```
Add immediately after (keep `categoryKeywords` unchanged — it's still used by `matchCategories()`):
```ts

// Curated by hand — 2 broad/representative terms per category, used to
// actively query YouTube search.list (100 quota units/call) instead of only
// waiting for a keyword to show up in generic trending. Kept small and
// separate from categoryKeywords above (which is used for substring
// matching, not search queries) to bound daily quota cost: 2 seeds × 3
// categories × 101 units (search.list + 1 videos.list stats call) × 3 runs/
// day ≈ 1,818 units/day, well under the 10,000/day default. Review by hand
// if search results for a seed look off-topic — not auto-derived.
export const youtubeSeedKeywords: Record<Category, string[]> = {
  tai_chinh: ['chứng khoán', 'tài chính'],
  giai_tri: ['showbiz', 'âm nhạc'],
  du_lich: ['du lịch', 'tour'],
};
```

- [ ] **Step 2: Create `YouTubeSearchClient` and its real adapter**

Create `src/lib/youtube-search-client.ts`:
```ts
export interface YouTubeSearchResultItem {
  snippet?: { title?: string; tags?: string[] };
  statistics?: { viewCount?: string };
}

export interface YouTubeSearchClient {
  searchByKeyword(keyword: string): Promise<YouTubeSearchResultItem[]>;
}

const FETCH_TIMEOUT_MS = 15000;
const SEARCH_MAX_RESULTS = 25;
const PUBLISHED_AFTER_DAYS = 2;

// Real adapter over 2 real YouTube Data API v3 calls — search.list doesn't
// return `statistics` in its response, so a video's viewCount (needed by
// aggregateYouTubeKeywords) requires a follow-up videos.list call with the
// ids search.list returned. Verified manually against the live API once a
// key exists, not by an automated unit test — same convention as
// YouTubeTrendingSource's existing mostPopular fetch and
// RssParserFetcher/DefaultContentExtractor/GoogleTrendsSource elsewhere in
// this codebase. searchByKeyword's merge/aggregation logic downstream is
// what's unit-tested, via this interface's fake.
export class RealYouTubeSearchClient implements YouTubeSearchClient {
  constructor(private apiKey: string) {}

  async searchByKeyword(keyword: string): Promise<YouTubeSearchResultItem[]> {
    const publishedAfter = new Date(Date.now() - PUBLISHED_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const searchUrl =
      `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&regionCode=VN` +
      `&order=viewCount&maxResults=${SEARCH_MAX_RESULTS}` +
      `&publishedAfter=${encodeURIComponent(publishedAfter)}` +
      `&q=${encodeURIComponent(keyword)}&key=${this.apiKey}`;

    const searchBody = await this.fetchJson<{ items?: Array<{ id?: { videoId?: string } }> }>(searchUrl);
    const videoIds = (searchBody.items ?? [])
      .map((item) => item.id?.videoId)
      .filter((id): id is string => !!id);
    if (videoIds.length === 0) return [];

    const statsUrl =
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics` +
      `&id=${videoIds.join(',')}&key=${this.apiKey}`;
    const statsBody = await this.fetchJson<{ items?: YouTubeSearchResultItem[] }>(statsUrl);
    return statsBody.items ?? [];
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`YouTube API request failed: ${response.status}`);
      }
      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}
```

- [ ] **Step 3: Write the failing tests for `mergeCandidates` and the seeded fetch**

Create `tests/youtube-source.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { YouTubeTrendingSource, mergeCandidates } from '../src/lib/youtube-source';
import type { YouTubeSearchClient } from '../src/lib/youtube-search-client';
import type { RawCandidate } from '../src/types';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubMostPopularFetch(items: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ items }) }))
  );
}

describe('mergeCandidates', () => {
  it('sums metric_value and unions knownCategories when the same keyword appears in both lists', () => {
    const a: RawCandidate[] = [
      { keyword: 'vàng', metric_value: 100, growth_rate: null, knownCategories: ['tai_chinh'] },
    ];
    const b: RawCandidate[] = [
      { keyword: 'vàng', metric_value: 50, growth_rate: null, knownCategories: ['giai_tri'] },
    ];

    const result = mergeCandidates(a, b);

    expect(result).toHaveLength(1);
    expect(result[0].metric_value).toBe(150);
    expect(new Set(result[0].knownCategories)).toEqual(new Set(['tai_chinh', 'giai_tri']));
  });

  it('keeps a keyword that appears in only one list, normalizing knownCategories to an empty array', () => {
    const a: RawCandidate[] = [{ keyword: 'bitcoin', metric_value: 10, growth_rate: null }];
    const result = mergeCandidates(a, []);
    expect(result).toEqual([{ keyword: 'bitcoin', metric_value: 10, growth_rate: null, knownCategories: [] }]);
  });

  it('caps the merged result to 200 keywords', () => {
    const a: RawCandidate[] = Array.from({ length: 150 }, (_, i) => ({
      keyword: `a${i}`, metric_value: 300 - i, growth_rate: null,
    }));
    const b: RawCandidate[] = Array.from({ length: 150 }, (_, i) => ({
      keyword: `b${i}`, metric_value: 200 - i, growth_rate: null,
    }));
    const result = mergeCandidates(a, b);
    expect(result.length).toBeLessThanOrEqual(200);
  });
});

describe('YouTubeTrendingSource', () => {
  it('stamps knownCategories from the seed category on candidates found via search, not on mostPopular candidates', async () => {
    stubMostPopularFetch([{ snippet: { title: 'Video', tags: ['thịnh hành'] }, statistics: { viewCount: '999' } }]);
    const searchClient: YouTubeSearchClient = {
      searchByKeyword: async (keyword) =>
        keyword === 'chứng khoán'
          ? [{ snippet: { title: 'Video', tags: ['cổ phiếu'] }, statistics: { viewCount: '500' } }]
          : [],
    };
    const source = new YouTubeTrendingSource('fake-key', searchClient);

    const candidates = await source.fetchCandidates();

    const seeded = candidates.find((c) => c.keyword === 'cổ phiếu');
    const generic = candidates.find((c) => c.keyword === 'thịnh hành');
    expect(seeded?.knownCategories).toEqual(['tai_chinh']);
    expect(generic?.knownCategories ?? []).toHaveLength(0);
  });

  it('calls searchByKeyword once per configured seed keyword across all 3 categories', async () => {
    stubMostPopularFetch([]);
    const calls: string[] = [];
    const searchClient: YouTubeSearchClient = {
      searchByKeyword: async (keyword) => {
        calls.push(keyword);
        return [];
      },
    };
    const source = new YouTubeTrendingSource('fake-key', searchClient);

    await source.fetchCandidates();

    expect(calls).toHaveLength(6); // 2 seeds × 3 categories
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run tests/youtube-source.test.ts`
Expected: FAIL — `mergeCandidates` is not exported, and `YouTubeTrendingSource`'s constructor doesn't accept a second argument yet.

- [ ] **Step 5: Implement the merged `youtube-source.ts`**

Replace the entire contents of `src/lib/youtube-source.ts` with:
```ts
import type { DiscoverySource } from './discovery-source';
import type { Category, RawCandidate } from '../types';
import { aggregateYouTubeKeywords, type YouTubeVideoItem } from './aggregate-youtube-keywords';
import { capCandidates } from './cap-candidates';
import { youtubeSeedKeywords } from '../../config/categories.config';
import type { YouTubeSearchClient } from './youtube-search-client';

const FETCH_TIMEOUT_MS = 15000;
const MAX_MERGED_CANDIDATES = 200;

export class YouTubeTrendingSource implements DiscoverySource {
  name = 'youtube' as const;

  constructor(private apiKey: string, private searchClient: YouTubeSearchClient) {}

  async fetchCandidates(): Promise<RawCandidate[]> {
    const generic = await this.fetchMostPopular();
    const seeded = await this.fetchSeeded();
    return mergeCandidates(generic, seeded);
  }

  private async fetchMostPopular(): Promise<RawCandidate[]> {
    const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&chart=mostPopular&regionCode=VN&maxResults=50&key=${this.apiKey}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`YouTube API request failed: ${response.status}`);
      }
      const body = (await response.json()) as { items?: YouTubeVideoItem[] };
      return aggregateYouTubeKeywords(body.items ?? []);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchSeeded(): Promise<RawCandidate[]> {
    const results: RawCandidate[] = [];
    for (const [category, seeds] of Object.entries(youtubeSeedKeywords) as [Category, string[]][]) {
      for (const seed of seeds) {
        const items = await this.searchClient.searchByKeyword(seed);
        const candidates = aggregateYouTubeKeywords(items);
        for (const candidate of candidates) {
          results.push({ ...candidate, knownCategories: [category] });
        }
      }
    }
    return results;
  }
}

// Exported for its own unit tests. Merges two RawCandidate lists (the
// unseeded mostPopular fetch and the seeded per-category fetch), summing
// metric_value and unioning knownCategories when the same keyword appears
// in both, then re-applies the 200-keyword cap since each input list was
// already capped independently before merging.
export function mergeCandidates(a: RawCandidate[], b: RawCandidate[]): RawCandidate[] {
  const byKeyword = new Map<string, RawCandidate>();
  for (const candidate of [...a, ...b]) {
    const existing = byKeyword.get(candidate.keyword);
    if (!existing) {
      byKeyword.set(candidate.keyword, { ...candidate, knownCategories: candidate.knownCategories ?? [] });
      continue;
    }
    existing.metric_value += candidate.metric_value;
    existing.knownCategories = Array.from(
      new Set([...(existing.knownCategories ?? []), ...(candidate.knownCategories ?? [])])
    );
  }
  return capCandidates(Array.from(byKeyword.values()), MAX_MERGED_CANDIDATES);
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/youtube-source.test.ts`
Expected: 5 tests, PASS

- [ ] **Step 7: Run full test suite and typecheck**

Run: `npm run typecheck && npm test`
Expected: PASS. `src/run-discovery-ingest.ts` will now fail typecheck (it constructs `new YouTubeTrendingSource(youtubeApiKey)` with only 1 argument) — this is expected and fixed in Task 6. If `npm run typecheck` fails ONLY on that one line in `run-discovery-ingest.ts`, this is the expected, acceptable state to commit at the end of this task; confirm no other file has new type errors before proceeding.

- [ ] **Step 8: Commit**

```bash
git add config/categories.config.ts src/lib/youtube-search-client.ts src/lib/youtube-source.ts tests/youtube-source.test.ts
git commit -m "feat: add YouTube seed-driven search per category, merged with mostPopular"
```

---

### Task 3: LLM classification component

**Files:**
- Create: `src/lib/candidate-classifier.ts`
- Create: `tests/fakes/fake-candidate-classifier.ts`
- Create: `tests/fake-candidate-classifier.test.ts`

**Interfaces:**
- Consumes: `Category` (`src/types.ts`)
- Produces:
  - `type ClassificationLabel = Category | 'none'`
  - `interface CandidateClassifier { classify(keywords: string[]): Promise<Record<string, ClassificationLabel>> }` — used by Task 4, Task 6
  - `class OpenAiCandidateClassifier implements CandidateClassifier` — used by Task 6
  - `class FakeCandidateClassifier implements CandidateClassifier` (in `tests/fakes/`) — used by Task 4's tests

- [ ] **Step 1: Create the `CandidateClassifier` interface and real OpenAI adapter**

Create `src/lib/candidate-classifier.ts`:
```ts
import type { Category } from '../types';

export type ClassificationLabel = Category | 'none';

export interface CandidateClassifier {
  classify(keywords: string[]): Promise<Record<string, ClassificationLabel>>;
}

const FETCH_TIMEOUT_MS = 20000;
const MODEL = 'gpt-5-nano';

// Real adapter over the OpenAI Chat Completions REST API, called via native
// fetch (no `openai` npm dependency, matching how this codebase calls
// YouTube/Google Trends directly). Verified manually against the live API
// once a key exists, not by an automated unit test — same convention as
// every other real-network adapter in this codebase. discovery-ingest.ts's
// classify-the-leftovers logic is what's unit-tested, via this interface's
// fake.
export class OpenAiCandidateClassifier implements CandidateClassifier {
  constructor(private apiKey: string) {}

  async classify(keywords: string[]): Promise<Record<string, ClassificationLabel>> {
    if (keywords.length === 0) return {};

    const prompt =
      'Phân loại mỗi từ khoá tiếng Việt sau vào đúng 1 trong 4 nhãn: ' +
      '"tai_chinh" (tài chính/kinh doanh), "giai_tri" (giải trí/showbiz), ' +
      '"du_lich" (du lịch), hoặc "none" nếu không thuộc nhãn nào ở trên. ' +
      'Trả lời bằng đúng 1 JSON object, key là từ khoá gốc (giữ nguyên chính ' +
      'tả), value là nhãn. Không thêm giải thích. ' +
      `Từ khoá: ${JSON.stringify(keywords)}`;

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
      if (!content) return {};
      return JSON.parse(content) as Record<string, ClassificationLabel>;
    } finally {
      clearTimeout(timeout);
    }
  }
}
```

- [ ] **Step 2: Write the failing test for the fake**

Create `tests/fake-candidate-classifier.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { FakeCandidateClassifier } from './fakes/fake-candidate-classifier';

describe('FakeCandidateClassifier', () => {
  it('records the keywords it was called with', async () => {
    const classifier = new FakeCandidateClassifier();
    await classifier.classify(['a', 'b']);
    expect(classifier.calls).toEqual([['a', 'b']]);
  });

  it('returns the configured label for each keyword, defaulting to none', async () => {
    const classifier = new FakeCandidateClassifier();
    classifier.labels = { 'chứng khoán': 'tai_chinh' };

    const result = await classifier.classify(['chứng khoán', 'unrelated']);

    expect(result).toEqual({ 'chứng khoán': 'tai_chinh', unrelated: 'none' });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/fake-candidate-classifier.test.ts`
Expected: FAIL — `Cannot find module './fakes/fake-candidate-classifier'`

- [ ] **Step 4: Implement the fake**

Create `tests/fakes/fake-candidate-classifier.ts`:
```ts
import type { CandidateClassifier, ClassificationLabel } from '../../src/lib/candidate-classifier';

export class FakeCandidateClassifier implements CandidateClassifier {
  public calls: string[][] = [];
  public labels: Record<string, ClassificationLabel> = {};

  async classify(keywords: string[]): Promise<Record<string, ClassificationLabel>> {
    this.calls.push(keywords);
    const result: Record<string, ClassificationLabel> = {};
    for (const keyword of keywords) {
      result[keyword] = this.labels[keyword] ?? 'none';
    }
    return result;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/fake-candidate-classifier.test.ts`
Expected: 2 tests, PASS

- [ ] **Step 6: Run full test suite and typecheck**

Run: `npm run typecheck && npm test`
Expected: PASS (this task adds new, self-contained files — nothing else references them yet)

- [ ] **Step 7: Commit**

```bash
git add src/lib/candidate-classifier.ts tests/fakes/fake-candidate-classifier.ts tests/fake-candidate-classifier.test.ts
git commit -m "feat: add CandidateClassifier interface, OpenAI adapter, and test fake"
```

---

### Task 4: Wire category resolution into `discovery-ingest.ts`

**Files:**
- Modify: `src/discovery-ingest.ts`
- Modify: `tests/discovery-ingest.test.ts`

**Interfaces:**
- Consumes: `RawCandidate.knownCategories` (Task 1/2), `CandidateClassifier` + `FakeCandidateClassifier` (Task 3)
- Produces:
  - `DiscoveryIngestDeps.classifier?: CandidateClassifier` (new optional field) — used by Task 6

- [ ] **Step 1: Write the failing tests**

In `tests/discovery-ingest.test.ts`, find:
```ts
import { describe, it, expect } from 'vitest';
import { ingestDiscoverySource, ingestAllDiscoverySources } from '../src/discovery-ingest';
import { rankAndSelect } from '../src/rank-and-select';
import { FakeCandidateTopicRepository } from './fakes/fake-candidate-topic-repository';
import type { DiscoverySource } from '../src/lib/discovery-source';
import type { CandidateTopicRepository } from '../src/lib/candidate-topic-repository';

function fakeSource(
  name: 'google_trends' | 'youtube' | 'rss',
  candidates: Array<{ keyword: string; metric_value: number; growth_rate: number | null }>
): DiscoverySource {
  return { name, fetchCandidates: async () => candidates };
}
```
Replace with:
```ts
import { describe, it, expect } from 'vitest';
import { ingestDiscoverySource, ingestAllDiscoverySources } from '../src/discovery-ingest';
import { rankAndSelect } from '../src/rank-and-select';
import { FakeCandidateTopicRepository } from './fakes/fake-candidate-topic-repository';
import { FakeCandidateClassifier } from './fakes/fake-candidate-classifier';
import type { DiscoverySource } from '../src/lib/discovery-source';
import type { CandidateTopicRepository } from '../src/lib/candidate-topic-repository';
import type { CandidateClassifier } from '../src/lib/candidate-classifier';
import type { Category } from '../src/types';

function fakeSource(
  name: 'google_trends' | 'youtube' | 'rss',
  candidates: Array<{
    keyword: string;
    metric_value: number;
    growth_rate: number | null;
    knownCategories?: Category[];
  }>
): DiscoverySource {
  return { name, fetchCandidates: async () => candidates };
}
```

Then, at the end of the `describe('ingestDiscoverySource', ...)` block (immediately before its closing `});`), add:
```ts

  it('classifies candidates that still have no category_hint after matchCategories() and knownCategories', async () => {
    const repo = new FakeCandidateTopicRepository();
    const classifier = new FakeCandidateClassifier();
    classifier.labels = { 'quang dũng': 'giai_tri' };
    const source = fakeSource('google_trends', [{ keyword: 'quang dũng', metric_value: 100, growth_rate: null }]);

    await ingestDiscoverySource(source, { repo, classifier, now: () => new Date('2026-08-21T09:00:00Z') });

    expect(repo.candidates[0].category_hint).toEqual(['giai_tri']);
    expect(classifier.calls).toEqual([['quang dũng']]);
  });

  it('does not call the classifier for candidates that already have a category_hint', async () => {
    const repo = new FakeCandidateTopicRepository();
    const classifier = new FakeCandidateClassifier();
    const source = fakeSource('google_trends', [{ keyword: 'giá vàng', metric_value: 100, growth_rate: null }]);

    await ingestDiscoverySource(source, { repo, classifier, now: () => new Date('2026-08-21T09:00:00Z') });

    expect(classifier.calls).toEqual([]);
  });

  it('leaves category_hint empty and records an error, without dropping the candidate, when classification throws', async () => {
    const repo = new FakeCandidateTopicRepository();
    const classifier: CandidateClassifier = {
      classify: async () => {
        throw new Error('openai timeout');
      },
    };
    const source = fakeSource('google_trends', [{ keyword: 'quang dũng', metric_value: 100, growth_rate: null }]);

    const result = await ingestDiscoverySource(source, {
      repo,
      classifier,
      now: () => new Date('2026-08-21T09:00:00Z'),
    });

    expect(repo.candidates[0].category_hint).toEqual([]);
    expect(result.errors.some((e) => e.includes('openai timeout'))).toBe(true);
    expect(result.upserted).toBe(1);
  });

  it('skips classification entirely when no classifier dependency is provided', async () => {
    const repo = new FakeCandidateTopicRepository();
    const source = fakeSource('google_trends', [{ keyword: 'quang dũng', metric_value: 100, growth_rate: null }]);

    await ingestDiscoverySource(source, { repo, now: () => new Date('2026-08-21T09:00:00Z') });

    expect(repo.candidates[0].category_hint).toEqual([]);
  });

  it('uses knownCategories from the candidate (e.g. RSS ground truth or a YouTube seed match) even when matchCategories() finds nothing', async () => {
    const repo = new FakeCandidateTopicRepository();
    const source = fakeSource('rss', [
      { keyword: 'quang dũng', metric_value: 100, growth_rate: null, knownCategories: ['giai_tri'] },
    ]);

    await ingestDiscoverySource(source, { repo, now: () => new Date('2026-08-21T09:00:00Z') });

    expect(repo.candidates[0].category_hint).toEqual(['giai_tri']);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/discovery-ingest.test.ts`
Expected: FAIL — `DiscoveryIngestDeps` has no `classifier` field yet (TypeScript error) and `category_hint` doesn't yet include `knownCategories`/classification results.

- [ ] **Step 3: Implement the category resolution + classification wiring**

In `src/discovery-ingest.ts`, find:
```ts
import type { DiscoverySource } from './lib/discovery-source';
import type { CandidateTopicRepository } from './lib/candidate-topic-repository';
import type { CandidateTopic } from './types';
import { matchCategories } from './lib/match-categories';

export interface DiscoveryIngestDeps {
  repo: CandidateTopicRepository;
  now?: () => Date;
}
```
Replace with:
```ts
import type { DiscoverySource } from './lib/discovery-source';
import type { CandidateTopicRepository } from './lib/candidate-topic-repository';
import type { CandidateTopic } from './types';
import { matchCategories } from './lib/match-categories';
import type { CandidateClassifier } from './lib/candidate-classifier';

export interface DiscoveryIngestDeps {
  repo: CandidateTopicRepository;
  now?: () => Date;
  classifier?: CandidateClassifier;
}
```

Then find:
```ts
  result.fetched = candidates.length;

  // The workflow runs discovery-ingest -> rank-and-select up to 3x/day, all
```
Replace with:
```ts
  result.fetched = candidates.length;

  // category_hint starts as matchCategories() (substring match) unioned with
  // whatever the source already knew for sure (RSS ground-truth categories,
  // a YouTube seed's category). Anything still empty after that is a
  // candidate LLM classification (below) gets a shot at — named entities
  // (people, places) that no static keyword list can enumerate.
  const categoryHints = new Map<string, string[]>();
  for (const candidate of candidates) {
    const hints = Array.from(
      new Set([...matchCategories(candidate.keyword), ...(candidate.knownCategories ?? [])])
    );
    categoryHints.set(candidate.keyword, hints);
  }

  if (deps.classifier) {
    const uniqueEmpty = Array.from(
      new Set(candidates.map((c) => c.keyword).filter((keyword) => (categoryHints.get(keyword) ?? []).length === 0))
    );
    if (uniqueEmpty.length > 0) {
      try {
        const classified = await deps.classifier.classify(uniqueEmpty);
        for (const [keyword, label] of Object.entries(classified)) {
          if (label !== 'none') {
            categoryHints.set(keyword, [label]);
          }
        }
      } catch (err) {
        // Classification failure must not drop or block the rest of this
        // source's candidates — they're written with whatever category_hint
        // they already had (possibly still empty), same isolation principle
        // as the fetch/upsert failure handling elsewhere in this function.
        result.errors.push(`classification failed: ${(err as Error).message}`);
      }
    }
  }

  // The workflow runs discovery-ingest -> rank-and-select up to 3x/day, all
```

Then find:
```ts
    const row: Partial<CandidateTopic> = {
      source: source.name,
      keyword: candidate.keyword,
      date,
      metric_value: candidate.metric_value,
      category_hint: matchCategories(candidate.keyword),
    };
```
Replace with:
```ts
    const row: Partial<CandidateTopic> = {
      source: source.name,
      keyword: candidate.keyword,
      date,
      metric_value: candidate.metric_value,
      category_hint: categoryHints.get(candidate.keyword) ?? [],
    };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/discovery-ingest.test.ts`
Expected: all tests PASS (existing tests keep passing since `classifier` is optional and `matchCategories()`-only behavior is preserved when it's absent or the candidate has no `knownCategories`)

- [ ] **Step 5: Run full test suite and typecheck**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/discovery-ingest.ts tests/discovery-ingest.test.ts
git commit -m "feat: union knownCategories into category_hint, classify remaining unmatched candidates"
```

---

### Task 5: Per-(source, category) shortlist floor in `rank-and-select.ts`

**Files:**
- Modify: `src/rank-and-select.ts`
- Modify: `tests/rank-and-select.test.ts`

**Interfaces:**
- Consumes: `Category` (`src/types.ts`), `CandidateTopic.category_hint` (existing)
- Produces: no new exported names — `rankAndSelect`'s public signature is unchanged, only its internal shortlist logic gains a second, additive pass

- [ ] **Step 1: Write the failing tests**

In `tests/rank-and-select.test.ts`, after the last test inside the `describe('rankAndSelect', ...)` block but before its closing `});`, add:
```ts

  it('shortlists a candidate that ranks in the top-10 within its own category even though it misses the source-wide top-10', async () => {
    const repo = new FakeCandidateTopicRepository();
    // 12 youtube candidates with no category, ranked 1..12 by growth_rate —
    // the source-wide top-10 keeps only the first 10, so ranks 11 and 12 miss it.
    for (let i = 1; i <= 12; i++) {
      repo.candidates.push(
        candidate({ id: `no-cat-${i}`, source: 'youtube', keyword: `kw${i}`, growth_rate: 12 - i, category_hint: [] })
      );
    }
    // The only tai_chinh-tagged candidate in this source — automatically
    // top-1 within its own category even with a growth_rate lower than all
    // 12 above, so it misses the source-wide top-10 entirely.
    repo.candidates.push(
      candidate({
        id: 'tai-chinh-1',
        source: 'youtube',
        keyword: 'chứng khoán',
        growth_rate: -1,
        category_hint: ['tai_chinh'],
      })
    );

    await rankAndSelect({ repo, now: NOW });

    const taiChinh = repo.candidates.find((c) => c.id === 'tai-chinh-1')!;
    expect(taiChinh.is_shortlisted).toBe(true);
  });

  it('does not shortlist a candidate with no category_hint just because same-source candidates elsewhere fill a category top-10', async () => {
    const repo = new FakeCandidateTopicRepository();
    repo.candidates.push(
      candidate({ id: 'low-1', source: 'youtube', keyword: 'kw-low', growth_rate: -5, category_hint: [] })
    );
    for (let i = 1; i <= 10; i++) {
      repo.candidates.push(
        candidate({ id: `du-lich-${i}`, source: 'youtube', keyword: `dl${i}`, growth_rate: 100 - i, category_hint: ['du_lich'] })
      );
    }

    await rankAndSelect({ repo, now: NOW });

    const low = repo.candidates.find((c) => c.id === 'low-1')!;
    expect(low.is_shortlisted).toBe(false);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/rank-and-select.test.ts`
Expected: FAIL — `tai-chinh-1` is not shortlisted (current logic only checks source-wide top-10)

- [ ] **Step 3: Implement the per-(source, category) shortlist floor**

In `src/rank-and-select.ts`, find:
```ts
import type { CandidateTopicRepository } from './lib/candidate-topic-repository';
import type { CandidateTopic } from './types';
```
Replace with:
```ts
import type { CandidateTopicRepository } from './lib/candidate-topic-repository';
import type { CandidateTopic, Category } from './types';

const CATEGORIES: Category[] = ['tai_chinh', 'giai_tri', 'du_lich'];
```

Then find:
```ts
  const shortlistedKeywords = new Set<string>();
  for (const list of bySource.values()) {
    const top = [...list].sort((a, b) => (b.growth_rate ?? 0) - (a.growth_rate ?? 0)).slice(0, topPerSource);
    for (const item of top) {
      shortlistedKeywords.add(item.keyword);
    }
  }
```
Replace with:
```ts
  const shortlistedKeywords = new Set<string>();
  for (const list of bySource.values()) {
    const top = [...list].sort((a, b) => (b.growth_rate ?? 0) - (a.growth_rate ?? 0)).slice(0, topPerSource);
    for (const item of top) {
      shortlistedKeywords.add(item.keyword);
    }
  }

  // Additive floor: a candidate that misses the source-wide top-N can still
  // qualify by being top-N WITHIN its own category — this is what guarantees
  // a dashboard sector page has candidates even on a day where generic
  // trending (sports, lottery — outside all 3 categories) dominates a
  // source's overall top-N. A candidate with no category_hint never enters
  // any of these groups, so it's unaffected — its only path to
  // is_shortlisted stays the source-wide top-N above.
  for (const category of CATEGORIES) {
    for (const list of bySource.values()) {
      const inCategory = list.filter((c) => c.category_hint.includes(category));
      const top = [...inCategory].sort((a, b) => (b.growth_rate ?? 0) - (a.growth_rate ?? 0)).slice(0, topPerSource);
      for (const item of top) {
        shortlistedKeywords.add(item.keyword);
      }
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/rank-and-select.test.ts`
Expected: all tests PASS

- [ ] **Step 5: Run full test suite and typecheck**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/rank-and-select.ts tests/rank-and-select.test.ts
git commit -m "feat: add per-(source,category) shortlist floor, additive to source-wide top-N"
```

---

### Task 6: Wire everything into the entrypoint, workflow, and docs

**Files:**
- Modify: `src/run-discovery-ingest.ts`
- Modify: `.github/workflows/discovery-ingestion.yml`
- Modify: `tests/discovery-workflow.test.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `RealYouTubeSearchClient` (Task 2), `OpenAiCandidateClassifier` (Task 3), `DiscoveryIngestDeps.classifier` (Task 4) — all wired together here, nothing new produced

- [ ] **Step 1: Write the failing test for the workflow's new env var**

In `tests/discovery-workflow.test.ts`, after the last `it(...)` inside the `describe` block but before its closing `});`, add:
```ts

  it('passes OPENAI_API_KEY through to the discovery-ingest job for LLM category classification', () => {
    const step = doc['jobs']['discovery-ingest']['steps'].find((s: any) => s.run === 'npm run discover');
    expect(step?.env?.OPENAI_API_KEY).toBe('${{ secrets.OPENAI_API_KEY }}');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/discovery-workflow.test.ts`
Expected: FAIL — `step?.env?.OPENAI_API_KEY` is `undefined`

- [ ] **Step 3: Add the secret to the workflow**

In `.github/workflows/discovery-ingestion.yml`, find:
```yaml
      - run: npm run discover
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
          YOUTUBE_API_KEY: ${{ secrets.YOUTUBE_API_KEY }}
```
Replace with:
```yaml
      - run: npm run discover
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
          YOUTUBE_API_KEY: ${{ secrets.YOUTUBE_API_KEY }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/discovery-workflow.test.ts`
Expected: 4 tests, PASS

- [ ] **Step 5: Wire the new dependencies into `run-discovery-ingest.ts`**

Replace the entire contents of `src/run-discovery-ingest.ts` with:
```ts
import { createClient } from '@supabase/supabase-js';
import { getRequiredEnv } from './lib/env';
import { SupabaseCandidateTopicRepository } from './lib/candidate-topic-repository';
import { SupabaseArticleRepository } from './lib/article-repository';
import { GoogleTrendsSource } from './lib/google-trends-source';
import { YouTubeTrendingSource } from './lib/youtube-source';
import { RssTopicSource } from './lib/rss-topic-source';
import { RealYouTubeSearchClient } from './lib/youtube-search-client';
import { OpenAiCandidateClassifier } from './lib/candidate-classifier';
import type { DiscoverySource } from './lib/discovery-source';
import type { CandidateClassifier } from './lib/candidate-classifier';
import { ingestAllDiscoverySources } from './discovery-ingest';

async function main() {
  const client = createClient(getRequiredEnv('SUPABASE_URL'), getRequiredEnv('SUPABASE_SERVICE_KEY'));
  const repo = new SupabaseCandidateTopicRepository(client);
  const articleRepo = new SupabaseArticleRepository(client);

  const sources: DiscoverySource[] = [new GoogleTrendsSource(), new RssTopicSource(articleRepo)];

  const youtubeApiKey = process.env.YOUTUBE_API_KEY;
  if (youtubeApiKey) {
    sources.push(new YouTubeTrendingSource(youtubeApiKey, new RealYouTubeSearchClient(youtubeApiKey)));
  } else {
    console.error('YOUTUBE_API_KEY not set — skipping YouTube source');
  }

  const openaiApiKey = process.env.OPENAI_API_KEY;
  let classifier: CandidateClassifier | undefined;
  if (openaiApiKey) {
    classifier = new OpenAiCandidateClassifier(openaiApiKey);
  } else {
    console.error('OPENAI_API_KEY not set — skipping LLM classification for unmatched candidates');
  }

  const results = await ingestAllDiscoverySources(sources, { repo, classifier });

  let hasErrors = false;
  for (const r of results) {
    console.log(`[${r.source}] fetched=${r.fetched} upserted=${r.upserted} errors=${r.errors.length}`);
    if (r.errors.length > 0) {
      hasErrors = true;
      r.errors.forEach((e) => console.error(`  - ${e}`));
    }
  }

  if (hasErrors) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
```

- [ ] **Step 6: Run full test suite and typecheck**

Run: `npm run typecheck && npm test`
Expected: PASS, zero type errors anywhere (this resolves the expected `run-discovery-ingest.ts` typecheck gap noted at the end of Task 2)

- [ ] **Step 7: Update the root README**

In `README.md`, find:
```markdown
Setup: apply `supabase/migrations/0003_create_candidate_topics_table.sql` (after `0001` and `0002`), and add a `YOUTUBE_API_KEY` secret in the GitHub repo (from a Google Cloud project with the YouTube Data API v3 enabled).
```
Replace with:
```markdown
Setup: apply `supabase/migrations/0003_create_candidate_topics_table.sql` (after `0001` and `0002`), and add a `YOUTUBE_API_KEY` secret in the GitHub repo (from a Google Cloud project with the YouTube Data API v3 enabled) and an `OPENAI_API_KEY` secret (from an OpenAI account with billing enabled — used for `gpt-5-nano` category classification, ~$0.07–0.35/month at current volume; see `docs/superpowers/specs/2026-08-22-discovery-category-accuracy-design.md`).
```

Then find:
```markdown
The discovery layer (sub-project 2a) is **live in production since 2026-08-21** — migration `0003_create_candidate_topics_table.sql` applied and `.github/workflows/discovery-ingestion.yml` deployed, verified end-to-end via two real `workflow_dispatch` runs (`google_trends`/`rss`/`youtube` all fetching successfully, `rank-and-select` shortlisting per source). Runs on cron `0 2,5,14 * * *` UTC (09:00/12:00/21:00 ICT). See `docs/superpowers/specs/2026-08-21-discovery-layer-database-schema.md` for the schema and known gaps.
```
Replace with:
```markdown
The discovery layer (sub-project 2a) is **live in production since 2026-08-21** — migration `0003_create_candidate_topics_table.sql` applied and `.github/workflows/discovery-ingestion.yml` deployed, verified end-to-end via two real `workflow_dispatch` runs (`google_trends`/`rss`/`youtube` all fetching successfully, `rank-and-select` shortlisting per source). Runs on cron `0 2,5,14 * * *` UTC (09:00/12:00/21:00 ICT). See `docs/superpowers/specs/2026-08-21-discovery-layer-database-schema.md` for the schema and known gaps.

`category_hint` accuracy was improved 2026-08-22 (see `docs/superpowers/specs/2026-08-22-discovery-category-accuracy-design.md`): RSS candidates now carry the source article's real category instead of a keyword guess, YouTube adds a seed-driven `search.list` fetch per category, and any candidate still uncategorized after that is classified by `gpt-5-nano` (OpenAI). `rank-and-select` gained an additive per-(source, category) top-10 shortlist floor so a dashboard sector page isn't left empty on a day generic trending skews outside all 3 categories.
```

- [ ] **Step 8: Commit**

```bash
git add src/run-discovery-ingest.ts .github/workflows/discovery-ingestion.yml tests/discovery-workflow.test.ts README.md
git commit -m "feat: wire seed-driven YouTube fetch and LLM classification into discovery-ingest entrypoint"
```

---

## Self-Review Notes

- **Spec coverage:** §4.1 (RSS ground truth) → Task 1; §4.2 (YouTube seed-driven) → Task 2; §4.3 (LLM classification) → Task 3+4; §4.4 (shortlist floor) → Task 5; §7 secrets/params (`OPENAI_API_KEY`, seed list, top-N=10) → Tasks 2, 3, 6.
- **Placeholder scan:** no TBD/TODO; every step has complete, runnable code.
- **Type consistency:** `RawCandidate.knownCategories` (Task 1) is consumed with the same name/shape in Task 2 (`youtube-source.ts`) and Task 4 (`discovery-ingest.ts`). `CandidateClassifier`/`ClassificationLabel`/`FakeCandidateClassifier` (Task 3) are consumed with matching names in Task 4 and Task 6. `YouTubeSearchClient`/`RealYouTubeSearchClient` (Task 2) consumed with matching names in Task 6. `DiscoveryIngestDeps.classifier` (Task 4) consumed the same way in Task 6.
- **Backward compatibility check:** `classifier` is optional on `DiscoveryIngestDeps`, and `rankAndSelect`'s public signature is unchanged — every pre-existing test in `discovery-ingest.test.ts` and `rank-and-select.test.ts` keeps passing without modification (only new tests were appended, no existing assertions changed) except the 2 fixtures in Task 1 (`fake-article-repository.test.ts`, `rss-topic-source.test.ts` verified unaffected) that reflect `getRecentTitles`'s intentionally breaking return-type change.
