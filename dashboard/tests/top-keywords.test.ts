import { describe, it, expect } from 'vitest';
import { extractTopKeywords } from '../lib/top-keywords';
import type { CandidateTopic } from '../lib/types';

function candidate(overrides: Partial<CandidateTopic> = {}): CandidateTopic {
  return {
    id: 'id-1', source: 'rss', keyword: 'bitcoin', date: '2026-08-24', metric_value: 10,
    growth_rate: 0.5, category_hint: ['tai_chinh'], is_shortlisted: true, ...overrides,
  };
}

describe('extractTopKeywords', () => {
  it('sorts distinct keywords by total metric_value descending', () => {
    const result = extractTopKeywords([
      candidate({ id: '1', keyword: 'bitcoin', metric_value: 5 }),
      candidate({ id: '2', keyword: 'bitcoin', date: '2026-08-25', metric_value: 5 }), // same keyword, 2nd day -> totals 10
      candidate({ id: '3', keyword: 'vàng', metric_value: 20 }),
    ]);
    expect(result).toEqual(['vàng', 'bitcoin']);
  });

  it('caps to the given limit', () => {
    const candidates = ['a', 'b', 'c', 'd'].map((k, i) => candidate({ id: k, keyword: k, metric_value: 4 - i }));
    expect(extractTopKeywords(candidates, 2)).toEqual(['a', 'b']);
  });

  it('returns an empty array for empty input', () => {
    expect(extractTopKeywords([])).toEqual([]);
  });
});
