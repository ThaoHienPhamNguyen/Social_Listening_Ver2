// dashboard/tests/hot-topics.test.ts
import { describe, it, expect } from 'vitest';
import {
  filterByCategory,
  computeTrendingScore,
  computeShareOfVoice,
  groupBySource,
  buildHotTopicsForCategory,
  buildHotTopicsOverview,
  sortByRecency,
  type HotTopicRow,
} from '../lib/hot-topics';
import type { CandidateTopic } from '../lib/types';

function candidate(overrides: Partial<CandidateTopic> = {}): CandidateTopic {
  return {
    id: 'id-1',
    source: 'rss',
    keyword: 'bitcoin',
    date: '2026-08-21',
    metric_value: 10,
    growth_rate: 0.5,
    category_hint: ['tai_chinh'],
    is_shortlisted: true,
    ...overrides,
  };
}

describe('filterByCategory', () => {
  it('keeps only candidates whose category_hint includes the given category', () => {
    const a = candidate({ id: 'a', category_hint: ['tai_chinh'] });
    const b = candidate({ id: 'b', category_hint: ['giai_tri'] });
    expect(filterByCategory([a, b], 'tai_chinh')).toEqual([a]);
  });

  it('keeps a candidate tagged with multiple categories if any of them match', () => {
    const a = candidate({ id: 'a', category_hint: ['tai_chinh', 'giai_tri'] });
    expect(filterByCategory([a], 'giai_tri')).toEqual([a]);
  });
});

describe('computeTrendingScore', () => {
  it('converts growth_rate to a percentage', () => {
    expect(computeTrendingScore(candidate({ growth_rate: 0.5 }))).toBe(50);
  });

  it('returns null when growth_rate is null', () => {
    expect(computeTrendingScore(candidate({ growth_rate: null }))).toBeNull();
  });
});

describe('computeShareOfVoice', () => {
  it('splits 100% across candidates of the same source proportionally to metric_value', () => {
    const a = candidate({ id: 'a', source: 'rss', metric_value: 30 });
    const b = candidate({ id: 'b', source: 'rss', metric_value: 70 });
    const result = computeShareOfVoice([a, b]);
    expect(result.get('a')).toBe(30);
    expect(result.get('b')).toBe(70);
  });

  it('computes totals separately per source', () => {
    const a = candidate({ id: 'a', source: 'rss', metric_value: 50 });
    const b = candidate({ id: 'b', source: 'youtube', metric_value: 50 });
    const result = computeShareOfVoice([a, b]);
    // each is 100% of its own source's total, since it's the only entry
    expect(result.get('a')).toBe(100);
    expect(result.get('b')).toBe(100);
  });

  it('returns 0 for a source whose total metric_value is 0', () => {
    const a = candidate({ id: 'a', source: 'rss', metric_value: 0 });
    expect(computeShareOfVoice([a]).get('a')).toBe(0);
  });
});

describe('groupBySource', () => {
  it('groups rows by source and sorts each group by trendingScore descending', () => {
    const rows = [
      { id: 'a', source: 'rss' as const, keyword: 'a', metricValue: 1, trendingScore: 10, shareOfVoice: 5 },
      { id: 'b', source: 'rss' as const, keyword: 'b', metricValue: 1, trendingScore: 90, shareOfVoice: 5 },
      { id: 'c', source: 'youtube' as const, keyword: 'c', metricValue: 1, trendingScore: 40, shareOfVoice: 5 },
    ];
    const grouped = groupBySource(rows);
    expect(grouped.rss.map((r) => r.id)).toEqual(['b', 'a']);
    expect(grouped.youtube.map((r) => r.id)).toEqual(['c']);
    expect(grouped.google_trends).toEqual([]);
  });
});

describe('buildHotTopicsForCategory', () => {
  it('computes share of voice against ALL candidates in the category, but only returns shortlisted rows', () => {
    const shortlisted = candidate({ id: 'shortlisted', metric_value: 20, is_shortlisted: true, category_hint: ['tai_chinh'] });
    const notShortlisted = candidate({ id: 'not-shortlisted', metric_value: 80, is_shortlisted: false, category_hint: ['tai_chinh'] });
    const otherCategory = candidate({ id: 'other', metric_value: 999, is_shortlisted: true, category_hint: ['giai_tri'] });

    const result = buildHotTopicsForCategory([shortlisted, notShortlisted, otherCategory], 'tai_chinh');

    expect(result.rss).toHaveLength(1);
    expect(result.rss[0].id).toBe('shortlisted');
    // 20 / (20 + 80) * 100 = 20, even though the 80-weight row never appears
    expect(result.rss[0].shareOfVoice).toBe(20);
  });
});

describe('buildHotTopicsOverview', () => {
  it('includes shortlisted candidates from every category', () => {
    const a = candidate({ id: 'a', category_hint: ['tai_chinh'], is_shortlisted: true });
    const b = candidate({ id: 'b', category_hint: ['giai_tri'], is_shortlisted: true });
    const result = buildHotTopicsOverview([a, b], ['tai_chinh', 'giai_tri', 'du_lich']);
    expect(result.rss.map((r) => r.id).sort()).toEqual(['a', 'b']);
  });

  it('averages share of voice across a candidate\'s multiple categories', () => {
    const multi = candidate({ id: 'multi', metric_value: 25, category_hint: ['tai_chinh', 'giai_tri'], is_shortlisted: true });
    const otherInGiaiTri = candidate({ id: 'other', metric_value: 75, category_hint: ['giai_tri'], is_shortlisted: true });
    // alone in tai_chinh -> 100% share; 25 / (25 + 75) in giai_tri -> 25% share;
    // average = (100 + 25) / 2 = 62.5, which can't be confused with either raw value
    const result = buildHotTopicsOverview([multi, otherInGiaiTri], ['tai_chinh', 'giai_tri', 'du_lich']);
    const row = result.rss.find((r) => r.id === 'multi');
    expect(row?.shareOfVoice).toBe(62.5);
  });

  it('returns null share of voice for a candidate with no category_hint', () => {
    const uncategorized = candidate({ id: 'u', category_hint: [], is_shortlisted: true });
    const result = buildHotTopicsOverview([uncategorized], ['tai_chinh', 'giai_tri', 'du_lich']);
    expect(result.rss[0].shareOfVoice).toBeNull();
  });
});

describe('categoryHint passthrough', () => {
  it('buildHotTopicsForCategory carries category_hint through onto each row', () => {
    const c = candidate({ id: 'a', category_hint: ['tai_chinh', 'giai_tri'] });
    const result = buildHotTopicsForCategory([c], 'tai_chinh');
    expect(result.rss[0].categoryHint).toEqual(['tai_chinh', 'giai_tri']);
  });

  it('buildHotTopicsOverview carries category_hint through onto each row', () => {
    const c = candidate({ id: 'a', category_hint: ['du_lich'] });
    const result = buildHotTopicsOverview([c], ['tai_chinh', 'giai_tri', 'du_lich']);
    expect(result.rss[0].categoryHint).toEqual(['du_lich']);
  });
});

describe('sortByRecency', () => {
  function hotTopicRow(overrides: Partial<HotTopicRow> = {}): HotTopicRow {
    return { id: '1', source: 'rss', keyword: 'a', metricValue: 1, trendingScore: 1, shareOfVoice: 1, ...overrides };
  }

  it('orders rows by createdAt descending', () => {
    const rows = [
      hotTopicRow({ id: '1', createdAt: '2026-08-24T08:00:00Z' }),
      hotTopicRow({ id: '2', createdAt: '2026-08-24T14:00:00Z' }),
    ];
    expect(sortByRecency(rows).map((r) => r.id)).toEqual(['2', '1']);
  });

  it('sorts rows with no createdAt to the end', () => {
    const rows = [
      hotTopicRow({ id: '1' }), // no createdAt
      hotTopicRow({ id: '2', createdAt: '2026-08-24T14:00:00Z' }),
    ];
    expect(sortByRecency(rows).map((r) => r.id)).toEqual(['2', '1']);
  });
});

describe('buildHotTopicsForCategory createdAt', () => {
  it('populates createdAt from the candidate row', () => {
    const candidates = [
      { id: '1', source: 'rss' as const, keyword: 'a', date: '2026-08-24', metric_value: 1, growth_rate: 0, category_hint: ['tai_chinh'], is_shortlisted: true, created_at: '2026-08-24T09:00:00Z' },
    ];
    const result = buildHotTopicsForCategory(candidates, 'tai_chinh');
    expect(result.rss[0].createdAt).toBe('2026-08-24T09:00:00Z');
  });
});
