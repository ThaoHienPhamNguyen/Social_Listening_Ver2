import { describe, it, expect } from 'vitest';
import { capCandidates } from '../src/lib/cap-candidates';
import type { RawCandidate } from '../src/types';

function candidate(keyword: string, metric_value: number): RawCandidate {
  return { keyword, metric_value, growth_rate: null };
}

describe('capCandidates', () => {
  it('returns all candidates unchanged in count when under the limit', () => {
    const input = [candidate('a', 1), candidate('b', 2)];
    const result = capCandidates(input, 200);
    expect(result).toHaveLength(2);
  });

  it('truncates to the top N candidates by metric_value when over the limit', () => {
    const input = [candidate('low', 1), candidate('high', 100), candidate('mid', 50)];
    const result = capCandidates(input, 2);
    expect(result.map((c) => c.keyword)).toEqual(['high', 'mid']);
  });

  it('does not mutate the input array', () => {
    const input = [candidate('a', 1), candidate('b', 2)];
    const copy = [...input];
    capCandidates(input, 1);
    expect(input).toEqual(copy);
  });
});
