import { describe, it, expect } from 'vitest';
import { computeSentimentByCategory } from '../lib/sentiment-by-category';
import type { CandidateTopic } from '../lib/types';

function candidate(overrides: Partial<CandidateTopic> = {}): CandidateTopic {
  return {
    id: 'id-1', source: 'rss', keyword: 'bitcoin', date: '2026-08-24', metric_value: 10,
    growth_rate: 0.5, category_hint: ['tai_chinh'], is_shortlisted: true, ...overrides,
  };
}

describe('computeSentimentByCategory', () => {
  it('maps threads sentiment to category via candidate keyword lookup', () => {
    const result = computeSentimentByCategory(
      [{ keyword: 'bitcoin', sentiment: 'positive' }],
      [candidate({ keyword: 'bitcoin', category_hint: ['tai_chinh'] })],
      []
    );
    const taiChinh = result.find((r) => r.category === 'tai_chinh')!;
    expect(taiChinh.counts).toEqual({ positive: 1, negative: 0, neutral: 0 });
  });

  it('adds facebook sentiment directly by category (no keyword lookup needed)', () => {
    const result = computeSentimentByCategory([], [], [{ category: 'giai_tri', sentiment: 'negative' }]);
    const giaiTri = result.find((r) => r.category === 'giai_tri')!;
    expect(giaiTri.counts).toEqual({ positive: 0, negative: 1, neutral: 0 });
  });

  it('excludes a threads sentiment row whose keyword has no matching candidate', () => {
    const result = computeSentimentByCategory([{ keyword: 'unknown-keyword', sentiment: 'positive' }], [], []);
    const total = result.reduce((sum, r) => sum + r.counts.positive + r.counts.negative + r.counts.neutral, 0);
    expect(total).toBe(0);
  });

  it('always returns all 3 categories, even with zero counts', () => {
    const result = computeSentimentByCategory([], [], []);
    expect(result.map((r) => r.category).sort()).toEqual(['du_lich', 'giai_tri', 'tai_chinh']);
  });
});
