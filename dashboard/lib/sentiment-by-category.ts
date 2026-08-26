import { CATEGORIES } from './categories';
import { groupSentimentCounts, type SentimentCounts } from './topic-engagement';
import type { CandidateTopic, SentimentLabel } from './types';

export interface CategorySentiment {
  category: string;
  label: string;
  counts: SentimentCounts;
}

// keyword -> category lookup, first non-empty category_hint wins (order in
// the input array doesn't matter for correctness here since it's a single
// day's candidates — no cross-day order-dependence risk like
// topic-movers.ts's categoryDate tracking had to solve).
function resolveKeywordCategories(candidates: CandidateTopic[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const c of candidates) {
    if (c.category_hint.length > 0 && !result.has(c.keyword)) {
      result.set(c.keyword, c.category_hint[0]);
    }
  }
  return result;
}

export function computeSentimentByCategory(
  threadsSentimentRows: { keyword: string; sentiment: SentimentLabel | null }[],
  candidatesForLookup: CandidateTopic[],
  facebookSentimentRows: { category: string; sentiment: SentimentLabel | null }[]
): CategorySentiment[] {
  const keywordToCategory = resolveKeywordCategories(candidatesForLookup);

  const keyed: { key: string; sentiment: SentimentLabel | null }[] = [];
  for (const r of threadsSentimentRows) {
    const category = keywordToCategory.get(r.keyword);
    if (category !== undefined) keyed.push({ key: category, sentiment: r.sentiment });
  }
  for (const r of facebookSentimentRows) {
    keyed.push({ key: r.category, sentiment: r.sentiment });
  }

  const counted = groupSentimentCounts(keyed);

  return CATEGORIES.map((c) => ({
    category: c.value,
    label: c.label,
    counts: counted.get(c.value) ?? { positive: 0, negative: 0, neutral: 0 },
  }));
}
