import { extractKeywords } from './keyword-extractor';
import { capCandidates } from './cap-candidates';
import type { Category, RawCandidate } from '../types';

// Only the top MAX_CANDIDATES survive into candidate_topics — anything ranked
// below this never has a chance at the top-N shortlist anyway, so capping
// here bounds per-day row volume and write cost without affecting outcomes.
const MAX_CANDIDATES = 200;

export function aggregateRssKeywords(
  articles: { title: string; categories: string[] }[]
): RawCandidate[] {
  const counts = new Map<string, number>();
  const categoriesByKeyword = new Map<string, Set<Category>>();

  for (const article of articles) {
    for (const keyword of new Set(extractKeywords(article.title))) {
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
