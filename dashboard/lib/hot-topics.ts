// dashboard/lib/hot-topics.ts
import type { CandidateTopic } from './types';

export interface HotTopicRow {
  id: string;
  source: CandidateTopic['source'];
  keyword: string;
  metricValue: number;
  trendingScore: number | null;
  shareOfVoice: number | null;
  categoryHint?: string[]; // the source candidate's raw category_hint — optional
  // because existing callers (e.g. groupBySource's own tests) construct
  // HotTopicRow literals without it; only Trending Now's unified view needs it.
  createdAt?: string; // candidate_topics.created_at — populated by
  // buildHotTopicsForCategory/buildHotTopicsOverview, consumed by
  // sortByRecency for the "Mới nhất" tab. Optional for the same reason
  // categoryHint is: existing HotTopicRow literals in tests don't supply it.
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
    categoryHint: c.category_hint,
    createdAt: c.created_at,
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
      categoryHint: c.category_hint,
      createdAt: c.created_at,
    };
  });
  return groupBySource(rows);
}

// Sort by candidate_topics.created_at descending — the "Mới nhất" tab.
// Rows fetched for one day still vary in created_at because the discovery
// layer runs 2-3x/day and upserts, so this distinguishes "most recently
// (re-)discovered today" from "Trending" (sorted by trendingScore instead).
// Rows with no createdAt sort last. Secondary sort by keyword: a batch
// upsert can give many rows the exact same created_at (Postgres now() is
// transaction-scoped), and without a tiebreak a tie falls through to
// whatever order the array arrived in — which for flattenAndRankHotTopics's
// output is the Trending order, silently making this tab mirror that one.
export function sortByRecency<T extends HotTopicRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const byCreatedAt = (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
    if (byCreatedAt !== 0) return byCreatedAt;
    return a.keyword.localeCompare(b.keyword);
  });
}
