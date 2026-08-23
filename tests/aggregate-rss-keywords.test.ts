import { describe, it, expect } from 'vitest';
import { aggregateRssKeywords } from '../src/lib/aggregate-rss-keywords';

function article(title: string, categories: string[] = []) {
  return { title, categories };
}

describe('aggregateRssKeywords', () => {
  it('counts how many titles each keyword appears in', () => {
    const result = aggregateRssKeywords([
      article('Giá vàng tăng mạnh'),
      article('Giá vàng lập đỉnh mới'),
      article('Chứng khoán giảm'),
    ]);
    const giaVang = result.find((r) => r.keyword === 'giá vàng');
    expect(giaVang).toBeDefined();
    expect(giaVang!.metric_value).toBe(2);
  });

  it('counts a keyword at most once per title even if it repeats within that title', () => {
    const result = aggregateRssKeywords([article('vàng vàng vàng')]);
    const vangVang = result.find((r) => r.keyword === 'vàng vàng');
    expect(vangVang!.metric_value).toBe(1);
  });

  it('leaves growth_rate null for every keyword', () => {
    const result = aggregateRssKeywords([article('Một tiêu đề bất kỳ')]);
    expect(result.every((r) => r.growth_rate === null)).toBe(true);
  });

  it('caps the result to the top 200 keywords by metric_value', () => {
    // 210 titles, each containing a unique 3+ char keyword that appears only
    // once — aggregateRssKeywords would otherwise emit 210 distinct keywords.
    const articles = Array.from({ length: 210 }, (_, i) => article(`duy nhat tukhoa${i}`));
    const result = aggregateRssKeywords(articles);
    expect(result.length).toBeLessThanOrEqual(200);
  });

  it('unions categories from every article a keyword appears in', () => {
    const result = aggregateRssKeywords([
      article('Chứng khoán tăng vọt hôm nay', ['tai_chinh']),
      article('Ca sĩ nổi tiếng đầu tư chứng khoán', ['giai_tri']),
    ]);
    const chungKhoan = result.find((r) => r.keyword === 'chứng khoán');
    expect(chungKhoan).toBeDefined();
    expect(new Set(chungKhoan!.knownCategories)).toEqual(new Set(['tai_chinh', 'giai_tri']));
  });

  it('leaves knownCategories empty when the source article has no categories', () => {
    const result = aggregateRssKeywords([article('Một tiêu đề bất kỳ', [])]);
    expect(result.every((r) => (r.knownCategories ?? []).length === 0)).toBe(true);
  });
});
