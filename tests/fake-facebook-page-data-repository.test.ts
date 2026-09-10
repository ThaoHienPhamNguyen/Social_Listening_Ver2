import { describe, it, expect } from 'vitest';
import { FakeFacebookPageDataRepository } from './fakes/fake-facebook-page-data-repository';

describe('FakeFacebookPageDataRepository', () => {
  it('getPostsForDate returns only posts matching that date', async () => {
    const repo = new FakeFacebookPageDataRepository();
    await repo.upsertPosts([
      { page_url: 'https://www.facebook.com/cafef.vn', keyword: 'tai_chinh', category: 'tai_chinh', date: '2026-08-23', post_url: 'p1' },
      { page_url: 'https://www.facebook.com/cafef.vn', keyword: 'tai_chinh', category: 'tai_chinh', date: '2026-08-22', post_url: 'p2' },
    ]);

    const posts = await repo.getPostsForDate('2026-08-23');

    expect(posts).toHaveLength(1);
    expect(posts[0].post_url).toBe('p1');
  });
});
