import type { CandidateTopic } from './types';

// Distinct keywords ranked by total metric_value across every input row
// (caller pre-filters to category + shortlisted + window — see
// get-sector-metrics.ts's callers for the exact scoping). Used for the
// "Từ khóa nổi bật" pill list — ver2 has no separate tag/description field,
// so the most prominent shortlisted keywords stand in for it.
export function extractTopKeywords(candidates: CandidateTopic[], limit = 12): string[] {
  const totals = new Map<string, number>();
  for (const c of candidates) {
    totals.set(c.keyword, (totals.get(c.keyword) ?? 0) + c.metric_value);
  }
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([keyword]) => keyword);
}
