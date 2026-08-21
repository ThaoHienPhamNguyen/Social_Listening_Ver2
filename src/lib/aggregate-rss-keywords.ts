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
