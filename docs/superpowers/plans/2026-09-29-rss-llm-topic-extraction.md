# RSS LLM Topic Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the RSS discovery source's regex bigram extractor with an LLM (`gpt-5-nano`) call that reads the full headline, falling back to the existing regex extractor per-chunk on any failure so RSS never loses candidates outright.

**Architecture:** A new `RssTopicExtractor` interface + real `OpenAiRssTopicExtractor` adapter sits in front of `RssTopicSource.fetchCandidates()`. `RssTopicSource` chunks fetched titles (20/chunk), tries the extractor per chunk, and falls back to `extractKeywords()` (unchanged) for any chunk that throws or when no extractor is configured. `aggregate-rss-keywords.ts` is decoupled from `extractKeywords()` entirely — it now aggregates whatever `topics: string[]` each article already carries, regardless of where those topics came from.

**Tech Stack:** TypeScript, Vitest, native `fetch` to OpenAI's Chat Completions API (no `openai` npm package — matches `candidate-classifier.ts`'s existing convention).

**Spec:** `docs/superpowers/specs/2026-09-29-rss-llm-topic-extraction-design.md`

## Global Constraints

- Model: `gpt-5-nano` (same as `OpenAiCandidateClassifier`).
- Chunk size: 20 titles per LLM call (spec §3, §6 — matches the sentiment-classifier precedent for full-sentence-length inputs).
- Timeout: 60000ms per call (`FETCH_TIMEOUT_MS`, same value as `candidate-classifier.ts`).
- Response format: JSON object keyed by **string index** ("0", "1", ...), never by the raw title text (spec §4 — avoids JSON-escaping and duplicate-title collisions).
- On any per-chunk failure (throw, timeout, bad JSON, non-2xx), that chunk's titles fall back to `extractKeywords()` — never drop a chunk's candidates entirely.
- When no `OPENAI_API_KEY` is configured, `RssTopicSource` must behave exactly as it does today (100% `extractKeywords()`).
- Google Trends and YouTube are out of scope — only `RssTopicSource` changes.
- `src/lib/keyword-extractor.ts` is not modified in this plan — it becomes the fallback path, used as-is.

## Review Focus

- An LLM response array shorter than the input `titles` array (missing trailing entries) — code must not crash indexing into it, missing entries become `[]`, not `undefined` propagating into `Set`/`.map` calls. Owning task: Task 1 (code), pinned by Task 3's malformed-response test.
- Zero articles fetched that day (e.g. a quiet news day, or a lookback window with nothing new) — `fetchCandidates()` must return `[]` without ever calling the extractor with an empty array. Owning task: Task 3.
- A chunk boundary that lands exactly on a multiple of `CHUNK_SIZE` (e.g. exactly 20 or 40 titles) must not produce a trailing empty chunk that calls the extractor with `[]`. Owning task: Task 3 (exercised naturally by the 25-article multi-chunk test; pinned explicitly with an exact-20 case).
- One chunk's extractor call throwing must not prevent a later chunk's extractor call from happening (no shared mutable state accidentally short-circuits the loop). Owning task: Task 3.
- `aggregate-rss-keywords.ts`'s existing category-union and 200-item cap behavior (already correct today) must survive the input-shape change unchanged — a regression here would silently break `category_hint` assignment downstream. Owning task: Task 2 (existing test suite ported to the new shape, not weakened).

---

### Task 1: `RssTopicExtractor` interface, OpenAI adapter, and fake

**Files:**
- Create: `src/lib/rss-topic-extractor.ts`
- Create: `tests/fakes/fake-rss-topic-extractor.ts`
- Test: `tests/fake-rss-topic-extractor.test.ts`

**Interfaces:**
- Produces: `RssTopicExtractor` interface with `extractTopics(titles: string[]): Promise<string[][]>` — the returned array is positionally aligned with `titles` (index `i` of the result is the topic list for `titles[i]`).
- Produces: `OpenAiRssTopicExtractor` class (constructor takes `apiKey: string`), implements `RssTopicExtractor`.
- Produces: `FakeRssTopicExtractor` class in `tests/fakes/`, implements `RssTopicExtractor`, with public `calls: string[][]`, `topicsByTitle: Record<string, string[]>`, `shouldThrow: boolean`.

- [ ] **Step 1: Write the failing test for the fake**

Create `tests/fake-rss-topic-extractor.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { FakeRssTopicExtractor } from './fakes/fake-rss-topic-extractor';

describe('FakeRssTopicExtractor', () => {
  it('records the titles it was called with', async () => {
    const extractor = new FakeRssTopicExtractor();
    await extractor.extractTopics(['a', 'b']);
    expect(extractor.calls).toEqual([['a', 'b']]);
  });

  it('returns the configured topics for each title, defaulting to an empty array', async () => {
    const extractor = new FakeRssTopicExtractor();
    extractor.topicsByTitle = { 'Giá vàng tăng mạnh': ['giá vàng'] };

    const result = await extractor.extractTopics(['Giá vàng tăng mạnh', 'Một tiêu đề khác']);

    expect(result).toEqual([['giá vàng'], []]);
  });

  it('throws when shouldThrow is set, instead of returning topics', async () => {
    const extractor = new FakeRssTopicExtractor();
    extractor.shouldThrow = true;

    await expect(extractor.extractTopics(['bất kỳ'])).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/fake-rss-topic-extractor.test.ts`
Expected: FAIL — `Cannot find module './fakes/fake-rss-topic-extractor'`

- [ ] **Step 3: Create the `RssTopicExtractor` interface and real adapter**

Create `src/lib/rss-topic-extractor.ts`:

```typescript
export interface RssTopicExtractor {
  extractTopics(titles: string[]): Promise<string[][]>;
}

const FETCH_TIMEOUT_MS = 60000;
const MODEL = 'gpt-5-nano';

// Real adapter over OpenAI's Chat Completions API, called via native fetch —
// same convention as OpenAiCandidateClassifier (no `openai` npm dependency).
// Reads a batch of RSS headlines and asks the model for 1-3 specific topic
// phrases per headline, avoiding what the sliding-window bigram extractor in
// keyword-extractor.ts structurally cannot: telling a real 3+-word phrase
// ("doanh nghiệp nhỏ") apart from its own overlapping 2-word fragments
// ("doanh nghiệp", "nghiệp nhỏ"). Not unit-tested — verified manually against
// the live API once a key exists, same convention as every other real-network
// adapter in this codebase (see candidate-classifier.ts, apify-threads-client.ts).
export class OpenAiRssTopicExtractor implements RssTopicExtractor {
  constructor(private apiKey: string) {}

  async extractTopics(titles: string[]): Promise<string[][]> {
    if (titles.length === 0) return [];

    const numbered = titles.map((t, i) => `${i}. "${t}"`).join('\n');
    const prompt =
      'Đọc các tiêu đề tin tức tiếng Việt sau (đánh số). Với mỗi tiêu đề, trích 1-3 cụm ' +
      'từ thể hiện đúng CHỦ ĐỀ CỤ THỂ của tiêu đề đó (tên riêng, sự kiện, con số cụ thể ' +
      '— KHÔNG phải từ chung chung như "kinh doanh", "tài sản", "thị trường" đứng một ' +
      'mình). Giữ nguyên chính tả gốc, viết thường. Nếu 1 tiêu đề không có chủ đề nào ' +
      'đủ cụ thể, trả về mảng rỗng cho tiêu đề đó.\n\n' +
      'Trả lời bằng đúng 1 JSON object, key là số thứ tự (dạng chuỗi "0", "1", ...), ' +
      'value là mảng chuỗi. Không thêm giải thích.\n\n' +
      `Tiêu đề:\n${numbered}`;

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
      if (!content) return titles.map(() => []);
      const parsed = JSON.parse(content) as Record<string, string[]>;
      return titles.map((_, i) => parsed[String(i)] ?? []);
    } finally {
      clearTimeout(timeout);
    }
  }
}
```

- [ ] **Step 4: Create the fake**

Create `tests/fakes/fake-rss-topic-extractor.ts`:

```typescript
import type { RssTopicExtractor } from '../../src/lib/rss-topic-extractor';

export class FakeRssTopicExtractor implements RssTopicExtractor {
  public calls: string[][] = [];
  public topicsByTitle: Record<string, string[]> = {};
  public shouldThrow = false;

  async extractTopics(titles: string[]): Promise<string[][]> {
    this.calls.push(titles);
    if (this.shouldThrow) {
      throw new Error('FakeRssTopicExtractor: extractTopics failed');
    }
    return titles.map((t) => this.topicsByTitle[t] ?? []);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/fake-rss-topic-extractor.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: PASS, no errors

- [ ] **Step 7: Commit**

```bash
git add src/lib/rss-topic-extractor.ts tests/fakes/fake-rss-topic-extractor.ts tests/fake-rss-topic-extractor.test.ts
git commit -m "feat: add RssTopicExtractor interface, OpenAI adapter, and fake"
```

---

### Task 2: Decouple `aggregate-rss-keywords.ts` from `extractKeywords`

**Files:**
- Modify: `src/lib/aggregate-rss-keywords.ts`
- Test: `tests/aggregate-rss-keywords.test.ts` (full rewrite of fixtures, same assertions)

**Interfaces:**
- Produces: `aggregateRssKeywords(articles: { topics: string[]; categories: string[] }[]): RawCandidate[]` — replaces the old `{ title: string; categories: string[] }[]` signature. Counting/capping/category-union logic is unchanged; only the source of each article's keyword list changes (pre-computed `topics` instead of an internal `extractKeywords(article.title)` call).

- [ ] **Step 1: Update the test file for the new signature**

Replace the full contents of `tests/aggregate-rss-keywords.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { aggregateRssKeywords } from '../src/lib/aggregate-rss-keywords';

function article(topics: string[], categories: string[] = []) {
  return { topics, categories };
}

describe('aggregateRssKeywords', () => {
  it('counts how many articles each topic appears in', () => {
    const result = aggregateRssKeywords([
      article(['giá vàng']),
      article(['giá vàng', 'lập đỉnh']),
      article(['chứng khoán']),
    ]);
    const giaVang = result.find((r) => r.keyword === 'giá vàng');
    expect(giaVang).toBeDefined();
    expect(giaVang!.metric_value).toBe(2);
  });

  it('counts a topic at most once per article even if it repeats within that article\'s topic list', () => {
    const result = aggregateRssKeywords([article(['vàng vàng', 'vàng vàng'])]);
    const vangVang = result.find((r) => r.keyword === 'vàng vàng');
    expect(vangVang!.metric_value).toBe(1);
  });

  it('leaves growth_rate null for every keyword', () => {
    const result = aggregateRssKeywords([article(['một chủ đề'])]);
    expect(result.every((r) => r.growth_rate === null)).toBe(true);
  });

  it('caps the result to the top 200 keywords by metric_value', () => {
    // 210 articles, each with a unique topic that appears only once —
    // aggregateRssKeywords would otherwise emit 210 distinct keywords.
    const articles = Array.from({ length: 210 }, (_, i) => article([`duy nhat tukhoa${i}`]));
    const result = aggregateRssKeywords(articles);
    expect(result.length).toBeLessThanOrEqual(200);
  });

  it('unions categories from every article a topic appears in', () => {
    const result = aggregateRssKeywords([
      article(['chứng khoán'], ['tai_chinh']),
      article(['chứng khoán'], ['giai_tri']),
    ]);
    const chungKhoan = result.find((r) => r.keyword === 'chứng khoán');
    expect(chungKhoan).toBeDefined();
    expect(new Set(chungKhoan!.knownCategories)).toEqual(new Set(['tai_chinh', 'giai_tri']));
  });

  it('leaves knownCategories empty when the source article has no categories', () => {
    const result = aggregateRssKeywords([article(['một chủ đề'], [])]);
    expect(result.every((r) => (r.knownCategories ?? []).length === 0)).toBe(true);
  });

  it('produces no candidates when there are no articles', () => {
    const result = aggregateRssKeywords([]);
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/aggregate-rss-keywords.test.ts`
Expected: FAIL — the current implementation reads `article.title` (undefined here) and calls `extractKeywords(undefined)`, throwing or producing wrong results. Every test in the file should fail or error.

- [ ] **Step 3: Update the implementation**

Replace the full contents of `src/lib/aggregate-rss-keywords.ts`:

```typescript
import { capCandidates } from './cap-candidates';
import type { Category, RawCandidate } from '../types';

// Only the top MAX_CANDIDATES survive into candidate_topics — anything ranked
// below this never has a chance at the top-N shortlist anyway, so capping
// here bounds per-day row volume and write cost without affecting outcomes.
const MAX_CANDIDATES = 200;

// `topics` is pre-computed per article by the caller (RssTopicSource) —
// either from the LLM extractor or, as a fallback, from keyword-extractor.ts.
// This function only counts/aggregates; it does not know or care where the
// topics came from.
export function aggregateRssKeywords(
  articles: { topics: string[]; categories: string[] }[]
): RawCandidate[] {
  const counts = new Map<string, number>();
  const categoriesByKeyword = new Map<string, Set<Category>>();

  for (const article of articles) {
    for (const keyword of new Set(article.topics)) {
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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/aggregate-rss-keywords.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: FAIL — `src/lib/rss-topic-source.ts` still calls `aggregateRssKeywords` with the old `{ title, categories }[]` shape. This is expected; Task 3 fixes it. Confirm the *only* errors are in `rss-topic-source.ts` (and its test file), not elsewhere.

- [ ] **Step 6: Commit**

```bash
git add src/lib/aggregate-rss-keywords.ts tests/aggregate-rss-keywords.test.ts
git commit -m "refactor: decouple aggregateRssKeywords from extractKeywords"
```

---

### Task 3: `RssTopicSource` — chunk, extract, and fall back per chunk

**Files:**
- Modify: `src/lib/rss-topic-source.ts`
- Test: `tests/rss-topic-source.test.ts` (extends the existing file)

**Interfaces:**
- Consumes: `RssTopicExtractor` from Task 1 (`src/lib/rss-topic-extractor.ts`), `FakeRssTopicExtractor` from Task 1 (`tests/fakes/fake-rss-topic-extractor.ts`), `aggregateRssKeywords(articles: { topics: string[]; categories: string[] }[])` from Task 2, `extractKeywords(text: string): string[]` from the existing `src/lib/keyword-extractor.ts` (unchanged).
- Produces: `RssTopicSource` constructor becomes `constructor(repo: Pick<ArticleRepository, 'getRecentTitles'>, extractor?: RssTopicExtractor)` — the second parameter is optional and backward-compatible with every existing 1-argument call site.

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `tests/rss-topic-source.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { RssTopicSource } from '../src/lib/rss-topic-source';
import { FakeArticleRepository } from './fakes/fake-article-repository';
import { FakeRssTopicExtractor } from './fakes/fake-rss-topic-extractor';
import type { Article } from '../src/types';

function makeArticle(id: string, title: string, categories: string[] = []): Article {
  return {
    id,
    url: `https://example.com/${id}`,
    title,
    published_at: '',
    source_id: 's',
    categories,
    snippet: '',
    full_content: null,
    content_fetch_status: 'pending',
    fetch_attempts: 0,
    created_at: new Date().toISOString(),
  };
}

describe('RssTopicSource', () => {
  it('fetches recent titles from the repository and aggregates them into candidates', async () => {
    const repo = new FakeArticleRepository();
    repo.articles.push(makeArticle('1', 'Giá vàng tăng mạnh'));
    const source = new RssTopicSource(repo);

    const candidates = await source.fetchCandidates();

    expect(source.name).toBe('rss');
    expect(candidates.some((c) => c.keyword === 'giá vàng')).toBe(true);
  });

  it('requests only 1 day of lookback, so metric_value reflects that day only (not a multi-day rolling window)', async () => {
    let requestedDays: number | undefined;
    const repo = {
      getRecentTitles: async (days: number) => {
        requestedDays = days;
        return [];
      },
    };
    const source = new RssTopicSource(repo);

    await source.fetchCandidates();

    expect(requestedDays).toBe(1);
  });

  it('produces no candidates and never calls the extractor when there are no recent articles', async () => {
    const repo = new FakeArticleRepository();
    const extractor = new FakeRssTopicExtractor();
    const source = new RssTopicSource(repo, extractor);

    const candidates = await source.fetchCandidates();

    expect(candidates).toEqual([]);
    expect(extractor.calls).toEqual([]);
  });

  it('uses the extractor topics instead of the regex fallback when the extractor succeeds', async () => {
    const repo = new FakeArticleRepository();
    repo.articles.push(makeArticle('1', 'Novaland chào bán cổ phiếu tỉ lệ 3:1'));
    const extractor = new FakeRssTopicExtractor();
    extractor.topicsByTitle['Novaland chào bán cổ phiếu tỉ lệ 3:1'] = ['novaland', 'chào bán cổ phiếu'];
    const source = new RssTopicSource(repo, extractor);

    const candidates = await source.fetchCandidates();

    expect(candidates.map((c) => c.keyword).sort()).toEqual(['chào bán cổ phiếu', 'novaland']);
  });

  it('falls back to extractKeywords for a chunk when the extractor throws', async () => {
    const repo = new FakeArticleRepository();
    repo.articles.push(makeArticle('1', 'Giá vàng tăng mạnh'));
    const extractor = new FakeRssTopicExtractor();
    extractor.shouldThrow = true;
    const source = new RssTopicSource(repo, extractor);

    const candidates = await source.fetchCandidates();

    expect(candidates.some((c) => c.keyword === 'giá vàng')).toBe(true);
  });

  it('falls back to extractKeywords for every title when no extractor is provided', async () => {
    const repo = new FakeArticleRepository();
    repo.articles.push(makeArticle('1', 'Giá vàng tăng mạnh'));
    const source = new RssTopicSource(repo);

    const candidates = await source.fetchCandidates();

    expect(candidates.some((c) => c.keyword === 'giá vàng')).toBe(true);
  });

  it('treats a shorter-than-expected extractor response as empty topics for the missing titles, without crashing', async () => {
    const repo = new FakeArticleRepository();
    repo.articles.push(makeArticle('1', 'Tiêu đề một'));
    repo.articles.push(makeArticle('2', 'Tiêu đề hai'));
    const extractor = new FakeRssTopicExtractor();
    extractor.extractTopics = async () => [['tiêu đề một']]; // only 1 entry for 2 titles
    const source = new RssTopicSource(repo, extractor);

    const candidates = await source.fetchCandidates();

    expect(candidates.map((c) => c.keyword)).toEqual(['tiêu đề một']);
  });

  it('isolates a failing chunk from a succeeding one, and still calls the extractor once per chunk on an exact chunk-size boundary', async () => {
    const repo = new FakeArticleRepository();
    // 20 articles (exactly CHUNK_SIZE) whose chunk will fail, plus 5 more in a
    // second, succeeding chunk — pins both "no trailing empty chunk on an
    // exact boundary" and "one failing chunk doesn't block the next".
    for (let i = 0; i < 20; i++) {
      repo.articles.push(makeArticle(`a${i}`, `Tiêu đề chung số ${i}`));
    }
    for (let i = 0; i < 5; i++) {
      repo.articles.push(makeArticle(`b${i}`, `Bài viết riêng số ${i}`));
    }
    const extractor = new FakeRssTopicExtractor();
    let callCount = 0;
    extractor.extractTopics = async (titles: string[]) => {
      callCount += 1;
      if (callCount === 1) throw new Error('first chunk fails');
      return titles.map(() => ['chủ đề riêng']);
    };
    const source = new RssTopicSource(repo, extractor);

    const candidates = await source.fetchCandidates();

    expect(callCount).toBe(2);
    expect(candidates.some((c) => c.keyword === 'chủ đề riêng')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/rss-topic-source.test.ts`
Expected: FAIL — `RssTopicSource` doesn't accept a second constructor argument yet, and still calls `aggregateRssKeywords` with the old shape (which Task 2 already changed), so even the pre-existing passing tests should now fail too.

- [ ] **Step 3: Update the implementation**

Replace the full contents of `src/lib/rss-topic-source.ts`:

```typescript
import type { DiscoverySource } from './discovery-source';
import type { RawCandidate } from '../types';
import type { ArticleRepository } from './article-repository';
import type { RssTopicExtractor } from './rss-topic-extractor';
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
    private extractor?: RssTopicExtractor
  ) {}

  async fetchCandidates(): Promise<RawCandidate[]> {
    const articles = await this.repo.getRecentTitles(LOOKBACK_DAYS);
    const withTopics: { topics: string[]; categories: string[] }[] = [];

    for (const batch of chunk(articles, CHUNK_SIZE)) {
      const titles = batch.map((a) => a.title);
      let topicsPerTitle: string[][];

      if (this.extractor) {
        try {
          topicsPerTitle = await this.extractor.extractTopics(titles);
        } catch {
          // One chunk's LLM failure must not drop or block any other chunk,
          // or RSS's candidates for the day entirely — fall back to the
          // regex extractor for exactly this chunk's titles.
          topicsPerTitle = titles.map((t) => extractKeywords(t));
        }
      } else {
        topicsPerTitle = titles.map((t) => extractKeywords(t));
      }

      batch.forEach((article, i) => {
        withTopics.push({ topics: topicsPerTitle[i] ?? [], categories: article.categories });
      });
    }

    return aggregateRssKeywords(withTopics);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/rss-topic-source.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Run the full test suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS — this closes out the typecheck failure Task 2 left open (`run-discovery-ingest.ts` still passes 1 argument to `RssTopicSource`, which now compiles since the second parameter is optional).

- [ ] **Step 6: Commit**

```bash
git add src/lib/rss-topic-source.ts tests/rss-topic-source.test.ts
git commit -m "feat: chunk RSS titles through the LLM extractor with regex fallback"
```

---

### Task 4: Wire `OpenAiRssTopicExtractor` into the real entrypoint

**Files:**
- Modify: `src/run-discovery-ingest.ts`

**Interfaces:**
- Consumes: `OpenAiRssTopicExtractor` and `RssTopicExtractor` from Task 1 (`src/lib/rss-topic-extractor.ts`), `RssTopicSource`'s new optional second constructor parameter from Task 3.

- [ ] **Step 1: Read the current file**

Run: `cat src/run-discovery-ingest.ts` (or open it) to confirm the current structure before editing — this file is not unit-tested (it's the CLI entrypoint, matching every other `run-*.ts` file in this codebase), so there is no failing-test step here. Verification happens via typecheck and the full test suite in Step 3.

- [ ] **Step 2: Update the implementation**

Replace the full contents of `src/run-discovery-ingest.ts`:

```typescript
import { createClient } from '@supabase/supabase-js';
import { getRequiredEnv } from './lib/env';
import { SupabaseCandidateTopicRepository } from './lib/candidate-topic-repository';
import { SupabaseArticleRepository } from './lib/article-repository';
import { GoogleTrendsSource } from './lib/google-trends-source';
import { YouTubeTrendingSource } from './lib/youtube-source';
import { RssTopicSource } from './lib/rss-topic-source';
import { RealYouTubeSearchClient } from './lib/youtube-search-client';
import { OpenAiCandidateClassifier } from './lib/candidate-classifier';
import { OpenAiRssTopicExtractor, type RssTopicExtractor } from './lib/rss-topic-extractor';
import type { DiscoverySource } from './lib/discovery-source';
import type { CandidateClassifier } from './lib/candidate-classifier';
import { ingestAllDiscoverySources } from './discovery-ingest';

async function main() {
  const client = createClient(getRequiredEnv('SUPABASE_URL'), getRequiredEnv('SUPABASE_SERVICE_KEY'));
  const repo = new SupabaseCandidateTopicRepository(client);
  const articleRepo = new SupabaseArticleRepository(client);

  const openaiApiKey = process.env.OPENAI_API_KEY;
  let classifier: CandidateClassifier | undefined;
  let rssTopicExtractor: RssTopicExtractor | undefined;
  if (openaiApiKey) {
    classifier = new OpenAiCandidateClassifier(openaiApiKey);
    rssTopicExtractor = new OpenAiRssTopicExtractor(openaiApiKey);
  } else {
    console.error('OPENAI_API_KEY not set — skipping LLM classification and RSS topic extraction');
  }

  const sources: DiscoverySource[] = [
    new GoogleTrendsSource(),
    new RssTopicSource(articleRepo, rssTopicExtractor),
  ];

  const youtubeApiKey = process.env.YOUTUBE_API_KEY;
  if (youtubeApiKey) {
    sources.push(new YouTubeTrendingSource(youtubeApiKey, new RealYouTubeSearchClient(youtubeApiKey)));
  } else {
    console.error('YOUTUBE_API_KEY not set — skipping YouTube source');
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

- [ ] **Step 3: Run the full test suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS — every existing test still passes; this file has no dedicated test, but any type mismatch in the wiring (e.g. a wrong constructor argument order) fails typecheck immediately.

- [ ] **Step 4: Commit**

```bash
git add src/run-discovery-ingest.ts
git commit -m "feat: wire OpenAiRssTopicExtractor into the discovery-ingest entrypoint"
```
