# Sentiment + Engagement Metrics (sub-project 3, phần 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add sentiment classification (LLM-based) for social posts and daily engagement aggregation (pure SQL/arithmetic), both stored in the database — no dashboard UI in this plan.

**Architecture:** Two independent pipelines, each following this codebase's established pure-logic-core + real-adapter split. Sentiment: a new `sentiment` column on `topic_social_data`/`facebook_page_data`, filled by a chunked LLM classifier job (mirrors `candidate-classifier.ts`/`discovery-ingest.ts`'s existing pattern exactly). Engagement: two new `*_engagement_daily` tables, filled by a pure-JS aggregation job (group-by + sum in TypeScript, not SQL — matches how this codebase already does grouping/dedup, e.g. `selectDeepCrawlTopics`). Both run as new independent jobs in `discovery-ingestion.yml`.

**Tech Stack:** TypeScript, `tsx`, Vitest, `@supabase/supabase-js`, native `fetch` (OpenAI Chat Completions API, no SDK — matches `candidate-classifier.ts`), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-23-sentiment-engagement-metrics-design.md`

## Global Constraints

- Sentiment values: exactly `'positive' | 'negative' | 'neutral'` (spec §2.1). `NULL` = not yet classified.
- Sentiment classifier text input truncated to **500 chars** before sending to the LLM (spec §2.2).
- Sentiment classification chunk size: **20 posts/call** (spec §2.3) — smaller than the existing category classifier's 50/call because post text is much longer than a keyword.
- Sentiment job reads `process.env.OPENAI_API_KEY` directly (not `getRequiredEnv`) and **skips gracefully** (log + return, no throw) if unset (spec §2.4) — matches `run-discovery-ingest.ts`'s existing convention for this same secret.
- Engagement: **2 separate tables** (`threads_engagement_daily` keyed by `(date, keyword)`, `facebook_engagement_daily` keyed by `(date, category)`) — never merge into one shape (spec §3.1).
- Engagement aggregation is **recompute-and-overwrite** every run (upsert), not skip-if-exists — safe to run multiple times/day (spec §3.3).
- Threads engagement rows get `category` via joining `candidate_topics(keyword, date)`, taking `category_hint[0]`; `NULL` if no match found (spec §3.1) — this is what resolves the known gap documented in `docs/superpowers/specs/2026-08-23-deep-crawl-threads-database-schema.md`'s "Known gaps" section.
- No new "buzz score"/trend formula — only raw SUM/COUNT aggregation (spec §1, §3.2). Do not invent one.
- Both new GitHub Actions jobs: `needs: [deep-crawl, deep-crawl-facebook]`, `if: ${{ !cancelled() }}` (spec §4).
- **Any task that edits `.github/workflows/discovery-ingestion.yml` MUST update `tests/discovery-workflow.test.ts` in the same task and run `npm test`** — a prior sub-project (2c) shipped a broken workflow-shape test because a task added a job without updating this test, which would have broken every job's `npm test` gate in production. Do not repeat this.

---

### Task 1: Sentiment migration, types, and existing schema doc updates

**Files:**
- Create: `supabase/migrations/0006_add_sentiment_columns.sql`
- Modify: `src/types.ts`
- Modify: `docs/superpowers/specs/2026-08-23-deep-crawl-threads-database-schema.md`
- Modify: `docs/superpowers/specs/2026-08-23-deep-crawl-facebook-database-schema.md`

**Interfaces:**
- Produces: `SentimentLabel` type (`'positive' | 'negative' | 'neutral'`), `sentiment?: SentimentLabel | null` field added to `TopicSocialData` and `FacebookPageData` — used by every later task in this plan.

No automated test cycle — schema + types + docs, same as prior migration-only tasks in this project.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0006_add_sentiment_columns.sql`:

```sql
alter table topic_social_data
  add column sentiment text check (sentiment in ('positive', 'negative', 'neutral'));

alter table facebook_page_data
  add column sentiment text check (sentiment in ('positive', 'negative', 'neutral'));
```

Not applied to production by this task — a human step, same as every prior migration in this project.

- [ ] **Step 2: Add `SentimentLabel` and the `sentiment` field**

In `src/types.ts`, after the existing `TopicSocialData` interface (end of file), add:

```typescript
export type SentimentLabel = 'positive' | 'negative' | 'neutral';
```

Then modify the existing `TopicSocialData` interface — insert `sentiment?: SentimentLabel | null;` right after the `posted_at` field and before `fetched_at?`:

```typescript
export interface TopicSocialData {
  id?: string;
  keyword: string;
  source: DeepCrawlSourceName;
  date: string;
  post_url: string;
  text_content: string;
  like_count: number | null;
  reply_count: number | null;
  repost_count: number | null;
  quote_count: number | null;
  share_count: number | null;
  view_count: number | null;
  posted_at: string | null;
  sentiment?: SentimentLabel | null;
  fetched_at?: string;
}
```

And the existing `FacebookPageData` interface, same insertion point:

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
  sentiment?: SentimentLabel | null;
  fetched_at?: string;
}
```

(The `SentimentLabel` type declaration itself can go anywhere convenient after `Category` is defined — e.g. right before `TopicSocialData`, or at the end of the file. Exact position doesn't matter, just keep it above both interfaces that use it.)

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: exits 0, no errors (adding an optional field to an existing interface doesn't break any existing construction of it).

- [ ] **Step 4: Update the Threads schema doc**

In `docs/superpowers/specs/2026-08-23-deep-crawl-threads-database-schema.md`, in the `erDiagram` block, add a line for `sentiment` right after `posted_at`:

```
        timestamptz posted_at
        text sentiment
        timestamptz fetched_at
```

In the "Chi tiết cột" table, add a new row right after the `posted_at` row and before the `fetched_at` row:

```
| `sentiment` | `text` | nullable, `check (sentiment in ('positive','negative','neutral'))` | phân loại bởi `classify-sentiment.ts` (sub-project 3), thêm ở migration `0006`. `NULL` = chưa phân loại. Xem [schema doc sub-project 3](./2026-08-23-sentiment-engagement-metrics-database-schema.md) |
```

- [ ] **Step 5: Update the Facebook schema doc**

Same two edits in `docs/superpowers/specs/2026-08-23-deep-crawl-facebook-database-schema.md` — add `text sentiment` to its `erDiagram` block right after `posted_at`, and the same table row (adjust wording if needed to match that doc's exact column-table phrasing style) right after its `posted_at` row and before `fetched_at`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0006_add_sentiment_columns.sql src/types.ts docs/superpowers/specs/2026-08-23-deep-crawl-threads-database-schema.md docs/superpowers/specs/2026-08-23-deep-crawl-facebook-database-schema.md
git commit -m "feat: add sentiment column migration and type"
```

---

### Task 2: Engagement migration, types, and new schema doc

**Files:**
- Create: `supabase/migrations/0007_add_engagement_daily_tables.sql`
- Modify: `src/types.ts`
- Create: `docs/superpowers/specs/2026-08-23-sentiment-engagement-metrics-database-schema.md`

**Interfaces:**
- Consumes: `Category` type (already in `src/types.ts`).
- Produces: `ThreadsEngagementDaily` and `FacebookEngagementDaily` interfaces — used by Tasks 7 and 8.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0007_add_engagement_daily_tables.sql`:

```sql
create table if not exists threads_engagement_daily (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  keyword text not null,
  category text,
  total_like_count integer not null default 0,
  total_reply_count integer not null default 0,
  total_repost_count integer not null default 0,
  total_quote_count integer not null default 0,
  total_share_count integer not null default 0,
  total_view_count integer not null default 0,
  post_count integer not null default 0,
  computed_at timestamptz not null default now(),
  unique (date, keyword)
);

create table if not exists facebook_engagement_daily (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  category text not null check (category in ('tai_chinh', 'giai_tri', 'du_lich')),
  total_like_count integer not null default 0,
  total_comment_count integer not null default 0,
  total_share_count integer not null default 0,
  post_count integer not null default 0,
  computed_at timestamptz not null default now(),
  unique (date, category)
);

create index if not exists threads_engagement_daily_date_idx
  on threads_engagement_daily (date);

create index if not exists facebook_engagement_daily_date_idx
  on facebook_engagement_daily (date);

alter table threads_engagement_daily enable row level security;
alter table facebook_engagement_daily enable row level security;
```

- [ ] **Step 2: Add the types**

In `src/types.ts`, add (anywhere after `Category` is defined):

```typescript
export interface ThreadsEngagementDaily {
  id?: string;
  date: string;
  keyword: string;
  category: Category | null;
  total_like_count: number;
  total_reply_count: number;
  total_repost_count: number;
  total_quote_count: number;
  total_share_count: number;
  total_view_count: number;
  post_count: number;
  computed_at?: string;
}

export interface FacebookEngagementDaily {
  id?: string;
  date: string;
  category: Category;
  total_like_count: number;
  total_comment_count: number;
  total_share_count: number;
  post_count: number;
  computed_at?: string;
}
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: exits 0, no errors.

- [ ] **Step 4: Write the schema doc**

Create `docs/superpowers/specs/2026-08-23-sentiment-engagement-metrics-database-schema.md`:

```markdown
# Sentiment + Engagement Metrics — Database Schema

**Ngày:** 2026-08-23
**Trạng thái:** Chưa deploy — migration 0006 và 0007 chưa apply lên production
**Thuộc:** chi tiết hoá phần data model của [2026-08-23-sentiment-engagement-metrics-design.md](./2026-08-23-sentiment-engagement-metrics-design.md), phản ánh đúng 2 migration đã viết (`0006_add_sentiment_columns.sql`, `0007_add_engagement_daily_tables.sql`), chưa phải bản đã chạy thật trên Supabase.

## Sơ đồ

Migration 0006 thêm 1 cột (`sentiment`) vào 2 bảng đã có (`topic_social_data`, `facebook_page_data` — xem schema doc của [2b](./2026-08-23-deep-crawl-threads-database-schema.md)/[2c](./2026-08-23-deep-crawl-facebook-database-schema.md) để biết đầy đủ 2 bảng đó). Migration 0007 thêm 2 bảng mới hoàn toàn:

\`\`\`mermaid
erDiagram
    threads_engagement_daily {
        uuid id PK
        date date
        text keyword
        text category
        integer total_like_count
        integer total_reply_count
        integer total_repost_count
        integer total_quote_count
        integer total_share_count
        integer total_view_count
        integer post_count
        timestamptz computed_at
    }
    facebook_engagement_daily {
        uuid id PK
        date date
        text category
        integer total_like_count
        integer total_comment_count
        integer total_share_count
        integer post_count
        timestamptz computed_at
    }
\`\`\`

## Chi tiết cột — `threads_engagement_daily`

| Cột | Kiểu | Ràng buộc | Ghi chú |
|---|---|---|---|
| `id` | `uuid` | PK, `default gen_random_uuid()` | tự sinh |
| `date` | `date` | `not null` | ngày aggregate |
| `keyword` | `text` | `not null` | khớp `topic_social_data.keyword` |
| `category` | `text` | nullable | join ngược qua `candidate_topics(keyword, date)`, lấy `category_hint[0]`. `NULL` nếu không tìm thấy dòng `candidate_topics` khớp — xem Known gaps |
| `total_like_count` / `total_reply_count` / `total_repost_count` / `total_quote_count` / `total_share_count` / `total_view_count` | `integer` | `not null default 0` | tổng 6 cột engagement tương ứng của `topic_social_data`, `SUM` qua tất cả bài cùng `(date, keyword)` |
| `post_count` | `integer` | `not null default 0` | số bài được tính tổng |
| `computed_at` | `timestamptz` | `not null default now()` | thời điểm job `aggregate-engagement.ts` ghi/ghi đè dòng này |

Ràng buộc bổ sung: `unique (date, keyword)` — `ThreadsEngagementDailyRepository.upsertDaily()` dùng `onConflict: 'date,keyword'`. Mỗi lần job chạy, dòng cùng `(date, keyword)` bị **ghi đè hoàn toàn** (không cộng dồn) — xem thiết kế spec §3.3.

## Chi tiết cột — `facebook_engagement_daily`

| Cột | Kiểu | Ràng buộc | Ghi chú |
|---|---|---|---|
| `id` | `uuid` | PK, `default gen_random_uuid()` | tự sinh |
| `date` | `date` | `not null` | ngày aggregate |
| `category` | `text` | `not null`, `check (category in ('tai_chinh','giai_tri','du_lich'))` | Facebook đã có category natively từ seed list, không cần join |
| `total_like_count` / `total_comment_count` / `total_share_count` | `integer` | `not null default 0` | tổng 3 cột engagement tương ứng của `facebook_page_data`, `SUM` qua tất cả bài cùng `(date, category)` |
| `post_count` | `integer` | `not null default 0` | số bài được tính tổng |
| `computed_at` | `timestamptz` | `not null default now()` | thời điểm job ghi/ghi đè dòng này |

Ràng buộc bổ sung: `unique (date, category)` — `onConflict: 'date,category'`.

## Index

- `threads_engagement_daily_date_idx` / `facebook_engagement_daily_date_idx` — btree trên `date`, phục vụ query đọc theo ngày (dashboard, nếu sau này cần).

## Row Level Security

Cả 2 bảng bật RLS không policy, cùng trạng thái với mọi bảng khác trong project — an toàn vì toàn bộ ghi/đọc đều qua `service_role` key trong GitHub Actions.

## Known gaps / limitations

- **`threads_engagement_daily.category` chỉ lấy `category_hint[0]`** — nếu 1 keyword thuộc nhiều category (`category_hint` có >1 phần tử), phần tử còn lại bị bỏ qua hoàn toàn ở bảng này (không nhân bản dòng theo từng category như share-of-voice ở dashboard đã làm) — simplification chấp nhận được cho v1, xem lại nếu cần chính xác hơn.
- **`category = NULL` nếu không tìm thấy `candidate_topics` khớp `(keyword, date)`** — có thể xảy ra nếu dữ liệu `candidate_topics` bị dọn/archive khác lịch với `topic_social_data`. Không coi là lỗi, chỉ là category chưa xác định được.
- **Ghi đè hoàn toàn mỗi lần chạy, không phải cộng dồn** — nếu `aggregate-engagement.ts` chạy 2 lần/ngày và dữ liệu nguồn (`topic_social_data`/`facebook_page_data`) không đổi giữa 2 lần, kết quả giống hệt nhau (idempotent theo nghĩa "cùng input → cùng output", khác với sentiment job vốn idempotent theo nghĩa "chỉ xử lý phần chưa làm").
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0007_add_engagement_daily_tables.sql src/types.ts docs/superpowers/specs/2026-08-23-sentiment-engagement-metrics-database-schema.md
git commit -m "feat: add engagement_daily tables migration, types, and schema doc"
```

---

### Task 3: Extend `TopicSocialDataRepository` and `FacebookPageDataRepository`

**Files:**
- Modify: `src/lib/topic-social-data-repository.ts`
- Modify: `src/lib/facebook-page-data-repository.ts`
- Modify: `tests/fakes/fake-topic-social-data-repository.ts`
- Modify: `tests/fakes/fake-facebook-page-data-repository.ts`
- Modify: `tests/fake-topic-social-data-repository.test.ts`
- Create: `tests/fake-facebook-page-data-repository.test.ts`

**Interfaces:**
- Consumes: `SentimentLabel` (Task 1).
- Produces: 3 new methods on each repository interface — `getUnclassifiedPosts(): Promise<{ id: string; text_content: string }[]>`, `updateSentiment(id: string, sentiment: SentimentLabel): Promise<{ error: string | null }>`, `getPostsForDate(date: string): Promise<TopicSocialData[]>` (or `FacebookPageData[]`) — Task 5 depends on the first two, Task 8 depends on the third.

This project's convention: every Fake gets its own direct unit test (see `tests/fake-topic-social-data-repository.test.ts`, already exists for `upsertPosts`/`hasDataForDate`). No test file exists yet for `FakeFacebookPageDataRepository` — this task creates one, covering **only the 3 new methods** (not retesting `upsertPosts`/`hasDataForDate`, already covered indirectly via `tests/deep-crawl-facebook.test.ts`).

- [ ] **Step 1: Write the failing tests**

Add to the end of `tests/fake-topic-social-data-repository.test.ts` (inside the existing `describe` block, before the closing `});`):

```typescript
  it('getUnclassifiedPosts returns only posts with sentiment not yet set', async () => {
    const repo = new FakeTopicSocialDataRepository();
    await repo.upsertPosts([
      { keyword: 'bitcoin', source: 'threads', date: '2026-08-23', post_url: 'https://threads.net/p/1', text_content: 'hello' },
    ]);
    const [post] = repo.posts;

    const unclassified = await repo.getUnclassifiedPosts();
    expect(unclassified).toEqual([{ id: post.id, text_content: 'hello' }]);

    await repo.updateSentiment(post.id!, 'positive');
    expect(await repo.getUnclassifiedPosts()).toEqual([]);
  });

  it('updateSentiment sets the sentiment field on the matching post', async () => {
    const repo = new FakeTopicSocialDataRepository();
    await repo.upsertPosts([
      { keyword: 'bitcoin', source: 'threads', date: '2026-08-23', post_url: 'https://threads.net/p/1' },
    ]);
    const [post] = repo.posts;

    const { error } = await repo.updateSentiment(post.id!, 'negative');

    expect(error).toBeNull();
    expect(repo.posts[0].sentiment).toBe('negative');
  });

  it('updateSentiment returns the configured error for a specific id and leaves sentiment unset', async () => {
    const repo = new FakeTopicSocialDataRepository();
    await repo.upsertPosts([
      { keyword: 'bitcoin', source: 'threads', date: '2026-08-23', post_url: 'https://threads.net/p/1' },
    ]);
    const [post] = repo.posts;
    repo.updateSentimentErrorForId[post.id!] = 'simulated failure';

    const { error } = await repo.updateSentiment(post.id!, 'positive');

    expect(error).toBe('simulated failure');
    expect(repo.posts[0].sentiment).toBeNull();
  });

  it('getPostsForDate returns only posts matching that date', async () => {
    const repo = new FakeTopicSocialDataRepository();
    await repo.upsertPosts([
      { keyword: 'bitcoin', source: 'threads', date: '2026-08-23', post_url: 'https://threads.net/p/1' },
      { keyword: 'bitcoin', source: 'threads', date: '2026-08-22', post_url: 'https://threads.net/p/2' },
    ]);

    const posts = await repo.getPostsForDate('2026-08-23');

    expect(posts).toHaveLength(1);
    expect(posts[0].post_url).toBe('https://threads.net/p/1');
  });
```

Create `tests/fake-facebook-page-data-repository.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { FakeFacebookPageDataRepository } from './fakes/fake-facebook-page-data-repository';

describe('FakeFacebookPageDataRepository', () => {
  it('getUnclassifiedPosts returns only posts with sentiment not yet set', async () => {
    const repo = new FakeFacebookPageDataRepository();
    await repo.upsertPosts([
      { page_url: 'https://www.facebook.com/cafef.vn', category: 'tai_chinh', date: '2026-08-23', post_url: 'p1', text_content: 'hello' },
    ]);
    const [post] = repo.posts;

    const unclassified = await repo.getUnclassifiedPosts();
    expect(unclassified).toEqual([{ id: post.id, text_content: 'hello' }]);

    await repo.updateSentiment(post.id!, 'neutral');
    expect(await repo.getUnclassifiedPosts()).toEqual([]);
  });

  it('updateSentiment sets the sentiment field on the matching post', async () => {
    const repo = new FakeFacebookPageDataRepository();
    await repo.upsertPosts([
      { page_url: 'https://www.facebook.com/cafef.vn', category: 'tai_chinh', date: '2026-08-23', post_url: 'p1' },
    ]);
    const [post] = repo.posts;

    const { error } = await repo.updateSentiment(post.id!, 'positive');

    expect(error).toBeNull();
    expect(repo.posts[0].sentiment).toBe('positive');
  });

  it('updateSentiment returns the configured error for a specific id and leaves sentiment unset', async () => {
    const repo = new FakeFacebookPageDataRepository();
    await repo.upsertPosts([
      { page_url: 'https://www.facebook.com/cafef.vn', category: 'tai_chinh', date: '2026-08-23', post_url: 'p1' },
    ]);
    const [post] = repo.posts;
    repo.updateSentimentErrorForId[post.id!] = 'simulated failure';

    const { error } = await repo.updateSentiment(post.id!, 'positive');

    expect(error).toBe('simulated failure');
    expect(repo.posts[0].sentiment).toBeNull();
  });

  it('getPostsForDate returns only posts matching that date', async () => {
    const repo = new FakeFacebookPageDataRepository();
    await repo.upsertPosts([
      { page_url: 'https://www.facebook.com/cafef.vn', category: 'tai_chinh', date: '2026-08-23', post_url: 'p1' },
      { page_url: 'https://www.facebook.com/cafef.vn', category: 'tai_chinh', date: '2026-08-22', post_url: 'p2' },
    ]);

    const posts = await repo.getPostsForDate('2026-08-23');

    expect(posts).toHaveLength(1);
    expect(posts[0].post_url).toBe('p1');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/fake-topic-social-data-repository.test.ts tests/fake-facebook-page-data-repository.test.ts`
Expected: FAIL — `getUnclassifiedPosts`/`updateSentiment`/`getPostsForDate` are not functions yet.

- [ ] **Step 3: Extend `TopicSocialDataRepository`**

In `src/lib/topic-social-data-repository.ts`, modify the interface and the Supabase class:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { TopicSocialData, SentimentLabel } from '../types';

export interface TopicSocialDataRepository {
  hasDataForDate(date: string): Promise<boolean>;
  upsertPosts(rows: Partial<TopicSocialData>[]): Promise<{ error: string | null; count: number }>;
  getUnclassifiedPosts(): Promise<{ id: string; text_content: string }[]>;
  updateSentiment(id: string, sentiment: SentimentLabel): Promise<{ error: string | null }>;
  getPostsForDate(date: string): Promise<TopicSocialData[]>;
}

export class SupabaseTopicSocialDataRepository implements TopicSocialDataRepository {
  constructor(private client: SupabaseClient) {}

  async hasDataForDate(date: string): Promise<boolean> {
    const { count, error } = await this.client
      .from('topic_social_data')
      .select('id', { count: 'exact', head: true })
      .eq('date', date);
    if (error) throw new Error(error.message);
    return (count ?? 0) > 0;
  }

  async upsertPosts(rows: Partial<TopicSocialData>[]) {
    if (rows.length === 0) return { error: null, count: 0 };
    const { error } = await this.client
      .from('topic_social_data')
      .upsert(rows, { onConflict: 'source,keyword,post_url' });
    return { error: error?.message ?? null, count: error ? 0 : rows.length };
  }

  async getUnclassifiedPosts() {
    const { data, error } = await this.client
      .from('topic_social_data')
      .select('id, text_content')
      .is('sentiment', null)
      .limit(5000);
    if (error) throw new Error(error.message);
    return (data ?? []) as { id: string; text_content: string }[];
  }

  async updateSentiment(id: string, sentiment: SentimentLabel) {
    const { error } = await this.client
      .from('topic_social_data')
      .update({ sentiment })
      .eq('id', id);
    return { error: error?.message ?? null };
  }

  async getPostsForDate(date: string) {
    const { data, error } = await this.client
      .from('topic_social_data')
      .select('*')
      .eq('date', date)
      .limit(5000);
    if (error) throw new Error(error.message);
    return (data ?? []) as TopicSocialData[];
  }
}
```

- [ ] **Step 4: Extend `FacebookPageDataRepository`**

In `src/lib/facebook-page-data-repository.ts`, the same 3 additions (table name `facebook_page_data`):

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FacebookPageData, SentimentLabel } from '../types';

export interface FacebookPageDataRepository {
  hasDataForDate(date: string): Promise<boolean>;
  upsertPosts(rows: Partial<FacebookPageData>[]): Promise<{ error: string | null; count: number }>;
  getUnclassifiedPosts(): Promise<{ id: string; text_content: string }[]>;
  updateSentiment(id: string, sentiment: SentimentLabel): Promise<{ error: string | null }>;
  getPostsForDate(date: string): Promise<FacebookPageData[]>;
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

  async getUnclassifiedPosts() {
    const { data, error } = await this.client
      .from('facebook_page_data')
      .select('id, text_content')
      .is('sentiment', null)
      .limit(5000);
    if (error) throw new Error(error.message);
    return (data ?? []) as { id: string; text_content: string }[];
  }

  async updateSentiment(id: string, sentiment: SentimentLabel) {
    const { error } = await this.client
      .from('facebook_page_data')
      .update({ sentiment })
      .eq('id', id);
    return { error: error?.message ?? null };
  }

  async getPostsForDate(date: string) {
    const { data, error } = await this.client
      .from('facebook_page_data')
      .select('*')
      .eq('date', date)
      .limit(5000);
    if (error) throw new Error(error.message);
    return (data ?? []) as FacebookPageData[];
  }
}
```

- [ ] **Step 5: Extend `FakeTopicSocialDataRepository`**

In `tests/fakes/fake-topic-social-data-repository.ts`:

```typescript
import type { TopicSocialDataRepository } from '../../src/lib/topic-social-data-repository';
import type { TopicSocialData, SentimentLabel } from '../../src/types';

export class FakeTopicSocialDataRepository implements TopicSocialDataRepository {
  public posts: TopicSocialData[] = [];
  // Set to simulate upsertPosts failing, e.g. to test deep-crawl's batch
  // error handling without a real database.
  public upsertError: string | null = null;
  // Set to simulate updateSentiment failing for a specific post id, e.g. to
  // test classify-sentiment's per-post error isolation without a real DB.
  public updateSentimentErrorForId: Record<string, string> = {};

  async hasDataForDate(date: string): Promise<boolean> {
    return this.posts.some((p) => p.date === date);
  }

  async upsertPosts(rows: Partial<TopicSocialData>[]) {
    if (this.upsertError) return { error: this.upsertError, count: 0 };
    for (const row of rows) {
      this.posts.push({
        id: row.id ?? crypto.randomUUID(),
        keyword: row.keyword!,
        source: row.source ?? 'threads',
        date: row.date!,
        post_url: row.post_url!,
        text_content: row.text_content ?? '',
        like_count: row.like_count ?? null,
        reply_count: row.reply_count ?? null,
        repost_count: row.repost_count ?? null,
        quote_count: row.quote_count ?? null,
        share_count: row.share_count ?? null,
        view_count: row.view_count ?? null,
        posted_at: row.posted_at ?? null,
        sentiment: row.sentiment ?? null,
      });
    }
    return { error: null, count: rows.length };
  }

  async getUnclassifiedPosts() {
    return this.posts
      .filter((p) => p.sentiment == null)
      .map((p) => ({ id: p.id!, text_content: p.text_content }));
  }

  async updateSentiment(id: string, sentiment: SentimentLabel) {
    if (this.updateSentimentErrorForId[id]) {
      return { error: this.updateSentimentErrorForId[id] };
    }
    const post = this.posts.find((p) => p.id === id);
    if (post) post.sentiment = sentiment;
    return { error: null };
  }

  async getPostsForDate(date: string) {
    return this.posts.filter((p) => p.date === date);
  }
}
```

- [ ] **Step 6: Extend `FakeFacebookPageDataRepository`**

In `tests/fakes/fake-facebook-page-data-repository.ts`, the same 3 additions:

```typescript
import type { FacebookPageDataRepository } from '../../src/lib/facebook-page-data-repository';
import type { FacebookPageData, SentimentLabel } from '../../src/types';

export class FakeFacebookPageDataRepository implements FacebookPageDataRepository {
  public posts: FacebookPageData[] = [];
  // Set to simulate upsertPosts failing, e.g. to test deep-crawl-facebook's
  // batch error handling without a real database.
  public upsertError: string | null = null;
  // Set to simulate updateSentiment failing for a specific post id, e.g. to
  // test classify-sentiment's per-post error isolation without a real DB.
  public updateSentimentErrorForId: Record<string, string> = {};

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
        sentiment: row.sentiment ?? null,
      });
    }
    return { error: null, count: rows.length };
  }

  async getUnclassifiedPosts() {
    return this.posts
      .filter((p) => p.sentiment == null)
      .map((p) => ({ id: p.id!, text_content: p.text_content }));
  }

  async updateSentiment(id: string, sentiment: SentimentLabel) {
    if (this.updateSentimentErrorForId[id]) {
      return { error: this.updateSentimentErrorForId[id] };
    }
    const post = this.posts.find((p) => p.id === id);
    if (post) post.sentiment = sentiment;
    return { error: null };
  }

  async getPostsForDate(date: string) {
    return this.posts.filter((p) => p.date === date);
  }
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run tests/fake-topic-social-data-repository.test.ts tests/fake-facebook-page-data-repository.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 8: Run the full test suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: all pass, no regressions (this changes 2 interfaces that other code implements/consumes — confirm nothing else broke).

- [ ] **Step 9: Commit**

```bash
git add src/lib/topic-social-data-repository.ts src/lib/facebook-page-data-repository.ts tests/fakes/fake-topic-social-data-repository.ts tests/fakes/fake-facebook-page-data-repository.ts tests/fake-topic-social-data-repository.test.ts tests/fake-facebook-page-data-repository.test.ts
git commit -m "feat: add sentiment and date-query methods to social data repositories"
```

---

### Task 4: OpenAI sentiment classifier client

**Files:**
- Create: `src/lib/openai-sentiment-classifier.ts`

**Interfaces:**
- Consumes: `SentimentLabel` (Task 1).
- Produces: `SentimentClassifier` interface (`classify(posts: {id: string; text: string}[]): Promise<Record<string, SentimentLabel>>`), `OpenAiSentimentClassifier` class — Task 5 depends on this interface, Task 6 on the real class.

No test file — pure I/O adapter, matches the existing `candidate-classifier.ts` precedent (no test file exists for it either).

- [ ] **Step 1: Write the client**

Create `src/lib/openai-sentiment-classifier.ts`:

```typescript
import type { SentimentLabel } from '../types';

export interface SentimentClassifier {
  classify(posts: { id: string; text: string }[]): Promise<Record<string, SentimentLabel>>;
}

// 60s timeout matches candidate-classifier.ts's FETCH_TIMEOUT_MS — this runs
// unattended in CI, not user-facing, so a generous ceiling is cheap and a
// spurious timeout isn't (same reasoning documented there).
const FETCH_TIMEOUT_MS = 60000;
const MODEL = 'gpt-5-nano';
// Sentiment doesn't need the full post — truncating keeps prompt size (and
// therefore cost/latency) predictable across chunks regardless of how long
// an individual caption/post is.
const MAX_TEXT_CHARS = 500;

// Real adapter over the OpenAI Chat Completions REST API, called via native
// fetch (no `openai` npm dependency) — same style as candidate-classifier.ts.
// Verified manually against the live API once a key exists, not by an
// automated unit test — same convention as every other real-network adapter
// in this codebase. classify-sentiment.ts's chunking/isolation logic is what's
// unit-tested, via this interface's fake.
export class OpenAiSentimentClassifier implements SentimentClassifier {
  constructor(private apiKey: string) {}

  async classify(posts: { id: string; text: string }[]): Promise<Record<string, SentimentLabel>> {
    if (posts.length === 0) return {};

    const truncated = posts.map((p) => ({ id: p.id, text: p.text.slice(0, MAX_TEXT_CHARS) }));

    const prompt =
      'Phân loại cảm xúc (sentiment) của mỗi bài đăng mạng xã hội tiếng Việt sau vào đúng 1 trong 3 nhãn: ' +
      '"positive" (tích cực), "negative" (tiêu cực), hoặc "neutral" (trung lập/không rõ). ' +
      'Trả lời bằng đúng 1 JSON object, key là id bài đăng (giữ nguyên), value là nhãn. ' +
      'Không thêm giải thích. ' +
      `Bài đăng: ${JSON.stringify(truncated)}`;

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
      return JSON.parse(content) as Record<string, SentimentLabel>;
    } finally {
      clearTimeout(timeout);
    }
  }
}
```

Note: this `as Record<string, SentimentLabel>` is a type assertion on untrusted LLM output, not a runtime guarantee — exactly like `candidate-classifier.ts`'s equivalent line. Task 5's caller validates the label is actually a known `SentimentLabel` before applying it, mirroring how `discovery-ingest.ts` validates `ClassificationLabel`.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: exits 0, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/openai-sentiment-classifier.ts
git commit -m "feat: add OpenAI sentiment classifier client"
```

---

### Task 5: Core logic (`classify-sentiment.ts`)

**Files:**
- Create: `src/classify-sentiment.ts`
- Create: `tests/fakes/fake-sentiment-classifier.ts`
- Create: `tests/classify-sentiment.test.ts`

**Interfaces:**
- Consumes: `TopicSocialDataRepository`/`FacebookPageDataRepository`'s `getUnclassifiedPosts`/`updateSentiment` (Task 3), `SentimentClassifier` (Task 4), `SentimentLabel` (Task 1).
- Produces: `ClassifySentimentDeps` interface, `ClassifySentimentResult` interface (`classified: number`, `errors: string[]`), `runClassifySentiment(deps): Promise<ClassifySentimentResult>` — Task 6's entrypoint depends on this exact function name and `ClassifySentimentDeps` shape.

- [ ] **Step 1: Write the fake classifier**

Create `tests/fakes/fake-sentiment-classifier.ts`:

```typescript
import type { SentimentClassifier } from '../../src/lib/openai-sentiment-classifier';
import type { SentimentLabel } from '../../src/types';

export class FakeSentimentClassifier implements SentimentClassifier {
  public calls: { id: string; text: string }[][] = [];
  // Typed as string, not SentimentLabel — this fake can simulate an LLM
  // returning an out-of-set label, the same way the real client's return
  // type is just an unverified assertion on untrusted JSON.
  public labels: Record<string, string> = {};
  // 0-indexed call number to throw on, for testing per-chunk error isolation.
  public errorOnCall: number | null = null;

  async classify(posts: { id: string; text: string }[]): Promise<Record<string, SentimentLabel>> {
    const callIndex = this.calls.length;
    this.calls.push(posts);
    if (this.errorOnCall === callIndex) {
      throw new Error('simulated classifier failure');
    }
    const result: Record<string, SentimentLabel> = {};
    for (const post of posts) {
      if (this.labels[post.id] !== undefined) {
        result[post.id] = this.labels[post.id] as SentimentLabel;
      }
    }
    return result;
  }
}
```

- [ ] **Step 2: Write the failing tests**

Create `tests/classify-sentiment.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { runClassifySentiment } from '../src/classify-sentiment';
import { FakeTopicSocialDataRepository } from './fakes/fake-topic-social-data-repository';
import { FakeFacebookPageDataRepository } from './fakes/fake-facebook-page-data-repository';
import { FakeSentimentClassifier } from './fakes/fake-sentiment-classifier';

describe('runClassifySentiment', () => {
  it('classifies unclassified posts from both Threads and Facebook, tagging the right repo', async () => {
    const threadsRepo = new FakeTopicSocialDataRepository();
    await threadsRepo.upsertPosts([
      { keyword: 'bitcoin', source: 'threads', date: '2026-08-23', post_url: 'https://threads.net/p/1', text_content: 'great news' },
    ]);
    const facebookRepo = new FakeFacebookPageDataRepository();
    await facebookRepo.upsertPosts([
      { page_url: 'https://www.facebook.com/cafef.vn', category: 'tai_chinh', date: '2026-08-23', post_url: 'p1', text_content: 'bad news' },
    ]);
    const classifier = new FakeSentimentClassifier();
    const threadsId = threadsRepo.posts[0].id!;
    const facebookId = facebookRepo.posts[0].id!;
    classifier.labels[threadsId] = 'positive';
    classifier.labels[facebookId] = 'negative';

    const result = await runClassifySentiment({ threadsRepo, facebookRepo, classifier });

    expect(result.classified).toBe(2);
    expect(result.errors).toEqual([]);
    expect(threadsRepo.posts[0].sentiment).toBe('positive');
    expect(facebookRepo.posts[0].sentiment).toBe('negative');
  });

  it('does nothing and makes no classifier calls when there are no unclassified posts', async () => {
    const threadsRepo = new FakeTopicSocialDataRepository();
    const facebookRepo = new FakeFacebookPageDataRepository();
    const classifier = new FakeSentimentClassifier();

    const result = await runClassifySentiment({ threadsRepo, facebookRepo, classifier });

    expect(result.classified).toBe(0);
    expect(classifier.calls).toEqual([]);
  });

  it('chunks posts into groups of 20 per classifier call', async () => {
    const threadsRepo = new FakeTopicSocialDataRepository();
    const rows = [];
    for (let i = 0; i < 25; i++) {
      rows.push({ keyword: 'bitcoin', source: 'threads' as const, date: '2026-08-23', post_url: `https://threads.net/p/${i}`, text_content: `post ${i}` });
    }
    await threadsRepo.upsertPosts(rows);
    const facebookRepo = new FakeFacebookPageDataRepository();
    const classifier = new FakeSentimentClassifier();

    await runClassifySentiment({ threadsRepo, facebookRepo, classifier });

    expect(classifier.calls).toHaveLength(2);
    expect(classifier.calls[0]).toHaveLength(20);
    expect(classifier.calls[1]).toHaveLength(5);
  });

  it("isolates one chunk's classification failure from the rest", async () => {
    const threadsRepo = new FakeTopicSocialDataRepository();
    const rows = [];
    for (let i = 0; i < 25; i++) {
      rows.push({ keyword: 'bitcoin', source: 'threads' as const, date: '2026-08-23', post_url: `https://threads.net/p/${i}`, text_content: `post ${i}` });
    }
    await threadsRepo.upsertPosts(rows);
    const facebookRepo = new FakeFacebookPageDataRepository();
    const classifier = new FakeSentimentClassifier();
    classifier.errorOnCall = 0;
    for (const post of threadsRepo.posts.slice(20)) {
      classifier.labels[post.id!] = 'neutral';
    }

    const result = await runClassifySentiment({ threadsRepo, facebookRepo, classifier });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('classification failed');
    expect(result.classified).toBe(5);
  });

  it("isolates one post's updateSentiment failure from the rest", async () => {
    const threadsRepo = new FakeTopicSocialDataRepository();
    await threadsRepo.upsertPosts([
      { keyword: 'bitcoin', source: 'threads', date: '2026-08-23', post_url: 'https://threads.net/p/1', text_content: 'a' },
      { keyword: 'bitcoin', source: 'threads', date: '2026-08-23', post_url: 'https://threads.net/p/2', text_content: 'b' },
    ]);
    const facebookRepo = new FakeFacebookPageDataRepository();
    const classifier = new FakeSentimentClassifier();
    const [post1, post2] = threadsRepo.posts;
    classifier.labels[post1.id!] = 'positive';
    classifier.labels[post2.id!] = 'negative';
    threadsRepo.updateSentimentErrorForId[post1.id!] = 'db down';

    const result = await runClassifySentiment({ threadsRepo, facebookRepo, classifier });

    expect(result.errors).toEqual([`update failed for post "${post1.id}": db down`]);
    expect(result.classified).toBe(1);
    expect(post1.sentiment).toBeNull();
    expect(post2.sentiment).toBe('negative');
  });

  it('ignores a label outside the known sentiment set', async () => {
    const threadsRepo = new FakeTopicSocialDataRepository();
    await threadsRepo.upsertPosts([
      { keyword: 'bitcoin', source: 'threads', date: '2026-08-23', post_url: 'https://threads.net/p/1', text_content: 'a' },
    ]);
    const facebookRepo = new FakeFacebookPageDataRepository();
    const classifier = new FakeSentimentClassifier();
    const post = threadsRepo.posts[0];
    classifier.labels[post.id!] = 'happy';

    const result = await runClassifySentiment({ threadsRepo, facebookRepo, classifier });

    expect(result.classified).toBe(0);
    expect(post.sentiment).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/classify-sentiment.test.ts`
Expected: FAIL — `Cannot find module '../src/classify-sentiment'`

- [ ] **Step 4: Write the implementation**

Create `src/classify-sentiment.ts`:

```typescript
import type { TopicSocialDataRepository } from './lib/topic-social-data-repository';
import type { FacebookPageDataRepository } from './lib/facebook-page-data-repository';
import type { SentimentClassifier } from './lib/openai-sentiment-classifier';
import type { SentimentLabel } from './types';

export interface ClassifySentimentDeps {
  threadsRepo: Pick<TopicSocialDataRepository, 'getUnclassifiedPosts' | 'updateSentiment'>;
  facebookRepo: Pick<FacebookPageDataRepository, 'getUnclassifiedPosts' | 'updateSentiment'>;
  classifier: SentimentClassifier;
}

export interface ClassifySentimentResult {
  classified: number;
  errors: string[];
}

// Smaller than discovery-ingest.ts's CLASSIFY_CHUNK_SIZE=50 for category
// classification — post text is much longer than a bare keyword, so a
// smaller chunk keeps each call's prompt size (and expected latency)
// bounded, avoiding the same "This operation was aborted" timeout observed
// in production 2026-08-22 for over-large category-classification batches.
const CHUNK_SIZE = 20;

const KNOWN_LABELS = new Set<SentimentLabel>(['positive', 'negative', 'neutral']);

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

interface TaggedPost {
  id: string;
  text_content: string;
  source: 'threads' | 'facebook';
}

export async function runClassifySentiment(deps: ClassifySentimentDeps): Promise<ClassifySentimentResult> {
  const result: ClassifySentimentResult = { classified: 0, errors: [] };

  const threadsPosts = await deps.threadsRepo.getUnclassifiedPosts();
  const facebookPosts = await deps.facebookRepo.getUnclassifiedPosts();

  const tagged: TaggedPost[] = [
    ...threadsPosts.map((p) => ({ ...p, source: 'threads' as const })),
    ...facebookPosts.map((p) => ({ ...p, source: 'facebook' as const })),
  ];

  for (const postChunk of chunk(tagged, CHUNK_SIZE)) {
    try {
      const classified = await deps.classifier.classify(
        postChunk.map((p) => ({ id: p.id, text: p.text_content }))
      );
      const byId = new Map(postChunk.map((p) => [p.id, p]));
      for (const [id, label] of Object.entries(classified)) {
        // Only ever apply a label for a post that was actually sent in
        // *this* chunk, and only a label within the known set — the real
        // adapter parses raw LLM JSON output, so an out-of-set string or an
        // id belonging to a different chunk must never be applied. Same
        // defensive pattern as discovery-ingest.ts's classification loop.
        const post = byId.get(id);
        if (!post || !KNOWN_LABELS.has(label as SentimentLabel)) continue;
        try {
          const repo = post.source === 'threads' ? deps.threadsRepo : deps.facebookRepo;
          const { error } = await repo.updateSentiment(id, label as SentimentLabel);
          if (error) {
            result.errors.push(`update failed for post "${id}": ${error}`);
          } else {
            result.classified += 1;
          }
        } catch (err) {
          // One post's update failure must not abort the rest of the chunk.
          result.errors.push(`update threw for post "${id}": ${(err as Error).message}`);
        }
      }
    } catch (err) {
      // One chunk's classification failure must not block any other chunk —
      // same isolation principle used throughout this project.
      result.errors.push(`classification failed for a chunk of ${postChunk.length}: ${(err as Error).message}`);
    }
  }

  return result;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/classify-sentiment.test.ts`
Expected: PASS, 6/6 tests.

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: all pass, no regressions.

- [ ] **Step 7: Commit**

```bash
git add src/classify-sentiment.ts tests/fakes/fake-sentiment-classifier.ts tests/classify-sentiment.test.ts
git commit -m "feat: add runClassifySentiment core logic"
```

---

### Task 6: Sentiment entrypoint + npm script

**Files:**
- Create: `src/run-classify-sentiment.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `runClassifySentiment`/`ClassifySentimentDeps` (Task 5), `SupabaseTopicSocialDataRepository` (Task 3), `SupabaseFacebookPageDataRepository` (Task 3), `OpenAiSentimentClassifier` (Task 4).
- Produces: `npm run classify-sentiment` script — Task 10's workflow job depends on this exact script name.

No test — matches the existing convention (`run-deep-crawl.ts`/`run-deep-crawl-facebook.ts` have no direct test either).

- [ ] **Step 1: Write the entrypoint**

Create `src/run-classify-sentiment.ts`:

```typescript
import { createClient } from '@supabase/supabase-js';
import { getRequiredEnv } from './lib/env';
import { SupabaseTopicSocialDataRepository } from './lib/topic-social-data-repository';
import { SupabaseFacebookPageDataRepository } from './lib/facebook-page-data-repository';
import { OpenAiSentimentClassifier } from './lib/openai-sentiment-classifier';
import { runClassifySentiment } from './classify-sentiment';

async function main() {
  // Optional secret, matching run-discovery-ingest.ts's existing convention
  // for OPENAI_API_KEY: skip gracefully rather than fail the whole job if
  // it's not set, since it's not required for the other jobs in this workflow.
  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    console.log('OPENAI_API_KEY not set — skipping sentiment classification');
    return;
  }

  const client = createClient(getRequiredEnv('SUPABASE_URL'), getRequiredEnv('SUPABASE_SERVICE_KEY'));
  const threadsRepo = new SupabaseTopicSocialDataRepository(client);
  const facebookRepo = new SupabaseFacebookPageDataRepository(client);
  const classifier = new OpenAiSentimentClassifier(openaiApiKey);

  const result = await runClassifySentiment({ threadsRepo, facebookRepo, classifier });

  console.log(`classified=${result.classified} errors=${result.errors.length}`);
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

In `package.json`, in the `"scripts"` block, add a line after `"deep-crawl-facebook": "tsx src/run-deep-crawl-facebook.ts"`:

```json
    "classify-sentiment": "tsx src/run-classify-sentiment.ts"
```

- [ ] **Step 3: Run typecheck and full test suite**

Run: `npm run typecheck && npm test`
Expected: both exit 0, no errors, no regressions.

- [ ] **Step 4: Commit**

```bash
git add src/run-classify-sentiment.ts package.json
git commit -m "feat: add run-classify-sentiment entrypoint and npm script"
```

---

### Task 7: Engagement repositories

**Files:**
- Create: `src/lib/threads-engagement-repository.ts`
- Create: `src/lib/facebook-engagement-repository.ts`
- Create: `tests/fakes/fake-threads-engagement-repository.ts`
- Create: `tests/fakes/fake-facebook-engagement-repository.ts`
- Create: `tests/fake-threads-engagement-repository.test.ts`
- Create: `tests/fake-facebook-engagement-repository.test.ts`

**Interfaces:**
- Consumes: `ThreadsEngagementDaily`, `FacebookEngagementDaily` (Task 2).
- Produces: `ThreadsEngagementDailyRepository`/`SupabaseThreadsEngagementDailyRepository`/`FakeThreadsEngagementDailyRepository`, `FacebookEngagementDailyRepository`/`SupabaseFacebookEngagementDailyRepository`/`FakeFacebookEngagementDailyRepository` — Task 8's tests depend on the fakes, Task 9's entrypoint depends on the real classes.

- [ ] **Step 1: Write the failing tests**

Create `tests/fake-threads-engagement-repository.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { FakeThreadsEngagementDailyRepository } from './fakes/fake-threads-engagement-repository';

describe('FakeThreadsEngagementDailyRepository', () => {
  it('upsertDaily adds every row in the batch, defaulting category to null', async () => {
    const repo = new FakeThreadsEngagementDailyRepository();
    const { error, count } = await repo.upsertDaily([
      { date: '2026-08-23', keyword: 'bitcoin', total_like_count: 10, post_count: 2 },
    ]);
    expect(error).toBeNull();
    expect(count).toBe(1);
    expect(repo.rows).toHaveLength(1);
    expect(repo.rows[0]).toMatchObject({ date: '2026-08-23', keyword: 'bitcoin', category: null, total_like_count: 10, post_count: 2 });
  });

  it('upsertDaily returns the configured error and adds nothing when upsertError is set', async () => {
    const repo = new FakeThreadsEngagementDailyRepository();
    repo.upsertError = 'simulated failure';
    const { error, count } = await repo.upsertDaily([{ date: '2026-08-23', keyword: 'bitcoin' }]);
    expect(error).toBe('simulated failure');
    expect(count).toBe(0);
    expect(repo.rows).toHaveLength(0);
  });
});
```

Create `tests/fake-facebook-engagement-repository.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { FakeFacebookEngagementDailyRepository } from './fakes/fake-facebook-engagement-repository';

describe('FakeFacebookEngagementDailyRepository', () => {
  it('upsertDaily adds every row in the batch', async () => {
    const repo = new FakeFacebookEngagementDailyRepository();
    const { error, count } = await repo.upsertDaily([
      { date: '2026-08-23', category: 'tai_chinh', total_like_count: 10, post_count: 2 },
    ]);
    expect(error).toBeNull();
    expect(count).toBe(1);
    expect(repo.rows).toHaveLength(1);
    expect(repo.rows[0]).toMatchObject({ date: '2026-08-23', category: 'tai_chinh', total_like_count: 10, post_count: 2 });
  });

  it('upsertDaily returns the configured error and adds nothing when upsertError is set', async () => {
    const repo = new FakeFacebookEngagementDailyRepository();
    repo.upsertError = 'simulated failure';
    const { error, count } = await repo.upsertDaily([{ date: '2026-08-23', category: 'tai_chinh' }]);
    expect(error).toBe('simulated failure');
    expect(count).toBe(0);
    expect(repo.rows).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/fake-threads-engagement-repository.test.ts tests/fake-facebook-engagement-repository.test.ts`
Expected: FAIL — modules don't exist yet.

- [ ] **Step 3: Write `threads-engagement-repository.ts`**

Create `src/lib/threads-engagement-repository.ts`:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ThreadsEngagementDaily } from '../types';

export interface ThreadsEngagementDailyRepository {
  upsertDaily(rows: Partial<ThreadsEngagementDaily>[]): Promise<{ error: string | null; count: number }>;
}

export class SupabaseThreadsEngagementDailyRepository implements ThreadsEngagementDailyRepository {
  constructor(private client: SupabaseClient) {}

  async upsertDaily(rows: Partial<ThreadsEngagementDaily>[]) {
    if (rows.length === 0) return { error: null, count: 0 };
    const { error } = await this.client
      .from('threads_engagement_daily')
      .upsert(rows, { onConflict: 'date,keyword' });
    return { error: error?.message ?? null, count: error ? 0 : rows.length };
  }
}
```

- [ ] **Step 4: Write `facebook-engagement-repository.ts`**

Create `src/lib/facebook-engagement-repository.ts`:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FacebookEngagementDaily } from '../types';

export interface FacebookEngagementDailyRepository {
  upsertDaily(rows: Partial<FacebookEngagementDaily>[]): Promise<{ error: string | null; count: number }>;
}

export class SupabaseFacebookEngagementDailyRepository implements FacebookEngagementDailyRepository {
  constructor(private client: SupabaseClient) {}

  async upsertDaily(rows: Partial<FacebookEngagementDaily>[]) {
    if (rows.length === 0) return { error: null, count: 0 };
    const { error } = await this.client
      .from('facebook_engagement_daily')
      .upsert(rows, { onConflict: 'date,category' });
    return { error: error?.message ?? null, count: error ? 0 : rows.length };
  }
}
```

- [ ] **Step 5: Write `FakeThreadsEngagementDailyRepository`**

Create `tests/fakes/fake-threads-engagement-repository.ts`:

```typescript
import type { ThreadsEngagementDailyRepository } from '../../src/lib/threads-engagement-repository';
import type { ThreadsEngagementDaily } from '../../src/types';

export class FakeThreadsEngagementDailyRepository implements ThreadsEngagementDailyRepository {
  public rows: ThreadsEngagementDaily[] = [];
  public upsertError: string | null = null;

  async upsertDaily(rows: Partial<ThreadsEngagementDaily>[]) {
    if (this.upsertError) return { error: this.upsertError, count: 0 };
    for (const row of rows) {
      this.rows.push({
        id: row.id ?? crypto.randomUUID(),
        date: row.date!,
        keyword: row.keyword!,
        category: row.category ?? null,
        total_like_count: row.total_like_count ?? 0,
        total_reply_count: row.total_reply_count ?? 0,
        total_repost_count: row.total_repost_count ?? 0,
        total_quote_count: row.total_quote_count ?? 0,
        total_share_count: row.total_share_count ?? 0,
        total_view_count: row.total_view_count ?? 0,
        post_count: row.post_count ?? 0,
      });
    }
    return { error: null, count: rows.length };
  }
}
```

- [ ] **Step 6: Write `FakeFacebookEngagementDailyRepository`**

Create `tests/fakes/fake-facebook-engagement-repository.ts`:

```typescript
import type { FacebookEngagementDailyRepository } from '../../src/lib/facebook-engagement-repository';
import type { FacebookEngagementDaily } from '../../src/types';

export class FakeFacebookEngagementDailyRepository implements FacebookEngagementDailyRepository {
  public rows: FacebookEngagementDaily[] = [];
  public upsertError: string | null = null;

  async upsertDaily(rows: Partial<FacebookEngagementDaily>[]) {
    if (this.upsertError) return { error: this.upsertError, count: 0 };
    for (const row of rows) {
      this.rows.push({
        id: row.id ?? crypto.randomUUID(),
        date: row.date!,
        category: row.category!,
        total_like_count: row.total_like_count ?? 0,
        total_comment_count: row.total_comment_count ?? 0,
        total_share_count: row.total_share_count ?? 0,
        post_count: row.post_count ?? 0,
      });
    }
    return { error: null, count: rows.length };
  }
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run tests/fake-threads-engagement-repository.test.ts tests/fake-facebook-engagement-repository.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 8: Run typecheck**

Run: `npm run typecheck`
Expected: exits 0, no errors.

- [ ] **Step 9: Commit**

```bash
git add src/lib/threads-engagement-repository.ts src/lib/facebook-engagement-repository.ts tests/fakes/fake-threads-engagement-repository.ts tests/fakes/fake-facebook-engagement-repository.ts tests/fake-threads-engagement-repository.test.ts tests/fake-facebook-engagement-repository.test.ts
git commit -m "feat: add engagement daily repositories and their fakes"
```

---

### Task 8: Core logic (`aggregate-engagement.ts`)

**Files:**
- Create: `src/aggregate-engagement.ts`
- Create: `tests/aggregate-engagement.test.ts`

**Interfaces:**
- Consumes: `TopicSocialDataRepository.getPostsForDate` (Task 3), `FacebookPageDataRepository.getPostsForDate` (Task 3), `CandidateTopicRepository.getTodayCandidates` (existing, unmodified), `ThreadsEngagementDailyRepository`/`FacebookEngagementDailyRepository` (Task 7).
- Produces: `AggregateEngagementDeps` interface, `AggregateEngagementResult` interface (`threadsRowsUpserted: number`, `facebookRowsUpserted: number`, `errors: string[]`), `runAggregateEngagement(deps): Promise<AggregateEngagementResult>` — Task 9's entrypoint depends on this exact function name and shape.

- [ ] **Step 1: Write the failing tests**

Create `tests/aggregate-engagement.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { runAggregateEngagement } from '../src/aggregate-engagement';
import { FakeTopicSocialDataRepository } from './fakes/fake-topic-social-data-repository';
import { FakeFacebookPageDataRepository } from './fakes/fake-facebook-page-data-repository';
import { FakeCandidateTopicRepository } from './fakes/fake-candidate-topic-repository';
import { FakeThreadsEngagementDailyRepository } from './fakes/fake-threads-engagement-repository';
import { FakeFacebookEngagementDailyRepository } from './fakes/fake-facebook-engagement-repository';
import type { CandidateTopic } from '../src/types';

function candidate(overrides: Partial<CandidateTopic>): CandidateTopic {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    source: 'google_trends',
    keyword: 'x',
    date: '2026-08-23',
    metric_value: 100,
    growth_rate: 1,
    category_hint: [],
    is_shortlisted: true,
    ...overrides,
  };
}

const NOW = () => new Date('2026-08-23T09:00:00Z');

describe('runAggregateEngagement', () => {
  it('sums Threads engagement per keyword and joins category from candidate_topics', async () => {
    const threadsSocialRepo = new FakeTopicSocialDataRepository();
    await threadsSocialRepo.upsertPosts([
      { keyword: 'bitcoin', source: 'threads', date: '2026-08-23', post_url: 'p1', like_count: 10, reply_count: 1, repost_count: 2, quote_count: 0, share_count: 3, view_count: 100 },
      { keyword: 'bitcoin', source: 'threads', date: '2026-08-23', post_url: 'p2', like_count: 5, reply_count: 0, repost_count: 1, quote_count: 1, share_count: 2, view_count: 50 },
    ]);
    const facebookSocialRepo = new FakeFacebookPageDataRepository();
    const candidateRepo = new FakeCandidateTopicRepository();
    candidateRepo.candidates.push(candidate({ keyword: 'bitcoin', date: '2026-08-23', category_hint: ['tai_chinh'] }));
    const threadsEngagementRepo = new FakeThreadsEngagementDailyRepository();
    const facebookEngagementRepo = new FakeFacebookEngagementDailyRepository();

    const result = await runAggregateEngagement({
      threadsSocialRepo, facebookSocialRepo, candidateRepo, threadsEngagementRepo, facebookEngagementRepo, now: NOW,
    });

    expect(result.threadsRowsUpserted).toBe(1);
    expect(threadsEngagementRepo.rows).toHaveLength(1);
    expect(threadsEngagementRepo.rows[0]).toMatchObject({
      date: '2026-08-23',
      keyword: 'bitcoin',
      category: 'tai_chinh',
      total_like_count: 15,
      total_reply_count: 1,
      total_repost_count: 3,
      total_quote_count: 1,
      total_share_count: 5,
      total_view_count: 150,
      post_count: 2,
    });
  });

  it('sets category to null when no matching candidate_topics row exists for that keyword/date', async () => {
    const threadsSocialRepo = new FakeTopicSocialDataRepository();
    await threadsSocialRepo.upsertPosts([
      { keyword: 'orphan', source: 'threads', date: '2026-08-23', post_url: 'p1' },
    ]);
    const facebookSocialRepo = new FakeFacebookPageDataRepository();
    const candidateRepo = new FakeCandidateTopicRepository();
    const threadsEngagementRepo = new FakeThreadsEngagementDailyRepository();
    const facebookEngagementRepo = new FakeFacebookEngagementDailyRepository();

    await runAggregateEngagement({
      threadsSocialRepo, facebookSocialRepo, candidateRepo, threadsEngagementRepo, facebookEngagementRepo, now: NOW,
    });

    expect(threadsEngagementRepo.rows[0].category).toBeNull();
  });

  it('sums Facebook engagement per category', async () => {
    const threadsSocialRepo = new FakeTopicSocialDataRepository();
    const facebookSocialRepo = new FakeFacebookPageDataRepository();
    await facebookSocialRepo.upsertPosts([
      { page_url: 'https://www.facebook.com/cafef.vn', category: 'tai_chinh', date: '2026-08-23', post_url: 'p1', like_count: 4, comment_count: 1, share_count: 2 },
      { page_url: 'https://www.facebook.com/vneconomy.vn', category: 'tai_chinh', date: '2026-08-23', post_url: 'p2', like_count: 6, comment_count: 2, share_count: 1 },
    ]);
    const candidateRepo = new FakeCandidateTopicRepository();
    const threadsEngagementRepo = new FakeThreadsEngagementDailyRepository();
    const facebookEngagementRepo = new FakeFacebookEngagementDailyRepository();

    const result = await runAggregateEngagement({
      threadsSocialRepo, facebookSocialRepo, candidateRepo, threadsEngagementRepo, facebookEngagementRepo, now: NOW,
    });

    expect(result.facebookRowsUpserted).toBe(1);
    expect(facebookEngagementRepo.rows[0]).toMatchObject({
      date: '2026-08-23',
      category: 'tai_chinh',
      total_like_count: 10,
      total_comment_count: 3,
      total_share_count: 3,
      post_count: 2,
    });
  });

  it("isolates Threads aggregation failure from Facebook's", async () => {
    const threadsSocialRepo = new FakeTopicSocialDataRepository();
    await threadsSocialRepo.upsertPosts([{ keyword: 'bitcoin', source: 'threads', date: '2026-08-23', post_url: 'p1' }]);
    const facebookSocialRepo = new FakeFacebookPageDataRepository();
    await facebookSocialRepo.upsertPosts([{ page_url: 'https://www.facebook.com/cafef.vn', category: 'tai_chinh', date: '2026-08-23', post_url: 'p1' }]);
    const candidateRepo = new FakeCandidateTopicRepository();
    const threadsEngagementRepo = new FakeThreadsEngagementDailyRepository();
    threadsEngagementRepo.upsertError = 'db down';
    const facebookEngagementRepo = new FakeFacebookEngagementDailyRepository();

    const result = await runAggregateEngagement({
      threadsSocialRepo, facebookSocialRepo, candidateRepo, threadsEngagementRepo, facebookEngagementRepo, now: NOW,
    });

    expect(result.errors).toEqual(['threads aggregate upsert failed: db down']);
    expect(result.facebookRowsUpserted).toBe(1);
  });

  it('returns 0 rows and no errors when there is no social data for the date', async () => {
    const threadsSocialRepo = new FakeTopicSocialDataRepository();
    const facebookSocialRepo = new FakeFacebookPageDataRepository();
    const candidateRepo = new FakeCandidateTopicRepository();
    const threadsEngagementRepo = new FakeThreadsEngagementDailyRepository();
    const facebookEngagementRepo = new FakeFacebookEngagementDailyRepository();

    const result = await runAggregateEngagement({
      threadsSocialRepo, facebookSocialRepo, candidateRepo, threadsEngagementRepo, facebookEngagementRepo, now: NOW,
    });

    expect(result.errors).toEqual([]);
    expect(result.threadsRowsUpserted).toBe(0);
    expect(result.facebookRowsUpserted).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/aggregate-engagement.test.ts`
Expected: FAIL — `Cannot find module '../src/aggregate-engagement'`

- [ ] **Step 3: Write the implementation**

Create `src/aggregate-engagement.ts`:

```typescript
import type { TopicSocialDataRepository } from './lib/topic-social-data-repository';
import type { FacebookPageDataRepository } from './lib/facebook-page-data-repository';
import type { CandidateTopicRepository } from './lib/candidate-topic-repository';
import type { ThreadsEngagementDailyRepository } from './lib/threads-engagement-repository';
import type { FacebookEngagementDailyRepository } from './lib/facebook-engagement-repository';
import type {
  TopicSocialData,
  FacebookPageData,
  ThreadsEngagementDaily,
  FacebookEngagementDaily,
  Category,
} from './types';

export interface AggregateEngagementDeps {
  threadsSocialRepo: Pick<TopicSocialDataRepository, 'getPostsForDate'>;
  facebookSocialRepo: Pick<FacebookPageDataRepository, 'getPostsForDate'>;
  candidateRepo: Pick<CandidateTopicRepository, 'getTodayCandidates'>;
  threadsEngagementRepo: ThreadsEngagementDailyRepository;
  facebookEngagementRepo: FacebookEngagementDailyRepository;
  now?: () => Date;
}

export interface AggregateEngagementResult {
  threadsRowsUpserted: number;
  facebookRowsUpserted: number;
  errors: string[];
}

function sumField<T>(items: T[], field: keyof T): number {
  return items.reduce((total, item) => total + ((item[field] as unknown as number | null) ?? 0), 0);
}

export async function runAggregateEngagement(deps: AggregateEngagementDeps): Promise<AggregateEngagementResult> {
  const now = deps.now ?? (() => new Date());
  const date = now().toISOString().slice(0, 10);
  const result: AggregateEngagementResult = { threadsRowsUpserted: 0, facebookRowsUpserted: 0, errors: [] };

  // Isolated in its own try/catch so a Threads-side failure never blocks the
  // Facebook aggregation below — same isolation principle used throughout
  // this project.
  try {
    const posts = await deps.threadsSocialRepo.getPostsForDate(date);
    const candidates = await deps.candidateRepo.getTodayCandidates(date);
    const categoryByKeyword = new Map<string, Category | null>();
    for (const c of candidates) {
      categoryByKeyword.set(c.keyword, (c.category_hint[0] as Category) ?? null);
    }

    const byKeyword = new Map<string, TopicSocialData[]>();
    for (const post of posts) {
      const existing = byKeyword.get(post.keyword) ?? [];
      existing.push(post);
      byKeyword.set(post.keyword, existing);
    }

    const rows: Partial<ThreadsEngagementDaily>[] = [];
    for (const [keyword, keywordPosts] of byKeyword) {
      rows.push({
        date,
        keyword,
        category: categoryByKeyword.get(keyword) ?? null,
        total_like_count: sumField(keywordPosts, 'like_count'),
        total_reply_count: sumField(keywordPosts, 'reply_count'),
        total_repost_count: sumField(keywordPosts, 'repost_count'),
        total_quote_count: sumField(keywordPosts, 'quote_count'),
        total_share_count: sumField(keywordPosts, 'share_count'),
        total_view_count: sumField(keywordPosts, 'view_count'),
        post_count: keywordPosts.length,
      });
    }

    const { error, count } = await deps.threadsEngagementRepo.upsertDaily(rows);
    if (error) {
      result.errors.push(`threads aggregate upsert failed: ${error}`);
    } else {
      result.threadsRowsUpserted = count;
    }
  } catch (err) {
    result.errors.push(`threads aggregate failed: ${(err as Error).message}`);
  }

  try {
    const posts = await deps.facebookSocialRepo.getPostsForDate(date);
    const byCategory = new Map<Category, FacebookPageData[]>();
    for (const post of posts) {
      const existing = byCategory.get(post.category) ?? [];
      existing.push(post);
      byCategory.set(post.category, existing);
    }

    const rows: Partial<FacebookEngagementDaily>[] = [];
    for (const [category, categoryPosts] of byCategory) {
      rows.push({
        date,
        category,
        total_like_count: sumField(categoryPosts, 'like_count'),
        total_comment_count: sumField(categoryPosts, 'comment_count'),
        total_share_count: sumField(categoryPosts, 'share_count'),
        post_count: categoryPosts.length,
      });
    }

    const { error, count } = await deps.facebookEngagementRepo.upsertDaily(rows);
    if (error) {
      result.errors.push(`facebook aggregate upsert failed: ${error}`);
    } else {
      result.facebookRowsUpserted = count;
    }
  } catch (err) {
    result.errors.push(`facebook aggregate failed: ${(err as Error).message}`);
  }

  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/aggregate-engagement.test.ts`
Expected: PASS, 5/5 tests.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: all pass, no regressions.

- [ ] **Step 6: Commit**

```bash
git add src/aggregate-engagement.ts tests/aggregate-engagement.test.ts
git commit -m "feat: add runAggregateEngagement core logic"
```

---

### Task 9: Engagement entrypoint + npm script

**Files:**
- Create: `src/run-aggregate-engagement.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `runAggregateEngagement`/`AggregateEngagementDeps` (Task 8), `SupabaseTopicSocialDataRepository`/`SupabaseFacebookPageDataRepository` (Task 3, real classes already exist), `SupabaseCandidateTopicRepository` (existing, unmodified), `SupabaseThreadsEngagementDailyRepository`/`SupabaseFacebookEngagementDailyRepository` (Task 7).
- Produces: `npm run aggregate-engagement` script — Task 10's workflow job depends on this exact script name.

No test — matches existing entrypoint convention.

- [ ] **Step 1: Write the entrypoint**

Create `src/run-aggregate-engagement.ts`:

```typescript
import { createClient } from '@supabase/supabase-js';
import { getRequiredEnv } from './lib/env';
import { SupabaseTopicSocialDataRepository } from './lib/topic-social-data-repository';
import { SupabaseFacebookPageDataRepository } from './lib/facebook-page-data-repository';
import { SupabaseCandidateTopicRepository } from './lib/candidate-topic-repository';
import { SupabaseThreadsEngagementDailyRepository } from './lib/threads-engagement-repository';
import { SupabaseFacebookEngagementDailyRepository } from './lib/facebook-engagement-repository';
import { runAggregateEngagement } from './aggregate-engagement';

async function main() {
  const client = createClient(getRequiredEnv('SUPABASE_URL'), getRequiredEnv('SUPABASE_SERVICE_KEY'));
  const threadsSocialRepo = new SupabaseTopicSocialDataRepository(client);
  const facebookSocialRepo = new SupabaseFacebookPageDataRepository(client);
  const candidateRepo = new SupabaseCandidateTopicRepository(client);
  const threadsEngagementRepo = new SupabaseThreadsEngagementDailyRepository(client);
  const facebookEngagementRepo = new SupabaseFacebookEngagementDailyRepository(client);

  const result = await runAggregateEngagement({
    threadsSocialRepo,
    facebookSocialRepo,
    candidateRepo,
    threadsEngagementRepo,
    facebookEngagementRepo,
  });

  console.log(
    `threadsRowsUpserted=${result.threadsRowsUpserted} facebookRowsUpserted=${result.facebookRowsUpserted} errors=${result.errors.length}`
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

In `package.json`, in the `"scripts"` block, add a line after `"classify-sentiment": "tsx src/run-classify-sentiment.ts"`:

```json
    "aggregate-engagement": "tsx src/run-aggregate-engagement.ts"
```

- [ ] **Step 3: Run typecheck and full test suite**

Run: `npm run typecheck && npm test`
Expected: both exit 0, no errors, no regressions.

- [ ] **Step 4: Commit**

```bash
git add src/run-aggregate-engagement.ts package.json
git commit -m "feat: add run-aggregate-engagement entrypoint and npm script"
```

---

### Task 10: Wire both jobs into `discovery-ingestion.yml`

**Files:**
- Modify: `.github/workflows/discovery-ingestion.yml`
- Modify: `tests/discovery-workflow.test.ts`

**Interfaces:**
- Consumes: `npm run classify-sentiment` (Task 6), `npm run aggregate-engagement` (Task 9).

**This task MUST update `tests/discovery-workflow.test.ts` and run `npm test` — see Global Constraints.** A prior sub-project shipped a workflow YAML change without updating this test, which would have broken every job's `npm test` gate in production had the final review not caught it.

- [ ] **Step 1: Add the 2 jobs**

In `.github/workflows/discovery-ingestion.yml`, after the existing `deep-crawl-facebook:` job, add:

```yaml
  classify-sentiment:
    needs: [deep-crawl, deep-crawl-facebook]
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
      - run: npm run classify-sentiment
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}

  aggregate-engagement:
    needs: [deep-crawl, deep-crawl-facebook]
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
      - run: npm run aggregate-engagement
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
```

Both `needs: [deep-crawl, deep-crawl-facebook]` (wait for the newest social data from both sources), no new secret for `aggregate-engagement` (Supabase only), `classify-sentiment` reuses the existing `OPENAI_API_KEY` secret (already used by the `discovery-ingest` job).

- [ ] **Step 2: Update the workflow-shape test**

In `tests/discovery-workflow.test.ts`, change the `'defines all four jobs'` test to:

```typescript
  it('defines all six jobs', () => {
    expect(Object.keys(doc.jobs)).toEqual([
      'discovery-ingest',
      'rank-and-select',
      'deep-crawl',
      'deep-crawl-facebook',
      'classify-sentiment',
      'aggregate-engagement',
    ]);
  });
```

Then add 4 new tests at the end of the file, right before the closing `});` of the `describe` block:

```typescript
  it('gates classify-sentiment and aggregate-engagement on both deep-crawl jobs via needs', () => {
    expect(doc['jobs']['classify-sentiment']['needs']).toEqual(['deep-crawl', 'deep-crawl-facebook']);
    expect(doc['jobs']['aggregate-engagement']['needs']).toEqual(['deep-crawl', 'deep-crawl-facebook']);
  });

  it('runs classify-sentiment and aggregate-engagement even if an earlier job failed, as long as it was not cancelled', () => {
    expect(doc['jobs']['classify-sentiment']['if']).toBe('${{ !cancelled() }}');
    expect(doc['jobs']['aggregate-engagement']['if']).toBe('${{ !cancelled() }}');
  });

  it('passes OPENAI_API_KEY through to the classify-sentiment job', () => {
    const step = doc['jobs']['classify-sentiment']['steps'].find((s: any) => s.run === 'npm run classify-sentiment');
    expect(step?.env?.OPENAI_API_KEY).toBe('${{ secrets.OPENAI_API_KEY }}');
  });

  it('does not require a new secret for aggregate-engagement beyond Supabase', () => {
    const step = doc['jobs']['aggregate-engagement']['steps'].find((s: any) => s.run === 'npm run aggregate-engagement');
    expect(Object.keys(step?.env ?? {})).toEqual(['SUPABASE_URL', 'SUPABASE_SERVICE_KEY']);
  });
```

- [ ] **Step 3: Validate YAML syntax**

Run: `node -e "require('js-yaml').load(require('fs').readFileSync('.github/workflows/discovery-ingestion.yml', 'utf8')); console.log('valid')"`
Expected: prints `valid`.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: all pass, including the updated/new tests in `tests/discovery-workflow.test.ts` — **this is the step that would have caught 2c's Critical regression; do not skip it.**

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/discovery-ingestion.yml tests/discovery-workflow.test.ts
git commit -m "feat: wire classify-sentiment and aggregate-engagement into discovery-ingestion workflow"
```

---

### Task 11: README update

**Files:**
- Modify: `README.md`

**Interfaces:** none — documentation only.

- [ ] **Step 1: Add a "Sentiment + Engagement Metrics" section**

In `README.md`, after the existing `## Deep-crawl Facebook (sub-project 2c)` section (ends right before `## Tests`), add:

```markdown
## Sentiment + Engagement Metrics (sub-project 3, phần 1)

```bash
export SUPABASE_URL=...
export SUPABASE_SERVICE_KEY=...
export OPENAI_API_KEY=...   # optional — job skips gracefully if unset
npm run classify-sentiment    # fills sentiment (positive/negative/neutral) on unclassified topic_social_data/facebook_page_data rows
npm run aggregate-engagement  # sums today's engagement counts into threads_engagement_daily / facebook_engagement_daily
```

Setup: apply `supabase/migrations/0006_add_sentiment_columns.sql` and `0007_add_engagement_daily_tables.sql` (after `0001`-`0005`). No new secret needed — `classify-sentiment` reuses the existing `OPENAI_API_KEY` (from sub-project 2a), `aggregate-engagement` only needs Supabase.

Data layer only — no dashboard display yet (a future round of design work, same as sub-project 2b/2c's social data). Both run as their own jobs in `discovery-ingestion.yml`, `needs: [deep-crawl, deep-crawl-facebook]`. Sentiment classification is LLM-based (`gpt-5-nano`, same model as category classification), chunked 20 posts/call; engagement aggregation is pure SQL-equivalent summing, no LLM. See `docs/superpowers/specs/2026-08-23-sentiment-engagement-metrics-design.md` for the full design.
```

- [ ] **Step 2: Add pending items**

In the "Known pending items" section, add:

```markdown
- Migration `0006_add_sentiment_columns.sql` and `0007_add_engagement_daily_tables.sql` are **not yet applied** to production — until a human applies both, the `classify-sentiment` and `aggregate-engagement` jobs will fail every cron run (isolated failure via `if: ${{ !cancelled() }}`, but red until fixed). See `docs/superpowers/specs/2026-08-23-sentiment-engagement-metrics-database-schema.md` for the schema.
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document sub-project 3 phần 1 (sentiment + engagement metrics) in README"
```
