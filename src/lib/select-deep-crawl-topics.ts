import type { CandidateTopic, Category } from '../types';

const CATEGORIES: Category[] = ['tai_chinh', 'giai_tri', 'du_lich'];
const TOP_PER_CATEGORY = 2;
const MAX_TOPICS = 8;

// Unlike rank-and-select.ts's per-category floor (purely additive, no total
// cap), this selection is hard-capped at MAX_TOPICS because the daily deep-
// crawl budget is fixed — floor-then-fill, not additive.
export function selectDeepCrawlTopics(candidates: CandidateTopic[]): string[] {
  const shortlisted = candidates.filter((c) => c.is_shortlisted);

  // Dedup by keyword — the same keyword can appear as multiple rows (one per
  // discovery source: google_trends/youtube/rss). Keep the row with the
  // highest growth_rate as that keyword's representative for ranking.
  const byKeyword = new Map<string, CandidateTopic>();
  for (const c of shortlisted) {
    const existing = byKeyword.get(c.keyword);
    if (!existing || (c.growth_rate ?? 0) > (existing.growth_rate ?? 0)) {
      byKeyword.set(c.keyword, c);
    }
  }
  const deduped = Array.from(byKeyword.values());

  const selected = new Set<string>();

  // Reserve floor: top-2 per category, so every sector still gets some
  // social data even on a day where generic trending crowds it out overall.
  for (const category of CATEGORIES) {
    const inCategory = deduped
      .filter((c) => c.category_hint.includes(category))
      .sort((a, b) => (b.growth_rate ?? 0) - (a.growth_rate ?? 0))
      .slice(0, TOP_PER_CATEGORY);
    for (const c of inCategory) selected.add(c.keyword);
  }

  // Fill remaining slots with the next-highest growth_rate overall,
  // regardless of category — spends the full daily budget instead of
  // leaving slots unused when a category has fewer than 2 good candidates.
  const byGrowthRate = [...deduped].sort((a, b) => (b.growth_rate ?? 0) - (a.growth_rate ?? 0));
  for (const c of byGrowthRate) {
    if (selected.size >= MAX_TOPICS) break;
    selected.add(c.keyword);
  }

  return Array.from(selected).slice(0, MAX_TOPICS);
}
