# Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a public, read-only Next.js dashboard (deployed to Vercel) showing today's hot topics (from `candidate_topics`, sub-project 2a) and recent RSS articles (from `articles`, sub-project 1), split into an Overview view and 3 category views (tài chính / giải trí / du lịch).

**Architecture:** New standalone Next.js 15 App Router project at `dashboard/` (own `package.json`, isolated from the root ingestion project). Server Components query Supabase directly via `@supabase/supabase-js`, authenticated with the service-role key (server-only env var) since both source tables have RLS enabled with zero policies. Trending score reuses the existing `growth_rate` column as-is; share of voice is a new value computed at render time from data already fetched, never persisted.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS v4, `@supabase/supabase-js`, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-21-dashboard-design.md`

## Global Constraints

- App lives at `dashboard/` with its own `package.json` — never merge into the root project's `package.json` or `tsconfig.json`.
- Deploy target: Vercel, Root Directory = `dashboard/`.
- All Supabase access happens in Server Components / server-side modules only, using `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` env vars (no `NEXT_PUBLIC_` prefix — must never reach the browser bundle).
- Routes: `/`, `/tai-chinh`, `/giai-tri`, `/du-lich`.
- DB category values are snake_case: `tai_chinh`, `giai_tri`, `du_lich` (must match `config/sources.config.ts` in the root project).
- Recent articles: latest 20 per page.
- Trending score = `growth_rate × 100`, displayed as-is — no new backend computation.
- Share of voice formula: `metric_value(keyword) / Σ metric_value(all candidates, same source + same category + same date) × 100`, denominator over **all evaluated candidates for that date**, not just the shortlisted ones. Multi-category keywords count at full weight in each category they belong to. Computed at render time, never written back to Supabase.
- No authentication — public.
- Per-section error/empty states — one section failing to load must never crash the whole page.
- Testing: Vitest for pure data-shaping functions only (grouping, filtering, share-of-voice math). No E2E. Per project convention, Supabase-backed reader classes are not unit-tested directly (verified by an actual deploy, same as the root project's repositories) — only the pure functions and the orchestration functions (tested via fakes) get tests.
- Out of scope: sentiment, historical/time-series charts, topic-detail pages, Apify 2b integration.

---

## Task 1: Scaffold the Next.js + Tailwind + Vitest project

**Files:**
- Create: `dashboard/package.json`
- Create: `dashboard/tsconfig.json`
- Create: `dashboard/next.config.mjs`
- Create: `dashboard/postcss.config.mjs`
- Create: `dashboard/next-env.d.ts`
- Create: `dashboard/vitest.config.ts`
- Create: `dashboard/.gitignore`
- Create: `dashboard/.env.example`
- Create: `dashboard/app/globals.css`
- Create: `dashboard/app/layout.tsx`
- Create: `dashboard/app/page.tsx` (temporary placeholder, replaced in Task 8)

**Interfaces:**
- Produces: a working Next.js dev/build/test toolchain that every later task builds on. No app-specific interfaces yet.

This task is pure scaffolding — no application logic, so there is no RED/GREEN test cycle. Verification is "the toolchain runs cleanly."

- [ ] **Step 1: Create `dashboard/package.json`**

```json
{
  "name": "social-listening-dashboard",
  "version": "0.1.0",
  "private": true,
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "@supabase/supabase-js": "^2.45.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^5.5.0",
    "tailwindcss": "^4.0.0",
    "@tailwindcss/postcss": "^4.0.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `dashboard/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create `dashboard/next.config.mjs`**

```js
/** @type {import('next').NextConfig} */
const nextConfig = {};

export default nextConfig;
```

- [ ] **Step 4: Create `dashboard/postcss.config.mjs`**

```js
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
```

- [ ] **Step 5: Create `dashboard/next-env.d.ts`**

```ts
/// <reference types="next" />
/// <reference types="next/image-types/global" />

// NOTE: This file should not be edited
// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.
```

- [ ] **Step 6: Create `dashboard/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
  },
});
```

- [ ] **Step 7: Create `dashboard/.gitignore`**

```
node_modules/
.next/
.env
.env.local
```

- [ ] **Step 8: Create `dashboard/.env.example`**

```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

- [ ] **Step 9: Create `dashboard/app/globals.css`**

```css
@import "tailwindcss";
```

- [ ] **Step 10: Create `dashboard/app/layout.tsx`**

```tsx
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Social Listening Dashboard',
  description: 'Topic đang hot và bài báo gần đây theo tài chính, giải trí, du lịch',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body className="bg-white text-gray-900">{children}</body>
    </html>
  );
}
```

- [ ] **Step 11: Create a temporary placeholder `dashboard/app/page.tsx`**

This gets replaced by the real Overview page in Task 8 — its only job here is letting `next build` succeed.

```tsx
export default function Placeholder() {
  return <main className="p-6">Dashboard scaffold OK.</main>;
}
```

- [ ] **Step 12: Install dependencies and verify the build**

Run, from `dashboard/`:
```bash
npm install
npm run build
npm run test
```
Expected: `npm run build` completes with no errors; `npm run test` runs with 0 test files found (no failure — Vitest exits 0 when no tests exist yet).

- [ ] **Step 13: Commit**

```bash
git add dashboard/
git commit -m "chore(dashboard): scaffold Next.js + Tailwind + Vitest project"
```

---

## Task 2: Server-only Supabase client factory

**Files:**
- Create: `dashboard/lib/supabase.ts`
- Test: `dashboard/tests/supabase.test.ts`

**Interfaces:**
- Produces: `createServerSupabaseClient(): SupabaseClient` — every later Supabase-backed reader (Task 6) calls this to obtain a client. Throws if `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` is unset.

- [ ] **Step 1: Write the failing tests**

```ts
// dashboard/tests/supabase.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { createServerSupabaseClient } from '../lib/supabase';

describe('createServerSupabaseClient', () => {
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  });

  it('throws when SUPABASE_URL is missing', () => {
    delete process.env.SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    expect(() => createServerSupabaseClient()).toThrow(/SUPABASE_URL/);
  });

  it('throws when SUPABASE_SERVICE_ROLE_KEY is missing', () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => createServerSupabaseClient()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('returns a Supabase client when both env vars are present', () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    const client = createServerSupabaseClient();
    expect(client.from).toBeTypeOf('function');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- supabase.test.ts` (from `dashboard/`)
Expected: FAIL — `Cannot find module '../lib/supabase'` (the file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```ts
// dashboard/lib/supabase.ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Server-only: this must never be imported from a Client Component, and the
// key it reads (SUPABASE_SERVICE_ROLE_KEY) must never carry a NEXT_PUBLIC_
// prefix — that would bundle it into client-side JS. It bypasses RLS, which
// is required today because `articles` and `candidate_topics` both have RLS
// enabled with zero policies defined (see the root project's migrations
// 0001 and 0003) — the anon key cannot read either table right now.
export function createServerSupabaseClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) {
    throw new Error('Missing SUPABASE_URL environment variable.');
  }
  if (!key) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY environment variable.');
  }
  return createClient(url, key, {
    auth: { persistSession: false },
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- supabase.test.ts`
Expected: PASS, 3/3.

- [ ] **Step 5: Commit**

```bash
git add dashboard/lib/supabase.ts dashboard/tests/supabase.test.ts
git commit -m "feat(dashboard): add server-only Supabase client factory"
```

---

## Task 3: Category definitions

**Files:**
- Create: `dashboard/lib/categories.ts`
- Test: `dashboard/tests/categories.test.ts`

**Interfaces:**
- Produces: `CategoryDef { slug, value, label, color }`, `CATEGORIES: CategoryDef[]`, `getCategoryBySlug(slug: string): CategoryDef | undefined` — used by Task 7's page-data functions and Task 8's routing/nav.

- [ ] **Step 1: Write the failing tests**

```ts
// dashboard/tests/categories.test.ts
import { describe, it, expect } from 'vitest';
import { CATEGORIES, getCategoryBySlug } from '../lib/categories';

describe('CATEGORIES', () => {
  it('has exactly the 3 sectors with their DB category values', () => {
    expect(CATEGORIES).toEqual([
      { slug: 'tai-chinh', value: 'tai_chinh', label: 'Tài chính', color: '#16a34a' },
      { slug: 'giai-tri', value: 'giai_tri', label: 'Giải trí', color: '#af006e' },
      { slug: 'du-lich', value: 'du_lich', label: 'Du lịch', color: '#3b82f6' },
    ]);
  });
});

describe('getCategoryBySlug', () => {
  it('returns the matching category for a known slug', () => {
    expect(getCategoryBySlug('tai-chinh')?.value).toBe('tai_chinh');
  });

  it('returns undefined for an unknown slug', () => {
    expect(getCategoryBySlug('not-a-real-slug')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- categories.test.ts`
Expected: FAIL — `Cannot find module '../lib/categories'`.

- [ ] **Step 3: Write the implementation**

```ts
// dashboard/lib/categories.ts

// DB values are snake_case and must match config/sources.config.ts in the
// root ingestion project — that's what tags candidate_topics.category_hint
// and articles.categories.
export interface CategoryDef {
  slug: string;
  value: 'tai_chinh' | 'giai_tri' | 'du_lich';
  label: string;
  color: string;
}

export const CATEGORIES: CategoryDef[] = [
  { slug: 'tai-chinh', value: 'tai_chinh', label: 'Tài chính', color: '#16a34a' },
  { slug: 'giai-tri', value: 'giai_tri', label: 'Giải trí', color: '#af006e' },
  { slug: 'du-lich', value: 'du_lich', label: 'Du lịch', color: '#3b82f6' },
];

export function getCategoryBySlug(slug: string): CategoryDef | undefined {
  return CATEGORIES.find((c) => c.slug === slug);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- categories.test.ts`
Expected: PASS, 3/3.

- [ ] **Step 5: Commit**

```bash
git add dashboard/lib/categories.ts dashboard/tests/categories.test.ts
git commit -m "feat(dashboard): add category definitions"
```

---

## Task 4: Shared types

**Files:**
- Create: `dashboard/lib/types.ts`

**Interfaces:**
- Produces: `CandidateTopic`, `Article` — the shapes every later task (5, 6, 7, 8, 9) imports.

Type-only file, no runtime behavior — verified by `tsc`, not Vitest.

- [ ] **Step 1: Write the types**

```ts
// dashboard/lib/types.ts
// Mirrors the shapes of the root ingestion project's src/types.ts, trimmed
// to the fields this dashboard actually reads.

export type DiscoverySourceName = 'google_trends' | 'youtube' | 'rss';

export interface CandidateTopic {
  id: string;
  source: DiscoverySourceName;
  keyword: string;
  date: string;
  metric_value: number;
  growth_rate: number | null;
  category_hint: string[];
  is_shortlisted: boolean;
}

export interface Article {
  id: string;
  url: string;
  title: string;
  published_at: string | null;
  source_id: string;
  categories: string[];
  snippet: string;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck` (from `dashboard/`)
Expected: no errors (this file has no consumers yet, so it just needs to parse cleanly).

- [ ] **Step 3: Commit**

```bash
git add dashboard/lib/types.ts
git commit -m "feat(dashboard): add shared CandidateTopic/Article types"
```

---

## Task 5: Hot-topics pure logic (grouping, trending score, share of voice)

**Files:**
- Create: `dashboard/lib/hot-topics.ts`
- Test: `dashboard/tests/hot-topics.test.ts`

**Interfaces:**
- Consumes: `CandidateTopic` from `dashboard/lib/types.ts` (Task 4).
- Produces: `HotTopicRow`, `filterByCategory`, `computeTrendingScore`, `computeShareOfVoice`, `groupBySource`, `buildHotTopicsForCategory`, `buildHotTopicsOverview` — Task 7's `getHotTopics` orchestration function calls `buildHotTopicsForCategory`/`buildHotTopicsOverview` directly.

- [ ] **Step 1: Write the failing tests**

```ts
// dashboard/tests/hot-topics.test.ts
import { describe, it, expect } from 'vitest';
import {
  filterByCategory,
  computeTrendingScore,
  computeShareOfVoice,
  groupBySource,
  buildHotTopicsForCategory,
  buildHotTopicsOverview,
} from '../lib/hot-topics';
import type { CandidateTopic } from '../lib/types';

function candidate(overrides: Partial<CandidateTopic> = {}): CandidateTopic {
  return {
    id: 'id-1',
    source: 'rss',
    keyword: 'bitcoin',
    date: '2026-08-21',
    metric_value: 10,
    growth_rate: 0.5,
    category_hint: ['tai_chinh'],
    is_shortlisted: true,
    ...overrides,
  };
}

describe('filterByCategory', () => {
  it('keeps only candidates whose category_hint includes the given category', () => {
    const a = candidate({ id: 'a', category_hint: ['tai_chinh'] });
    const b = candidate({ id: 'b', category_hint: ['giai_tri'] });
    expect(filterByCategory([a, b], 'tai_chinh')).toEqual([a]);
  });

  it('keeps a candidate tagged with multiple categories if any of them match', () => {
    const a = candidate({ id: 'a', category_hint: ['tai_chinh', 'giai_tri'] });
    expect(filterByCategory([a], 'giai_tri')).toEqual([a]);
  });
});

describe('computeTrendingScore', () => {
  it('converts growth_rate to a percentage', () => {
    expect(computeTrendingScore(candidate({ growth_rate: 0.5 }))).toBe(50);
  });

  it('returns null when growth_rate is null', () => {
    expect(computeTrendingScore(candidate({ growth_rate: null }))).toBeNull();
  });
});

describe('computeShareOfVoice', () => {
  it('splits 100% across candidates of the same source proportionally to metric_value', () => {
    const a = candidate({ id: 'a', source: 'rss', metric_value: 30 });
    const b = candidate({ id: 'b', source: 'rss', metric_value: 70 });
    const result = computeShareOfVoice([a, b]);
    expect(result.get('a')).toBe(30);
    expect(result.get('b')).toBe(70);
  });

  it('computes totals separately per source', () => {
    const a = candidate({ id: 'a', source: 'rss', metric_value: 50 });
    const b = candidate({ id: 'b', source: 'youtube', metric_value: 50 });
    const result = computeShareOfVoice([a, b]);
    // each is 100% of its own source's total, since it's the only entry
    expect(result.get('a')).toBe(100);
    expect(result.get('b')).toBe(100);
  });

  it('returns 0 for a source whose total metric_value is 0', () => {
    const a = candidate({ id: 'a', source: 'rss', metric_value: 0 });
    expect(computeShareOfVoice([a]).get('a')).toBe(0);
  });
});

describe('groupBySource', () => {
  it('groups rows by source and sorts each group by trendingScore descending', () => {
    const rows = [
      { id: 'a', source: 'rss' as const, keyword: 'a', metricValue: 1, trendingScore: 10, shareOfVoice: 5 },
      { id: 'b', source: 'rss' as const, keyword: 'b', metricValue: 1, trendingScore: 90, shareOfVoice: 5 },
      { id: 'c', source: 'youtube' as const, keyword: 'c', metricValue: 1, trendingScore: 40, shareOfVoice: 5 },
    ];
    const grouped = groupBySource(rows);
    expect(grouped.rss.map((r) => r.id)).toEqual(['b', 'a']);
    expect(grouped.youtube.map((r) => r.id)).toEqual(['c']);
    expect(grouped.google_trends).toEqual([]);
  });
});

describe('buildHotTopicsForCategory', () => {
  it('computes share of voice against ALL candidates in the category, but only returns shortlisted rows', () => {
    const shortlisted = candidate({ id: 'shortlisted', metric_value: 20, is_shortlisted: true, category_hint: ['tai_chinh'] });
    const notShortlisted = candidate({ id: 'not-shortlisted', metric_value: 80, is_shortlisted: false, category_hint: ['tai_chinh'] });
    const otherCategory = candidate({ id: 'other', metric_value: 999, is_shortlisted: true, category_hint: ['giai_tri'] });

    const result = buildHotTopicsForCategory([shortlisted, notShortlisted, otherCategory], 'tai_chinh');

    expect(result.rss).toHaveLength(1);
    expect(result.rss[0].id).toBe('shortlisted');
    // 20 / (20 + 80) * 100 = 20, even though the 80-weight row never appears
    expect(result.rss[0].shareOfVoice).toBe(20);
  });
});

describe('buildHotTopicsOverview', () => {
  it('includes shortlisted candidates from every category', () => {
    const a = candidate({ id: 'a', category_hint: ['tai_chinh'], is_shortlisted: true });
    const b = candidate({ id: 'b', category_hint: ['giai_tri'], is_shortlisted: true });
    const result = buildHotTopicsOverview([a, b], ['tai_chinh', 'giai_tri', 'du_lich']);
    expect(result.rss.map((r) => r.id).sort()).toEqual(['a', 'b']);
  });

  it('averages share of voice across a candidate\'s multiple categories', () => {
    const multi = candidate({ id: 'multi', metric_value: 50, category_hint: ['tai_chinh', 'giai_tri'], is_shortlisted: true });
    // alone in tai_chinh -> 100% share; alone in giai_tri -> 100% share; average = 100
    const result = buildHotTopicsOverview([multi], ['tai_chinh', 'giai_tri', 'du_lich']);
    expect(result.rss[0].shareOfVoice).toBe(100);
  });

  it('returns null share of voice for a candidate with no category_hint', () => {
    const uncategorized = candidate({ id: 'u', category_hint: [], is_shortlisted: true });
    const result = buildHotTopicsOverview([uncategorized], ['tai_chinh', 'giai_tri', 'du_lich']);
    expect(result.rss[0].shareOfVoice).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- hot-topics.test.ts`
Expected: FAIL — `Cannot find module '../lib/hot-topics'`.

- [ ] **Step 3: Write the implementation**

```ts
// dashboard/lib/hot-topics.ts
import type { CandidateTopic } from './types';

export interface HotTopicRow {
  id: string;
  source: CandidateTopic['source'];
  keyword: string;
  metricValue: number;
  trendingScore: number | null;
  shareOfVoice: number | null;
}

export function filterByCategory(candidates: CandidateTopic[], category: string): CandidateTopic[] {
  return candidates.filter((c) => c.category_hint.includes(category));
}

export function computeTrendingScore(candidate: CandidateTopic): number | null {
  return candidate.growth_rate === null ? null : candidate.growth_rate * 100;
}

// Share of voice within one source, scoped to whatever set of candidates is
// passed in. The caller is responsible for having already filtered that set
// to one category — the denominator here is the sum of metric_value across
// every candidate sharing a source in the input, not just the shortlisted
// ones (per the design spec's share-of-voice formula).
export function computeShareOfVoice(candidates: CandidateTopic[]): Map<string, number> {
  const totalsBySource = new Map<string, number>();
  for (const c of candidates) {
    totalsBySource.set(c.source, (totalsBySource.get(c.source) ?? 0) + c.metric_value);
  }
  const result = new Map<string, number>();
  for (const c of candidates) {
    const total = totalsBySource.get(c.source) ?? 0;
    result.set(c.id, total === 0 ? 0 : (c.metric_value / total) * 100);
  }
  return result;
}

export function groupBySource(rows: HotTopicRow[]): Record<CandidateTopic['source'], HotTopicRow[]> {
  const grouped: Record<CandidateTopic['source'], HotTopicRow[]> = {
    google_trends: [],
    youtube: [],
    rss: [],
  };
  for (const row of rows) {
    grouped[row.source].push(row);
  }
  for (const source of Object.keys(grouped) as CandidateTopic['source'][]) {
    grouped[source].sort((a, b) => (b.trendingScore ?? 0) - (a.trendingScore ?? 0));
  }
  return grouped;
}

// Hot Topics section for one sector page: `allCandidates` is every
// candidate_topics row for the latest date (all sources, all categories,
// shortlisted or not). Filters to one category, computes share of voice
// against the FULL total for that category (not just the shortlisted rows),
// then keeps only the shortlisted rows for display.
export function buildHotTopicsForCategory(
  allCandidates: CandidateTopic[],
  category: string
): Record<CandidateTopic['source'], HotTopicRow[]> {
  const inCategory = filterByCategory(allCandidates, category);
  const shareMap = computeShareOfVoice(inCategory);
  const shortlisted = inCategory.filter((c) => c.is_shortlisted);
  const rows: HotTopicRow[] = shortlisted.map((c) => ({
    id: c.id,
    source: c.source,
    keyword: c.keyword,
    metricValue: c.metric_value,
    trendingScore: computeTrendingScore(c),
    shareOfVoice: shareMap.get(c.id) ?? null,
  }));
  return groupBySource(rows);
}

// Hot Topics section for the Overview page: every shortlisted candidate
// regardless of category. Share of voice is the average of the candidate's
// per-category value across every category it belongs to (each computed
// against that category's full total, identical to what
// buildHotTopicsForCategory would show on that category's own page). A
// candidate with an empty category_hint has no category-scoped total to
// divide into, so its share of voice is null (rendered as "—").
export function buildHotTopicsOverview(
  allCandidates: CandidateTopic[],
  categories: string[]
): Record<CandidateTopic['source'], HotTopicRow[]> {
  const shareMapsByCategory = new Map<string, Map<string, number>>();
  for (const category of categories) {
    shareMapsByCategory.set(category, computeShareOfVoice(filterByCategory(allCandidates, category)));
  }

  const shortlisted = allCandidates.filter((c) => c.is_shortlisted);
  const rows: HotTopicRow[] = shortlisted.map((c) => {
    const values = c.category_hint
      .map((cat) => shareMapsByCategory.get(cat)?.get(c.id))
      .filter((v): v is number => v !== undefined);
    const shareOfVoice = values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
    return {
      id: c.id,
      source: c.source,
      keyword: c.keyword,
      metricValue: c.metric_value,
      trendingScore: computeTrendingScore(c),
      shareOfVoice,
    };
  });
  return groupBySource(rows);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- hot-topics.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add dashboard/lib/hot-topics.ts dashboard/tests/hot-topics.test.ts
git commit -m "feat(dashboard): add hot-topics grouping/trending-score/share-of-voice logic"
```

---

## Task 6: Supabase-backed readers + fake

**Files:**
- Create: `dashboard/lib/candidate-topics-reader.ts`
- Create: `dashboard/lib/articles-reader.ts`
- Create: `dashboard/tests/fakes/fake-candidate-topics-reader.ts`

**Interfaces:**
- Consumes: `CandidateTopic`, `Article` (Task 4).
- Produces: `CandidateTopicsReader` interface (`getLatestDate`, `getCandidatesForDate`), `SupabaseCandidateTopicsReader`, `FakeCandidateTopicsReader`; `ArticlesReader` interface (`getRecentArticles`), `SupabaseArticlesReader`. Task 7's `getHotTopics` consumes `CandidateTopicsReader`/`FakeCandidateTopicsReader`. Task 8's pages consume both Supabase-backed classes directly.

Following the root project's convention: Supabase-backed classes are not unit-tested directly (they're verified by an actual deploy, the same way `SupabaseCandidateTopicRepository` in the root project is) — only `FakeCandidateTopicsReader` exists here, to support Task 7's orchestration tests. `ArticlesReader` has no fake: its only implementation pushes category filtering into the Supabase query itself (`.contains()`), so there's no in-memory logic worth a test double — the pages in Task 8 use `SupabaseArticlesReader` directly. This task has no RED/GREEN cycle of its own; verify with `typecheck`.

- [ ] **Step 1: Create `dashboard/lib/candidate-topics-reader.ts`**

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CandidateTopic } from './types';

export interface CandidateTopicsReader {
  // Most recent date (YYYY-MM-DD) with any candidate_topics rows, or null if
  // the table is empty (e.g. before the discovery layer's first run).
  getLatestDate(): Promise<string | null>;
  // Every candidate_topics row for the given date — NOT filtered by category
  // or is_shortlisted. Callers need the full set to compute correct
  // share-of-voice denominators (see lib/hot-topics.ts).
  getCandidatesForDate(date: string): Promise<CandidateTopic[]>;
}

export class SupabaseCandidateTopicsReader implements CandidateTopicsReader {
  constructor(private client: SupabaseClient) {}

  async getLatestDate(): Promise<string | null> {
    const { data, error } = await this.client
      .from('candidate_topics')
      .select('date')
      .order('date', { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);
    return data && data.length > 0 ? (data[0].date as string) : null;
  }

  async getCandidatesForDate(date: string): Promise<CandidateTopic[]> {
    const { data, error } = await this.client
      .from('candidate_topics')
      .select('id, source, keyword, date, metric_value, growth_rate, category_hint, is_shortlisted')
      .eq('date', date)
      .order('metric_value', { ascending: false })
      .limit(5000);
    if (error) throw new Error(error.message);
    return (data ?? []) as CandidateTopic[];
  }
}
```

- [ ] **Step 2: Create `dashboard/lib/articles-reader.ts`**

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Article } from './types';

export interface ArticlesReader {
  getRecentArticles(limit: number, category: string | null): Promise<Article[]>;
}

export class SupabaseArticlesReader implements ArticlesReader {
  constructor(private client: SupabaseClient) {}

  async getRecentArticles(limit: number, category: string | null): Promise<Article[]> {
    let query = this.client
      .from('articles')
      .select('id, url, title, published_at, source_id, categories, snippet')
      .order('published_at', { ascending: false })
      .limit(limit);
    if (category) {
      query = query.contains('categories', [category]);
    }
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data ?? []) as Article[];
  }
}
```

- [ ] **Step 3: Create `dashboard/tests/fakes/fake-candidate-topics-reader.ts`**

```ts
import type { CandidateTopicsReader } from '../../lib/candidate-topics-reader';
import type { CandidateTopic } from '../../lib/types';

export class FakeCandidateTopicsReader implements CandidateTopicsReader {
  constructor(private candidates: CandidateTopic[] = []) {}

  async getLatestDate(): Promise<string | null> {
    if (this.candidates.length === 0) return null;
    return [...this.candidates.map((c) => c.date)].sort().at(-1)!;
  }

  async getCandidatesForDate(date: string): Promise<CandidateTopic[]> {
    return this.candidates.filter((c) => c.date === date);
  }
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck` (from `dashboard/`)
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add dashboard/lib/candidate-topics-reader.ts dashboard/lib/articles-reader.ts dashboard/tests/fakes/
git commit -m "feat(dashboard): add Supabase-backed readers and their fake"
```

---

## Task 7: Hot-topics page-data orchestration

**Files:**
- Create: `dashboard/lib/get-hot-topics.ts`
- Test: `dashboard/tests/get-hot-topics.test.ts`

**Interfaces:**
- Consumes: `CandidateTopicsReader` (Task 6), `buildHotTopicsForCategory`/`buildHotTopicsOverview`/`HotTopicRow` (Task 5), `CATEGORIES` (Task 3), `CandidateTopic` (Task 4).
- Produces: `HotTopicsResult { date: string | null; bySource: Record<CandidateTopic['source'], HotTopicRow[]> }`, `getHotTopics(reader, category: string | null): Promise<HotTopicsResult>` — Task 8's pages call this directly.

- [ ] **Step 1: Write the failing tests**

```ts
// dashboard/tests/get-hot-topics.test.ts
import { describe, it, expect } from 'vitest';
import { getHotTopics } from '../lib/get-hot-topics';
import { FakeCandidateTopicsReader } from './fakes/fake-candidate-topics-reader';
import type { CandidateTopic } from '../lib/types';

function candidate(overrides: Partial<CandidateTopic> = {}): CandidateTopic {
  return {
    id: 'id-1',
    source: 'rss',
    keyword: 'bitcoin',
    date: '2026-08-21',
    metric_value: 10,
    growth_rate: 0.5,
    category_hint: ['tai_chinh'],
    is_shortlisted: true,
    ...overrides,
  };
}

describe('getHotTopics', () => {
  it('returns a null date and empty groups when the reader has no data', async () => {
    const reader = new FakeCandidateTopicsReader([]);
    const result = await getHotTopics(reader, 'tai_chinh');
    expect(result.date).toBeNull();
    expect(result.bySource).toEqual({ google_trends: [], youtube: [], rss: [] });
  });

  it('filters to one category when a category is given', async () => {
    const inCat = candidate({ id: 'in', category_hint: ['tai_chinh'] });
    const outOfCat = candidate({ id: 'out', category_hint: ['giai_tri'] });
    const reader = new FakeCandidateTopicsReader([inCat, outOfCat]);
    const result = await getHotTopics(reader, 'tai_chinh');
    expect(result.date).toBe('2026-08-21');
    expect(result.bySource.rss.map((r) => r.id)).toEqual(['in']);
  });

  it('returns candidates from every category when category is null (Overview)', async () => {
    const a = candidate({ id: 'a', category_hint: ['tai_chinh'] });
    const b = candidate({ id: 'b', category_hint: ['giai_tri'] });
    const reader = new FakeCandidateTopicsReader([a, b]);
    const result = await getHotTopics(reader, null);
    expect(result.bySource.rss.map((r) => r.id).sort()).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- get-hot-topics.test.ts`
Expected: FAIL — `Cannot find module '../lib/get-hot-topics'`.

- [ ] **Step 3: Write the implementation**

```ts
// dashboard/lib/get-hot-topics.ts
import type { CandidateTopicsReader } from './candidate-topics-reader';
import { buildHotTopicsForCategory, buildHotTopicsOverview, type HotTopicRow } from './hot-topics';
import { CATEGORIES } from './categories';
import type { CandidateTopic } from './types';

export interface HotTopicsResult {
  date: string | null;
  bySource: Record<CandidateTopic['source'], HotTopicRow[]>;
}

const EMPTY_BY_SOURCE: Record<CandidateTopic['source'], HotTopicRow[]> = {
  google_trends: [],
  youtube: [],
  rss: [],
};

export async function getHotTopics(
  reader: CandidateTopicsReader,
  category: string | null
): Promise<HotTopicsResult> {
  const date = await reader.getLatestDate();
  if (date === null) {
    return { date: null, bySource: EMPTY_BY_SOURCE };
  }
  const allCandidates = await reader.getCandidatesForDate(date);
  const bySource = category
    ? buildHotTopicsForCategory(allCandidates, category)
    : buildHotTopicsOverview(allCandidates, CATEGORIES.map((c) => c.value));
  return { date, bySource };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- get-hot-topics.test.ts`
Expected: PASS, 3/3.

- [ ] **Step 5: Commit**

```bash
git add dashboard/lib/get-hot-topics.ts dashboard/tests/get-hot-topics.test.ts
git commit -m "feat(dashboard): add hot-topics page-data orchestration"
```

---

## Task 8: Components and pages

**Files:**
- Create: `dashboard/components/HotTopicsSection.tsx`
- Create: `dashboard/components/ArticlesSection.tsx`
- Create: `dashboard/components/CategoryNav.tsx`
- Modify: `dashboard/app/page.tsx` (replace Task 1's placeholder)
- Create: `dashboard/app/[slug]/page.tsx`

**Interfaces:**
- Consumes: `HotTopicRow`, `getHotTopics`/`HotTopicsResult` (Task 7), `CandidateTopicsReader`/`SupabaseCandidateTopicsReader` (Task 6), `ArticlesReader`/`SupabaseArticlesReader` (Task 6), `createServerSupabaseClient` (Task 2), `CATEGORIES`/`getCategoryBySlug` (Task 3), `Article`/`CandidateTopic` (Task 4).

Per the spec's testing section, UI/pages are not unit-tested — verification is `npm run build` succeeding and a manual dev-server check. No RED/GREEN cycle in this task.

- [ ] **Step 1: Create `dashboard/components/HotTopicsSection.tsx`**

```tsx
import type { HotTopicRow } from '../lib/hot-topics';
import type { CandidateTopic } from '../lib/types';

const SOURCE_LABELS: Record<CandidateTopic['source'], string> = {
  google_trends: 'Google Trends',
  youtube: 'YouTube',
  rss: 'RSS',
};

function formatPercent(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}%`;
}

export function HotTopicsSection({
  date,
  bySource,
}: {
  date: string | null;
  bySource: Record<CandidateTopic['source'], HotTopicRow[]>;
}) {
  if (date === null) {
    return (
      <section>
        <h2 className="text-xl font-semibold mb-2">Topic đang hot</h2>
        <p className="text-gray-500">Chưa có dữ liệu — chờ lần chạy discovery layer tiếp theo.</p>
      </section>
    );
  }

  const sources = Object.keys(bySource) as CandidateTopic['source'][];
  const hasAny = sources.some((s) => bySource[s].length > 0);

  return (
    <section>
      <h2 className="text-xl font-semibold mb-2">Topic đang hot ({date})</h2>
      {!hasAny && <p className="text-gray-500">Không có topic nào được shortlist hôm nay.</p>}
      <div className="grid gap-6 md:grid-cols-3">
        {sources.map((source) => (
          <div key={source}>
            <h3 className="font-medium mb-1">{SOURCE_LABELS[source]}</h3>
            <ul className="space-y-1">
              {bySource[source].map((row) => (
                <li key={row.id} className="text-sm flex justify-between gap-2">
                  <span>{row.keyword}</span>
                  <span className="text-gray-500 whitespace-nowrap">
                    {formatPercent(row.trendingScore)} · {formatPercent(row.shareOfVoice)}
                  </span>
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

- [ ] **Step 2: Create `dashboard/components/ArticlesSection.tsx`**

```tsx
import type { Article } from '../lib/types';

export function ArticlesSection({ articles }: { articles: Article[] }) {
  if (articles.length === 0) {
    return (
      <section>
        <h2 className="text-xl font-semibold mb-2">Bài báo gần đây</h2>
        <p className="text-gray-500">Chưa có bài báo nào.</p>
      </section>
    );
  }
  return (
    <section>
      <h2 className="text-xl font-semibold mb-2">Bài báo gần đây</h2>
      <ul className="space-y-2">
        {articles.map((a) => (
          <li key={a.id}>
            <a href={a.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
              {a.title}
            </a>
            {a.published_at && (
              <span className="text-gray-400 text-sm ml-2">
                {new Date(a.published_at).toLocaleDateString('vi-VN')}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 3: Create `dashboard/components/CategoryNav.tsx`**

```tsx
import Link from 'next/link';
import { CATEGORIES } from '../lib/categories';

export function CategoryNav() {
  return (
    <nav className="flex gap-4 mb-6">
      <Link href="/" className="font-medium hover:underline">
        Overview
      </Link>
      {CATEGORIES.map((c) => (
        <Link key={c.slug} href={`/${c.slug}`} style={{ color: c.color }} className="font-medium hover:underline">
          {c.label}
        </Link>
      ))}
    </nav>
  );
}
```

- [ ] **Step 4: Replace `dashboard/app/page.tsx` with the real Overview page**

```tsx
import { createServerSupabaseClient } from '../lib/supabase';
import { SupabaseCandidateTopicsReader } from '../lib/candidate-topics-reader';
import { SupabaseArticlesReader } from '../lib/articles-reader';
import { getHotTopics, type HotTopicsResult } from '../lib/get-hot-topics';
import { HotTopicsSection } from '../components/HotTopicsSection';
import { ArticlesSection } from '../components/ArticlesSection';
import { CategoryNav } from '../components/CategoryNav';
import type { Article } from '../lib/types';

export const dynamic = 'force-dynamic';

async function loadHotTopics(): Promise<HotTopicsResult | { error: string }> {
  try {
    const client = createServerSupabaseClient();
    return await getHotTopics(new SupabaseCandidateTopicsReader(client), null);
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

async function loadArticles(): Promise<Article[] | { error: string }> {
  try {
    const client = createServerSupabaseClient();
    return await new SupabaseArticlesReader(client).getRecentArticles(20, null);
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

export default async function OverviewPage() {
  const [hotTopics, articles] = await Promise.all([loadHotTopics(), loadArticles()]);

  return (
    <main className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">Social Listening — Overview</h1>
      <CategoryNav />
      {'error' in hotTopics ? (
        <p className="text-red-600">Không tải được dữ liệu topic: {hotTopics.error}</p>
      ) : (
        <HotTopicsSection date={hotTopics.date} bySource={hotTopics.bySource} />
      )}
      <div className="mt-8">
        {'error' in articles ? (
          <p className="text-red-600">Không tải được bài báo: {articles.error}</p>
        ) : (
          <ArticlesSection articles={articles} />
        )}
      </div>
    </main>
  );
}
```

- [ ] **Step 5: Create `dashboard/app/[slug]/page.tsx`**

One dynamic route serves all 3 sector pages (`/tai-chinh`, `/giai-tri`, `/du-lich`) — `generateStaticParams` enumerates the 3 valid slugs, `notFound()` handles anything else.

```tsx
import { notFound } from 'next/navigation';
import { createServerSupabaseClient } from '../../lib/supabase';
import { SupabaseCandidateTopicsReader } from '../../lib/candidate-topics-reader';
import { SupabaseArticlesReader } from '../../lib/articles-reader';
import { getHotTopics, type HotTopicsResult } from '../../lib/get-hot-topics';
import { getCategoryBySlug, CATEGORIES } from '../../lib/categories';
import { HotTopicsSection } from '../../components/HotTopicsSection';
import { ArticlesSection } from '../../components/ArticlesSection';
import { CategoryNav } from '../../components/CategoryNav';
import type { Article } from '../../lib/types';

export const dynamic = 'force-dynamic';

export function generateStaticParams() {
  return CATEGORIES.map((c) => ({ slug: c.slug }));
}

async function loadHotTopics(category: string): Promise<HotTopicsResult | { error: string }> {
  try {
    const client = createServerSupabaseClient();
    return await getHotTopics(new SupabaseCandidateTopicsReader(client), category);
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

async function loadArticles(category: string): Promise<Article[] | { error: string }> {
  try {
    const client = createServerSupabaseClient();
    return await new SupabaseArticlesReader(client).getRecentArticles(20, category);
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' };
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

  return (
    <main className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4" style={{ color: categoryDef.color }}>
        {categoryDef.label}
      </h1>
      <CategoryNav />
      {'error' in hotTopics ? (
        <p className="text-red-600">Không tải được dữ liệu topic: {hotTopics.error}</p>
      ) : (
        <HotTopicsSection date={hotTopics.date} bySource={hotTopics.bySource} />
      )}
      <div className="mt-8">
        {'error' in articles ? (
          <p className="text-red-600">Không tải được bài báo: {articles.error}</p>
        ) : (
          <ArticlesSection articles={articles} />
        )}
      </div>
    </main>
  );
}
```

- [ ] **Step 6: Build and smoke-test**

Run, from `dashboard/`:
```bash
npm run build
npm run test
npm run typecheck
```
Expected: all three succeed.

Then, optionally, run `npm run dev` and open `http://localhost:3000` and `http://localhost:3000/tai-chinh` in a browser. **Without `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` set locally, both page sections will show their red error state ("Không tải được dữ liệu topic: Missing SUPABASE_URL environment variable.") — this is the per-section error handling working as designed, not a bug.** To see real data, copy `.env.example` to `.env.local` and fill in the project's Supabase URL and service-role key (from the Supabase dashboard → Project Settings → API).

- [ ] **Step 7: Commit**

```bash
git add dashboard/components/ dashboard/app/
git commit -m "feat(dashboard): add Overview and sector pages"
```

---

## Task 9: Deployment docs

**Files:**
- Create: `dashboard/README.md`

**Interfaces:** None — documentation only.

- [ ] **Step 1: Write `dashboard/README.md`**

```markdown
# Social Listening Dashboard

Read-only Next.js dashboard for the social listening tool. Shows today's hot topics (from the discovery layer, sub-project 2a) and recent RSS articles (sub-project 1), split into an Overview view and 3 sector views.

Design spec: [`../docs/superpowers/specs/2026-08-21-dashboard-design.md`](../docs/superpowers/specs/2026-08-21-dashboard-design.md)

## Local development

```bash
npm install
cp .env.example .env.local   # fill in SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
npm run dev
```

Get both values from the Supabase project dashboard → Project Settings → API. `SUPABASE_SERVICE_ROLE_KEY` is the **service_role** secret, not the anon/public key — this app relies on it to bypass RLS (both `articles` and `candidate_topics` have RLS enabled with zero policies defined, so the anon key cannot read either table).

## Deployment (Vercel)

1. Import this repository into Vercel.
2. Set **Root Directory** to `dashboard/` in the project's Vercel settings — this is a separate app from the root project's ingestion scripts.
3. Add the two environment variables (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) in Vercel's Project Settings → Environment Variables. **Do not** prefix them with `NEXT_PUBLIC_` — they must stay server-only.
4. Deploy. No build command overrides needed (`next build` / `next start` are Vercel's Next.js defaults).

## Scope

See the design spec for what's in and out of scope. Notably out of scope for this version: sentiment, historical/time-series charts, per-topic detail pages, authentication, and any data from Apify (sub-project 2b, not yet built).
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/README.md
git commit -m "docs(dashboard): add README with local dev and deployment instructions"
```

---

## Done criteria

- `npm run build`, `npm run test`, `npm run typecheck` all pass from `dashboard/`.
- All 4 routes (`/`, `/tai-chinh`, `/giai-tri`, `/du-lich`) render without crashing, with or without Supabase credentials configured.
- Every pure function in `lib/hot-topics.ts` and `lib/articles.ts` has a passing test written before its implementation.
