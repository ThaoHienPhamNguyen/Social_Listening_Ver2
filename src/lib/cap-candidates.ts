import type { RawCandidate } from '../types';

export function capCandidates(candidates: RawCandidate[], limit: number): RawCandidate[] {
  return [...candidates].sort((a, b) => b.metric_value - a.metric_value).slice(0, limit);
}
