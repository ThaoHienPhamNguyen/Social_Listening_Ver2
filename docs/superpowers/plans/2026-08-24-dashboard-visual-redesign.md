# Dashboard Visual Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the visual design system (colors, typography, spacing, border-radius, shadow) and Sidebar+Topbar layout shell from a prior version of this project (`C:\Users\user\Social Listening`, "ver1") into `dashboard/`, and restyle the 2 existing sections (`HotTopicsSection`, `ArticlesSection`) to match — pure visual change, no new data, no new dependencies.

**Architecture:** Tailwind v4 `@theme` CSS tokens replace ver1's Tailwind v3 `tailwind.config.ts extend` block (different config mechanism between versions — CSS-first in v4, JS config in v3). New `Sidebar`/`Topbar` components replace the existing horizontal `CategoryNav`. Existing section components keep their exact props/logic, only JSX/className changes.

**Tech Stack:** Next.js 15 (App Router), React 19, Tailwind CSS v4 (`@tailwindcss/postcss`), TypeScript.

**Spec:** `docs/superpowers/specs/2026-08-24-dashboard-visual-redesign-design.md`

## Global Constraints

- Working directory for all tasks: `dashboard/` (the Next.js app), not the repo root.
- **No new npm dependencies** — icons are inline SVG (copied from ver1, no `lucide-react`), font loads via plain `@import url(...)` in CSS (not `next/font`).
- **No dark mode** — only port `:root` (light) tokens, no `[data-theme="dark"]` block, no toggle.
- **No Topbar functional buttons** — no refresh, no date-range picker, no `/help` link, no dark-mode toggle. Topbar shows only a title and the current date.
- **Sidebar nav has exactly 2 sections**: "Tổng quan" (Overview only) and "Lĩnh vực" (the 3 categories from `lib/categories.ts`) — no "Trending Now"/"Analytics" (those pages don't exist in this project).
- **No new Tailwind theme tokens beyond what a task in this plan actually uses** — do not add `success`/`danger`/`line-md` or any color/token not referenced by Sidebar, Topbar, `HotTopicsSection`, or `ArticlesSection`.
- **No component tests** — this codebase only unit-tests pure logic (no `@testing-library/react` installed). Verify each task via `npm run build` (catches TypeScript/JSX/Tailwind CSS errors) plus the existing `npm test`/`npm run typecheck` for regressions. There is no automated visual check — that's expected per the spec.
- Error-message styling (`text-red-600` on load failures in `app/page.tsx`/`app/[slug]/page.tsx`) stays exactly as-is — not part of this redesign's scope.

---

### Task 1: Design tokens in `globals.css`

**Files:**
- Modify: `dashboard/app/globals.css`

**Interfaces:**
- Produces: CSS custom properties (`--color-brand-primary`, `--color-bg-base`, etc.) and Tailwind v4 `@theme` tokens (`--color-brand`, `--color-surface`, `--color-ink`, `--radius-card`, `--shadow-card`, `--spacing-sidebar`, `--spacing-topbar`, etc.) — every later task's Tailwind classes (`bg-surface`, `text-ink`, `rounded-card`, `w-sidebar`, ...) depend on these existing.

No test cycle — this is CSS, verified by `npm run build` succeeding (Tailwind v4 processes `@theme` at build time; invalid syntax fails the build).

- [ ] **Step 1: Replace the file contents**

Current `dashboard/app/globals.css` is just:
```css
@import "tailwindcss";
```

Replace it entirely with:

```css
@import "tailwindcss";

@import url('https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700;800&display=swap');

:root {
  --color-brand-primary:       #af006e;
  --color-brand-primary-hover: #930059;
  --color-brand-primary-light: #fce7f3;
  --color-brand-primary-faint: #fdf2f8;

  --color-bg-base:   #ffffff;
  --color-bg-subtle: #fafafa;
  --color-bg-muted:  #f5f5f5;

  --color-surface-1: #ffffff;
  --color-surface-2: #fafafa;

  --color-border-light: #e8e8e8;
  --color-border-base:  #d0d0d0;

  --color-text-primary:   #111111;
  --color-text-secondary: #5e5e5e;
  --color-text-muted:     #888888;
  --color-text-disabled:  #b0b0b0;
  --color-text-inverse:   #ffffff;
}

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

  --radius-card: 16px;
  --radius-btn: 9999px;

  --shadow-card: 0 1px 3px 0 rgba(0,0,0,.08), 0 1px 2px -1px rgba(0,0,0,.06);
  --shadow-card-hover: 0 4px 6px -1px rgba(0,0,0,.08), 0 2px 4px -2px rgba(0,0,0,.06);

  --spacing-sidebar: 232px;
  --spacing-topbar: 64px;
}

@layer base {
  body {
    background-color: var(--color-bg-subtle);
    color: var(--color-text-primary);
    font-family: 'Be Vietnam Pro', Inter, system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
}
```

- [ ] **Step 2: Verify the build succeeds**

Run (from `dashboard/`): `npm run build`
Expected: exits 0. This is the only verification for this task — there is no separate typecheck step needed here since `next build` runs its own type-check, and there's no logic to unit-test.

- [ ] **Step 3: Commit**

```bash
git add dashboard/app/globals.css
git commit -m "feat(dashboard): port design tokens from ver1 as Tailwind v4 @theme"
```

---

### Task 2: `Sidebar` component

**Files:**
- Create: `dashboard/components/layout/Sidebar.tsx`

**Interfaces:**
- Consumes: `CATEGORIES` from `dashboard/lib/categories.ts` (existing — array of `{ slug, value, label, color }`), tokens from Task 1 (`bg-surface`, `border-line`, `text-ink`, `text-ink-3`, `bg-brand`, `bg-brand-faint`, `text-brand`, `bg-muted`, `w-sidebar`).
- Produces: `Sidebar` component (no props) — used by Task 4's `app/layout.tsx`.

No test cycle (JSX component, no pure logic) — verified by `npm run build`.

- [ ] **Step 1: Write the component**

Create `dashboard/components/layout/Sidebar.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CATEGORIES } from '../../lib/categories';

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 w-sidebar flex flex-col bg-surface border-r border-line z-50">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-line">
        <div className="w-9 h-9 rounded-[10px] bg-brand flex items-center justify-center flex-shrink-0">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
            <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
          </svg>
        </div>
        <div>
          <div className="text-sm font-bold text-ink">SL Dashboard</div>
          <div className="text-[11px] text-ink-3">Social Listening</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        {/* Main */}
        <div>
          <p className="text-[11px] font-semibold text-ink-3 tracking-wider uppercase px-3 mb-2">
            Tổng quan
          </p>
          <Link
            href="/"
            className={`flex items-center gap-3 px-3 py-2.5 rounded-[10px] text-sm font-medium transition-colors ${
              pathname === '/'
                ? 'bg-brand-faint text-brand font-semibold'
                : 'text-ink-2 hover:bg-muted hover:text-ink'
            }`}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
            Overview
          </Link>
        </div>

        {/* Categories */}
        <div>
          <p className="text-[11px] font-semibold text-ink-3 tracking-wider uppercase px-3 mb-2">
            Lĩnh vực
          </p>
          <div className="space-y-0.5">
            {CATEGORIES.map((cat) => {
              const href = `/${cat.slug}`;
              const active = pathname === href;
              return (
                <Link
                  key={cat.slug}
                  href={href}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-[10px] text-sm font-medium transition-colors ${
                    active
                      ? 'bg-brand-faint text-brand font-semibold'
                      : 'text-ink-2 hover:bg-muted hover:text-ink'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: cat.color }} />
                  {cat.label}
                </Link>
              );
            })}
          </div>
        </div>
      </nav>
    </aside>
  );
}
```

- [ ] **Step 2: Verify the build succeeds**

Run (from `dashboard/`): `npm run build`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add dashboard/components/layout/Sidebar.tsx
git commit -m "feat(dashboard): add Sidebar layout component"
```

---

### Task 3: `Topbar` component

**Files:**
- Create: `dashboard/components/layout/Topbar.tsx`

**Interfaces:**
- Produces: `Topbar({ title, color }: { title: string; color?: string })` — used by Task 4's `app/page.tsx` and `app/[slug]/page.tsx`. `color` is optional so `HomePage` can omit it while sector pages pass `categoryDef.color` (preserving the existing per-category title color that today lives on the `<h1>` in `app/[slug]/page.tsx`).

No test cycle — verified by `npm run build`.

- [ ] **Step 1: Write the component**

Create `dashboard/components/layout/Topbar.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';

export function Topbar({ title, color }: { title: string; color?: string }) {
  const [today, setToday] = useState('');

  // Client-only date formatting avoids an SSR/client hydration mismatch
  // (server render time vs. client render time can land on different days).
  useEffect(() => {
    setToday(
      new Date().toLocaleDateString('vi-VN', {
        weekday: 'long',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })
    );
  }, []);

  return (
    <header className="sticky top-0 z-40 h-topbar flex items-center px-8 bg-surface border-b border-line">
      <div>
        <h1 className="text-lg font-bold text-ink" style={color ? { color } : undefined}>
          {title}
        </h1>
        <p className="text-xs text-ink-3 mt-0.5">{today}</p>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Verify the build succeeds**

Run (from `dashboard/`): `npm run build`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add dashboard/components/layout/Topbar.tsx
git commit -m "feat(dashboard): add Topbar layout component"
```

---

### Task 4: Wire Sidebar+Topbar into the app, remove `CategoryNav`

**Files:**
- Modify: `dashboard/app/layout.tsx`
- Modify: `dashboard/app/page.tsx`
- Modify: `dashboard/app/[slug]/page.tsx`
- Delete: `dashboard/components/CategoryNav.tsx`

**Interfaces:**
- Consumes: `Sidebar` (Task 2), `Topbar` (Task 3).

This is one task because the 4 changes are one coherent integration step — `CategoryNav` cannot be deleted until both pages stop importing it, and the pages' `<Topbar>` usage only makes sense once `layout.tsx` reserves space for the fixed `Sidebar`.

No test cycle — verified by `npm run build` plus the existing `npm test`/`npm run typecheck` (regression check: neither page's data-loading logic changes, only JSX).

- [ ] **Step 1: Update the root layout**

Replace `dashboard/app/layout.tsx` entirely with:

```tsx
import type { Metadata } from 'next';
import './globals.css';
import { Sidebar } from '../components/layout/Sidebar';

export const metadata: Metadata = {
  title: 'Social Listening Dashboard',
  description: 'Topic đang hot và bài báo gần đây theo tài chính, giải trí, du lịch',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>
        <Sidebar />
        <div className="pl-sidebar">{children}</div>
      </body>
    </html>
  );
}
```

(`bg-white text-gray-900` is dropped from `<body>` — `globals.css`'s `@layer base { body { ... } }` from Task 1 now supplies background/text color globally.)

- [ ] **Step 2: Update the Overview page**

Replace `dashboard/app/page.tsx` entirely with:

```tsx
import { createServerSupabaseClient } from '../lib/supabase';
import { SupabaseCandidateTopicsReader } from '../lib/candidate-topics-reader';
import { SupabaseArticlesReader } from '../lib/articles-reader';
import { getHotTopics, type HotTopicsResult } from '../lib/get-hot-topics';
import { HotTopicsSection } from '../components/HotTopicsSection';
import { ArticlesSection } from '../components/ArticlesSection';
import { Topbar } from '../components/layout/Topbar';
import type { Article } from '../lib/types';

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

export default async function OverviewPage() {
  const [hotTopics, articles] = await Promise.all([loadHotTopics(), loadArticles()]);

  return (
    <>
      <Topbar title="Overview" />
      <main className="max-w-4xl mx-auto p-6">
        {'error' in hotTopics ? (
          <p className="text-red-600">{hotTopics.error}</p>
        ) : (
          <HotTopicsSection date={hotTopics.date} bySource={hotTopics.bySource} />
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

- [ ] **Step 3: Update the sector page**

Replace `dashboard/app/[slug]/page.tsx` entirely with:

```tsx
import { notFound } from 'next/navigation';
import { createServerSupabaseClient } from '../../lib/supabase';
import { SupabaseCandidateTopicsReader } from '../../lib/candidate-topics-reader';
import { SupabaseArticlesReader } from '../../lib/articles-reader';
import { getHotTopics, type HotTopicsResult } from '../../lib/get-hot-topics';
import { getCategoryBySlug } from '../../lib/categories';
import { HotTopicsSection } from '../../components/HotTopicsSection';
import { ArticlesSection } from '../../components/ArticlesSection';
import { Topbar } from '../../components/layout/Topbar';
import type { Article } from '../../lib/types';

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

export default async function SectorPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const categoryDef = getCategoryBySlug(slug);
  if (!categoryDef) notFound();

  const [hotTopics, articles] = await Promise.all([
    loadHotTopics(categoryDef.value),
    loadArticles(categoryDef.value),
  ]);

  return (
    <>
      <Topbar title={categoryDef.label} color={categoryDef.color} />
      <main className="max-w-4xl mx-auto p-6">
        {'error' in hotTopics ? (
          <p className="text-red-600">{hotTopics.error}</p>
        ) : (
          <HotTopicsSection date={hotTopics.date} bySource={hotTopics.bySource} />
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

- [ ] **Step 4: Delete the now-unused `CategoryNav`**

```bash
git rm dashboard/components/CategoryNav.tsx
```

- [ ] **Step 5: Verify the build and tests**

Run (from `dashboard/`): `npm run build && npm run typecheck && npm test`
Expected: all exit 0. (`npm run typecheck`/`npm test` confirm no regression in `lib/get-hot-topics.ts`/`lib/hot-topics.ts`/`lib/categories.ts` — none of their signatures changed, only page JSX.)

- [ ] **Step 6: Commit**

```bash
git add dashboard/app/layout.tsx dashboard/app/page.tsx dashboard/app/[slug]/page.tsx
git commit -m "feat(dashboard): wire Sidebar/Topbar into layout and pages, remove CategoryNav"
```

---

### Task 5: Restyle `HotTopicsSection`

**Files:**
- Modify: `dashboard/components/HotTopicsSection.tsx`

**Interfaces:**
- Unchanged: same props (`date: string | null`, `bySource: Record<CandidateTopic['source'], HotTopicRow[]>`), same `formatPercent`/`formatTrendingScore`/`SOURCE_LABELS` logic — only JSX/className changes, so nothing downstream needs to change.

No test cycle — this component isn't unit-tested (only the pure `hot-topics.ts`/`get-hot-topics.ts` logic it consumes is, and that's untouched). Verified by `npm run build`.

- [ ] **Step 1: Replace the file contents**

Replace `dashboard/components/HotTopicsSection.tsx` entirely with:

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

// growth_rate = 999 is the ingestion pipeline's sentinel for "no prior-week
// baseline" (see rank-and-select.ts). computeTrendingScore multiplies by
// 100, so it shows up here as exactly 99900. Render it as "Mới" (new)
// instead of a nonsense percentage.
function formatTrendingScore(value: number | null): string {
  if (value === null) return '—';
  if (value === 99900) return 'Mới';
  return `${value.toFixed(1)}%`;
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
            <div className="space-y-0.5">
              {bySource[source].map((row, i) => (
                <div
                  key={row.id}
                  className="flex items-center gap-3 px-3 py-2 rounded-[10px] hover:bg-muted transition-colors"
                >
                  <span className="w-4 text-center text-xs font-bold text-ink-3 flex-shrink-0">{i + 1}</span>
                  <span className="flex-1 min-w-0 text-sm text-ink truncate">{row.keyword}</span>
                  <span className="text-xs text-ink-3 whitespace-nowrap flex-shrink-0">
                    {formatTrendingScore(row.trendingScore)} · {formatPercent(row.shareOfVoice)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Verify the build and existing tests**

Run (from `dashboard/`): `npm run build && npm test`
Expected: both exit 0 — `tests/hot-topics.test.ts`/`tests/get-hot-topics.test.ts` test the logic this component consumes, unaffected by this styling-only change.

- [ ] **Step 3: Commit**

```bash
git add dashboard/components/HotTopicsSection.tsx
git commit -m "style(dashboard): restyle HotTopicsSection with new design tokens"
```

---

### Task 6: Restyle `ArticlesSection`

**Files:**
- Modify: `dashboard/components/ArticlesSection.tsx`

**Interfaces:**
- Unchanged: same props (`articles: Article[]`) — only JSX/className changes.

No test cycle — same reasoning as Task 5. Verified by `npm run build`.

- [ ] **Step 1: Replace the file contents**

Replace `dashboard/components/ArticlesSection.tsx` entirely with:

```tsx
import type { Article } from '../lib/types';

export function ArticlesSection({ articles }: { articles: Article[] }) {
  if (articles.length === 0) {
    return (
      <section className="bg-surface border border-line rounded-card shadow-card p-6">
        <h2 className="text-base font-bold text-ink mb-2">Bài báo gần đây</h2>
        <p className="text-sm text-ink-3">Chưa có bài báo nào.</p>
      </section>
    );
  }
  return (
    <section className="bg-surface border border-line rounded-card shadow-card p-6">
      <h2 className="text-base font-bold text-ink mb-4">Bài báo gần đây</h2>
      <ul className="space-y-1">
        {articles.map((a) => (
          <li key={a.id} className="px-3 py-2 rounded-[10px] hover:bg-muted transition-colors">
            <a
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-ink hover:text-brand"
            >
              {a.title}
            </a>
            {a.published_at && (
              <span className="text-xs text-ink-3 ml-2">
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

- [ ] **Step 2: Verify the build**

Run (from `dashboard/`): `npm run build`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add dashboard/components/ArticlesSection.tsx
git commit -m "style(dashboard): restyle ArticlesSection with new design tokens"
```

---

### Task 7: Final full-suite verification

**Files:** none (verification-only task).

- [ ] **Step 1: Run the full check from `dashboard/`**

Run: `npm run build && npm run typecheck && npm test`
Expected: all exit 0.

- [ ] **Step 2: Manual visual check**

Run: `npm run dev`, open `http://localhost:3000` in a browser. Confirm:
- Sidebar visible on the left (logo, "Overview" + 3 category links), active link highlighted per current page.
- Topbar visible at top of content (page title + today's date, colored per-category on sector pages).
- Hot topics and articles render inside cards with the new spacing/shadow/border style.
- No `CategoryNav` remnant, no console errors in the browser dev tools.

This step has no pass/fail command output to paste — it's a human/visual confirmation, consistent with the spec's Testing section (no automated visual test exists for this project).
