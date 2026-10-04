# Topic Content Summary + "Bản tin hôm nay" Daily Brief — Design

## 1. Problem

The dashboard (and the one-off chat report produced earlier) only ever shows
a **keyword string** per hot topic ("ngân hàng", "chuyển khoản"). The user
wants to know **what is actually being said** about a hot topic, not just
that the string is trending. A plain keyword list reads like a tag cloud,
not a news summary.

## 2. Goals

- For every shortlisted topic sourced from **RSS or Threads** (the only two
  sources with real underlying text), generate a short Vietnamese summary
  of what the underlying articles/posts are actually about.
- Surface that summary in two places:
  1. A new dashboard page, **"Bản tin hôm nay"**, with an overall top-topics
     section plus one section per sector (Tài chính / Giải trí / Du lịch).
  2. The existing `/topic/[keyword]` detail page.
- Topics sourced from Google Trends/YouTube (no underlying text available)
  keep showing in topic lists as today, just without a summary.

## 3. Non-goals

- No summarization for Google Trends/YouTube topics (no source text exists
  to summarize — confirmed against `GoogleTrendsItem`/YouTube candidates,
  which only carry a keyword + metric, never post/article text).
- No change to ranking/shortlisting logic (`rank-and-select.ts`) — this
  feature only adds a `summary` field to rows that are already shortlisted.
- No live/on-demand summarization. All summaries are precomputed once per
  day in the ingestion pipeline; the dashboard only ever reads a stored
  value.

## 4. Data model changes

### 4.1 New table: `topic_article_data`

RSS has no existing link between an extracted keyword and the article(s)
that produced it — `rss-topic-source.ts` computes a per-article
`{topics, categories}` mapping in memory and immediately discards it after
calling `aggregateRssKeywords`. This table captures that mapping the same
way `topic_social_data` already does for Threads.

```sql
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

The unique key deliberately excludes `date` (same convention as
`topic_social_data`'s `unique (source, keyword, post_url)`): if the same
article keeps being "recent" across more than one same-day ingestion run,
re-extracting the same keyword from it just re-upserts the same row,
refreshing `date`/`fetched_at` rather than creating a duplicate.

### 4.2 New column: `candidate_topics.summary`

```sql
alter table candidate_topics add column summary text;
```

Nullable, no default. Null means "not summarized" (Google Trends/YouTube
rows, or an RSS/Threads row whose summarization call failed).

Migration file: `supabase/migrations/0009_topic_summary.sql`, applied by
the user directly in Supabase's SQL Editor (this project has no automated
migration runner — same process used for every prior migration).

### 4.3 Type changes

`src/types.ts`:

```ts
export interface CandidateTopic {
  // ...unchanged fields...
  summary?: string | null;
}

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

`dashboard/lib/types.ts`'s `CandidateTopic` gets the same
`summary?: string | null;` field added.

## 5. Capturing RSS keyword → article links

`src/lib/article-repository.ts`'s `RecentArticleTitle` gains the fields the
link table needs (additive — the existing single consumer,
`aggregate-rss-keywords.ts`, only reads `title`/`categories` and is
unaffected):

```ts
export interface RecentArticleTitle {
  title: string;
  categories: string[];
  url: string;
  snippet: string;
}
```

`getRecentTitles`'s `select(...)` call adds `url, snippet` and the mapped
return object adds `url: row.url as string, snippet: row.snippet as string`.

### New repository: `src/lib/topic-article-data-repository.ts`

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

`limit(5000)` mirrors the existing safety-net convention in
`topic-social-data-repository.ts`/`article-repository.ts` for the known
Supabase "Max Rows" cap — not a tuned value.

### `RssTopicSource` writes the link rows it already computes

`src/lib/rss-topic-source.ts` currently discards the per-article topic
mapping after calling `aggregateRssKeywords`. It is the only place that
still has `{article, topics}` paired up, so it writes `topic_article_data`
itself as a second effect of the same already-computed data — the same
"reuse a computation for a second concern instead of recomputing/duplicating
a call" precedent `deep-crawl.ts`'s `extractTopicsForPosts` already
established for Threads (one LLM call's output feeds both the per-post tag
and the category aggregation).

```ts
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

The link write is deliberately best-effort and isolated: a failure here
must never throw out of `fetchCandidates()` and block that day's RSS
candidates from being discovered at all — it only means today's RSS topics
won't have source text available for the summarization step later, which
already degrades gracefully (section 7.3).

`src/run-discovery-ingest.ts` wires the new repo in:

```ts
const articleLinkRepo = new SupabaseTopicArticleDataRepository(client);
// ...
new RssTopicSource(articleRepo, rssTopicExtractor, articleLinkRepo),
```

## 6. Reading Threads' existing text

No new table needed. `topic_social_data.keyword` already matches
`candidate_topics.keyword` exactly for Threads (deep-crawl.ts tags each
post with `keyword: topics[0]`, the first LLM-extracted topic). The
summarization step reads `TopicSocialDataRepository.getPostsForDate(date)`
(already exists) and groups rows by `keyword` in memory.

## 7. Daily summarization step

### 7.1 `TopicSummarizer` interface and parsing

`src/lib/topic-summarizer.ts` (new file), same shape and failure-handling
convention as `topic-extractor.ts`:

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

export class OpenAiTopicSummarizer implements TopicSummarizer {
  constructor(private apiKey: string) {}

  async summarizeTopics(inputs: TopicSummaryInput[]): Promise<(string | null)[]> {
    if (inputs.length === 0) return [];

    const numbered = inputs
      .map((input, i) => {
        const texts = input.texts
          .slice(0, MAX_TEXTS_PER_TOPIC)
          .map((t) => t.slice(0, MAX_CHARS_PER_TEXT));
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
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
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

`MAX_TEXTS_PER_TOPIC = 5` and `MAX_CHARS_PER_TEXT = 500` bound prompt size
per topic — same truncation convention `deep-crawl.ts`'s
`MAX_EXTRACT_CHARS` already established (full text is never needed to
describe what a topic is about; the model only needs enough to summarize).

### 7.2 Orchestration: `src/summarize-topics.ts` (new file)

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
  // data from before this feature existed) can't be summarized — skip it
  // rather than sending an empty-text prompt the model can't ground anything in.
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

### 7.3 Repository additions

`src/lib/candidate-topic-repository.ts`'s `CandidateTopicRepository`
interface gains:

```ts
getShortlistedCandidates(date: string): Promise<CandidateTopic[]>;
updateSummary(id: string, summary: string): Promise<{ error: string | null }>;
```

Implemented on `SupabaseCandidateTopicRepository`:

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

### 7.4 Entry point and wiring

`src/run-summarize-topics.ts` (new, same shape as `run-rank-and-select.ts`
/`run-deep-crawl.ts`):

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

`package.json` gains: `"summarize-topics": "tsx src/run-summarize-topics.ts"`.

### 7.5 Workflow change

`.github/workflows/discovery-ingestion.yml` gains a 5th job,
`summarize-topics`, gated on `rank-and-select` (needs the day's
`is_shortlisted` flags already recomputed) and `deep-crawl` (needs
`topic_social_data` for today already written):

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

`OPENAI_API_KEY` already exists as a repo secret (confirmed earlier this
session — reused by the category classifier and both topic extractors). No
new secret needed.

## 8. Dashboard changes

### 8.1 Readers select the new column

`dashboard/lib/candidate-topics-reader.ts`'s three `select(...)` column
lists (`getCandidatesForDate`, `getHistoryForKeyword`,
`getShortlistedForDateRange`) each add `, summary` to their explicit column
list (they don't use `select('*')`, so the new column must be named
explicitly or it silently won't come through).

### 8.2 `HotTopicRow` carries `summary`

`dashboard/lib/hot-topics.ts`:

```ts
export interface HotTopicRow {
  // ...existing fields...
  summary?: string | null;
}
```

Both `buildHotTopicsForCategory` and `buildHotTopicsOverview` add
`summary: c.summary ?? null` to the row they construct.

### 8.3 `flattenAndRankHotTopics` carries `summary` through a merge

`dashboard/lib/trending.ts`'s `mergeSameKeyword`: the merged row already
spreads `...representative` (whichever row `compareByRank` ranks best), so
`summary` passes through automatically when the representative has one.
Add one explicit fallback for the case the *representative* has no summary
but another row in the same merged group does (e.g. a keyword discovered by
both `google_trends` and `threads` — the Threads row has text, the Google
Trends row never will):

```ts
merged.push({
  ...representative,
  // ...existing explicit overrides...
  summary: representative.summary ?? group.map((r) => r.summary).find((s) => s != null) ?? null,
});
```

### 8.4 `TopicApiItem` (public API) gains `summary`

`dashboard/lib/topics-api.ts`: add `summary: string | null` to
`TopicApiItem` and thread `row.summary ?? null` through in `getTopicsForDate`.
This is a backward-compatible additive field on the public `/api/topics`
response — no breaking change for the external consumer already using it.

### 8.5 New page: "Bản tin hôm nay" (`/ban-tin`)

New route `dashboard/app/ban-tin/page.tsx`, following the same
`loadX`-helper-plus-`try/catch` pattern as `dashboard/app/[slug]/page.tsx`:

- Resolve `latestDate` via `SupabaseCandidateTopicsReader.getLatestDate()`.
- Fetch the overview hot-topics set via the existing
  `getHotTopics(reader, null, latestDate)` → `flattenAndRankHotTopics(...)`,
  same call the `/api/topics` route already makes.
- **Overall section**: top 10 ranked topics (by the existing
  `compareByRank` order), each rendered as a card: keyword as a heading,
  `summary` as body text if present, otherwise just the metric
  (`metricValue`/`trendingScore`) with no body text, and a link to
  `/topic/[keyword]`.
- **Per-sector sections** (Tài chính / Giải trí / Du lịch, in
  `CATEGORIES` order): for each category, fetch
  `getHotTopics(reader, category.value, latestDate)` →
  `flattenAndRankHotTopics(...)`, take the top 5, render the same card
  style under a heading using `category.label`/`category.color` (same
  dot-badge styling already used elsewhere, e.g. `TopicDetailPage`'s
  category badge).
- No data for the day (`latestDate === null`): render the same
  "Chưa có dữ liệu." empty state used elsewhere.

New component `dashboard/components/TopicBriefCard.tsx` (keyword, optional
summary, metricValue, trendingScore, href) factors the repeated card
markup out of the overall section and each sector section — both need
the exact same card shape.

`dashboard/components/layout/Sidebar.tsx` gains one more link in the
"Tổng quan" group, between "Overview" and "Trending Now":

```tsx
<Link href="/ban-tin" aria-current={pathname === '/ban-tin' ? 'page' : undefined} ...>
  {/* newspaper-style icon, same stroke convention as neighboring icons */}
  Bản tin hôm nay
</Link>
```

### 8.6 Topic detail page shows its summary

`dashboard/lib/topic-detail.ts`: `TopicDetailData` gains
`summary: string | null`, resolved the same way `resolveCategory` already
resolves a single value out of a multi-row history — the latest-dated row
in `candidateHistory` that has a non-null `summary`:

```ts
function resolveSummary(candidateHistory: CandidateTopic[]): string | null {
  const withSummary = candidateHistory.filter((c) => c.summary != null && c.summary !== '');
  if (withSummary.length === 0) return null;
  return [...withSummary].sort((a, b) => b.date.localeCompare(a.date))[0].summary!;
}
```

`computeTopicDetail` calls it and includes the result. `getTopicDetail`
needs no change — it already passes the full `CandidateTopic[]` history
through.

`dashboard/app/topic/[keyword]/page.tsx` renders a new section, placed
first (above the existing Trending Score chart), only when
`detail.summary` is non-null:

```tsx
{detail.summary && (
  <div className="bg-surface border border-line rounded-card shadow-card p-6">
    <h2 className="text-base font-bold text-ink mb-2">Nội dung đang nói gì</h2>
    <p className="text-sm text-ink-2">{detail.summary}</p>
  </div>
)}
```

## 9. Error handling summary

| Failure | Behavior |
|---|---|
| RSS link write fails (`upsertLinks` error/throw) | Logged, swallowed — that day's RSS candidates are still discovered; those keywords just have no source text for summarization later. |
| A summarization chunk's LLM call fails or returns unusable JSON | Logged to `result.errors`, `process.exitCode = 1` for the job — but every other chunk's topics still get summarized (chunk isolation, same as `rss-topic-source.ts` / `discovery-ingest.ts`). |
| A single topic's value in the LLM response is the wrong shape | That topic's summary stays `null`; doesn't affect the rest of the chunk. |
| `updateSummary` fails for one topic | Logged to `result.errors`; other topics in the same chunk are unaffected (each is its own `updateSummary` call). |
| Topic has no linked source text (`texts.length === 0`) | Skipped before ever calling the summarizer — `summary` stays `null`. |
| `OPENAI_API_KEY` not set | The whole `summarize-topics` job logs a message and exits 0 (no error) — every topic simply stays unsummarized for the day, same convention as the existing "skip LLM classification" messages in `run-discovery-ingest.ts`/`run-deep-crawl.ts`. |

## 10. Testing

- `src/lib/topic-summarizer.ts`: unit tests for `parseSummaryResponse`
  covering: valid response, empty content (throws), unparseable JSON
  (throws), no usable index keys (throws), a non-string value at one index
  (that index → `null`, others unaffected), a blank-string value (→ `null`).
- `src/lib/topic-article-data-repository.ts`: fake implementation +
  test verifying `upsertLinks`/`getArticlesForDate` shape, mirroring the
  existing `tests/topic-social-data-repository.test.ts` pattern (fake, not
  a live-DB test).
- `src/lib/rss-topic-source.ts`: extend its existing test file with a case
  verifying `articleLinkRepo.upsertLinks` is called with one row per
  (article, extracted topic) pair, and a case verifying a failing
  `upsertLinks` doesn't throw out of `fetchCandidates()`.
- `src/summarize-topics.ts` (new test file): fake repos + fake
  `TopicSummarizer`, covering: a mixed day (rss + threads + google_trends
  candidates, only rss/threads get summarized), a topic with no linked
  text (skipped, no summarizer call for it), a chunk-level summarizer
  failure (other chunks still processed, error recorded), and a
  `updateSummary` failure (recorded, doesn't block other topics).
- `dashboard/lib/hot-topics.test.ts`, `dashboard/lib/trending.test.ts`:
  extend existing cases to assert `summary` passes through
  `buildHotTopicsForCategory`/`buildHotTopicsOverview`/
  `flattenAndRankHotTopics`'s merge (including the merge fallback case: two
  same-keyword rows, only one has a summary).
- `dashboard/lib/topic-detail.test.ts`: extend with cases for
  `resolveSummary` — latest-dated row wins, rows with null/empty summary
  are skipped, no row has a summary → `null`.
- `dashboard/lib/topics-api.test.ts`: extend to assert `summary` appears
  in `TopicApiItem`.
- No new live-API dry-run is planned for `OpenAiTopicSummarizer` itself —
  same convention already applied to `OpenAiTopicExtractor`/
  `OpenAiCandidateClassifier`/`ApifyThreadsSearchClient`: real-network
  adapters are verified manually against the live API once deployed, not
  unit-tested.

## 11. Rollout note

Until the first post-deploy pipeline run completes, `topic_article_data`
is empty and every `candidate_topics.summary` is `null` — the daily brief
page and topic detail section both already degrade gracefully to "no
summary" for that case (section 8.5/8.6), so no backfill step is required.
