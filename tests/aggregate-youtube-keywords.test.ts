import { describe, it, expect } from 'vitest';
import { aggregateYouTubeKeywords } from '../src/lib/aggregate-youtube-keywords';

describe('aggregateYouTubeKeywords', () => {
  it('sums view counts per keyword across videos sharing that keyword/tag', () => {
    const result = aggregateYouTubeKeywords([
      { snippet: { title: 'Giá vàng hôm nay', tags: ['vàng'] }, statistics: { viewCount: '1000' } },
      { snippet: { title: 'Vàng tăng giá mạnh', tags: ['vàng'] }, statistics: { viewCount: '500' } },
    ]);

    const vang = result.find((r) => r.keyword === 'vàng');
    expect(vang).toBeDefined();
    expect(vang!.metric_value).toBe(1500);
  });

  it('does not double count a keyword that appears both in the title and in tags for the same video', () => {
    const result = aggregateYouTubeKeywords([
      { snippet: { title: 'Bitcoin tăng giá', tags: ['bitcoin'] }, statistics: { viewCount: '2000' } },
    ]);

    const bitcoin = result.find((r) => r.keyword === 'bitcoin');
    expect(bitcoin!.metric_value).toBe(2000);
  });

  it('leaves growth_rate null for every keyword', () => {
    const result = aggregateYouTubeKeywords([
      { snippet: { title: 'Chủ đề bất kỳ', tags: [] }, statistics: { viewCount: '10' } },
    ]);
    expect(result.every((r) => r.growth_rate === null)).toBe(true);
  });

  it('treats a missing viewCount as zero', () => {
    const result = aggregateYouTubeKeywords([
      { snippet: { title: 'Không có view count', tags: [] }, statistics: {} },
    ]);
    expect(result.every((r) => r.metric_value === 0)).toBe(true);
  });
});
