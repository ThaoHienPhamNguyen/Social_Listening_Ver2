import { describe, it, expect } from 'vitest';
import { aggregateRssKeywords } from '../src/lib/aggregate-rss-keywords';

describe('aggregateRssKeywords', () => {
  it('counts how many titles each keyword appears in', () => {
    const result = aggregateRssKeywords(['Giá vàng tăng mạnh', 'Vàng lập đỉnh mới', 'Chứng khoán giảm']);
    const vang = result.find((r) => r.keyword === 'vàng');
    expect(vang).toBeDefined();
    expect(vang!.metric_value).toBe(2);
  });

  it('counts a keyword at most once per title even if it repeats within that title', () => {
    const result = aggregateRssKeywords(['vàng vàng vàng']);
    const vang = result.find((r) => r.keyword === 'vàng');
    expect(vang!.metric_value).toBe(1);
  });

  it('leaves growth_rate null for every keyword', () => {
    const result = aggregateRssKeywords(['Một tiêu đề bất kỳ']);
    expect(result.every((r) => r.growth_rate === null)).toBe(true);
  });

  it('caps the result to the top 200 keywords by metric_value', () => {
    // 210 titles, each containing a unique 3+ char keyword that appears only once —
    // aggregateRssKeywords would otherwise emit 210 distinct keywords.
    const titles = Array.from({ length: 210 }, (_, i) => `duy nhat tukhoa${i}`);
    const result = aggregateRssKeywords(titles);
    expect(result.length).toBeLessThanOrEqual(200);
  });
});
