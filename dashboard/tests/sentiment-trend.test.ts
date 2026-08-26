import { describe, it, expect } from 'vitest';
import { computeSentimentTrend } from '../lib/sentiment-trend';

describe('computeSentimentTrend', () => {
  it('combines threads + facebook sentiment counts per day, in the given date order', () => {
    const result = computeSentimentTrend(
      [
        { date: '2026-08-24', sentiment: 'positive' },
        { date: '2026-08-25', sentiment: 'negative' },
      ],
      [{ date: '2026-08-24', sentiment: 'negative' }],
      ['2026-08-24', '2026-08-25']
    );
    expect(result).toEqual([
      { date: '2026-08-24', positive: 1, negative: 1, neutral: 0 },
      { date: '2026-08-25', positive: 0, negative: 1, neutral: 0 },
    ]);
  });

  it('fills zero counts for a date with no rows', () => {
    const result = computeSentimentTrend([], [], ['2026-08-24']);
    expect(result).toEqual([{ date: '2026-08-24', positive: 0, negative: 0, neutral: 0 }]);
  });
});
