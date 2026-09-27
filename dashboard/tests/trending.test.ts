import { describe, it, expect } from 'vitest';
import { flattenAndRankHotTopics } from '../lib/trending';
import { NEW_KEYWORD_TRENDING_SCORE } from '../lib/hot-topics';
import type { EnrichedHotTopicRow } from '../lib/topic-engagement';

let nextKeyword = 0;

function row(overrides: Partial<EnrichedHotTopicRow> = {}): EnrichedHotTopicRow {
  return {
    id: 'r-1',
    source: 'rss',
    keyword: overrides.keyword ?? `keyword-${nextKeyword++}`,
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
      threads: [],
      facebook: [],
    };
    const result = flattenAndRankHotTopics(bySource);
    expect(result.map((r) => r.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('breaks a tie in real trendingScore by metricValue descending, instead of leaving it to arrival order', () => {
    // Google Trends reports growth in coarse buckets (100%, 500%, 1000%...)
    // rather than an exact figure, so many keywords legitimately tie at the
    // same real trendingScore on a given day — metricValue (actual search
    // volume) is the tiebreak, same principle as the "Mới" tier already uses.
    const bySource = {
      google_trends: [
        row({ id: 'tied-low-volume', trendingScore: 1000, metricValue: 5 }),
        row({ id: 'tied-high-volume', trendingScore: 1000, metricValue: 50 }),
      ],
      youtube: [],
      rss: [],
      threads: [],
      facebook: [],
    };
    const result = flattenAndRankHotTopics(bySource);
    expect(result.map((r) => r.id)).toEqual(['tied-high-volume', 'tied-low-volume']);
  });

  it('sorts by trendingScore descending', () => {
    const bySource = {
      google_trends: [row({ id: 'low', trendingScore: 10 })],
      youtube: [row({ id: 'high', trendingScore: 90 })],
      rss: [],
      threads: [],
      facebook: [],
    };
    const result = flattenAndRankHotTopics(bySource);
    expect(result.map((r) => r.id)).toEqual(['high', 'low']);
  });

  it('puts null trendingScore rows last, then breaks ties by metricValue descending', () => {
    const bySource = {
      google_trends: [row({ id: 'null-low', trendingScore: null, metricValue: 5 })],
      youtube: [row({ id: 'has-score', trendingScore: 20 })],
      rss: [row({ id: 'null-high', trendingScore: null, metricValue: 50 })],
      threads: [],
      facebook: [],
    };
    const result = flattenAndRankHotTopics(bySource);
    expect(result.map((r) => r.id)).toEqual(['has-score', 'null-high', 'null-low']);
  });

  it('ranks "Mới" (no-baseline sentinel) keywords below real growth-rate scores, even when the sentinel is numerically much larger', () => {
    const bySource = {
      google_trends: [row({ id: 'real-score', trendingScore: 50, metricValue: 5 })],
      youtube: [row({ id: 'new-high-metric', trendingScore: NEW_KEYWORD_TRENDING_SCORE, metricValue: 999 })],
      rss: [],
      threads: [],
      facebook: [],
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
      threads: [],
      facebook: [],
    };
    const result = flattenAndRankHotTopics(bySource);
    expect(result.map((r) => r.id)).toEqual(['new-high', 'new-low']);
  });

  it('orders the 3 tiers correctly when a null-score row is mixed in too', () => {
    const bySource = {
      google_trends: [row({ id: 'real', trendingScore: 30, metricValue: 1 })],
      youtube: [row({ id: 'new', trendingScore: NEW_KEYWORD_TRENDING_SCORE, metricValue: 1 })],
      rss: [row({ id: 'none', trendingScore: null, metricValue: 1 })],
      threads: [],
      facebook: [],
    };
    const result = flattenAndRankHotTopics(bySource);
    expect(result.map((r) => r.id)).toEqual(['real', 'new', 'none']);
  });

  describe('merging the same keyword found by more than one source', () => {
    it('collapses 2 rows sharing a keyword into 1, summing metricValue', () => {
      const bySource = {
        google_trends: [],
        youtube: [row({ id: 'yt', keyword: 'việt nam', metricValue: 30, trendingScore: 20 })],
        threads: [row({ id: 'th', keyword: 'việt nam', metricValue: 70, trendingScore: 10 })],
        rss: [],
        facebook: [],
      };
      const result = flattenAndRankHotTopics(bySource);
      expect(result).toHaveLength(1);
      expect(result[0].metricValue).toBe(100);
    });

    it('lists every contributing source on the merged row, and keeps `source` as the highest-metricValue one', () => {
      const bySource = {
        google_trends: [],
        youtube: [row({ id: 'yt', keyword: 'việt nam', source: 'youtube', metricValue: 30 })],
        threads: [row({ id: 'th', keyword: 'việt nam', source: 'threads', metricValue: 70 })],
        rss: [],
        facebook: [],
      };
      const result = flattenAndRankHotTopics(bySource);
      expect(result[0].source).toBe('threads');
      expect(result[0].sources?.slice().sort()).toEqual(['threads', 'youtube']);
    });

    it('does not merge rows that merely share a keyword text across different, unrelated categories the same way — merge is purely by keyword, sources combine regardless', () => {
      // Documented behavior, not a bug: merge is keyword-only, categoryHint
      // is unioned rather than treated as a merge key.
      const bySource = {
        google_trends: [],
        youtube: [row({ id: 'yt', keyword: 'việt nam', categoryHint: ['du_lich'] })],
        threads: [row({ id: 'th', keyword: 'việt nam', categoryHint: ['tai_chinh'] })],
        rss: [],
        facebook: [],
      };
      const result = flattenAndRankHotTopics(bySource);
      expect(result).toHaveLength(1);
      expect(result[0].categoryHint?.slice().sort()).toEqual(['du_lich', 'tai_chinh']);
    });

    it('takes the trendingScore/tier from whichever source ranks best, not an average', () => {
      const bySource = {
        google_trends: [],
        youtube: [row({ id: 'yt', keyword: 'việt nam', trendingScore: 20, metricValue: 1 })],
        threads: [
          row({ id: 'th', keyword: 'việt nam', trendingScore: NEW_KEYWORD_TRENDING_SCORE, metricValue: 1 }),
        ],
        rss: [],
        facebook: [],
      };
      const result = flattenAndRankHotTopics(bySource);
      // A real 20% growth score outranks the "Mới" sentinel regardless of
      // its huge raw value — same tier rule as everywhere else.
      expect(result[0].trendingScore).toBe(20);
    });

    it('drops shareOfVoice to null on a merged row — a % of one source total does not combine across sources', () => {
      const bySource = {
        google_trends: [],
        youtube: [row({ id: 'yt', keyword: 'việt nam', shareOfVoice: 40 })],
        threads: [row({ id: 'th', keyword: 'việt nam', shareOfVoice: 60 })],
        rss: [],
        facebook: [],
      };
      const result = flattenAndRankHotTopics(bySource);
      expect(result[0].shareOfVoice).toBeNull();
    });

    it('keeps the most recent createdAt among the merged rows', () => {
      const bySource = {
        google_trends: [],
        youtube: [row({ id: 'yt', keyword: 'việt nam', createdAt: '2026-09-27T01:00:00Z' })],
        threads: [row({ id: 'th', keyword: 'việt nam', createdAt: '2026-09-27T09:00:00Z' })],
        rss: [],
        facebook: [],
      };
      const result = flattenAndRankHotTopics(bySource);
      expect(result[0].createdAt).toBe('2026-09-27T09:00:00Z');
    });

    it('leaves a keyword found by only one source untouched (no sources field, unchanged shareOfVoice)', () => {
      const bySource = {
        google_trends: [],
        youtube: [row({ id: 'solo', keyword: 'bitcoin', shareOfVoice: 42 })],
        threads: [],
        rss: [],
        facebook: [],
      };
      const result = flattenAndRankHotTopics(bySource);
      expect(result[0].sources).toBeUndefined();
      expect(result[0].shareOfVoice).toBe(42);
    });
  });
});
