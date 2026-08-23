# Deep-crawl Facebook (sub-project 2c) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Facebook deep-crawl job that pulls posts from a small hard-coded seed list of Facebook Pages (2 per category) into a new `facebook_page_data` table, running independently of the existing `candidate_topics`/keyword-search pipeline.

**Architecture:** Same layered pattern as sub-project 2b (Threads): a pure-logic core (`runDeepCrawlFacebook`) receives injected repository + Apify-client dependencies and an idempotency-guarded, per-page-error-isolated loop over a seed list, testable via fakes with zero real I/O. A thin entrypoint wires real Supabase + Apify clients and runs as its own job in the existing `discovery-ingestion.yml` workflow.

**Tech Stack:** TypeScript, `tsx`, Vitest, `@supabase/supabase-js`, native `fetch` (no Apify SDK — matches `apify-threads-client.ts`), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-23-deep-crawl-facebook-design.md`

## Global Constraints

- Data model: gắn theo **category** (`tai_chinh`/`giai_tri`/`du_lich`), NOT keyword — new table `facebook_page_data`, separate from `topic_social_data` (spec §2).
- Seed list: hard-coded in code, **exactly 6 pages, 2 per category** (spec §3).
- Error handling: isolate failures **per page** (try/catch around each actor call), **no retry** in v1 (spec §4).
- `MAX_POSTS_PER_PAGE = 15`, `MAX_TOTAL_CHARGE_USD = 0.3` per page-call, passed as both a URL query param and in the request body (spec §5, §7 — the query param is what Apify actually enforces, learned during 2b).
- `FETCH_TIMEOUT_MS = 300000` (Apify's `run-sync-*` server-side cutoff, spec §7).
- Actor: `apify/facebook-posts-scraper` → URL-encoded actor id `apify~facebook-posts-scraper`.
- Job does **not** depend on `candidate_topics`/`discovery-ingest`/`rank-and-select` — no `needs:` on those jobs (spec §6).
- Idempotency guard: check `facebook_page_data` has any row for today's `date` before doing any Apify call; skip (exit 0) if so (spec §6).
- Reuses the existing `APIFY_TOKEN` GitHub secret — no new secret required (spec §7).
- Dedupe by `post_url` before every upsert batch (same reason as 2b: a duplicate `post_url` within one page's batch would make Postgres reject the entire upsert statement).
- No media/hashtags/mentions stored — YAGNI, matches 2b.

---

### Task 1: Migration, `FacebookPageData` type, and schema doc

**Files:**
- Create: `supabase/migrations/0005_add_facebook_page_data.sql`
- Modify: `src/types.ts`
- Create: `docs/superpowers/specs/2026-08-23-deep-crawl-facebook-database-schema.md`

**Interfaces:**
- Produces: `FacebookPageData` TypeScript interface (used by every later task), table `facebook_page_data` with columns `id, page_url, category, date, post_url, text_content, like_count, comment_count, share_count, posted_at, fetched_at` and unique constraint `(page_url, post_url)`.

This task has no automated test cycle — it's schema + types + docs, mirroring how `0004_add_topic_social_data.sql` was introduced in sub-project 2b (no test file for a migration exists anywhere in this repo).

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0005_add_facebook_page_data.sql`:

```sql
create table if not exists facebook_page_data (
  id uuid primary key default gen_random_uuid(),
  page_url text not null,
  category text not null check (category in ('tai_chinh', 'giai_tri', 'du_lich')),
  date date not null,
  post_url text not null,
  text_content text not null default '',
  like_count integer,
  comment_count integer,
  share_count integer,
  posted_at timestamptz,
  fetched_at timestamptz not null default now(),
  unique (page_url, post_url)
);

create index if not exists facebook_page_data_date_idx
  on facebook_page_data (date);

alter table facebook_page_data enable row level security;
```

This migration is **not applied to production by this plan** — applying it to the real Supabase project is a human step (see Task 8's README update), same as `0004` was in 2b.

- [ ] **Step 2: Add the `FacebookPageData` type**

In `src/types.ts`, after the existing `TopicSocialData` interface (end of file), add:

```typescript
export interface FacebookPageData {
  id?: string;
  page_url: string;
  category: Category;
  date: string;
  post_url: string;
  text_content: string;
  like_count: number | null;
  comment_count: number | null;
  share_count: number | null;
  posted_at: string | null;
  fetched_at?: string;
}
```

(`Category` is already defined earlier in this file — `'tai_chinh' | 'giai_tri' | 'du_lich'`.)

- [ ] **Step 3: Run typecheck to confirm no errors**

Run: `npm run typecheck`
Expected: exits 0, no errors (this step only adds a new exported type — nothing consumes it yet).

- [ ] **Step 4: Write the schema doc**

Create `docs/superpowers/specs/2026-08-23-deep-crawl-facebook-database-schema.md`:

```markdown
# Deep-crawl Facebook — Database Schema

**Ngày:** 2026-08-23
**Trạng thái:** Chưa deploy — migration 0005 chưa apply lên production
**Thuộc:** chi tiết hoá phần data model của [2026-08-23-deep-crawl-facebook-design.md](./2026-08-23-deep-crawl-facebook-design.md), phản ánh đúng migration đã viết (`supabase/migrations/0005_add_facebook_page_data.sql`), chưa phải bản đã chạy thật trên Supabase.

## Sơ đồ

Thêm 1 bảng mới — `facebook_page_data` — bên cạnh `topic_social_data` (sub-project 2b, xem [2026-08-23-deep-crawl-threads-database-schema.md](./2026-08-23-deep-crawl-threads-database-schema.md)). Khác `topic_social_data`, bảng này không có cột `keyword` — gắn theo `category` vì Facebook không hỗ trợ search theo từ khóa (xem design spec §1/§2). Không đọc/ghi `candidate_topics` — seed list tĩnh, không phụ thuộc shortlist hôm đó.

\`\`\`mermaid
erDiagram
    facebook_page_data {
        uuid id PK
        text page_url
        text category
        date date
        text post_url
        text text_content
        integer like_count
        integer comment_count
        integer share_count
        timestamptz posted_at
        timestamptz fetched_at
    }
\`\`\`

## Chi tiết cột

| Cột | Kiểu | Ràng buộc | Ghi chú |
|---|---|---|---|
| `id` | `uuid` | PK, `default gen_random_uuid()` | tự sinh |
| `page_url` | `text` | `not null` | URL Page nguồn, khớp `facebook-seed-pages.ts` |
| `category` | `text` | `not null`, `check (category in ('tai_chinh','giai_tri','du_lich'))` | gán sẵn per-page lúc curate seed list, KHÔNG suy ra từ nội dung bài viết — 1 Page luôn thuộc đúng 1 category cố định |
| `date` | `date` | `not null` | ngày chạy deep-crawl (UTC calendar date), dùng cho idempotency guard `hasDataForDate(date)` |
| `post_url` | `text` | `not null` | key dedup cùng `page_url` — xem `unique` bên dưới |
| `text_content` | `text` | `not null default ''` | rỗng nếu actor trả sai kiểu, thay vì null vì cột `not null` |
| `like_count` / `comment_count` / `share_count` | `integer` | nullable | engagement thô từ actor; `null` nếu actor không trả về hoặc trả sai kiểu (runtime-checked, không ép kiểu bằng `as`) |
| `posted_at` | `timestamptz` | nullable | thời điểm đăng bài, `null` nếu actor không trả về hoặc trả sai kiểu |
| `fetched_at` | `timestamptz` | `not null default now()` | thời điểm job ghi dòng này, không tự cập nhật khi upsert đè lên dòng cũ |

Ràng buộc bổ sung: `unique (page_url, post_url)` — key dedup, `FacebookPageDataRepository.upsertPosts()` dùng `onConflict: 'page_url,post_url'`.

## Index

- `facebook_page_data_date_idx` — btree trên `date`, phục vụ `hasDataForDate(date)` và query đọc theo ngày ở sub-project 3 sau này.

## Row Level Security

`alter table facebook_page_data enable row level security;` — bật nhưng chưa có policy nào, cùng trạng thái với `articles`/`candidate_topics`/`topic_social_data`. An toàn vì toàn bộ ghi/đọc đều qua `service_role` key trong GitHub Actions.

## Known gaps / limitations

- **Category gán per-Page, không per-post** — vì 1 Facebook Page thường đăng nội dung đa dạng, không thuần 1 chủ đề, category ở đây là nhãn "Page thuộc mảng nào" (chọn lúc curate seed list, ưu tiên Page có nội dung tập trung 1 chủ đề) chứ không phải phân loại chính xác từng bài viết. Nếu cần phân loại per-post chính xác hơn, cần NLP classify riêng — ngoài phạm vi v1.
- **Idempotency guard giống 2b** — kiểm tra "đã có dữ liệu ghi hôm nay chưa", không phải "job đã chạy hôm nay chưa". Nếu mọi page đều lỗi trong 1 lần chạy, lần cron kế tiếp trong ngày sẽ chạy lại từ đầu.
- **Dedupe theo `post_url` trước khi upsert** — cùng lý do 2b: 1 `post_url` trùng trong batch của 1 page sẽ khiến Postgres từ chối toàn bộ câu lệnh upsert.
- Không có cột liên kết ngược `candidate_topics` — bảng này độc lập hoàn toàn với discovery layer.
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0005_add_facebook_page_data.sql src/types.ts docs/superpowers/specs/2026-08-23-deep-crawl-facebook-database-schema.md
git commit -m "feat: add facebook_page_data migration, type, and schema doc"
```

---

### Task 2: Seed list (`facebook-seed-pages.ts`)

**Files:**
- Create: `src/lib/facebook-seed-pages.ts`
- Test: `tests/facebook-seed-pages.test.ts`

**Interfaces:**
- Consumes: `Category` type from `src/types.ts` (Task 1).
- Produces: `FacebookSeedPage` interface (`{ url: string; category: Category }`) and `FACEBOOK_SEED_PAGES: FacebookSeedPage[]` constant — consumed by Task 5 (`deep-crawl-facebook.ts`) as the default seed list.

**Seed list content** — 2 pages per category, real well-known Vietnamese outlets/brands whose Facebook Pages are thematically focused on that category (so the per-Page category label in Task 1's schema is meaningfully accurate, not a guess):

| Category | Page | URL |
|---|---|---|
| `tai_chinh` | CafeF (Vietnamese business/finance news) | `https://www.facebook.com/cafef.vn` |
| `tai_chinh` | VnEconomy (Vietnamese economy/finance news) | `https://www.facebook.com/vneconomy.vn` |
| `giai_tri` | Kenh14 (Vietnamese youth entertainment/lifestyle news) | `https://www.facebook.com/kenh14` |
| `giai_tri` | Saostar (Vietnamese celebrity/entertainment news) | `https://www.facebook.com/Saostar.vn` |
| `du_lich` | Vietravel (Vietnamese travel agency) | `https://www.facebook.com/vietravel` |
| `du_lich` | Klook Vietnam (travel booking/experiences platform) | `https://www.facebook.com/klook.vietnam` |

**IMPORTANT — verify before committing:** these 6 URLs are best-effort picks made without a live browser check in this session. Before writing the file, visit each URL (or run a quick `curl -sI <url>` and check for a 200/redirect-to-real-page rather than an error page) to confirm it resolves to a real, active Facebook Page. If any URL is dead or wrong, replace it with a working Facebook Page for a real outlet/brand in the same category, keeping the "thematically focused, not general news" intent above. Note any substitution in the commit message.

- [ ] **Step 1: Write the failing test**

Create `tests/facebook-seed-pages.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { FACEBOOK_SEED_PAGES } from '../src/lib/facebook-seed-pages';

describe('FACEBOOK_SEED_PAGES', () => {
  it('has exactly 6 pages, 2 per category', () => {
    expect(FACEBOOK_SEED_PAGES).toHaveLength(6);
    const byCategory = { tai_chinh: 0, giai_tri: 0, du_lich: 0 };
    for (const page of FACEBOOK_SEED_PAGES) {
      byCategory[page.category]++;
    }
    expect(byCategory).toEqual({ tai_chinh: 2, giai_tri: 2, du_lich: 2 });
  });

  it('has no duplicate page URLs', () => {
    const urls = FACEBOOK_SEED_PAGES.map((p) => p.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('every URL is a facebook.com URL', () => {
    for (const page of FACEBOOK_SEED_PAGES) {
      expect(page.url).toMatch(/^https:\/\/www\.facebook\.com\//);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/facebook-seed-pages.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/facebook-seed-pages'`

- [ ] **Step 3: Write the seed list**

Create `src/lib/facebook-seed-pages.ts`:

```typescript
import type { Category } from '../types';

export interface FacebookSeedPage {
  url: string;
  category: Category;
}

// Hard-coded seed list, deliberately over-provisioned (2 pages/category) to
// survive the per-page unreliability measured during 2b's pricing spike
// (2/3 test pages failed with "not_available"/"no_items"). Each page is
// picked to be thematically focused on its category (not a general news
// outlet posting a mix of everything) so the per-page category label is
// meaningfully accurate — see the design spec §2/§3 and the schema doc's
// "Known gaps" note on category being per-Page, not per-post.
//
// To scale up later (more pages, or raise MAX_POSTS_PER_PAGE in
// apify-facebook-client.ts), just edit this array/constant — no
// architecture change needed. See design spec §5.
export const FACEBOOK_SEED_PAGES: FacebookSeedPage[] = [
  { url: 'https://www.facebook.com/cafef.vn', category: 'tai_chinh' },
  { url: 'https://www.facebook.com/vneconomy.vn', category: 'tai_chinh' },
  { url: 'https://www.facebook.com/kenh14', category: 'giai_tri' },
  { url: 'https://www.facebook.com/Saostar.vn', category: 'giai_tri' },
  { url: 'https://www.facebook.com/vietravel', category: 'du_lich' },
  { url: 'https://www.facebook.com/klook.vietnam', category: 'du_lich' },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/facebook-seed-pages.test.ts`
Expected: PASS, 3/3 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/facebook-seed-pages.ts tests/facebook-seed-pages.test.ts
git commit -m "feat: add Facebook seed page list"
```

---

### Task 3: `FacebookPageDataRepository` (interface + Supabase impl + fake)

**Files:**
- Create: `src/lib/facebook-page-data-repository.ts`
- Create: `tests/fakes/fake-facebook-page-data-repository.ts`

**Interfaces:**
- Consumes: `FacebookPageData` type (Task 1).
- Produces: `FacebookPageDataRepository` interface (`hasDataForDate(date): Promise<boolean>`, `upsertPosts(rows): Promise<{error, count}>`), `SupabaseFacebookPageDataRepository` class, `FakeFacebookPageDataRepository` class — Task 5's tests and entrypoint (Task 6) depend on these exact names/signatures.

No test file for the real Supabase-backed class — this matches the existing convention in this codebase: `topic-social-data-repository.ts` (2b) has no direct test either, since it's a thin I/O wrapper. It's exercised indirectly through the fake in Task 5's tests.

- [ ] **Step 1: Write the repository**

Create `src/lib/facebook-page-data-repository.ts`:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FacebookPageData } from '../types';

export interface FacebookPageDataRepository {
  hasDataForDate(date: string): Promise<boolean>;
  upsertPosts(rows: Partial<FacebookPageData>[]): Promise<{ error: string | null; count: number }>;
}

export class SupabaseFacebookPageDataRepository implements FacebookPageDataRepository {
  constructor(private client: SupabaseClient) {}

  async hasDataForDate(date: string): Promise<boolean> {
    const { count, error } = await this.client
      .from('facebook_page_data')
      .select('id', { count: 'exact', head: true })
      .eq('date', date);
    if (error) throw new Error(error.message);
    return (count ?? 0) > 0;
  }

  async upsertPosts(rows: Partial<FacebookPageData>[]) {
    if (rows.length === 0) return { error: null, count: 0 };
    const { error } = await this.client
      .from('facebook_page_data')
      .upsert(rows, { onConflict: 'page_url,post_url' });
    return { error: error?.message ?? null, count: error ? 0 : rows.length };
  }
}
```

- [ ] **Step 2: Write the fake**

Create `tests/fakes/fake-facebook-page-data-repository.ts`:

```typescript
import type { FacebookPageDataRepository } from '../../src/lib/facebook-page-data-repository';
import type { FacebookPageData } from '../../src/types';

export class FakeFacebookPageDataRepository implements FacebookPageDataRepository {
  public posts: FacebookPageData[] = [];
  // Set to simulate upsertPosts failing, e.g. to test deep-crawl-facebook's
  // batch error handling without a real database.
  public upsertError: string | null = null;

  async hasDataForDate(date: string): Promise<boolean> {
    return this.posts.some((p) => p.date === date);
  }

  async upsertPosts(rows: Partial<FacebookPageData>[]) {
    if (this.upsertError) return { error: this.upsertError, count: 0 };
    for (const row of rows) {
      this.posts.push({
        id: row.id ?? crypto.randomUUID(),
        page_url: row.page_url!,
        category: row.category!,
        date: row.date!,
        post_url: row.post_url!,
        text_content: row.text_content ?? '',
        like_count: row.like_count ?? null,
        comment_count: row.comment_count ?? null,
        share_count: row.share_count ?? null,
        posted_at: row.posted_at ?? null,
      });
    }
    return { error: null, count: rows.length };
  }
}
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: exits 0, no errors

- [ ] **Step 4: Commit**

```bash
git add src/lib/facebook-page-data-repository.ts tests/fakes/fake-facebook-page-data-repository.ts
git commit -m "feat: add FacebookPageDataRepository and its fake"
```

---

### Task 4: Apify Facebook client (`apify-facebook-client.ts`)

**Files:**
- Create: `src/lib/apify-facebook-client.ts`

**Interfaces:**
- Produces: `FacebookPost` interface (`post_url, text_content, like_count, comment_count, share_count, posted_at`), `FacebookPageScrapeClient` interface (`scrapePage(pageUrl: string): Promise<FacebookPost[]>`), `ApifyFacebookPageScrapeClient` class — Task 5 depends on `FacebookPageScrapeClient`/`FacebookPost`, Task 6 depends on `ApifyFacebookPageScrapeClient`.

No test file — this is a pure I/O wrapper, matching the existing convention (`apify-threads-client.ts` in 2b has no direct test file either; it's exercised for real only in production, and its shape is exercised via fakes implementing the same interface in the logic-layer tests).

**IMPORTANT — field-name uncertainty:** the exact JSON field names `apify/facebook-posts-scraper` returns per post (`url`/`text`/`likes`/`comments`/`shares`/`time` below) are best-effort based on this actor's commonly documented shape, NOT verified against a real response in this session (unlike 2b, where the Threads actor's fields were confirmed via a real pricing-spike run). Before finishing this task, either run the actor once via the Apify Console's "Input" tab with one seed URL and inspect a real dataset item, or make one real `run-sync-get-dataset-items` call locally with a valid `APIFY_TOKEN`, and adjust the field-extraction code below if the real field names differ.

- [ ] **Step 1: Write the client**

Create `src/lib/apify-facebook-client.ts`:

```typescript
export interface FacebookPost {
  post_url: string;
  text_content: string;
  like_count: number | null;
  comment_count: number | null;
  share_count: number | null;
  posted_at: string | null;
}

export interface FacebookPageScrapeClient {
  scrapePage(pageUrl: string): Promise<FacebookPost[]>;
}

const FETCH_TIMEOUT_MS = 300000;
const MAX_POSTS_PER_PAGE = 15;
const MAX_TOTAL_CHARGE_USD = 0.3;
const ACTOR_ID = 'apify~facebook-posts-scraper';

function toNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null;
}

function toStringOrDefault(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

// Real adapter over Apify's run-sync-get-dataset-items endpoint — same
// pattern as apify-threads-client.ts (2b): blocks until the run finishes or
// times out, no separate poll loop. maxTotalChargeUsd is a hard per-call
// safety cap, passed both as a URL query param (what Apify actually
// enforces — learned in 2b) and in the body (harmless belt-and-braces).
// FETCH_TIMEOUT_MS matches Apify's own server-side cutoff for
// run-sync-* endpoints, same reasoning as 2b.
export class ApifyFacebookPageScrapeClient implements FacebookPageScrapeClient {
  constructor(private apiToken: string) {}

  async scrapePage(pageUrl: string): Promise<FacebookPost[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const url = `https://api.apify.com/v2/acts/${ACTOR_ID}/run-sync-get-dataset-items?token=${this.apiToken}&maxTotalChargeUsd=${MAX_TOTAL_CHARGE_USD}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          startUrls: [{ url: pageUrl }],
          resultsLimit: MAX_POSTS_PER_PAGE,
          maxTotalChargeUsd: MAX_TOTAL_CHARGE_USD,
        }),
      });
      if (!response.ok) {
        const bodyText = await response.text().catch(() => '');
        throw new Error(`Apify request failed: ${response.status} ${bodyText.slice(0, 200)}`);
      }
      const items = (await response.json()) as Array<Record<string, unknown>>;
      return items
        .filter((item) => typeof item.url === 'string')
        .map((item) => ({
          post_url: item.url as string,
          text_content: toStringOrDefault(item.text, ''),
          like_count: toNumberOrNull(item.likes),
          comment_count: toNumberOrNull(item.comments),
          share_count: toNumberOrNull(item.shares),
          posted_at: toStringOrNull(item.time),
        }));
    } finally {
      clearTimeout(timeout);
    }
  }
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: exits 0, no errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/apify-facebook-client.ts
git commit -m "feat: add Apify Facebook page-scrape client"
```

---

### Task 5: Core logic (`deep-crawl-facebook.ts`)

**Files:**
- Create: `src/deep-crawl-facebook.ts`
- Test: `tests/deep-crawl-facebook.test.ts`

**Interfaces:**
- Consumes: `FacebookPageDataRepository` (Task 3), `FacebookPageScrapeClient`/`FacebookPost` (Task 4), `FacebookSeedPage`/`FACEBOOK_SEED_PAGES` (Task 2), `FacebookPageData` (Task 1).
- Produces: `DeepCrawlFacebookDeps` interface (`socialRepo`, `client`, `seedPages?`, `now?`), `DeepCrawlFacebookResult` interface (`skipped`, `pagesCrawled`, `postsUpserted`, `errors`), `runDeepCrawlFacebook(deps): Promise<DeepCrawlFacebookResult>` — Task 6's entrypoint depends on this exact function name and `DeepCrawlFacebookDeps` shape.

`seedPages` is injectable (defaults to the real `FACEBOOK_SEED_PAGES`) specifically so tests use a small controlled list instead of depending on the real production seed list — the same reason `now` is injectable.

- [ ] **Step 1: Write the failing tests**

Create `tests/deep-crawl-facebook.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { runDeepCrawlFacebook } from '../src/deep-crawl-facebook';
import { FakeFacebookPageDataRepository } from './fakes/fake-facebook-page-data-repository';
import type { FacebookPageScrapeClient, FacebookPost } from '../src/lib/apify-facebook-client';
import type { FacebookSeedPage } from '../src/lib/facebook-seed-pages';

function post(overrides: Partial<FacebookPost> = {}): FacebookPost {
  return {
    post_url: 'https://www.facebook.com/page/posts/1',
    text_content: 'hello',
    like_count: 1,
    comment_count: 1,
    share_count: 0,
    posted_at: '2026-08-23T00:00:00Z',
    ...overrides,
  };
}

class FakeFacebookPageScrapeClient implements FacebookPageScrapeClient {
  public calls: string[] = [];
  public postsByPage: Record<string, FacebookPost[]> = {};
  public errorForPage: Record<string, string> = {};

  async scrapePage(pageUrl: string): Promise<FacebookPost[]> {
    this.calls.push(pageUrl);
    if (this.errorForPage[pageUrl]) throw new Error(this.errorForPage[pageUrl]);
    return this.postsByPage[pageUrl] ?? [];
  }
}

const NOW = () => new Date('2026-08-23T09:00:00Z');

const TEST_SEED_PAGES: FacebookSeedPage[] = [
  { url: 'https://www.facebook.com/finance-page', category: 'tai_chinh' },
  { url: 'https://www.facebook.com/entertainment-page', category: 'giai_tri' },
];

describe('runDeepCrawlFacebook', () => {
  it('skips and returns early when facebook_page_data already has rows for today', async () => {
    const socialRepo = new FakeFacebookPageDataRepository();
    await socialRepo.upsertPosts([
      {
        page_url: 'https://www.facebook.com/existing',
        category: 'tai_chinh',
        date: '2026-08-23',
        post_url: 'https://www.facebook.com/existing/posts/0',
      },
    ]);
    const client = new FakeFacebookPageScrapeClient();

    const result = await runDeepCrawlFacebook({ socialRepo, client, seedPages: TEST_SEED_PAGES, now: NOW });

    expect(result.skipped).toBe(true);
    expect(client.calls).toEqual([]);
  });

  it('calls the client once per seed page', async () => {
    const socialRepo = new FakeFacebookPageDataRepository();
    const client = new FakeFacebookPageScrapeClient();

    const result = await runDeepCrawlFacebook({ socialRepo, client, seedPages: TEST_SEED_PAGES, now: NOW });

    expect(result.skipped).toBe(false);
    expect(result.pagesCrawled).toBe(2);
    expect(client.calls.sort()).toEqual([
      'https://www.facebook.com/entertainment-page',
      'https://www.facebook.com/finance-page',
    ]);
  });

  it('upserts posts returned by the client, tagging them with page_url/category/date', async () => {
    const socialRepo = new FakeFacebookPageDataRepository();
    const client = new FakeFacebookPageScrapeClient();
    client.postsByPage['https://www.facebook.com/finance-page'] = [
      post({ post_url: 'https://www.facebook.com/finance-page/posts/1' }),
    ];

    const result = await runDeepCrawlFacebook({ socialRepo, client, seedPages: TEST_SEED_PAGES, now: NOW });

    expect(result.postsUpserted).toBe(1);
    expect(socialRepo.posts).toHaveLength(1);
    expect(socialRepo.posts[0]).toMatchObject({
      page_url: 'https://www.facebook.com/finance-page',
      category: 'tai_chinh',
      date: '2026-08-23',
      post_url: 'https://www.facebook.com/finance-page/posts/1',
    });
  });

  it("isolates one page's client failure from the rest", async () => {
    const socialRepo = new FakeFacebookPageDataRepository();
    const client = new FakeFacebookPageScrapeClient();
    client.errorForPage['https://www.facebook.com/finance-page'] = 'actor failed';
    client.postsByPage['https://www.facebook.com/entertainment-page'] = [
      post({ post_url: 'https://www.facebook.com/entertainment-page/posts/2' }),
    ];

    const result = await runDeepCrawlFacebook({ socialRepo, client, seedPages: TEST_SEED_PAGES, now: NOW });

    expect(result.errors).toEqual([
      'crawl failed for "https://www.facebook.com/finance-page": actor failed',
    ]);
    expect(result.postsUpserted).toBe(1);
    expect(socialRepo.posts).toHaveLength(1);
  });

  it("isolates one page's upsert failure from the rest", async () => {
    const socialRepo = new FakeFacebookPageDataRepository();
    socialRepo.upsertError = 'db down';
    const client = new FakeFacebookPageScrapeClient();
    client.postsByPage['https://www.facebook.com/finance-page'] = [post()];

    const result = await runDeepCrawlFacebook({
      socialRepo,
      client,
      seedPages: [TEST_SEED_PAGES[0]],
      now: NOW,
    });

    expect(result.errors).toEqual([
      'upsert failed for "https://www.facebook.com/finance-page": db down',
    ]);
    expect(result.postsUpserted).toBe(0);
  });

  it('dedupes duplicate post_url from the same page before upserting', async () => {
    const socialRepo = new FakeFacebookPageDataRepository();
    const client = new FakeFacebookPageScrapeClient();
    client.postsByPage['https://www.facebook.com/finance-page'] = [
      post({ post_url: 'https://www.facebook.com/finance-page/posts/1', text_content: 'first' }),
      post({ post_url: 'https://www.facebook.com/finance-page/posts/1', text_content: 'dup' }),
    ];

    const result = await runDeepCrawlFacebook({
      socialRepo,
      client,
      seedPages: [TEST_SEED_PAGES[0]],
      now: NOW,
    });

    expect(result.postsUpserted).toBe(1);
    expect(socialRepo.posts).toHaveLength(1);
  });

  it('defaults to the real FACEBOOK_SEED_PAGES list (6 pages) when seedPages is not provided', async () => {
    const socialRepo = new FakeFacebookPageDataRepository();
    const client = new FakeFacebookPageScrapeClient();

    const result = await runDeepCrawlFacebook({ socialRepo, client, now: NOW });

    expect(result.pagesCrawled).toBe(6);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/deep-crawl-facebook.test.ts`
Expected: FAIL — `Cannot find module '../src/deep-crawl-facebook'`

- [ ] **Step 3: Write the implementation**

Create `src/deep-crawl-facebook.ts`:

```typescript
import type { FacebookPageDataRepository } from './lib/facebook-page-data-repository';
import type { FacebookPageScrapeClient } from './lib/apify-facebook-client';
import type { FacebookPageData } from './types';
import { FACEBOOK_SEED_PAGES, type FacebookSeedPage } from './lib/facebook-seed-pages';

export interface DeepCrawlFacebookDeps {
  socialRepo: FacebookPageDataRepository;
  client: FacebookPageScrapeClient;
  // Injectable so tests use a small controlled list instead of depending on
  // the real production seed list — defaults to FACEBOOK_SEED_PAGES.
  seedPages?: FacebookSeedPage[];
  now?: () => Date;
}

export interface DeepCrawlFacebookResult {
  skipped: boolean;
  pagesCrawled: number;
  postsUpserted: number;
  errors: string[];
}

export async function runDeepCrawlFacebook(deps: DeepCrawlFacebookDeps): Promise<DeepCrawlFacebookResult> {
  const now = deps.now ?? (() => new Date());
  const date = now().toISOString().slice(0, 10);
  const result: DeepCrawlFacebookResult = { skipped: false, pagesCrawled: 0, postsUpserted: 0, errors: [] };

  // Idempotency guard — same reasoning as deep-crawl.ts (2b): robust against
  // cron schedule changes and repeated workflow_dispatch runs on the same
  // day. See design spec §6.
  const alreadyRan = await deps.socialRepo.hasDataForDate(date);
  if (alreadyRan) {
    result.skipped = true;
    return result;
  }

  const seedPages = deps.seedPages ?? FACEBOOK_SEED_PAGES;
  result.pagesCrawled = seedPages.length;

  for (const page of seedPages) {
    try {
      const posts = await deps.client.scrapePage(page.url);
      // Dedupe by post_url before upserting — same reason as deep-crawl.ts
      // (2b): every row in this batch shares page_url, so a duplicated
      // post_url would collide on the same unique(page_url,post_url)
      // conflict key within one upsert statement and make Postgres reject
      // the entire statement.
      const dedupedPosts = [...new Map(posts.map((p) => [p.post_url, p])).values()];
      // Spread ...post first so page_url/category/date (set by this job,
      // not the actor) can't be silently overwritten by a future
      // FacebookPost field.
      const rows: Partial<FacebookPageData>[] = dedupedPosts.map((p) => ({
        ...p,
        page_url: page.url,
        category: page.category,
        date,
      }));
      const { error, count } = await deps.socialRepo.upsertPosts(rows);
      if (error) {
        result.errors.push(`upsert failed for "${page.url}": ${error}`);
      } else {
        result.postsUpserted += count;
      }
    } catch (err) {
      // One page's Apify failure must not abort the remaining pages — same
      // isolation principle used throughout this project.
      result.errors.push(`crawl failed for "${page.url}": ${(err as Error).message}`);
    }
  }

  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/deep-crawl-facebook.test.ts`
Expected: PASS, 7/7 tests

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: all tests pass (existing suite + new ones), no regressions

- [ ] **Step 6: Commit**

```bash
git add src/deep-crawl-facebook.ts tests/deep-crawl-facebook.test.ts
git commit -m "feat: add runDeepCrawlFacebook core logic"
```

---

### Task 6: Entrypoint + npm script

**Files:**
- Create: `src/run-deep-crawl-facebook.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `runDeepCrawlFacebook`/`DeepCrawlFacebookDeps` (Task 5), `SupabaseFacebookPageDataRepository` (Task 3), `ApifyFacebookPageScrapeClient` (Task 4), `getRequiredEnv` (existing `src/lib/env.ts`).
- Produces: `npm run deep-crawl-facebook` script — Task 7's workflow job depends on this exact script name.

No test — matches the existing convention (`run-deep-crawl.ts` in 2b has no direct test either; it's a thin wiring script).

- [ ] **Step 1: Write the entrypoint**

Create `src/run-deep-crawl-facebook.ts`:

```typescript
import { createClient } from '@supabase/supabase-js';
import { getRequiredEnv } from './lib/env';
import { SupabaseFacebookPageDataRepository } from './lib/facebook-page-data-repository';
import { ApifyFacebookPageScrapeClient } from './lib/apify-facebook-client';
import { runDeepCrawlFacebook } from './deep-crawl-facebook';

async function main() {
  const client = createClient(getRequiredEnv('SUPABASE_URL'), getRequiredEnv('SUPABASE_SERVICE_KEY'));
  const socialRepo = new SupabaseFacebookPageDataRepository(client);
  const apifyClient = new ApifyFacebookPageScrapeClient(getRequiredEnv('APIFY_TOKEN'));

  const result = await runDeepCrawlFacebook({ socialRepo, client: apifyClient });

  if (result.skipped) {
    console.log('Facebook deep-crawl already ran today — skipped.');
    return;
  }

  console.log(
    `pagesCrawled=${result.pagesCrawled} postsUpserted=${result.postsUpserted} errors=${result.errors.length}`
  );
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

- [ ] **Step 2: Add the npm script**

In `package.json`, in the `"scripts"` block, add a line after `"deep-crawl": "tsx src/run-deep-crawl.ts"`:

```json
    "deep-crawl-facebook": "tsx src/run-deep-crawl-facebook.ts"
```

- [ ] **Step 3: Run typecheck and full test suite**

Run: `npm run typecheck && npm test`
Expected: both exit 0, no errors, no regressions

- [ ] **Step 4: Commit**

```bash
git add src/run-deep-crawl-facebook.ts package.json
git commit -m "feat: add run-deep-crawl-facebook entrypoint and npm script"
```

---

### Task 7: Wire into `discovery-ingestion.yml`

**Files:**
- Modify: `.github/workflows/discovery-ingestion.yml`

**Interfaces:**
- Consumes: `npm run deep-crawl-facebook` script (Task 6).

No automated test — this is a GitHub Actions YAML change, verified by a real `workflow_dispatch` run after merge (a human/live-verification step, same as 2b's workflow job was).

- [ ] **Step 1: Add the job**

In `.github/workflows/discovery-ingestion.yml`, after the existing `deep-crawl:` job (which ends at the `APIFY_TOKEN` env line), add a new top-level job at the same indentation as `discovery-ingest:`, `rank-and-select:`, and `deep-crawl:`:

```yaml
  deep-crawl-facebook:
    if: ${{ !cancelled() }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run deep-crawl-facebook
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
          APIFY_TOKEN: ${{ secrets.APIFY_TOKEN }}
```

Deliberately **no `needs:`** on `discovery-ingest`/`rank-and-select`/`deep-crawl` — this job reads only its own hard-coded seed list, not `candidate_topics`, so it runs independently and in parallel with the other three jobs (design spec §6).

- [ ] **Step 2: Validate YAML syntax**

Run: `node -e "require('js-yaml').load(require('fs').readFileSync('.github/workflows/discovery-ingestion.yml', 'utf8')); console.log('valid')"`
Expected: prints `valid`, no parse errors

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/discovery-ingestion.yml
git commit -m "feat: wire deep-crawl-facebook into discovery-ingestion workflow"
```

---

### Task 8: README update

**Files:**
- Modify: `README.md`

**Interfaces:** none — documentation only.

- [ ] **Step 1: Add a "Deep-crawl Facebook" section**

In `README.md`, after the existing `## Deep-crawl Threads (sub-project 2b v1)` section (ends right before `## Tests`), add:

```markdown
## Deep-crawl Facebook (sub-project 2c)

```bash
export SUPABASE_URL=...
export SUPABASE_SERVICE_KEY=...
export APIFY_TOKEN=...
npm run deep-crawl-facebook   # crawls 6 hard-coded Facebook Pages (2/category) -> facebook_page_data
```

Setup: apply `supabase/migrations/0005_add_facebook_page_data.sql` (after `0001`-`0004`). No new GitHub secret needed — reuses the existing `APIFY_TOKEN` from sub-project 2b.

Uses `apify/facebook-posts-scraper` against a small hard-coded seed list (`src/lib/facebook-seed-pages.ts`), not keyword search — Facebook's actor only accepts specific Page URLs, unlike Threads. Runs as its own job in `discovery-ingestion.yml`, independent of `candidate_topics`/the other 3 jobs (no `needs:`), guarded by the same per-day idempotency check as `deep-crawl`. Deliberately small/exploratory scale (`MAX_POSTS_PER_PAGE=15`, 6 pages) to measure real cost/reliability before deciding whether to scale up — see `docs/superpowers/specs/2026-08-23-deep-crawl-facebook-design.md` §5.
```

- [ ] **Step 2: Fix the stale "not yet applied" line and add a pending item for Facebook**

The existing "Known pending items" section has a line that's now stale — migration `0004` was applied and the `APIFY_TOKEN` secret was added after that line was written; a real `workflow_dispatch` run confirmed the `deep-crawl` job live (`topicsSelected=8 postsUpserted=400 errors=0`), but this fact was never committed to any doc, only mentioned in chat — fixing that here. Replace the line:

```markdown
- Migration `0004_add_topic_social_data.sql` is **not yet applied** to production and the `APIFY_TOKEN` secret is **not yet added** to the GitHub repo — until a human does both, the `deep-crawl` job will fail every cron run (isolated failure via `if: ${{ !cancelled() }}`, but red 3x/day until fixed). See `docs/superpowers/specs/2026-08-23-deep-crawl-threads-database-schema.md` for the schema.
```

with:

```markdown
- Migration `0004_add_topic_social_data.sql` is applied to production and the `deep-crawl` job (Threads) is live-verified via a real `workflow_dispatch` run (`topicsSelected=8 postsUpserted=400 errors=0`). See `docs/superpowers/specs/2026-08-23-deep-crawl-threads-database-schema.md` for the schema.
- Migration `0005_add_facebook_page_data.sql` is **not yet applied** to production — until a human applies it, the `deep-crawl-facebook` job will fail every cron run (isolated failure via `if: ${{ !cancelled() }}`, but red until fixed). No new secret needed (reuses `APIFY_TOKEN`). See `docs/superpowers/specs/2026-08-23-deep-crawl-facebook-database-schema.md` for the schema.
- The 6 Facebook Page URLs in `src/lib/facebook-seed-pages.ts` were picked without a live browser check in this session — confirm they still resolve to real, active Pages if the `deep-crawl-facebook` job logs `no_items`/`not_available` errors for all 6 on its first live run.
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document sub-project 2c (Facebook deep-crawl) in README"
```
