import { describe, it, expect, vi, afterEach } from 'vitest';
import { YouTubeTrendingSource, mergeCandidates } from '../src/lib/youtube-source';
import type { YouTubeSearchClient } from '../src/lib/youtube-search-client';
import type { RawCandidate } from '../src/types';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubMostPopularFetch(items: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ items }) }))
  );
}

describe('mergeCandidates', () => {
  it('sums metric_value and unions knownCategories when the same keyword appears in both lists', () => {
    const a: RawCandidate[] = [
      { keyword: 'vàng', metric_value: 100, growth_rate: null, knownCategories: ['tai_chinh'] },
    ];
    const b: RawCandidate[] = [
      { keyword: 'vàng', metric_value: 50, growth_rate: null, knownCategories: ['giai_tri'] },
    ];

    const result = mergeCandidates(a, b);

    expect(result).toHaveLength(1);
    expect(result[0].metric_value).toBe(150);
    expect(new Set(result[0].knownCategories)).toEqual(new Set(['tai_chinh', 'giai_tri']));
  });

  it('keeps a keyword that appears in only one list, normalizing knownCategories to an empty array', () => {
    const a: RawCandidate[] = [{ keyword: 'bitcoin', metric_value: 10, growth_rate: null }];
    const result = mergeCandidates(a, []);
    expect(result).toEqual([{ keyword: 'bitcoin', metric_value: 10, growth_rate: null, knownCategories: [] }]);
  });

  it('caps the merged result to 200 keywords', () => {
    const a: RawCandidate[] = Array.from({ length: 150 }, (_, i) => ({
      keyword: `a${i}`, metric_value: 300 - i, growth_rate: null,
    }));
    const b: RawCandidate[] = Array.from({ length: 150 }, (_, i) => ({
      keyword: `b${i}`, metric_value: 200 - i, growth_rate: null,
    }));
    const result = mergeCandidates(a, b);
    expect(result.length).toBeLessThanOrEqual(200);
  });
});

describe('YouTubeTrendingSource', () => {
  it('stamps knownCategories from the seed category on candidates found via search, not on mostPopular candidates', async () => {
    stubMostPopularFetch([{ snippet: { title: 'Video', tags: ['thịnh hành'] }, statistics: { viewCount: '999' } }]);
    const searchClient: YouTubeSearchClient = {
      searchByKeyword: async (keyword) =>
        keyword === 'chứng khoán'
          ? [{ snippet: { title: 'Video', tags: ['cổ phiếu'] }, statistics: { viewCount: '500' } }]
          : [],
    };
    const source = new YouTubeTrendingSource('fake-key', searchClient);

    const candidates = await source.fetchCandidates();

    const seeded = candidates.find((c) => c.keyword === 'cổ phiếu');
    const generic = candidates.find((c) => c.keyword === 'thịnh hành');
    expect(seeded?.knownCategories).toEqual(['tai_chinh']);
    expect(generic?.knownCategories ?? []).toHaveLength(0);
  });

  it('calls searchByKeyword once per configured seed keyword across all 3 categories', async () => {
    stubMostPopularFetch([]);
    const calls: string[] = [];
    const searchClient: YouTubeSearchClient = {
      searchByKeyword: async (keyword) => {
        calls.push(keyword);
        return [];
      },
    };
    const source = new YouTubeTrendingSource('fake-key', searchClient);

    await source.fetchCandidates();

    expect(calls).toHaveLength(6); // 2 seeds × 3 categories
  });

  it('keeps mostPopular candidates and other seeds when one seed keyword throws', async () => {
    stubMostPopularFetch([{ snippet: { title: 'Video', tags: ['thịnh hành'] }, statistics: { viewCount: '999' } }]);
    const searchClient: YouTubeSearchClient = {
      searchByKeyword: async (keyword) => {
        if (keyword === 'chứng khoán') throw new Error('YouTube API request failed: 500');
        return keyword === 'tài chính'
          ? [{ snippet: { title: 'Video', tags: ['lãi suất'] }, statistics: { viewCount: '500' } }]
          : [];
      },
    };
    const source = new YouTubeTrendingSource('fake-key', searchClient);

    const candidates = await source.fetchCandidates();

    expect(candidates.find((c) => c.keyword === 'thịnh hành')).toBeDefined();
    expect(candidates.find((c) => c.keyword === 'lãi suất')).toBeDefined();
  });
});
