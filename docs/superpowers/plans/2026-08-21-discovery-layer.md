# Discovery Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect "hot" topics daily from three free sources (Google Trends, YouTube Data API, and the existing RSS `articles` table), score them by relative change, and produce a shortlisted set of candidate topics for the future Apify deep-crawl layer (sub-project 2b) to consume.

**Architecture:** Two GitHub Actions jobs in one new workflow, `rank-and-select` gated on `discovery-ingest` via `needs:` — mirrors the RSS ingestion pipeline's 2-job pattern exactly. `discovery-ingest` calls three `DiscoverySource` adapters and upserts raw signal rows into `candidate_topics`. `rank-and-select` reads today's rows, fills in `growth_rate` for sources that don't provide it directly (via a 7-day baseline average), then per-source top-N selection unioned across sources becomes the shortlist. All I/O sits behind small interfaces (`DiscoverySource`, `CandidateTopicRepository`) so core logic is unit-testable without network or a live database, following the same pattern as sub-project 1.

**Tech Stack:** Same Node.js (>=22) + TypeScript project as sub-project 1 (no new package.json/tsconfig/vitest.config — this plan adds files to the existing project). New dependency: `@alkalisummer/google-trends-js` (spiked and confirmed working live for `geo: 'VN'`). YouTube Data API v3 called via native `fetch` (no SDK — matches the project's preference for direct, minimal dependencies).

**Spec:**
- `docs/superpowers/specs/2026-08-21-discovery-layer-design.md` (this sub-project's design, including the Reddit/TikTok Creative Center feasibility findings and the Apify budget-math flag)
- `docs/superpowers/specs/2026-08-20-social-listening-architecture-design.md` (overall architecture)

## Global Constraints

- Sources in scope: **Google Trends**, **YouTube Data API**, **RSS** (reads the existing `articles` table). Reddit and TikTok Creative Center are explicitly out of scope — see spec §7 for why.
- No cross-source magnitude comparison — each source ranks its own candidates by its own `growth_rate`, never compared in absolute terms against another source's numbers.
- `growth_rate` sentinel value for a keyword with no prior history (baseline average is zero or undefined): `999` — treated as "brand new, maximally hot."
- Top-**5** candidates per source get unioned into the shortlist (configurable parameter, not hard-coded — the real number depends on Apify pricing not yet measured, see spec §7).
- Baseline window for computing `growth_rate`: **7 days**.
- RSS keyword lookback window: **5 days** of `articles.created_at`.
- Category assignment reuses `config/categories.config.ts` / the same keyword lists as sub-project 1 — no new category mechanism, no default-category seeding (a candidate topic has no inherent "feed"), can be an empty array.
- 2 separate GitHub Actions jobs via `needs:`, new workflow file (not merged into `rss-ingestion.yml`) — failure isolation, matching sub-project 1's established rationale.
- New Supabase table `candidate_topics` gets RLS enabled **in the same migration that creates it** (lesson carried over from sub-project 1's final review finding).
- Node version floor: `>=22` (already set for the whole project).
- Apify deep-crawl (sub-project 2b) and trend-formula computation (sub-project 3) are out of scope for this plan.

---

## File Structure

```
src/
  types.ts                          # MODIFY: add DiscoverySourceName, CandidateTopic, RawCandidate
  lib/
    keyword-extractor.ts             # extractKeywords(text): string[]
    match-categories.ts              # matchCategories(text): string[]
    candidate-topic-repository.ts    # CandidateTopicRepository interface + SupabaseCandidateTopicRepository
    discovery-source.ts              # DiscoverySource interface
    google-trends-source.ts          # GoogleTrendsSource (untested adapter)
    aggregate-youtube-keywords.ts    # aggregateYouTubeKeywords(videos): RawCandidate[]
    youtube-source.ts                # YouTubeTrendingSource (untested adapter)
    aggregate-rss-keywords.ts        # aggregateRssKeywords(titles): RawCandidate[]
    rss-topic-source.ts              # RssTopicSource
    article-repository.ts            # MODIFY: add getRecentTitles(days) to ArticleRepository
  discovery-ingest.ts                 # ingestDiscoverySource, ingestAllDiscoverySources — pure logic
  rank-and-select.ts                  # rankAndSelect — pure logic
  run-discovery-ingest.ts             # CLI entrypoint, invoked by GitHub Actions
  run-rank-and-select.ts              # CLI entrypoint, invoked by GitHub Actions
supabase/
  migrations/
    0003_create_candidate_topics_table.sql
.github/
  workflows/
    discovery-ingestion.yml
tests/
  fakes/
    fake-candidate-topic-repository.ts
    fake-article-repository.ts        # MODIFY: add getRecentTitles
  keyword-extractor.test.ts
  match-categories.test.ts
  fake-candidate-topic-repository.test.ts
  fake-article-repository.test.ts     # MODIFY: add 1 test
  aggregate-youtube-keywords.test.ts
  aggregate-rss-keywords.test.ts
  rss-topic-source.test.ts
  discovery-ingest.test.ts
  rank-and-select.test.ts
  discovery-workflow.test.ts
```

---

### Task 1: Types, keyword extraction, and category matching

**Files:**
- Modify: `src/types.ts`
- Create: `src/lib/keyword-extractor.ts`
- Create: `src/lib/match-categories.ts`
- Test: `tests/keyword-extractor.test.ts`
- Test: `tests/match-categories.test.ts`

**Interfaces:**
- Consumes: `Category` (existing, `src/types.ts`), `categoryKeywords` (existing, `config/categories.config.ts`)
- Produces:
  - `type DiscoverySourceName = 'google_trends' | 'youtube' | 'rss'`
  - `interface RawCandidate { keyword: string; metric_value: number; growth_rate: number | null; }`
  - `interface CandidateTopic { id?: string; source: DiscoverySourceName; keyword: string; date: string; metric_value: number; growth_rate: number | null; category_hint: string[]; is_shortlisted: boolean; created_at?: string; updated_at?: string; }`
  - `extractKeywords(text: string): string[]` — used by Task 4, Task 5
  - `matchCategories(text: string): string[]` — used by Task 6

- [ ] **Step 1: Add the new types to `src/types.ts`**

Append to the end of the existing file:

```ts
export type DiscoverySourceName = 'google_trends' | 'youtube' | 'rss';

export interface RawCandidate {
  keyword: string;
  metric_value: number;
  growth_rate: number | null;
}

export interface CandidateTopic {
  id?: string;
  source: DiscoverySourceName;
  keyword: string;
  date: string;
  metric_value: number;
  growth_rate: number | null;
  category_hint: string[];
  is_shortlisted: boolean;
  created_at?: string;
  updated_at?: string;
}
```

- [ ] **Step 2: Write the failing tests for `extractKeywords`**

```ts
// tests/keyword-extractor.test.ts
import { describe, it, expect } from 'vitest';
import { extractKeywords } from '../src/lib/keyword-extractor';

describe('extractKeywords', () => {
  it('splits text into single words and 2-word phrases, lowercased', () => {
    const result = extractKeywords('Giá vàng tăng mạnh');
    expect(result).toContain('giá');
    expect(result).toContain('giá vàng');
    expect(result).toContain('vàng');
    expect(result).toContain('mạnh');
  });

  it('removes Vietnamese stop words', () => {
    const result = extractKeywords('vàng và bạc');
    expect(result).not.toContain('và');
  });

  it('drops words with 2 characters or fewer', () => {
    const result = extractKeywords('đi ra ngoài');
    expect(result).toContain('ngoài');
    expect(result).not.toContain('đi');
    expect(result).not.toContain('ra');
  });

  it('strips punctuation before tokenizing', () => {
    const result = extractKeywords('Bitcoin, Ethereum: tăng giá!');
    expect(result).toContain('bitcoin');
    expect(result).toContain('ethereum');
    expect(result).toContain('giá');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/keyword-extractor.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/keyword-extractor'`

- [ ] **Step 4: Implement `extractKeywords`**

```ts
// src/lib/keyword-extractor.ts
const STOP_WORDS = new Set([
  'là', 'và', 'của', 'có', 'cho', 'các', 'một', 'những', 'trong', 'này',
  'với', 'được', 'không', 'để', 'khi', 'đã', 'sẽ', 'về', 'từ', 'như',
  'tại', 'theo', 'sau', 'trên', 'đến', 'ra', 'vào', 'thì', 'lại', 'nên',
]);

export function extractKeywords(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  const keywords: string[] = [];
  for (let i = 0; i < words.length; i++) {
    keywords.push(words[i]);
    if (i < words.length - 1) {
      keywords.push(`${words[i]} ${words[i + 1]}`);
    }
  }
  return keywords;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/keyword-extractor.test.ts`
Expected: 4 tests, PASS.

- [ ] **Step 6: Write the failing tests for `matchCategories`**

```ts
// tests/match-categories.test.ts
import { describe, it, expect } from 'vitest';
import { matchCategories } from '../src/lib/match-categories';

describe('matchCategories', () => {
  it('returns matching categories based on keyword content', () => {
    expect(matchCategories('giá vàng và chứng khoán')).toEqual(['tai_chinh']);
  });

  it('returns an empty array when no keyword matches', () => {
    expect(matchCategories('một cụm từ ngẫu nhiên không liên quan')).toEqual([]);
  });

  it('returns multiple categories when text matches more than one', () => {
    const result = matchCategories('ngân hàng tài trợ tour du lịch');
    expect(result.sort()).toEqual(['du_lich', 'tai_chinh'].sort());
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run tests/match-categories.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/match-categories'`

- [ ] **Step 8: Implement `matchCategories`**

```ts
// src/lib/match-categories.ts
import { categoryKeywords } from '../../config/categories.config';

export function matchCategories(text: string): string[] {
  const categories: string[] = [];
  const lower = text.toLowerCase();

  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    if (keywords.some((kw) => lower.includes(kw.toLowerCase()))) {
      categories.push(category);
    }
  }

  return categories;
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npx vitest run tests/match-categories.test.ts`
Expected: 3 tests, PASS.

- [ ] **Step 10: Run the full suite and commit**

Run: `npm test`
Expected: all existing tests still pass, plus the 7 new ones (36 + 7 = 43 total, assuming the RSS ingestion suite's current count of 36 — verify against your actual baseline before committing).

```bash
git add src/types.ts src/lib/keyword-extractor.ts src/lib/match-categories.ts tests/keyword-extractor.test.ts tests/match-categories.test.ts
git commit -m "feat: add discovery layer types, extractKeywords, and matchCategories"
```

---

### Task 2: `CandidateTopicRepository`, Supabase adapter, test fake, and migration

**Files:**
- Create: `src/lib/candidate-topic-repository.ts`
- Create: `tests/fakes/fake-candidate-topic-repository.ts`
- Create: `supabase/migrations/0003_create_candidate_topics_table.sql`
- Test: `tests/fake-candidate-topic-repository.test.ts`

**Interfaces:**
- Consumes: `CandidateTopic` (Task 1, `src/types.ts`)
- Produces:
  - `interface CandidateTopicRepository { upsertCandidate(candidate: Partial<CandidateTopic>): Promise<{ error: string | null }>; getTodayCandidates(date: string): Promise<CandidateTopic[]>; getRecentMetrics(source: string, keyword: string, sinceDate: string, beforeDate: string): Promise<number[]>; updateGrowthRate(id: string, growthRate: number): Promise<{ error: string | null }>; markShortlisted(ids: string[]): Promise<{ error: string | null }>; }`
  - `class SupabaseCandidateTopicRepository implements CandidateTopicRepository` — used by Task 8
  - `class FakeCandidateTopicRepository implements CandidateTopicRepository` (in `tests/fakes/`, exposes public `candidates: CandidateTopic[]`) — used by Task 6, Task 7 tests

- [ ] **Step 1: Create the migration**

```sql
-- supabase/migrations/0003_create_candidate_topics_table.sql
create table if not exists candidate_topics (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('google_trends', 'youtube', 'rss')),
  keyword text not null,
  date date not null,
  metric_value numeric not null default 0,
  growth_rate numeric,
  category_hint text[] not null default '{}',
  is_shortlisted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, keyword, date)
);

create index if not exists candidate_topics_date_idx
  on candidate_topics (date);

create index if not exists candidate_topics_shortlisted_idx
  on candidate_topics (is_shortlisted);

alter table candidate_topics enable row level security;

create trigger candidate_topics_set_updated_at
  before update on candidate_topics
  for each row
  execute function set_updated_at();
```

> This reuses the `set_updated_at()` trigger function already created by migration `0002_add_updated_at_trigger.sql` (already applied to the live project) — do not redefine it.

- [ ] **Step 2: Create the interface and Supabase adapter**

```ts
// src/lib/candidate-topic-repository.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CandidateTopic } from '../types';

export interface CandidateTopicRepository {
  upsertCandidate(candidate: Partial<CandidateTopic>): Promise<{ error: string | null }>;
  getTodayCandidates(date: string): Promise<CandidateTopic[]>;
  getRecentMetrics(
    source: string,
    keyword: string,
    sinceDate: string,
    beforeDate: string
  ): Promise<number[]>;
  updateGrowthRate(id: string, growthRate: number): Promise<{ error: string | null }>;
  markShortlisted(ids: string[]): Promise<{ error: string | null }>;
}

export class SupabaseCandidateTopicRepository implements CandidateTopicRepository {
  constructor(private client: SupabaseClient) {}

  async upsertCandidate(candidate: Partial<CandidateTopic>) {
    const { error } = await this.client
      .from('candidate_topics')
      .upsert(candidate, { onConflict: 'source,keyword,date' });
    return { error: error?.message ?? null };
  }

  async getTodayCandidates(date: string) {
    const { data, error } = await this.client
      .from('candidate_topics')
      .select('*')
      .eq('date', date);
    if (error) throw new Error(error.message);
    return (data ?? []) as CandidateTopic[];
  }

  async getRecentMetrics(source: string, keyword: string, sinceDate: string, beforeDate: string) {
    const { data, error } = await this.client
      .from('candidate_topics')
      .select('metric_value')
      .eq('source', source)
      .eq('keyword', keyword)
      .gte('date', sinceDate)
      .lt('date', beforeDate);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => row.metric_value as number);
  }

  async updateGrowthRate(id: string, growthRate: number) {
    const { error } = await this.client
      .from('candidate_topics')
      .update({ growth_rate: growthRate })
      .eq('id', id);
    return { error: error?.message ?? null };
  }

  async markShortlisted(ids: string[]) {
    const { error } = await this.client
      .from('candidate_topics')
      .update({ is_shortlisted: true })
      .in('id', ids);
    return { error: error?.message ?? null };
  }
}
```

> Note the deliberate difference from `ArticleRepository.upsertArticle`: this upsert does **not** use `ignoreDuplicates: true`. RSS articles are immutable once seen (dedup by URL, never overwritten); `candidate_topics` rows for the same (source, keyword, date) get **overwritten** with the latest reading on purpose, since `discovery-ingest` runs 2-3×/day and each run's numbers should replace the previous run's for the same day.

> `SupabaseCandidateTopicRepository` wraps a real network client — verified manually once this is deployed, not by an automated unit test here, matching the convention from sub-project 1's `SupabaseArticleRepository`.

- [ ] **Step 3: Write the failing tests for the fake**

```ts
// tests/fake-candidate-topic-repository.test.ts
import { describe, it, expect } from 'vitest';
import { FakeCandidateTopicRepository } from './fakes/fake-candidate-topic-repository';

describe('FakeCandidateTopicRepository', () => {
  it('adds a new candidate on upsert', async () => {
    const repo = new FakeCandidateTopicRepository();
    const { error } = await repo.upsertCandidate({
      source: 'google_trends',
      keyword: 'bitcoin',
      date: '2026-08-21',
      metric_value: 100,
      growth_rate: 1.5,
      category_hint: ['tai_chinh'],
    });
    expect(error).toBeNull();
    expect(repo.candidates).toHaveLength(1);
  });

  it('overwrites the existing row for the same source+keyword+date instead of adding a duplicate', async () => {
    const repo = new FakeCandidateTopicRepository();
    await repo.upsertCandidate({ source: 'youtube', keyword: 'x', date: '2026-08-21', metric_value: 10 });
    await repo.upsertCandidate({ source: 'youtube', keyword: 'x', date: '2026-08-21', metric_value: 50 });

    expect(repo.candidates).toHaveLength(1);
    expect(repo.candidates[0].metric_value).toBe(50);
  });

  it('getTodayCandidates returns only rows matching the given date', async () => {
    const repo = new FakeCandidateTopicRepository();
    repo.candidates.push(
      { id: '1', source: 'rss', keyword: 'a', date: '2026-08-21', metric_value: 1, growth_rate: null, category_hint: [], is_shortlisted: false },
      { id: '2', source: 'rss', keyword: 'b', date: '2026-08-20', metric_value: 1, growth_rate: null, category_hint: [], is_shortlisted: false }
    );
    const today = await repo.getTodayCandidates('2026-08-21');
    expect(today.map((c) => c.id)).toEqual(['1']);
  });

  it('getRecentMetrics returns metric_value for the source+keyword within the date range', async () => {
    const repo = new FakeCandidateTopicRepository();
    repo.candidates.push(
      { id: '1', source: 'youtube', keyword: 'a', date: '2026-08-19', metric_value: 10, growth_rate: null, category_hint: [], is_shortlisted: false },
      { id: '2', source: 'youtube', keyword: 'a', date: '2026-08-21', metric_value: 99, growth_rate: null, category_hint: [], is_shortlisted: false },
      { id: '3', source: 'rss', keyword: 'a', date: '2026-08-19', metric_value: 5, growth_rate: null, category_hint: [], is_shortlisted: false }
    );
    const recent = await repo.getRecentMetrics('youtube', 'a', '2026-08-14', '2026-08-21');
    expect(recent).toEqual([10]);
  });

  it('updateGrowthRate sets the growth_rate on the matching row', async () => {
    const repo = new FakeCandidateTopicRepository();
    repo.candidates.push({ id: '1', source: 'youtube', keyword: 'a', date: '2026-08-21', metric_value: 1, growth_rate: null, category_hint: [], is_shortlisted: false });
    await repo.updateGrowthRate('1', 3.2);
    expect(repo.candidates[0].growth_rate).toBe(3.2);
  });

  it('markShortlisted sets is_shortlisted true for every given id', async () => {
    const repo = new FakeCandidateTopicRepository();
    repo.candidates.push(
      { id: '1', source: 'youtube', keyword: 'a', date: '2026-08-21', metric_value: 1, growth_rate: null, category_hint: [], is_shortlisted: false },
      { id: '2', source: 'youtube', keyword: 'b', date: '2026-08-21', metric_value: 1, growth_rate: null, category_hint: [], is_shortlisted: false }
    );
    await repo.markShortlisted(['1']);
    expect(repo.candidates[0].is_shortlisted).toBe(true);
    expect(repo.candidates[1].is_shortlisted).toBe(false);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run tests/fake-candidate-topic-repository.test.ts`
Expected: FAIL — `Cannot find module './fakes/fake-candidate-topic-repository'`

- [ ] **Step 5: Implement the fake**

```ts
// tests/fakes/fake-candidate-topic-repository.ts
import type { CandidateTopicRepository } from '../../src/lib/candidate-topic-repository';
import type { CandidateTopic } from '../../src/types';

export class FakeCandidateTopicRepository implements CandidateTopicRepository {
  public candidates: CandidateTopic[] = [];

  async upsertCandidate(candidate: Partial<CandidateTopic>) {
    const existing = this.candidates.find(
      (c) => c.source === candidate.source && c.keyword === candidate.keyword && c.date === candidate.date
    );
    if (existing) {
      Object.assign(existing, candidate);
    } else {
      this.candidates.push({
        id: candidate.id ?? crypto.randomUUID(),
        is_shortlisted: false,
        growth_rate: null,
        category_hint: [],
        ...candidate,
      } as CandidateTopic);
    }
    return { error: null };
  }

  async getTodayCandidates(date: string) {
    return this.candidates.filter((c) => c.date === date);
  }

  async getRecentMetrics(source: string, keyword: string, sinceDate: string, beforeDate: string) {
    return this.candidates
      .filter(
        (c) => c.source === source && c.keyword === keyword && c.date >= sinceDate && c.date < beforeDate
      )
      .map((c) => c.metric_value);
  }

  async updateGrowthRate(id: string, growthRate: number) {
    const c = this.candidates.find((x) => x.id === id);
    if (c) c.growth_rate = growthRate;
    return { error: null };
  }

  async markShortlisted(ids: string[]) {
    for (const id of ids) {
      const c = this.candidates.find((x) => x.id === id);
      if (c) c.is_shortlisted = true;
    }
    return { error: null };
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/fake-candidate-topic-repository.test.ts`
Expected: 6 tests, PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/candidate-topic-repository.ts tests/fakes/fake-candidate-topic-repository.ts tests/fake-candidate-topic-repository.test.ts supabase/migrations/0003_create_candidate_topics_table.sql
git commit -m "feat: add CandidateTopicRepository, Supabase adapter, test fake, and migration"
```

---

### Task 3: `GoogleTrendsSource`

**Files:**
- Create: `src/lib/discovery-source.ts`
- Create: `src/lib/google-trends-source.ts`
- Modify: `package.json` (add dependency)

**Interfaces:**
- Consumes: `RawCandidate`, `DiscoverySourceName` (Task 1)
- Produces:
  - `interface DiscoverySource { name: DiscoverySourceName; fetchCandidates(): Promise<RawCandidate[]>; }` — used by Task 4, Task 5, Task 6
  - `class GoogleTrendsSource implements DiscoverySource` — used by Task 8

- [ ] **Step 1: Add the dependency**

```bash
npm install @alkalisummer/google-trends-js
```

Expected: `package.json` gets `"@alkalisummer/google-trends-js": "^0.3.7"` added under `dependencies` (or whatever the currently-published version resolves to — this library ships its own TypeScript types, no separate `@types/` package needed).

- [ ] **Step 2: Create the `DiscoverySource` interface**

```ts
// src/lib/discovery-source.ts
import type { DiscoverySourceName, RawCandidate } from '../types';

export interface DiscoverySource {
  name: DiscoverySourceName;
  fetchCandidates(): Promise<RawCandidate[]>;
}
```

- [ ] **Step 3: Implement `GoogleTrendsSource`**

```ts
// src/lib/google-trends-source.ts
import GoogleTrendsApi from '@alkalisummer/google-trends-js';
import type { DiscoverySource } from './discovery-source';
import type { RawCandidate } from '../types';

export class GoogleTrendsSource implements DiscoverySource {
  name = 'google_trends' as const;

  async fetchCandidates(): Promise<RawCandidate[]> {
    const result = await GoogleTrendsApi.dailyTrends({ geo: 'VN', hl: 'vi' });
    const items = result.data ?? [];
    return items.map((item) => ({
      keyword: item.keyword.toLowerCase().trim(),
      metric_value: item.traffic,
      growth_rate: item.trafficGrowthRate,
    }));
  }
}
```

> `GoogleTrendsSource` wraps a real network call to Google Trends — already spiked and confirmed working live for `geo: 'VN'` (returned ~80 keyed trends with real Vietnamese keywords and a populated `trafficGrowthRate`). Not unit-tested here, matching the convention for real-network adapters (`RssParserFetcher`, `DefaultContentExtractor`) from sub-project 1 — verified manually once deployed.

- [ ] **Step 4: Run typecheck to verify it compiles**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/lib/discovery-source.ts src/lib/google-trends-source.ts
git commit -m "feat: add DiscoverySource interface and GoogleTrendsSource adapter"
```

---

### Task 4: `YouTubeTrendingSource`

**Files:**
- Create: `src/lib/aggregate-youtube-keywords.ts`
- Create: `src/lib/youtube-source.ts`
- Test: `tests/aggregate-youtube-keywords.test.ts`

**Interfaces:**
- Consumes: `extractKeywords` (Task 1), `DiscoverySource`, `RawCandidate` (Task 3/Task 1)
- Produces:
  - `interface YouTubeVideoItem { snippet?: { title?: string; tags?: string[] }; statistics?: { viewCount?: string }; }`
  - `aggregateYouTubeKeywords(videos: YouTubeVideoItem[]): RawCandidate[]` — used by Task 8's manual verification
  - `class YouTubeTrendingSource implements DiscoverySource` (constructor takes an API key string) — used by Task 8

- [ ] **Step 1: Write the failing tests for `aggregateYouTubeKeywords`**

```ts
// tests/aggregate-youtube-keywords.test.ts
import { describe, it, expect } from 'vitest';
import { aggregateYouTubeKeywords } from '../src/lib/aggregate-youtube-keywords';

describe('aggregateYouTubeKeywords', () => {
  it('sums view counts per keyword across videos sharing that keyword/tag', () => {
    const result = aggregateYouTubeKeywords([
      { snippet: { title: 'Giá vàng hôm nay', tags: ['vàng'] }, statistics: { viewCount: '1000' } },
      { snippet: { title: 'Vàng tăng giá mạnh', tags: ['vàng'] }, statistics: { viewCount: '500' } },
    ]);

    const vang = result.find((r) => r.keyword === 'vàng');
    expect(vang).toBeDefined();
    expect(vang!.metric_value).toBe(1500);
  });

  it('does not double count a keyword that appears both in the title and in tags for the same video', () => {
    const result = aggregateYouTubeKeywords([
      { snippet: { title: 'Bitcoin tăng giá', tags: ['bitcoin'] }, statistics: { viewCount: '2000' } },
    ]);

    const bitcoin = result.find((r) => r.keyword === 'bitcoin');
    expect(bitcoin!.metric_value).toBe(2000);
  });

  it('leaves growth_rate null for every keyword', () => {
    const result = aggregateYouTubeKeywords([
      { snippet: { title: 'Chủ đề bất kỳ', tags: [] }, statistics: { viewCount: '10' } },
    ]);
    expect(result.every((r) => r.growth_rate === null)).toBe(true);
  });

  it('treats a missing viewCount as zero', () => {
    const result = aggregateYouTubeKeywords([
      { snippet: { title: 'Không có view count', tags: [] }, statistics: {} },
    ]);
    expect(result.every((r) => r.metric_value === 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/aggregate-youtube-keywords.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/aggregate-youtube-keywords'`

- [ ] **Step 3: Implement `aggregateYouTubeKeywords`**

```ts
// src/lib/aggregate-youtube-keywords.ts
import { extractKeywords } from './keyword-extractor';
import type { RawCandidate } from '../types';

export interface YouTubeVideoItem {
  snippet?: { title?: string; tags?: string[] };
  statistics?: { viewCount?: string };
}

export function aggregateYouTubeKeywords(videos: YouTubeVideoItem[]): RawCandidate[] {
  const totals = new Map<string, number>();

  for (const video of videos) {
    const viewCount = Number(video.statistics?.viewCount ?? 0);
    const titleKeywords = extractKeywords(video.snippet?.title ?? '');
    const tags = (video.snippet?.tags ?? []).map((t) => t.toLowerCase().trim());
    const keywords = new Set([...titleKeywords, ...tags]);

    for (const keyword of keywords) {
      totals.set(keyword, (totals.get(keyword) ?? 0) + viewCount);
    }
  }

  return Array.from(totals.entries()).map(([keyword, metric_value]) => ({
    keyword,
    metric_value,
    growth_rate: null,
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/aggregate-youtube-keywords.test.ts`
Expected: 4 tests, PASS.

- [ ] **Step 5: Implement `YouTubeTrendingSource`**

```ts
// src/lib/youtube-source.ts
import type { DiscoverySource } from './discovery-source';
import type { RawCandidate } from '../types';
import { aggregateYouTubeKeywords, type YouTubeVideoItem } from './aggregate-youtube-keywords';

const FETCH_TIMEOUT_MS = 15000;

export class YouTubeTrendingSource implements DiscoverySource {
  name = 'youtube' as const;

  constructor(private apiKey: string) {}

  async fetchCandidates(): Promise<RawCandidate[]> {
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
}
```

> `YouTubeTrendingSource` wraps a real network call — verified manually once `YOUTUBE_API_KEY` is wired in (Task 8), not unit-tested, matching convention. All the meaningful logic (keyword aggregation) lives in the tested pure function above.

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/aggregate-youtube-keywords.ts src/lib/youtube-source.ts tests/aggregate-youtube-keywords.test.ts
git commit -m "feat: add aggregateYouTubeKeywords and YouTubeTrendingSource adapter"
```

---

### Task 5: `RssTopicSource`

**Files:**
- Modify: `src/lib/article-repository.ts` (add `getRecentTitles` to `ArticleRepository`)
- Modify: `tests/fakes/fake-article-repository.ts` (implement `getRecentTitles`)
- Create: `src/lib/aggregate-rss-keywords.ts`
- Create: `src/lib/rss-topic-source.ts`
- Test: `tests/fake-article-repository.test.ts` (add 1 test)
- Test: `tests/aggregate-rss-keywords.test.ts`
- Test: `tests/rss-topic-source.test.ts`

**Interfaces:**
- Consumes: `extractKeywords` (Task 1), `DiscoverySource`, `RawCandidate` (Task 3/Task 1), `ArticleRepository` (existing, sub-project 1)
- Produces:
  - `ArticleRepository.getRecentTitles(days: number): Promise<string[]>` (new method on the existing interface)
  - `aggregateRssKeywords(titles: string[]): RawCandidate[]`
  - `class RssTopicSource implements DiscoverySource` (constructor takes `Pick<ArticleRepository, 'getRecentTitles'>`) — used by Task 8

- [ ] **Step 1: Write the failing test for `ArticleRepository.getRecentTitles`**

Add this test to the end of the existing `describe('FakeArticleRepository', ...)` block in `tests/fake-article-repository.test.ts`:

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

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/fake-article-repository.test.ts`
Expected: FAIL — `repo.getRecentTitles is not a function`

- [ ] **Step 3: Add `getRecentTitles` to the interface and both implementations**

In `src/lib/article-repository.ts`, add to the `ArticleRepository` interface (after `markRetryOrFailed`):

```ts
  getRecentTitles(days: number): Promise<string[]>;
```

Add to `SupabaseArticleRepository` (after `markRetryOrFailed`):

```ts
  async getRecentTitles(days: number) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await this.client
      .from('articles')
      .select('title')
      .gte('created_at', since);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => row.title as string);
  }
```

In `tests/fakes/fake-article-repository.ts`, add to `FakeArticleRepository` (after `markRetryOrFailed`):

```ts
  async getRecentTitles(days: number) {
    const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;
    return this.articles
      .filter((a) => a.created_at && new Date(a.created_at).getTime() >= sinceMs)
      .map((a) => a.title);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/fake-article-repository.test.ts`
Expected: 10 tests, PASS (9 existing + 1 new).

- [ ] **Step 5: Write the failing tests for `aggregateRssKeywords`**

```ts
// tests/aggregate-rss-keywords.test.ts
import { describe, it, expect } from 'vitest';
import { aggregateRssKeywords } from '../src/lib/aggregate-rss-keywords';

describe('aggregateRssKeywords', () => {
  it('counts how many titles each keyword appears in', () => {
    const result = aggregateRssKeywords(['Giá vàng tăng mạnh', 'Vàng lập đỉnh mới', 'Chứng khoán giảm']);
    const vang = result.find((r) => r.keyword === 'vàng');
    expect(vang).toBeDefined();
    expect(vang!.metric_value).toBe(2);
  });

  it('counts a keyword at most once per title even if it repeats within that title', () => {
    const result = aggregateRssKeywords(['vàng vàng vàng']);
    const vang = result.find((r) => r.keyword === 'vàng');
    expect(vang!.metric_value).toBe(1);
  });

  it('leaves growth_rate null for every keyword', () => {
    const result = aggregateRssKeywords(['Một tiêu đề bất kỳ']);
    expect(result.every((r) => r.growth_rate === null)).toBe(true);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run tests/aggregate-rss-keywords.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/aggregate-rss-keywords'`

- [ ] **Step 7: Implement `aggregateRssKeywords`**

```ts
// src/lib/aggregate-rss-keywords.ts
import { extractKeywords } from './keyword-extractor';
import type { RawCandidate } from '../types';

export function aggregateRssKeywords(titles: string[]): RawCandidate[] {
  const counts = new Map<string, number>();

  for (const title of titles) {
    for (const keyword of new Set(extractKeywords(title))) {
      counts.set(keyword, (counts.get(keyword) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries()).map(([keyword, metric_value]) => ({
    keyword,
    metric_value,
    growth_rate: null,
  }));
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run tests/aggregate-rss-keywords.test.ts`
Expected: 3 tests, PASS.

- [ ] **Step 9: Write the failing test for `RssTopicSource`**

```ts
// tests/rss-topic-source.test.ts
import { describe, it, expect } from 'vitest';
import { RssTopicSource } from '../src/lib/rss-topic-source';
import { FakeArticleRepository } from './fakes/fake-article-repository';

describe('RssTopicSource', () => {
  it('fetches recent titles from the repository and aggregates them into candidates', async () => {
    const repo = new FakeArticleRepository();
    const now = Date.now();
    repo.articles.push({
      id: '1', url: 'u1', title: 'Giá vàng tăng mạnh', published_at: '', source_id: 's',
      categories: [], snippet: '', full_content: null, content_fetch_status: 'pending',
      fetch_attempts: 0, created_at: new Date(now).toISOString(),
    });
    const source = new RssTopicSource(repo);

    const candidates = await source.fetchCandidates();

    expect(source.name).toBe('rss');
    expect(candidates.some((c) => c.keyword === 'vàng')).toBe(true);
  });
});
```

- [ ] **Step 10: Run test to verify it fails**

Run: `npx vitest run tests/rss-topic-source.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/rss-topic-source'`

- [ ] **Step 11: Implement `RssTopicSource`**

```ts
// src/lib/rss-topic-source.ts
import type { DiscoverySource } from './discovery-source';
import type { RawCandidate } from '../types';
import type { ArticleRepository } from './article-repository';
import { aggregateRssKeywords } from './aggregate-rss-keywords';

const LOOKBACK_DAYS = 5;

export class RssTopicSource implements DiscoverySource {
  name = 'rss' as const;

  constructor(private repo: Pick<ArticleRepository, 'getRecentTitles'>) {}

  async fetchCandidates(): Promise<RawCandidate[]> {
    const titles = await this.repo.getRecentTitles(LOOKBACK_DAYS);
    return aggregateRssKeywords(titles);
  }
}
```

- [ ] **Step 12: Run test to verify it passes**

Run: `npx vitest run tests/rss-topic-source.test.ts`
Expected: 1 test, PASS.

- [ ] **Step 13: Run the full suite and commit**

Run: `npm test`
Expected: all tests pass.

```bash
git add src/lib/article-repository.ts tests/fakes/fake-article-repository.ts tests/fake-article-repository.test.ts src/lib/aggregate-rss-keywords.ts src/lib/rss-topic-source.ts tests/aggregate-rss-keywords.test.ts tests/rss-topic-source.test.ts
git commit -m "feat: add ArticleRepository.getRecentTitles and RssTopicSource"
```

---

### Task 6: `discovery-ingest` core logic

**Files:**
- Create: `src/discovery-ingest.ts`
- Test: `tests/discovery-ingest.test.ts`

**Interfaces:**
- Consumes: `DiscoverySource`, `RawCandidate` (Task 3), `CandidateTopicRepository`, `FakeCandidateTopicRepository` (Task 2), `matchCategories` (Task 1)
- Produces:
  - `interface DiscoveryIngestDeps { repo: CandidateTopicRepository; now?: () => Date; }`
  - `interface DiscoveryIngestResult { source: string; fetched: number; upserted: number; errors: string[]; }`
  - `ingestDiscoverySource(source: DiscoverySource, deps: DiscoveryIngestDeps): Promise<DiscoveryIngestResult>`
  - `ingestAllDiscoverySources(sources: DiscoverySource[], deps: DiscoveryIngestDeps): Promise<DiscoveryIngestResult[]>` — used by Task 8

- [ ] **Step 1: Write the failing tests**

```ts
// tests/discovery-ingest.test.ts
import { describe, it, expect } from 'vitest';
import { ingestDiscoverySource, ingestAllDiscoverySources } from '../src/discovery-ingest';
import { FakeCandidateTopicRepository } from './fakes/fake-candidate-topic-repository';
import type { DiscoverySource } from '../src/lib/discovery-source';

function fakeSource(
  name: 'google_trends' | 'youtube' | 'rss',
  candidates: Array<{ keyword: string; metric_value: number; growth_rate: number | null }>
): DiscoverySource {
  return { name, fetchCandidates: async () => candidates };
}

describe('ingestDiscoverySource', () => {
  it('upserts one candidate_topics row per fetched candidate, tagged with today and category hints', async () => {
    const repo = new FakeCandidateTopicRepository();
    const source = fakeSource('google_trends', [{ keyword: 'giá vàng', metric_value: 5000, growth_rate: 1.2 }]);

    const result = await ingestDiscoverySource(source, { repo, now: () => new Date('2026-08-21T09:00:00Z') });

    expect(result).toEqual({ source: 'google_trends', fetched: 1, upserted: 1, errors: [] });
    expect(repo.candidates).toHaveLength(1);
    expect(repo.candidates[0]).toMatchObject({
      source: 'google_trends',
      keyword: 'giá vàng',
      date: '2026-08-21',
      metric_value: 5000,
      growth_rate: 1.2,
      category_hint: ['tai_chinh'],
    });
  });

  it('records an error and returns early when fetchCandidates throws', async () => {
    const repo = new FakeCandidateTopicRepository();
    const source: DiscoverySource = {
      name: 'youtube',
      fetchCandidates: async () => {
        throw new Error('quota exceeded');
      },
    };

    const result = await ingestDiscoverySource(source, { repo, now: () => new Date() });

    expect(result.fetched).toBe(0);
    expect(result.errors[0]).toContain('quota exceeded');
  });
});

describe('ingestAllDiscoverySources', () => {
  it('runs ingestDiscoverySource for every source and aggregates results', async () => {
    const repo = new FakeCandidateTopicRepository();
    const sources = [
      fakeSource('google_trends', [{ keyword: 'a', metric_value: 1, growth_rate: 1 }]),
      fakeSource('youtube', [{ keyword: 'b', metric_value: 2, growth_rate: null }]),
    ];

    const results = await ingestAllDiscoverySources(sources, {
      repo,
      now: () => new Date('2026-08-21T09:00:00Z'),
    });

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.source)).toEqual(['google_trends', 'youtube']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/discovery-ingest.test.ts`
Expected: FAIL — `Cannot find module '../src/discovery-ingest'`

- [ ] **Step 3: Implement `ingestDiscoverySource`/`ingestAllDiscoverySources`**

```ts
// src/discovery-ingest.ts
import type { DiscoverySource } from './lib/discovery-source';
import type { CandidateTopicRepository } from './lib/candidate-topic-repository';
import { matchCategories } from './lib/match-categories';

export interface DiscoveryIngestDeps {
  repo: CandidateTopicRepository;
  now?: () => Date;
}

export interface DiscoveryIngestResult {
  source: string;
  fetched: number;
  upserted: number;
  errors: string[];
}

export async function ingestDiscoverySource(
  source: DiscoverySource,
  deps: DiscoveryIngestDeps
): Promise<DiscoveryIngestResult> {
  const now = deps.now ?? (() => new Date());
  const result: DiscoveryIngestResult = { source: source.name, fetched: 0, upserted: 0, errors: [] };
  const date = now().toISOString().slice(0, 10);

  let candidates;
  try {
    candidates = await source.fetchCandidates();
  } catch (err) {
    result.errors.push(`fetch failed: ${(err as Error).message}`);
    return result;
  }

  result.fetched = candidates.length;

  for (const candidate of candidates) {
    const { error } = await deps.repo.upsertCandidate({
      source: source.name,
      keyword: candidate.keyword,
      date,
      metric_value: candidate.metric_value,
      growth_rate: candidate.growth_rate,
      category_hint: matchCategories(candidate.keyword),
      is_shortlisted: false,
    });
    if (error) {
      result.errors.push(`upsert failed for "${candidate.keyword}": ${error}`);
    } else {
      result.upserted += 1;
    }
  }

  return result;
}

export async function ingestAllDiscoverySources(
  sources: DiscoverySource[],
  deps: DiscoveryIngestDeps
): Promise<DiscoveryIngestResult[]> {
  const results: DiscoveryIngestResult[] = [];
  for (const source of sources) {
    results.push(await ingestDiscoverySource(source, deps));
  }
  return results;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/discovery-ingest.test.ts`
Expected: 3 tests, PASS.

- [ ] **Step 5: Commit**

```bash
git add src/discovery-ingest.ts tests/discovery-ingest.test.ts
git commit -m "feat: add discovery-ingest core logic"
```

---

### Task 7: `rank-and-select` core logic

**Files:**
- Create: `src/rank-and-select.ts`
- Test: `tests/rank-and-select.test.ts`

**Interfaces:**
- Consumes: `CandidateTopicRepository`, `FakeCandidateTopicRepository` (Task 2), `CandidateTopic` (Task 1)
- Produces:
  - `interface RankDeps { repo: CandidateTopicRepository; now?: () => Date; }`
  - `interface RankOptions { topPerSource?: number; baselineDays?: number; }`
  - `interface RankResult { evaluated: number; shortlisted: number; }`
  - `rankAndSelect(deps: RankDeps, options?: RankOptions): Promise<RankResult>` — used by Task 8

- [ ] **Step 1: Write the failing tests**

```ts
// tests/rank-and-select.test.ts
import { describe, it, expect } from 'vitest';
import { rankAndSelect } from '../src/rank-and-select';
import { FakeCandidateTopicRepository } from './fakes/fake-candidate-topic-repository';
import type { CandidateTopic } from '../src/types';

function candidate(overrides: Partial<CandidateTopic>): CandidateTopic {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    source: 'google_trends',
    keyword: 'x',
    date: '2026-08-21',
    metric_value: 100,
    growth_rate: null,
    category_hint: [],
    is_shortlisted: false,
    ...overrides,
  };
}

const NOW = () => new Date('2026-08-21T09:00:00Z');

describe('rankAndSelect', () => {
  it('keeps the growth_rate already provided by a source (e.g. Google Trends) unchanged', async () => {
    const repo = new FakeCandidateTopicRepository();
    repo.candidates.push(candidate({ id: '1', growth_rate: 2.5 }));

    await rankAndSelect({ repo, now: NOW });

    expect(repo.candidates[0].growth_rate).toBe(2.5);
  });

  it('computes growth_rate from the 7-day baseline average when missing', async () => {
    const repo = new FakeCandidateTopicRepository();
    repo.candidates.push(
      candidate({ id: '1', keyword: 'bitcoin', source: 'youtube', metric_value: 300, date: '2026-08-21' }),
      candidate({ id: '2', keyword: 'bitcoin', source: 'youtube', metric_value: 100, date: '2026-08-19' }),
      candidate({ id: '3', keyword: 'bitcoin', source: 'youtube', metric_value: 100, date: '2026-08-20' })
    );

    await rankAndSelect({ repo, now: NOW });

    expect(repo.candidates[0].growth_rate).toBe(2);
  });

  it('assigns the sentinel growth_rate to a keyword with no history at all', async () => {
    const repo = new FakeCandidateTopicRepository();
    repo.candidates.push(candidate({ id: '1', keyword: 'topic mới', metric_value: 50 }));

    await rankAndSelect({ repo, now: NOW });

    expect(repo.candidates[0].growth_rate).toBe(999);
  });

  it('assigns the sentinel growth_rate when the baseline average is zero', async () => {
    const repo = new FakeCandidateTopicRepository();
    repo.candidates.push(
      candidate({ id: '1', keyword: 'y', metric_value: 10, date: '2026-08-21' }),
      candidate({ id: '2', keyword: 'y', metric_value: 0, date: '2026-08-20' })
    );

    await rankAndSelect({ repo, now: NOW });

    expect(repo.candidates[0].growth_rate).toBe(999);
  });

  it('shortlists only the top N per source by growth_rate, and marks every row (across sources) matching a shortlisted keyword', async () => {
    const repo = new FakeCandidateTopicRepository();
    repo.candidates.push(
      candidate({ id: '1', source: 'google_trends', keyword: 'a', growth_rate: 3 }),
      candidate({ id: '2', source: 'google_trends', keyword: 'b', growth_rate: 1 }),
      candidate({ id: '3', source: 'youtube', keyword: 'a', growth_rate: 5 })
    );

    const result = await rankAndSelect({ repo, now: NOW }, { topPerSource: 1 });

    expect(result).toEqual({ evaluated: 3, shortlisted: 1 });
    expect(repo.candidates.find((c) => c.id === '1')!.is_shortlisted).toBe(true);
    expect(repo.candidates.find((c) => c.id === '2')!.is_shortlisted).toBe(false);
    expect(repo.candidates.find((c) => c.id === '3')!.is_shortlisted).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/rank-and-select.test.ts`
Expected: FAIL — `Cannot find module '../src/rank-and-select'`

- [ ] **Step 3: Implement `rankAndSelect`**

```ts
// src/rank-and-select.ts
import type { CandidateTopicRepository } from './lib/candidate-topic-repository';
import type { CandidateTopic } from './types';

export interface RankDeps {
  repo: CandidateTopicRepository;
  now?: () => Date;
}

export interface RankOptions {
  topPerSource?: number;
  baselineDays?: number;
}

export interface RankResult {
  evaluated: number;
  shortlisted: number;
}

const DEFAULT_TOP_PER_SOURCE = 5;
const DEFAULT_BASELINE_DAYS = 7;
const NEW_KEYWORD_GROWTH_RATE = 999;

export async function rankAndSelect(deps: RankDeps, options: RankOptions = {}): Promise<RankResult> {
  const now = deps.now ?? (() => new Date());
  const topPerSource = options.topPerSource ?? DEFAULT_TOP_PER_SOURCE;
  const baselineDays = options.baselineDays ?? DEFAULT_BASELINE_DAYS;
  const today = now().toISOString().slice(0, 10);
  const since = new Date(now().getTime() - baselineDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const candidates = await deps.repo.getTodayCandidates(today);

  for (const candidate of candidates) {
    if (candidate.growth_rate !== null) continue;

    const recent = await deps.repo.getRecentMetrics(candidate.source, candidate.keyword, since, today);

    let growthRate: number;
    if (recent.length === 0) {
      growthRate = NEW_KEYWORD_GROWTH_RATE;
    } else {
      const baseline = recent.reduce((sum, v) => sum + v, 0) / recent.length;
      growthRate = baseline === 0 ? NEW_KEYWORD_GROWTH_RATE : (candidate.metric_value - baseline) / baseline;
    }

    await deps.repo.updateGrowthRate(candidate.id!, growthRate);
    candidate.growth_rate = growthRate;
  }

  const bySource = new Map<string, CandidateTopic[]>();
  for (const candidate of candidates) {
    const list = bySource.get(candidate.source) ?? [];
    list.push(candidate);
    bySource.set(candidate.source, list);
  }

  const shortlistedKeywords = new Set<string>();
  for (const list of bySource.values()) {
    const top = [...list].sort((a, b) => (b.growth_rate ?? 0) - (a.growth_rate ?? 0)).slice(0, topPerSource);
    for (const item of top) {
      shortlistedKeywords.add(item.keyword);
    }
  }

  const shortlistIds = candidates.filter((c) => shortlistedKeywords.has(c.keyword)).map((c) => c.id!);
  if (shortlistIds.length > 0) {
    await deps.repo.markShortlisted(shortlistIds);
  }

  return { evaluated: candidates.length, shortlisted: shortlistedKeywords.size };
}
```

> The shortlist is a set of **keywords**, not rows: if the same keyword is independently confirmed hot by two sources, both underlying rows get `is_shortlisted = true`, not just one. This matters for sub-project 2b later — it can see which sources agreed on a topic.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/rank-and-select.test.ts`
Expected: 5 tests, PASS.

- [ ] **Step 5: Commit**

```bash
git add src/rank-and-select.ts tests/rank-and-select.test.ts
git commit -m "feat: add rank-and-select core logic with per-source top-N shortlist"
```

---

### Task 8: CLI entrypoints, GitHub Actions workflow, README

**Files:**
- Create: `src/run-discovery-ingest.ts`
- Create: `src/run-rank-and-select.ts`
- Create: `.github/workflows/discovery-ingestion.yml`
- Modify: `package.json` (add `discover`/`rank` scripts)
- Modify: `README.md`
- Test: `tests/discovery-workflow.test.ts`

**Interfaces:**
- Consumes: `getRequiredEnv` (existing), `SupabaseCandidateTopicRepository`, `SupabaseArticleRepository` (existing), `GoogleTrendsSource` (Task 3), `YouTubeTrendingSource` (Task 4), `RssTopicSource` (Task 5), `ingestAllDiscoverySources` (Task 6), `rankAndSelect` (Task 7)
- Produces: nothing further downstream — last task in this plan

- [ ] **Step 1: Add npm scripts**

In `package.json`, add to `"scripts"`:

```json
    "discover": "tsx src/run-discovery-ingest.ts",
    "rank": "tsx src/run-rank-and-select.ts"
```

- [ ] **Step 2: Create the `run-discovery-ingest` entrypoint**

```ts
// src/run-discovery-ingest.ts
import { createClient } from '@supabase/supabase-js';
import { getRequiredEnv } from './lib/env';
import { SupabaseCandidateTopicRepository } from './lib/candidate-topic-repository';
import { SupabaseArticleRepository } from './lib/article-repository';
import { GoogleTrendsSource } from './lib/google-trends-source';
import { YouTubeTrendingSource } from './lib/youtube-source';
import { RssTopicSource } from './lib/rss-topic-source';
import { ingestAllDiscoverySources } from './discovery-ingest';

async function main() {
  const client = createClient(getRequiredEnv('SUPABASE_URL'), getRequiredEnv('SUPABASE_SERVICE_KEY'));
  const repo = new SupabaseCandidateTopicRepository(client);
  const articleRepo = new SupabaseArticleRepository(client);

  const sources = [
    new GoogleTrendsSource(),
    new YouTubeTrendingSource(getRequiredEnv('YOUTUBE_API_KEY')),
    new RssTopicSource(articleRepo),
  ];

  const results = await ingestAllDiscoverySources(sources, { repo });

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

- [ ] **Step 3: Create the `run-rank-and-select` entrypoint**

```ts
// src/run-rank-and-select.ts
import { createClient } from '@supabase/supabase-js';
import { getRequiredEnv } from './lib/env';
import { SupabaseCandidateTopicRepository } from './lib/candidate-topic-repository';
import { rankAndSelect } from './rank-and-select';

async function main() {
  const client = createClient(getRequiredEnv('SUPABASE_URL'), getRequiredEnv('SUPABASE_SERVICE_KEY'));
  const repo = new SupabaseCandidateTopicRepository(client);

  const result = await rankAndSelect({ repo });
  console.log(`evaluated=${result.evaluated} shortlisted=${result.shortlisted}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
```

- [ ] **Step 4: Write the failing test for the workflow file**

```ts
// tests/discovery-workflow.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';

describe('.github/workflows/discovery-ingestion.yml', () => {
  const doc = load(readFileSync('.github/workflows/discovery-ingestion.yml', 'utf8')) as any;

  it('defines both jobs', () => {
    expect(Object.keys(doc.jobs)).toEqual(['discovery-ingest', 'rank-and-select']);
  });

  it('gates rank-and-select on discovery-ingest via needs', () => {
    expect(doc['jobs']['rank-and-select']['needs']).toBe('discovery-ingest');
  });

  it('schedules 3 runs per day via cron, same cadence as RSS ingestion', () => {
    const schedule = doc.on.schedule;
    expect(schedule).toHaveLength(1);
    expect(schedule[0].cron.split(' ')[1].split(',')).toHaveLength(3);
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npx vitest run tests/discovery-workflow.test.ts`
Expected: FAIL — `ENOENT: no such file or directory, open '.github/workflows/discovery-ingestion.yml'`

- [ ] **Step 6: Create the GitHub Actions workflow**

```yaml
# .github/workflows/discovery-ingestion.yml
name: Discovery ingestion

on:
  schedule:
    # Same cadence as RSS ingestion — 08:00 / 11:00 / 20:00 Vietnam time (ICT, UTC+7).
    - cron: '0 1,4,13 * * *'
  workflow_dispatch: {}

jobs:
  discovery-ingest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run discover
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
          YOUTUBE_API_KEY: ${{ secrets.YOUTUBE_API_KEY }}

  rank-and-select:
    needs: discovery-ingest
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
      - run: npm run rank
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
```

> `rank-and-select` needs `if: ${{ !cancelled() }}` for the same reason `crawl-content` needed it in the RSS workflow — without it, any single-source error in `discovery-ingest` (which exits 1 on any error) would skip ranking entirely, defeating the point of splitting into two jobs.

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run tests/discovery-workflow.test.ts`
Expected: 3 tests, PASS.

- [ ] **Step 8: Update the README**

Add a new section to `README.md`, after the existing "Running locally" section:

```markdown
## Discovery layer (sub-project 2a)

```bash
export SUPABASE_URL=...
export SUPABASE_SERVICE_KEY=...
export YOUTUBE_API_KEY=...
npm run discover   # Google Trends + YouTube + RSS keyword signals -> candidate_topics
npm run rank       # computes growth_rate, shortlists top candidates per source
```

Setup: apply `supabase/migrations/0003_create_candidate_topics_table.sql` (after `0001` and `0002`), and add a `YOUTUBE_API_KEY` secret in the GitHub repo (from a Google Cloud project with the YouTube Data API v3 enabled).

Sources: Google Trends (`@alkalisummer/google-trends-js`, unofficial but verified working for `geo=VN`), YouTube Data API (official), and the existing `articles` table (keyword frequency in recent titles). Reddit and TikTok Creative Center are deliberately out of scope — see `docs/superpowers/specs/2026-08-21-discovery-layer-design.md` §7 for why.

This produces a `candidate_topics` shortlist for the future Apify deep-crawl layer (sub-project 2b, not yet built) to consume — this sub-project does not call Apify.
```

- [ ] **Step 9: Run the full suite, typecheck, and commit**

Run: `npm run typecheck && npm test`
Expected: no typecheck errors; all tests pass. Running total from this plan's baseline of 36: +7 (Task 1) +6 (Task 2) +0 (Task 3) +4 (Task 4) +5 (Task 5) +3 (Task 6) +5 (Task 7) +3 (Task 8) = **69 tests** — verify the actual count against your suite before committing, since it compounds across tasks and a skipped/reordered task changes the arithmetic.

```bash
git add src/run-discovery-ingest.ts src/run-rank-and-select.ts .github/workflows/discovery-ingestion.yml tests/discovery-workflow.test.ts package.json README.md
git commit -m "feat: add discovery-ingest/rank-and-select CLI entrypoints, GH Actions workflow, and README"
```

---

## Self-Review Notes

- **Spec coverage:** §1 (scope: 3 sources, no Apify/trend-formula/dashboard) → honored throughout, no Apify code anywhere in this plan. §2 (2-job architecture) → Task 8 workflow. §3 (`candidate_topics` schema) → Task 2 migration. §4 (3 sources) → Tasks 3/4/5. §5 (`extractKeywords`) → Task 1. §6 (rank-and-select algorithm, including the zero-baseline sentinel) → Task 7. §7 (Reddit/TikTok/budget findings) → documented in README (Task 8) and the spec itself, not re-litigated in code. §8 (category reuse) → Task 1's `matchCategories`, applied in Task 6. §9 (infra/secrets) → Tasks 2, 3, 8.
- **Placeholder scan:** no TBD/TODO; every code block is complete and runnable as written; every test file shown in full.
- **Type consistency:** `RawCandidate`, `CandidateTopic`, `DiscoverySourceName` (Task 1) are the only shapes referenced by name in later tasks. `DiscoverySource` (Task 3) is implemented identically by `GoogleTrendsSource` (Task 3), `YouTubeTrendingSource` (Task 4), and `RssTopicSource` (Task 5) — all three expose `name` and `fetchCandidates(): Promise<RawCandidate[]>`. `CandidateTopicRepository` (Task 2) is consumed with matching method names/signatures in Task 6 (`upsertCandidate`) and Task 7 (`getTodayCandidates`, `getRecentMetrics`, `updateGrowthRate`, `markShortlisted`) — verified against Task 2's interface definition, not re-derived. `ArticleRepository.getRecentTitles` (Task 5) matches its use in `RssTopicSource`'s constructor type (`Pick<ArticleRepository, 'getRecentTitles'>`).
