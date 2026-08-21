import { extractKeywords } from './keyword-extractor';
import { capCandidates } from './cap-candidates';
import type { RawCandidate } from '../types';

// Only the top MAX_CANDIDATES survive into candidate_topics — anything ranked
// below this never has a chance at the top-N shortlist anyway, so capping
// here bounds per-day row volume and write cost without affecting outcomes.
const MAX_CANDIDATES = 200;

export function aggregateRssKeywords(titles: string[]): RawCandidate[] {
  const counts = new Map<string, number>();

  for (const title of titles) {
    for (const keyword of new Set(extractKeywords(title))) {
      counts.set(keyword, (counts.get(keyword) ?? 0) + 1);
    }
  }

  const candidates = Array.from(counts.entries()).map(([keyword, metric_value]) => ({
    keyword,
    metric_value,
    growth_rate: null,
  }));

  return capCandidates(candidates, MAX_CANDIDATES);
}
