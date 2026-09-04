import { describe, it, expect } from 'vitest';
import { flattenAndRankHotTopics } from '../lib/trending';
import { NEW_KEYWORD_TRENDING_SCORE } from '../lib/hot-topics';
import type { EnrichedHotTopicRow } from '../lib/topic-engagement';

function row(overrides: Partial<EnrichedHotTopicRow> = {}): EnrichedHotTopicRow {
  return {
    id: 'r-1',
    source: 'rss',
    keyword: 'bitcoin',
    metricValue: 10,
    trendingScore: 50,
    shareOfVoice: 10,
    engagement: null,
    ...overrides,
  };
}

describe('flattenAndRankHotTopics', () => {
  it('flattens all sources into one array', () => {
    const bySource = {
      google_trends: [row({ id: 'a' })],
      youtube: [row({ id: 'b' })],
      rss: [row({ id: 'c' })],
    };
    const result = flattenAndRankHotTopics(bySource);
    expect(result.map((r) => r.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('sorts by trendingScore descending', () => {
    const bySource = {
      google_trends: [row({ id: 'low', trendingScore: 10 })],
      youtube: [row({ id: 'high', trendingScore: 90 })],
      rss: [],
    };
    const result = flattenAndRankHotTopics(bySource);
    expect(result.map((r) => r.id)).toEqual(['high', 'low']);
  });

  it('puts null trendingScore rows last, then breaks ties by metricValue descending', () => {
    const bySource = {
      google_trends: [row({ id: 'null-low', trendingScore: null, metricValue: 5 })],
      youtube: [row({ id: 'has-score', trendingScore: 20 })],
      rss: [row({ id: 'null-high', trendingScore: null, metricValue: 50 })],
    };
    const result = flattenAndRankHotTopics(bySource);
    expect(result.map((r) => r.id)).toEqual(['has-score', 'null-high', 'null-low']);
  });

  it('ranks "Mới" (no-baseline sentinel) keywords below real growth-rate scores, even when the sentinel is numerically much larger', () => {
    const bySource = {
      google_trends: [row({ id: 'real-score', trendingScore: 50, metricValue: 5 })],
      youtube: [row({ id: 'new-high-metric', trendingScore: NEW_KEYWORD_TRENDING_SCORE, metricValue: 999 })],
      rss: [],
    };
    const result = flattenAndRankHotTopics(bySource);
    // 'new-high-metric' has a far larger raw trendingScore (99900 vs 50) and
    // a far larger metricValue, but it must still rank BELOW the real score.
    expect(result.map((r) => r.id)).toEqual(['real-score', 'new-high-metric']);
  });

  it('breaks ties among "Mới" keywords by metricValue descending, not the (identical) sentinel score', () => {
    const bySource = {
      google_trends: [],
      youtube: [
        row({ id: 'new-low', trendingScore: NEW_KEYWORD_TRENDING_SCORE, metricValue: 5 }),
        row({ id: 'new-high', trendingScore: NEW_KEYWORD_TRENDING_SCORE, metricValue: 500 }),
      ],
      rss: [],
    };
    const result = flattenAndRankHotTopics(bySource);
    expect(result.map((r) => r.id)).toEqual(['new-high', 'new-low']);
  });

  it('orders the 3 tiers correctly when a null-score row is mixed in too', () => {
    const bySource = {
      google_trends: [row({ id: 'real', trendingScore: 30, metricValue: 1 })],
      youtube: [row({ id: 'new', trendingScore: NEW_KEYWORD_TRENDING_SCORE, metricValue: 1 })],
      rss: [row({ id: 'none', trendingScore: null, metricValue: 1 })],
    };
    const result = flattenAndRankHotTopics(bySource);
    expect(result.map((r) => r.id)).toEqual(['real', 'new', 'none']);
  });
});
