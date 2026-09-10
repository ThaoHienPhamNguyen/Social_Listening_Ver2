import { describe, it, expect } from 'vitest';
import { aggregateFacebookKeywords } from '../src/lib/aggregate-facebook-keywords';
import type { FacebookPost } from '../src/lib/apify-facebook-client';

function post(overrides: Partial<FacebookPost> = {}): FacebookPost {
  return {
    post_url: 'https://facebook.com/groups/x/posts/1',
    text_content: 'giá vàng hôm nay tăng mạnh',
    like_count: 1,
    comment_count: 1,
    share_count: 0,
    posted_at: '2026-09-10T00:00:00Z',
    ...overrides,
  };
}

describe('aggregateFacebookKeywords', () => {
  it('sums like+comment+share per extracted bigram', () => {
    const posts = [post({ text_content: 'giá vàng hôm nay', like_count: 10, comment_count: 3, share_count: 2 })];
    const result = aggregateFacebookKeywords(posts, 'tai_chinh');
    expect(result.find((c) => c.keyword === 'giá vàng')?.metric_value).toBe(15);
  });

  it('tags every candidate with the passed-in category, growth_rate null', () => {
    const result = aggregateFacebookKeywords([post({ text_content: 'giá vàng hôm nay' })], 'tai_chinh');
    expect(result[0].knownCategories).toEqual(['tai_chinh']);
    expect(result[0].growth_rate).toBeNull();
  });

  it('treats null engagement fields as 0', () => {
    const posts = [post({ text_content: 'giá vàng hôm nay', like_count: null, comment_count: null, share_count: null })];
    const result = aggregateFacebookKeywords(posts, 'tai_chinh');
    expect(result.find((c) => c.keyword === 'giá vàng')?.metric_value).toBe(0);
  });

  it('skips posts with empty text_content', () => {
    const result = aggregateFacebookKeywords([post({ text_content: '' })], 'tai_chinh');
    expect(result).toEqual([]);
  });
});
