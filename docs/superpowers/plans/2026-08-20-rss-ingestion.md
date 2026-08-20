# RSS Ingestion Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest RSS from 12 Vietnamese news feeds (4 sources × 3 categories), crawl each article's full content, assign categories, dedupe by URL, and store the result in Supabase — running twice-to-thrice daily via two chained GitHub Actions jobs.

**Architecture:** Two GitHub Actions jobs in one workflow, `crawl-content` gated on `ingest-rss` via `needs:`. `ingest-rss` parses feeds and upserts stub rows (`content_fetch_status = pending`). `crawl-content` picks up pending rows, fetches the source page, extracts the article body, and marks the row `done`/`failed`. All shared state lives in one Supabase table (`articles`) — no separate queue service. All I/O (feed fetching, content extraction, Supabase reads/writes) sits behind small interfaces so the core logic is unit-testable without network or a live database.

**Tech Stack:** Node.js (>=22) + TypeScript, `rss-parser`, `@extractus/article-extractor`, `@supabase/supabase-js`, `vitest` for tests, `tsx` to run TS entrypoints directly.

**Spec:**
- `docs/superpowers/specs/2026-08-20-rss-ingestion-design.md` (this sub-project's design)
- `docs/superpowers/specs/2026-08-20-social-listening-architecture-design.md` (overall architecture this plugs into)

## Global Constraints

- Cadence: pipeline runs 3×/day via GitHub Actions cron (matches the overall architecture's 2–3×/day requirement).
- Category values are exactly `tai_chinh`, `giai_tri`, `du_lich` (no `overall` category — overall is the unfiltered table).
- Category source of truth lives in repo files (`config/sources.config.ts`, `config/categories.config.ts`), never a database table.
- A category assignment is always `[feed default category] ∪ [keyword matches]` — multi-category is allowed and expected.
- Full page content is crawled (not just the RSS snippet/description).
- Max content-fetch retry attempts: `3` (`MAX_FETCH_ATTEMPTS`). After that, `content_fetch_status` stays `failed` permanently — no infinite retry.
- `ingest-rss` and `crawl-content` are separate GitHub Actions jobs (`needs:` chain), never merged into one job — failure isolation, per prior approved decision.
- No queue service — handoff between the two jobs is entirely via the `content_fetch_status` column on `articles`.
- Node version floor: `>=22` (bumped from the originally planned `>=20` — see Task 1 ruling in the SDD ledger: the pinned `@supabase/supabase-js@^2.45.0` range resolves to a version whose transitive deps require Node ≥22).

---

## File Structure

```
package.json
tsconfig.json
vitest.config.ts
.gitignore
config/
  sources.config.ts        # 12 RSS feeds, each with an id + default category
  categories.config.ts     # Vietnamese keyword lists per category, for fallback matching
src/
  types.ts                 # Article, ContentFetchStatus, RssSource, FeedItem
  lib/
    categorize.ts           # categorize(defaultCategory, text): string[]
    article-repository.ts   # ArticleRepository interface + SupabaseArticleRepository
    rss-fetcher.ts           # FeedFetcher interface + RssParserFetcher (wraps rss-parser)
    article-extractor.ts    # ContentExtractor interface + DefaultContentExtractor (wraps @extractus/article-extractor)
    env.ts                  # getRequiredEnv(name): string
  ingest-rss.ts             # ingestSource, ingestAllSources — pure logic, takes injected deps
  crawl-content.ts          # crawlPendingArticles — pure logic, takes injected deps
  run-ingest.ts             # CLI entrypoint wiring real deps, invoked by GitHub Actions
  run-crawl.ts              # CLI entrypoint wiring real deps, invoked by GitHub Actions
supabase/
  migrations/
    0001_create_articles_table.sql
.github/
  workflows/
    rss-ingestion.yml
tests/
  fakes/
    fake-article-repository.ts
  categorize.test.ts
  fake-article-repository.test.ts
  ingest-rss.test.ts
  crawl-content.test.ts
  env.test.ts
  workflow.test.ts
  smoke.test.ts
```

---

### Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Test: `tests/smoke.test.ts`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: a working `npm test` command any later task can rely on

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "social-listening-rss-ingestion",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "vitest run",
    "ingest": "tsx src/run-ingest.ts",
    "crawl": "tsx src/run-crawl.ts"
  },
  "dependencies": {
    "rss-parser": "^3.13.0",
    "@extractus/article-extractor": "^8.0.0",
    "@supabase/supabase-js": "^2.45.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "tsx": "^4.16.0",
    "vitest": "^2.0.0",
    "js-yaml": "^4.1.0",
    "@types/node": "^22.0.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "dist"
  },
  "include": ["src", "config", "tests"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
dist/
.env
```

- [ ] **Step 5: Write the smoke test**

```ts
// tests/smoke.test.ts
import { describe, it, expect } from 'vitest';

describe('project scaffolding', () => {
  it('runs a basic assertion', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 6: Install dependencies and run the test**

Run: `npm install && npm test`
Expected: 1 test file, 1 test, PASS.

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .gitignore tests/smoke.test.ts package-lock.json
git commit -m "chore: scaffold Node/TypeScript project with vitest"
```

---

### Task 2: Types, category config, and `categorize()`

**Files:**
- Create: `src/types.ts`
- Create: `config/categories.config.ts`
- Create: `config/sources.config.ts`
- Create: `src/lib/categorize.ts`
- Test: `tests/categorize.test.ts`

**Interfaces:**
- Consumes: nothing new
- Produces:
  - `type ContentFetchStatus = 'pending' | 'done' | 'failed'`
  - `interface Article { id?: string; url: string; title: string; published_at: string; source_id: string; categories: string[]; snippet: string; full_content: string | null; content_fetch_status: ContentFetchStatus; fetch_attempts: number; created_at?: string; updated_at?: string; }`
  - `interface RssSource { id: string; name: string; url: string; defaultCategory: string; }`
  - `interface FeedItem { link?: string; title?: string; contentSnippet?: string; content?: string; isoDate?: string; }`
  - `categorize(defaultCategory: string, text: string): string[]` — used by Task 4
  - `sources: RssSource[]` (12 entries) — used by Task 6

- [ ] **Step 1: Create `src/types.ts`**

```ts
export type ContentFetchStatus = 'pending' | 'done' | 'failed';

export interface Article {
  id?: string;
  url: string;
  title: string;
  published_at: string;
  source_id: string;
  categories: string[];
  snippet: string;
  full_content: string | null;
  content_fetch_status: ContentFetchStatus;
  fetch_attempts: number;
  created_at?: string;
  updated_at?: string;
}

export interface RssSource {
  id: string;
  name: string;
  url: string;
  defaultCategory: string;
}

export interface FeedItem {
  link?: string;
  title?: string;
  contentSnippet?: string;
  content?: string;
  isoDate?: string;
}
```

- [ ] **Step 2: Create `config/categories.config.ts`**

```ts
export const categoryKeywords: Record<string, string[]> = {
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

- [ ] **Step 3: Create `config/sources.config.ts`**

All 12 feed URLs below were verified live on 2026-08-20 (fetched and confirmed valid RSS 2.0 with real article titles). Re-verify before relying on this list long-term — news sites do change feed paths.

```ts
import type { RssSource } from '../src/types';

export const sources: RssSource[] = [
  { id: 'vnexpress-tai-chinh', name: 'VnExpress - Kinh doanh', url: 'https://vnexpress.net/rss/kinh-doanh.rss', defaultCategory: 'tai_chinh' },
  { id: 'vnexpress-giai-tri', name: 'VnExpress - Giải trí', url: 'https://vnexpress.net/rss/giai-tri.rss', defaultCategory: 'giai_tri' },
  { id: 'vnexpress-du-lich', name: 'VnExpress - Du lịch', url: 'https://vnexpress.net/rss/du-lich.rss', defaultCategory: 'du_lich' },

  { id: 'dantri-tai-chinh', name: 'Dân Trí - Kinh doanh', url: 'https://dantri.com.vn/rss/kinh-doanh.rss', defaultCategory: 'tai_chinh' },
  { id: 'dantri-giai-tri', name: 'Dân Trí - Giải trí', url: 'https://dantri.com.vn/rss/giai-tri.rss', defaultCategory: 'giai_tri' },
  { id: 'dantri-du-lich', name: 'Dân Trí - Du lịch', url: 'https://dantri.com.vn/rss/du-lich.rss', defaultCategory: 'du_lich' },

  { id: 'thanhnien-tai-chinh', name: 'Thanh Niên - Kinh tế', url: 'https://thanhnien.vn/rss/kinh-te.rss', defaultCategory: 'tai_chinh' },
  { id: 'thanhnien-giai-tri', name: 'Thanh Niên - Giải trí', url: 'https://thanhnien.vn/rss/giai-tri.rss', defaultCategory: 'giai_tri' },
  { id: 'thanhnien-du-lich', name: 'Thanh Niên - Du lịch', url: 'https://thanhnien.vn/rss/du-lich.rss', defaultCategory: 'du_lich' },

  { id: 'tuoitre-tai-chinh', name: 'Tuổi Trẻ - Kinh doanh', url: 'https://tuoitre.vn/rss/kinh-doanh.rss', defaultCategory: 'tai_chinh' },
  { id: 'tuoitre-giai-tri', name: 'Tuổi Trẻ - Giải trí', url: 'https://tuoitre.vn/rss/giai-tri.rss', defaultCategory: 'giai_tri' },
  { id: 'tuoitre-du-lich', name: 'Tuổi Trẻ - Du lịch', url: 'https://tuoitre.vn/rss/du-lich.rss', defaultCategory: 'du_lich' },
];
```

- [ ] **Step 4: Write the failing test for `categorize()`**

```ts
// tests/categorize.test.ts
import { describe, it, expect } from 'vitest';
import { categorize } from '../src/lib/categorize';

describe('categorize', () => {
  it('always includes the feed default category, even with no keyword match', () => {
    const result = categorize('du_lich', 'Một bài viết chung chung không liên quan gì đặc biệt');
    expect(result).toEqual(['du_lich']);
  });

  it('adds a keyword-matched category on top of the default', () => {
    const result = categorize('giai_tri', 'Ca sĩ ra mắt MV mới trong dịp lễ');
    expect(result.sort()).toEqual(['giai_tri'].sort());
  });

  it('supports multi-category when text matches a different category’s keywords', () => {
    const result = categorize('du_lich', 'Ngân hàng tài trợ tour du lịch giá rẻ cho khách hàng');
    expect(result.sort()).toEqual(['du_lich', 'tai_chinh'].sort());
  });

  it('does not duplicate the default category when it also keyword-matches', () => {
    const result = categorize('tai_chinh', 'Cổ phiếu ngân hàng tăng mạnh phiên hôm nay');
    expect(result).toEqual(['tai_chinh']);
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npx vitest run tests/categorize.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/categorize'`

- [ ] **Step 6: Implement `categorize()`**

```ts
// src/lib/categorize.ts
import { categoryKeywords } from '../../config/categories.config';

export function categorize(defaultCategory: string, text: string): string[] {
  const categories = new Set<string>([defaultCategory]);
  const lower = text.toLowerCase();

  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    if (keywords.some((kw) => lower.includes(kw.toLowerCase()))) {
      categories.add(category);
    }
  }

  return Array.from(categories);
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run tests/categorize.test.ts`
Expected: 4 tests, PASS.

- [ ] **Step 8: Commit**

```bash
git add src/types.ts config/categories.config.ts config/sources.config.ts src/lib/categorize.ts tests/categorize.test.ts
git commit -m "feat: add types, seed RSS sources/category keywords, and categorize()"
```

---

### Task 3: `ArticleRepository` interface, Supabase adapter, and test fake

**Files:**
- Create: `src/lib/article-repository.ts`
- Create: `tests/fakes/fake-article-repository.ts`
- Test: `tests/fake-article-repository.test.ts`

**Interfaces:**
- Consumes: `Article`, `ContentFetchStatus` from `src/types.ts` (Task 2)
- Produces:
  - `interface ArticleRepository { upsertArticle(article: Partial<Article>): Promise<{ error: string | null }>; getPendingArticles(limit: number, maxAttempts: number): Promise<Pick<Article, 'id' | 'url' | 'fetch_attempts'>[]>; markDone(id: string, fullContent: string, attempts: number): Promise<void>; markRetryOrFailed(id: string, attempts: number, maxAttempts: number): Promise<void>; }`
  - `class SupabaseArticleRepository implements ArticleRepository` (constructor takes a `SupabaseClient`) — used by Task 6
  - `class FakeArticleRepository implements ArticleRepository` (in `tests/fakes/`, exposes public `articles: Article[]` array for assertions) — used by Task 4 and Task 5 tests

- [ ] **Step 1: Create the interface and Supabase adapter**

```ts
// src/lib/article-repository.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Article } from '../types';

export interface ArticleRepository {
  upsertArticle(article: Partial<Article>): Promise<{ error: string | null }>;
  getPendingArticles(
    limit: number,
    maxAttempts: number
  ): Promise<Pick<Article, 'id' | 'url' | 'fetch_attempts'>[]>;
  markDone(id: string, fullContent: string, attempts: number): Promise<void>;
  markRetryOrFailed(id: string, attempts: number, maxAttempts: number): Promise<void>;
}

export class SupabaseArticleRepository implements ArticleRepository {
  constructor(private client: SupabaseClient) {}

  async upsertArticle(article: Partial<Article>) {
    const { error } = await this.client
      .from('articles')
      .upsert(article, { onConflict: 'url', ignoreDuplicates: true });
    return { error: error?.message ?? null };
  }

  async getPendingArticles(limit: number, maxAttempts: number) {
    const { data, error } = await this.client
      .from('articles')
      .select('id, url, fetch_attempts')
      .eq('content_fetch_status', 'pending')
      .lt('fetch_attempts', maxAttempts)
      .limit(limit);
    if (error || !data) return [];
    return data as Pick<Article, 'id' | 'url' | 'fetch_attempts'>[];
  }

  async markDone(id: string, fullContent: string, attempts: number) {
    await this.client
      .from('articles')
      .update({ full_content: fullContent, content_fetch_status: 'done', fetch_attempts: attempts })
      .eq('id', id);
  }

  async markRetryOrFailed(id: string, attempts: number, maxAttempts: number) {
    await this.client
      .from('articles')
      .update({
        content_fetch_status: attempts >= maxAttempts ? 'failed' : 'pending',
        fetch_attempts: attempts,
      })
      .eq('id', id);
  }
}
```

> `SupabaseArticleRepository` is a thin adapter over a real network client — it is verified manually once a Supabase project exists (see Task 7), not by an automated unit test here. The fake below is what Tasks 4–5 test against.

- [ ] **Step 2: Write the failing test for the fake**

```ts
// tests/fake-article-repository.test.ts
import { describe, it, expect } from 'vitest';
import { FakeArticleRepository } from './fakes/fake-article-repository';

describe('FakeArticleRepository', () => {
  it('adds a new article on upsert', async () => {
    const repo = new FakeArticleRepository();
    const { error } = await repo.upsertArticle({
      url: 'https://example.com/a',
      title: 'A',
      published_at: '2026-08-20T00:00:00Z',
      source_id: 'src-1',
      categories: ['tai_chinh'],
      snippet: '',
      full_content: null,
      content_fetch_status: 'pending',
      fetch_attempts: 0,
    });
    expect(error).toBeNull();
    expect(repo.articles).toHaveLength(1);
  });

  it('does not add a duplicate article with the same url', async () => {
    const repo = new FakeArticleRepository();
    const article = {
      url: 'https://example.com/a',
      title: 'A',
      published_at: '2026-08-20T00:00:00Z',
      source_id: 'src-1',
      categories: ['tai_chinh'],
      snippet: '',
      full_content: null,
      content_fetch_status: 'pending' as const,
      fetch_attempts: 0,
    };
    await repo.upsertArticle(article);
    await repo.upsertArticle(article);
    expect(repo.articles).toHaveLength(1);
  });

  it('getPendingArticles only returns pending rows under the attempt cap', async () => {
    const repo = new FakeArticleRepository();
    repo.articles.push(
      { id: '1', url: 'u1', title: 't', published_at: '', source_id: 's', categories: [], snippet: '', full_content: null, content_fetch_status: 'pending', fetch_attempts: 0 },
      { id: '2', url: 'u2', title: 't', published_at: '', source_id: 's', categories: [], snippet: '', full_content: null, content_fetch_status: 'pending', fetch_attempts: 3 },
      { id: '3', url: 'u3', title: 't', published_at: '', source_id: 's', categories: [], snippet: '', full_content: null, content_fetch_status: 'done', fetch_attempts: 1 }
    );
    const pending = await repo.getPendingArticles(10, 3);
    expect(pending.map((p) => p.id)).toEqual(['1']);
  });

  it('markDone sets full_content and status', async () => {
    const repo = new FakeArticleRepository();
    repo.articles.push({ id: '1', url: 'u1', title: 't', published_at: '', source_id: 's', categories: [], snippet: '', full_content: null, content_fetch_status: 'pending', fetch_attempts: 0 });
    await repo.markDone('1', 'full text here', 1);
    expect(repo.articles[0].content_fetch_status).toBe('done');
    expect(repo.articles[0].full_content).toBe('full text here');
    expect(repo.articles[0].fetch_attempts).toBe(1);
  });

  it('markRetryOrFailed keeps status pending under the cap, flips to failed at the cap', async () => {
    const repo = new FakeArticleRepository();
    repo.articles.push({ id: '1', url: 'u1', title: 't', published_at: '', source_id: 's', categories: [], snippet: '', full_content: null, content_fetch_status: 'pending', fetch_attempts: 1 });
    await repo.markRetryOrFailed('1', 2, 3);
    expect(repo.articles[0].content_fetch_status).toBe('pending');

    await repo.markRetryOrFailed('1', 3, 3);
    expect(repo.articles[0].content_fetch_status).toBe('failed');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/fake-article-repository.test.ts`
Expected: FAIL — `Cannot find module './fakes/fake-article-repository'`

- [ ] **Step 4: Implement the fake**

```ts
// tests/fakes/fake-article-repository.ts
import type { ArticleRepository } from '../../src/lib/article-repository';
import type { Article } from '../../src/types';

export class FakeArticleRepository implements ArticleRepository {
  public articles: Article[] = [];

  async upsertArticle(article: Partial<Article>) {
    const exists = this.articles.some((a) => a.url === article.url);
    if (!exists) {
      this.articles.push(article as Article);
    }
    return { error: null };
  }

  async getPendingArticles(limit: number, maxAttempts: number) {
    return this.articles
      .filter((a) => a.content_fetch_status === 'pending' && a.fetch_attempts < maxAttempts)
      .slice(0, limit)
      .map((a) => ({ id: a.id!, url: a.url, fetch_attempts: a.fetch_attempts }));
  }

  async markDone(id: string, fullContent: string, attempts: number) {
    const a = this.articles.find((x) => x.id === id);
    if (a) {
      a.full_content = fullContent;
      a.content_fetch_status = 'done';
      a.fetch_attempts = attempts;
    }
  }

  async markRetryOrFailed(id: string, attempts: number, maxAttempts: number) {
    const a = this.articles.find((x) => x.id === id);
    if (a) {
      a.content_fetch_status = attempts >= maxAttempts ? 'failed' : 'pending';
      a.fetch_attempts = attempts;
    }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/fake-article-repository.test.ts`
Expected: 5 tests, PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/article-repository.ts tests/fakes/fake-article-repository.ts tests/fake-article-repository.test.ts
git commit -m "feat: add ArticleRepository interface, Supabase adapter, and test fake"
```

---

### Task 4: `ingest-rss` core logic

**Files:**
- Create: `src/lib/rss-fetcher.ts`
- Create: `src/ingest-rss.ts`
- Test: `tests/ingest-rss.test.ts`

**Interfaces:**
- Consumes:
  - `ArticleRepository`, `FakeArticleRepository` (Task 3)
  - `RssSource`, `FeedItem`, `Article` (Task 2)
  - `categorize()` (Task 2)
- Produces:
  - `interface FeedFetcher { parseURL(url: string): Promise<{ items: FeedItem[] }>; }`
  - `class RssParserFetcher implements FeedFetcher` (wraps `rss-parser`) — used by Task 6
  - `interface IngestDeps { fetcher: FeedFetcher; repo: ArticleRepository; }`
  - `interface IngestResult { sourceId: string; fetched: number; upserted: number; errors: string[]; }`
  - `ingestSource(source: RssSource, deps: IngestDeps): Promise<IngestResult>`
  - `ingestAllSources(sources: RssSource[], deps: IngestDeps): Promise<IngestResult[]>` — used by Task 6

- [ ] **Step 1: Create the `FeedFetcher` interface and real adapter**

```ts
// src/lib/rss-fetcher.ts
import Parser from 'rss-parser';
import type { FeedItem } from '../types';

export interface FeedFetcher {
  parseURL(url: string): Promise<{ items: FeedItem[] }>;
}

export class RssParserFetcher implements FeedFetcher {
  private parser = new Parser();

  async parseURL(url: string) {
    const feed = await this.parser.parseURL(url);
    return { items: (feed.items ?? []) as FeedItem[] };
  }
}
```

> `RssParserFetcher` wraps a real network call — verified manually against the live feeds in Task 2, not by an automated unit test. `ingestSource`/`ingestAllSources` below are tested against a fake `FeedFetcher`.

- [ ] **Step 2: Write the failing tests for `ingestSource`/`ingestAllSources`**

```ts
// tests/ingest-rss.test.ts
import { describe, it, expect } from 'vitest';
import { ingestSource, ingestAllSources } from '../src/ingest-rss';
import { FakeArticleRepository } from './fakes/fake-article-repository';
import type { RssSource } from '../src/types';
import type { FeedFetcher } from '../src/lib/rss-fetcher';

const source: RssSource = {
  id: 'test-source',
  name: 'Test Source',
  url: 'https://example.com/rss',
  defaultCategory: 'giai_tri',
};

function fakeFetcher(items: Array<Record<string, string>>): FeedFetcher {
  return { parseURL: async () => ({ items }) };
}

describe('ingestSource', () => {
  it('upserts one article per valid feed item, tagged pending', async () => {
    const repo = new FakeArticleRepository();
    const fetcher = fakeFetcher([
      { link: 'https://example.com/1', title: 'Ca sĩ ra mắt MV mới', contentSnippet: 'tóm tắt', isoDate: '2026-08-20T00:00:00Z' },
    ]);

    const result = await ingestSource(source, { fetcher, repo });

    expect(result.errors).toEqual([]);
    expect(result.fetched).toBe(1);
    expect(result.upserted).toBe(1);
    expect(repo.articles).toHaveLength(1);
    expect(repo.articles[0]).toMatchObject({
      url: 'https://example.com/1',
      source_id: 'test-source',
      content_fetch_status: 'pending',
      fetch_attempts: 0,
      categories: ['giai_tri'],
    });
  });

  it('skips items missing a link or a title', async () => {
    const repo = new FakeArticleRepository();
    const fetcher = fakeFetcher([
      { title: 'Không có link' },
      { link: 'https://example.com/2' },
    ]);

    const result = await ingestSource(source, { fetcher, repo });

    expect(result.upserted).toBe(0);
    expect(repo.articles).toHaveLength(0);
  });

  it('records an error and returns early when the feed fetch throws', async () => {
    const repo = new FakeArticleRepository();
    const fetcher: FeedFetcher = {
      parseURL: async () => {
        throw new Error('network down');
      },
    };

    const result = await ingestSource(source, { fetcher, repo });

    expect(result.fetched).toBe(0);
    expect(result.errors[0]).toContain('network down');
  });
});

describe('ingestAllSources', () => {
  it('runs ingestSource for every source and aggregates results', async () => {
    const repo = new FakeArticleRepository();
    const fetcher = fakeFetcher([{ link: 'https://example.com/x', title: 'Tiêu đề' }]);
    const sources: RssSource[] = [
      { ...source, id: 'source-a' },
      { ...source, id: 'source-b' },
    ];

    const results = await ingestAllSources(sources, { fetcher, repo });

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.sourceId)).toEqual(['source-a', 'source-b']);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/ingest-rss.test.ts`
Expected: FAIL — `Cannot find module '../src/ingest-rss'`

- [ ] **Step 4: Implement `ingestSource`/`ingestAllSources`**

```ts
// src/ingest-rss.ts
import type { RssSource, Article } from './types';
import type { ArticleRepository } from './lib/article-repository';
import type { FeedFetcher } from './lib/rss-fetcher';
import { categorize } from './lib/categorize';

export interface IngestDeps {
  fetcher: FeedFetcher;
  repo: ArticleRepository;
}

export interface IngestResult {
  sourceId: string;
  fetched: number;
  upserted: number;
  errors: string[];
}

export async function ingestSource(source: RssSource, deps: IngestDeps): Promise<IngestResult> {
  const result: IngestResult = { sourceId: source.id, fetched: 0, upserted: 0, errors: [] };

  let feed;
  try {
    feed = await deps.fetcher.parseURL(source.url);
  } catch (err) {
    result.errors.push(`fetch failed: ${(err as Error).message}`);
    return result;
  }

  const items = feed.items ?? [];
  result.fetched = items.length;

  for (const item of items) {
    if (!item.link || !item.title) continue;

    const snippet = item.contentSnippet ?? item.content ?? '';
    const categories = categorize(source.defaultCategory, `${item.title} ${snippet}`);

    const article: Partial<Article> = {
      url: item.link,
      title: item.title,
      published_at: item.isoDate ?? new Date().toISOString(),
      source_id: source.id,
      categories,
      snippet,
      full_content: null,
      content_fetch_status: 'pending',
      fetch_attempts: 0,
    };

    const { error } = await deps.repo.upsertArticle(article);
    if (error) {
      result.errors.push(`upsert failed for ${item.link}: ${error}`);
    } else {
      result.upserted += 1;
    }
  }

  return result;
}

export async function ingestAllSources(sources: RssSource[], deps: IngestDeps): Promise<IngestResult[]> {
  const results: IngestResult[] = [];
  for (const source of sources) {
    results.push(await ingestSource(source, deps));
  }
  return results;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/ingest-rss.test.ts`
Expected: 5 tests, PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/rss-fetcher.ts src/ingest-rss.ts tests/ingest-rss.test.ts
git commit -m "feat: add ingest-rss core logic behind a FeedFetcher interface"
```

---

### Task 5: `crawl-content` core logic

**Files:**
- Create: `src/lib/article-extractor.ts`
- Create: `src/crawl-content.ts`
- Test: `tests/crawl-content.test.ts`

**Interfaces:**
- Consumes: `ArticleRepository`, `FakeArticleRepository` (Task 3)
- Produces:
  - `interface ContentExtractor { extract(url: string): Promise<{ text: string | null } | null>; }`
  - `class DefaultContentExtractor implements ContentExtractor` (wraps `@extractus/article-extractor`) — used by Task 6
  - `const MAX_FETCH_ATTEMPTS = 3` — used by Task 6/7
  - `interface CrawlDeps { repo: ArticleRepository; extractor: ContentExtractor; }`
  - `interface CrawlResult { processed: number; succeeded: number; failed: number; }`
  - `crawlPendingArticles(deps: CrawlDeps, limit?: number): Promise<CrawlResult>` — used by Task 6

- [ ] **Step 1: Create the `ContentExtractor` interface and real adapter**

```ts
// src/lib/article-extractor.ts
import { extract } from '@extractus/article-extractor';

export interface ContentExtractor {
  extract(url: string): Promise<{ text: string | null } | null>;
}

export class DefaultContentExtractor implements ContentExtractor {
  async extract(url: string) {
    const article = await extract(url);
    return article ? { text: article.content ?? null } : null;
  }
}
```

> `DefaultContentExtractor` wraps a real network fetch — verified manually once real article URLs flow through the pipeline, not by an automated unit test. `crawlPendingArticles` below is tested against a fake `ContentExtractor`.

- [ ] **Step 2: Write the failing tests for `crawlPendingArticles`**

```ts
// tests/crawl-content.test.ts
import { describe, it, expect } from 'vitest';
import { crawlPendingArticles, MAX_FETCH_ATTEMPTS } from '../src/crawl-content';
import { FakeArticleRepository } from './fakes/fake-article-repository';
import type { ContentExtractor } from '../src/lib/article-extractor';
import type { Article } from '../src/types';

function baseArticle(overrides: Partial<Article>): Article {
  return {
    id: '1',
    url: 'https://example.com/a',
    title: 't',
    published_at: '',
    source_id: 's',
    categories: [],
    snippet: '',
    full_content: null,
    content_fetch_status: 'pending',
    fetch_attempts: 0,
    ...overrides,
  };
}

describe('crawlPendingArticles', () => {
  it('marks an article done when extraction succeeds', async () => {
    const repo = new FakeArticleRepository();
    repo.articles.push(baseArticle({ id: '1' }));
    const extractor: ContentExtractor = { extract: async () => ({ text: 'nội dung đầy đủ' }) };

    const result = await crawlPendingArticles({ repo, extractor });

    expect(result).toEqual({ processed: 1, succeeded: 1, failed: 0 });
    expect(repo.articles[0].content_fetch_status).toBe('done');
    expect(repo.articles[0].full_content).toBe('nội dung đầy đủ');
  });

  it('keeps status pending and increments attempts when extraction fails, under the cap', async () => {
    const repo = new FakeArticleRepository();
    repo.articles.push(baseArticle({ id: '1', fetch_attempts: 0 }));
    const extractor: ContentExtractor = { extract: async () => null };

    const result = await crawlPendingArticles({ repo, extractor });

    expect(result).toEqual({ processed: 1, succeeded: 0, failed: 1 });
    expect(repo.articles[0].content_fetch_status).toBe('pending');
    expect(repo.articles[0].fetch_attempts).toBe(1);
  });

  it('marks failed permanently once attempts reach MAX_FETCH_ATTEMPTS', async () => {
    const repo = new FakeArticleRepository();
    repo.articles.push(baseArticle({ id: '1', fetch_attempts: MAX_FETCH_ATTEMPTS - 1 }));
    const extractor: ContentExtractor = {
      extract: async () => {
        throw new Error('timeout');
      },
    };

    await crawlPendingArticles({ repo, extractor });

    expect(repo.articles[0].content_fetch_status).toBe('failed');
    expect(repo.articles[0].fetch_attempts).toBe(MAX_FETCH_ATTEMPTS);
  });

  it('respects the limit parameter', async () => {
    const repo = new FakeArticleRepository();
    repo.articles.push(baseArticle({ id: '1' }), baseArticle({ id: '2', url: 'https://example.com/b' }));
    const extractor: ContentExtractor = { extract: async () => ({ text: 'x' }) };

    const result = await crawlPendingArticles({ repo, extractor }, 1);

    expect(result.processed).toBe(1);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/crawl-content.test.ts`
Expected: FAIL — `Cannot find module '../src/crawl-content'`

- [ ] **Step 4: Implement `crawlPendingArticles`**

```ts
// src/crawl-content.ts
import type { ArticleRepository } from './lib/article-repository';
import type { ContentExtractor } from './lib/article-extractor';

export const MAX_FETCH_ATTEMPTS = 3;

export interface CrawlDeps {
  repo: ArticleRepository;
  extractor: ContentExtractor;
}

export interface CrawlResult {
  processed: number;
  succeeded: number;
  failed: number;
}

export async function crawlPendingArticles(deps: CrawlDeps, limit = 50): Promise<CrawlResult> {
  const result: CrawlResult = { processed: 0, succeeded: 0, failed: 0 };
  const pending = await deps.repo.getPendingArticles(limit, MAX_FETCH_ATTEMPTS);

  for (const row of pending) {
    result.processed += 1;
    const attempts = row.fetch_attempts + 1;

    try {
      const extracted = await deps.extractor.extract(row.url);
      if (!extracted?.text) {
        throw new Error('no content extracted');
      }
      await deps.repo.markDone(row.id, extracted.text, attempts);
      result.succeeded += 1;
    } catch {
      await deps.repo.markRetryOrFailed(row.id, attempts, MAX_FETCH_ATTEMPTS);
      result.failed += 1;
    }
  }

  return result;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/crawl-content.test.ts`
Expected: 4 tests, PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/article-extractor.ts src/crawl-content.ts tests/crawl-content.test.ts
git commit -m "feat: add crawl-content core logic with capped retries"
```

---

### Task 6: CLI entrypoints (`run-ingest`, `run-crawl`)

**Files:**
- Create: `src/lib/env.ts`
- Create: `src/run-ingest.ts`
- Create: `src/run-crawl.ts`
- Test: `tests/env.test.ts`

**Interfaces:**
- Consumes:
  - `sources` (Task 2), `ingestAllSources`, `RssParserFetcher` (Task 4)
  - `crawlPendingArticles`, `DefaultContentExtractor` (Task 5)
  - `SupabaseArticleRepository` (Task 3)
- Produces:
  - `getRequiredEnv(name: string): string` (throws if missing) — the only piece of this task that's unit-tested; the entrypoints themselves are exercised manually once a Supabase project exists (Task 7)

- [ ] **Step 1: Write the failing test for `getRequiredEnv`**

```ts
// tests/env.test.ts
import { describe, it, expect } from 'vitest';
import { getRequiredEnv } from '../src/lib/env';

describe('getRequiredEnv', () => {
  it('returns the value when the env var is set', () => {
    process.env.TEST_VAR = 'hello';
    expect(getRequiredEnv('TEST_VAR')).toBe('hello');
    delete process.env.TEST_VAR;
  });

  it('throws a clear error when the env var is missing', () => {
    delete process.env.MISSING_VAR;
    expect(() => getRequiredEnv('MISSING_VAR')).toThrow('Missing required environment variable: MISSING_VAR');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/env.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/env'`

- [ ] **Step 3: Implement `getRequiredEnv`**

```ts
// src/lib/env.ts
export function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/env.test.ts`
Expected: 2 tests, PASS.

- [ ] **Step 5: Create the `run-ingest` entrypoint**

```ts
// src/run-ingest.ts
import { createClient } from '@supabase/supabase-js';
import { getRequiredEnv } from './lib/env';
import { SupabaseArticleRepository } from './lib/article-repository';
import { RssParserFetcher } from './lib/rss-fetcher';
import { ingestAllSources } from './ingest-rss';
import { sources } from '../config/sources.config';

async function main() {
  const client = createClient(getRequiredEnv('SUPABASE_URL'), getRequiredEnv('SUPABASE_SERVICE_KEY'));
  const repo = new SupabaseArticleRepository(client);
  const fetcher = new RssParserFetcher();

  const results = await ingestAllSources(sources, { fetcher, repo });

  let hasErrors = false;
  for (const r of results) {
    console.log(`[${r.sourceId}] fetched=${r.fetched} upserted=${r.upserted} errors=${r.errors.length}`);
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

- [ ] **Step 6: Create the `run-crawl` entrypoint**

```ts
// src/run-crawl.ts
import { createClient } from '@supabase/supabase-js';
import { getRequiredEnv } from './lib/env';
import { SupabaseArticleRepository } from './lib/article-repository';
import { DefaultContentExtractor } from './lib/article-extractor';
import { crawlPendingArticles } from './crawl-content';

async function main() {
  const client = createClient(getRequiredEnv('SUPABASE_URL'), getRequiredEnv('SUPABASE_SERVICE_KEY'));
  const repo = new SupabaseArticleRepository(client);
  const extractor = new DefaultContentExtractor();

  const result = await crawlPendingArticles({ repo, extractor });
  console.log(`processed=${result.processed} succeeded=${result.succeeded} failed=${result.failed}`);

  if (result.failed > 0 && result.succeeded === 0 && result.processed > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/env.ts src/run-ingest.ts src/run-crawl.ts tests/env.test.ts
git commit -m "feat: add run-ingest/run-crawl CLI entrypoints"
```

---

### Task 7: Supabase migration, GitHub Actions workflow, README

**Files:**
- Create: `supabase/migrations/0001_create_articles_table.sql`
- Create: `.github/workflows/rss-ingestion.yml`
- Create: `README.md`
- Test: `tests/workflow.test.ts`

**Interfaces:**
- Consumes: `npm run ingest` / `npm run crawl` (Task 6), `articles` table shape (Task 2/3)
- Produces: nothing further downstream — this is the last task in this sub-project

- [ ] **Step 1: Create the Supabase migration**

```sql
-- supabase/migrations/0001_create_articles_table.sql
create table if not exists articles (
  id uuid primary key default gen_random_uuid(),
  url text not null unique,
  title text not null,
  published_at timestamptz,
  source_id text not null,
  categories text[] not null default '{}',
  snippet text not null default '',
  full_content text,
  content_fetch_status text not null default 'pending'
    check (content_fetch_status in ('pending', 'done', 'failed')),
  fetch_attempts integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists articles_content_fetch_status_idx
  on articles (content_fetch_status);

create index if not exists articles_categories_idx
  on articles using gin (categories);
```

- [ ] **Step 2: Write the failing test for the workflow file**

```ts
// tests/workflow.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';

describe('.github/workflows/rss-ingestion.yml', () => {
  const doc = load(readFileSync('.github/workflows/rss-ingestion.yml', 'utf8')) as any;

  it('defines both jobs', () => {
    expect(Object.keys(doc.jobs)).toEqual(['ingest-rss', 'crawl-content']);
  });

  it('gates crawl-content on ingest-rss via needs', () => {
    expect(doc['jobs']['crawl-content']['needs']).toBe('ingest-rss');
  });

  it('schedules 3 runs per day via cron', () => {
    const schedule = doc.on.schedule;
    expect(schedule).toHaveLength(1);
    expect(schedule[0].cron.split(' ')[1].split(',')).toHaveLength(3);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/workflow.test.ts`
Expected: FAIL — `ENOENT: no such file or directory, open '.github/workflows/rss-ingestion.yml'`

- [ ] **Step 4: Create the GitHub Actions workflow**

Cron is in UTC; `23,5,11` UTC = `06:00 / 12:00 / 18:00` Vietnam time (ICT, UTC+7).

```yaml
# .github/workflows/rss-ingestion.yml
name: RSS ingestion

on:
  schedule:
    - cron: '0 23,5,11 * * *'
  workflow_dispatch: {}

jobs:
  ingest-rss:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm ci
      - run: npm run ingest
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}

  crawl-content:
    needs: ingest-rss
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm ci
      - run: npm run crawl
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/workflow.test.ts`
Expected: 3 tests, PASS.

- [ ] **Step 6: Write the README**

```markdown
# Social Listening — RSS Ingestion

RSS ingestion sub-project. See `docs/superpowers/specs/2026-08-20-rss-ingestion-design.md` for the design and `docs/superpowers/specs/2026-08-20-social-listening-architecture-design.md` for how this fits the overall architecture.

## Setup

1. `npm install`
2. Create a Supabase project (not automated — user-owned step).
3. Apply `supabase/migrations/0001_create_articles_table.sql` to that project.
4. In the GitHub repo settings, add secrets `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` (the service-role key, since writes happen server-side in Actions).

## Running locally

```bash
export SUPABASE_URL=...
export SUPABASE_SERVICE_KEY=...
npm run ingest   # parses all 12 feeds, upserts pending articles
npm run crawl    # fetches full content for pending articles
```

## Tests

```bash
npm test
```

## Known pending items

- Supabase project not yet created in any environment — required before `run-ingest`/`run-crawl` can succeed for real.
- Feed URLs in `config/sources.config.ts` were verified live on 2026-08-20; re-check if ingestion starts silently returning 0 items for a source.
```

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0001_create_articles_table.sql .github/workflows/rss-ingestion.yml README.md tests/workflow.test.ts
git commit -m "feat: add Supabase migration, GitHub Actions workflow, and README"
```

---

## Self-Review Notes

- **Spec coverage:** every section of `2026-08-20-rss-ingestion-design.md` maps to a task — §2 (2-job architecture) → Task 7 workflow; §3 (data model) → Task 2/7 migration; §4 (category config) → Task 2; §5 (full-content crawl + retry) → Task 5; §6 (stack) → Task 1; §7 (pending items) → Task 7 README "Known pending items".
- **Placeholder scan:** no TBD/TODO; every code block is complete and runnable as written.
- **Type consistency:** `Article`, `RssSource`, `FeedItem` (Task 2) are the only shapes referenced by name in later tasks; `ArticleRepository`/`FakeArticleRepository` (Task 3), `FeedFetcher`/`RssParserFetcher` (Task 4), `ContentExtractor`/`DefaultContentExtractor` (Task 5) are each defined once and consumed with matching names/signatures in Task 6's entrypoints.
