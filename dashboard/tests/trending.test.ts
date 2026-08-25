import { describe, it, expect } from 'vitest';
import { flattenAndRankHotTopics } from '../lib/trending';
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
});
