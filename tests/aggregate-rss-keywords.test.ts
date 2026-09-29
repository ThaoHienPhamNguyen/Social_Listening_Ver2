import { describe, it, expect } from 'vitest';
import { aggregateRssKeywords } from '../src/lib/aggregate-rss-keywords';

function article(topics: string[], categories: string[] = []) {
  return { topics, categories };
}

describe('aggregateRssKeywords', () => {
  it('counts how many articles each topic appears in', () => {
    const result = aggregateRssKeywords([
      article(['giá vàng']),
      article(['giá vàng', 'lập đỉnh']),
      article(['chứng khoán']),
    ]);
    const giaVang = result.find((r) => r.keyword === 'giá vàng');
    expect(giaVang).toBeDefined();
    expect(giaVang!.metric_value).toBe(2);
  });

  it('counts a topic at most once per article even if it repeats within that article\'s topic list', () => {
    const result = aggregateRssKeywords([article(['vàng vàng', 'vàng vàng'])]);
    const vangVang = result.find((r) => r.keyword === 'vàng vàng');
    expect(vangVang!.metric_value).toBe(1);
  });

  it('leaves growth_rate null for every keyword', () => {
    const result = aggregateRssKeywords([article(['một chủ đề'])]);
    expect(result.every((r) => r.growth_rate === null)).toBe(true);
  });

  it('caps the result to the top 200 keywords by metric_value', () => {
    // 210 articles, each with a unique topic that appears only once —
    // aggregateRssKeywords would otherwise emit 210 distinct keywords.
    const articles = Array.from({ length: 210 }, (_, i) => article([`duy nhat tukhoa${i}`]));
    const result = aggregateRssKeywords(articles);
    expect(result.length).toBeLessThanOrEqual(200);
  });

  it('unions categories from every article a topic appears in', () => {
    const result = aggregateRssKeywords([
      article(['chứng khoán'], ['tai_chinh']),
      article(['chứng khoán'], ['giai_tri']),
    ]);
    const chungKhoan = result.find((r) => r.keyword === 'chứng khoán');
    expect(chungKhoan).toBeDefined();
    expect(new Set(chungKhoan!.knownCategories)).toEqual(new Set(['tai_chinh', 'giai_tri']));
  });

  it('leaves knownCategories empty when the source article has no categories', () => {
    const result = aggregateRssKeywords([article(['một chủ đề'], [])]);
    expect(result.every((r) => (r.knownCategories ?? []).length === 0)).toBe(true);
  });

  it('produces no candidates when there are no articles', () => {
    const result = aggregateRssKeywords([]);
    expect(result).toEqual([]);
  });
});
