import { describe, it, expect } from 'vitest';
import { FakeFacebookPageDataRepository } from './fakes/fake-facebook-page-data-repository';

describe('FakeFacebookPageDataRepository', () => {
  it('getUnclassifiedPosts returns only posts with sentiment not yet set', async () => {
    const repo = new FakeFacebookPageDataRepository();
    await repo.upsertPosts([
      { page_url: 'https://www.facebook.com/cafef.vn', category: 'tai_chinh', date: '2026-08-23', post_url: 'p1', text_content: 'hello' },
    ]);
    const [post] = repo.posts;

    const unclassified = await repo.getUnclassifiedPosts();
    expect(unclassified).toEqual([{ id: post.id, text_content: 'hello' }]);

    await repo.updateSentiment(post.id!, 'neutral');
    expect(await repo.getUnclassifiedPosts()).toEqual([]);
  });

  it('updateSentiment sets the sentiment field on the matching post', async () => {
    const repo = new FakeFacebookPageDataRepository();
    await repo.upsertPosts([
      { page_url: 'https://www.facebook.com/cafef.vn', category: 'tai_chinh', date: '2026-08-23', post_url: 'p1' },
    ]);
    const [post] = repo.posts;

    const { error } = await repo.updateSentiment(post.id!, 'positive');

    expect(error).toBeNull();
    expect(repo.posts[0].sentiment).toBe('positive');
  });

  it('updateSentiment returns the configured error for a specific id and leaves sentiment unset', async () => {
    const repo = new FakeFacebookPageDataRepository();
    await repo.upsertPosts([
      { page_url: 'https://www.facebook.com/cafef.vn', category: 'tai_chinh', date: '2026-08-23', post_url: 'p1' },
    ]);
    const [post] = repo.posts;
    repo.updateSentimentErrorForId[post.id!] = 'simulated failure';

    const { error } = await repo.updateSentiment(post.id!, 'positive');

    expect(error).toBe('simulated failure');
    expect(repo.posts[0].sentiment).toBeNull();
  });

  it('getPostsForDate returns only posts matching that date', async () => {
    const repo = new FakeFacebookPageDataRepository();
    await repo.upsertPosts([
      { page_url: 'https://www.facebook.com/cafef.vn', category: 'tai_chinh', date: '2026-08-23', post_url: 'p1' },
      { page_url: 'https://www.facebook.com/cafef.vn', category: 'tai_chinh', date: '2026-08-22', post_url: 'p2' },
    ]);

    const posts = await repo.getPostsForDate('2026-08-23');

    expect(posts).toHaveLength(1);
    expect(posts[0].post_url).toBe('p1');
  });
});
