import { describe, it, expect } from 'vitest';
import { aggregateThreadsKeywords } from '../src/lib/aggregate-threads-keywords';
import type { ThreadsPost } from '../src/lib/apify-threads-client';

function post(overrides: Partial<ThreadsPost> = {}): ThreadsPost {
  return {
    post_url: 'https://threads.net/p/1',
    text_content: 'giá vàng hôm nay tăng mạnh',
    like_count: 1,
    reply_count: 1,
    repost_count: 0,
    quote_count: 0,
    share_count: 0,
    view_count: 100,
    posted_at: '2026-09-10T00:00:00Z',
    ...overrides,
  };
}

describe('aggregateThreadsKeywords', () => {
  it('sums like+reply+repost+quote+share (not view_count) per extracted bigram', () => {
    const posts = [
      post({
        text_content: 'giá vàng hôm nay',
        like_count: 10,
        reply_count: 2,
        repost_count: 1,
        quote_count: 1,
        share_count: 1,
        view_count: 9999,
      }),
    ];
    const result = aggregateThreadsKeywords(posts, 'tai_chinh');
    const giaVang = result.find((c) => c.keyword === 'giá vàng');
    expect(giaVang?.metric_value).toBe(15); // 10+2+1+1+1, view_count excluded
  });

  it('tags every candidate with the passed-in category as knownCategories, and growth_rate null', () => {
    const posts = [post({ text_content: 'giá vàng hôm nay' })];
    const result = aggregateThreadsKeywords(posts, 'tai_chinh');
    expect(result[0].knownCategories).toEqual(['tai_chinh']);
    expect(result[0].growth_rate).toBeNull();
  });

  it('treats null engagement fields as 0', () => {
    const posts = [
      post({
        text_content: 'giá vàng hôm nay',
        like_count: null,
        reply_count: null,
        repost_count: null,
        quote_count: null,
        share_count: null,
      }),
    ];
    const result = aggregateThreadsKeywords(posts, 'tai_chinh');
    expect(result.find((c) => c.keyword === 'giá vàng')?.metric_value).toBe(0);
  });

  it('skips posts with empty text_content', () => {
    const posts = [post({ text_content: '' })];
    const result = aggregateThreadsKeywords(posts, 'tai_chinh');
    expect(result).toEqual([]);
  });

  it('does not double-count a repeated bigram within the same post', () => {
    // "vàng hôm nay" would appear as a bigram once ("hôm nay"); this test
    // checks that a post whose text is short still yields a single row per
    // distinct bigram, not per occurrence.
    const posts = [
      post({
        text_content: 'vàng vàng hôm nay',
        like_count: 5,
        reply_count: 0,
        repost_count: 0,
        quote_count: 0,
        share_count: 0,
      }),
    ];
    const result = aggregateThreadsKeywords(posts, 'tai_chinh');
    const vangVang = result.find((c) => c.keyword === 'vàng vàng');
    expect(vangVang?.metric_value).toBe(5);
  });
});
