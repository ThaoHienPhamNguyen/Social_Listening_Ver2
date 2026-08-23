import { describe, it, expect } from 'vitest';
import { FakeTopicSocialDataRepository } from './fakes/fake-topic-social-data-repository';

describe('FakeTopicSocialDataRepository', () => {
  it('upsertPosts adds every row in the batch', async () => {
    const repo = new FakeTopicSocialDataRepository();
    const { error, count } = await repo.upsertPosts([
      { keyword: 'bitcoin', source: 'threads', date: '2026-08-23', post_url: 'https://threads.net/p/1' },
      { keyword: 'bitcoin', source: 'threads', date: '2026-08-23', post_url: 'https://threads.net/p/2' },
    ]);
    expect(error).toBeNull();
    expect(count).toBe(2);
    expect(repo.posts).toHaveLength(2);
  });

  it('hasDataForDate returns true only when a row exists for that date', async () => {
    const repo = new FakeTopicSocialDataRepository();
    await repo.upsertPosts([
      { keyword: 'bitcoin', source: 'threads', date: '2026-08-23', post_url: 'https://threads.net/p/1' },
    ]);
    expect(await repo.hasDataForDate('2026-08-23')).toBe(true);
    expect(await repo.hasDataForDate('2026-08-22')).toBe(false);
  });

  it('upsertPosts returns the configured error and adds nothing when upsertError is set', async () => {
    const repo = new FakeTopicSocialDataRepository();
    repo.upsertError = 'simulated failure';
    const { error, count } = await repo.upsertPosts([
      { keyword: 'bitcoin', source: 'threads', date: '2026-08-23', post_url: 'https://threads.net/p/1' },
    ]);
    expect(error).toBe('simulated failure');
    expect(count).toBe(0);
    expect(repo.posts).toHaveLength(0);
  });

  it('getUnclassifiedPosts returns only posts with sentiment not yet set', async () => {
    const repo = new FakeTopicSocialDataRepository();
    await repo.upsertPosts([
      { keyword: 'bitcoin', source: 'threads', date: '2026-08-23', post_url: 'https://threads.net/p/1', text_content: 'hello' },
    ]);
    const [post] = repo.posts;

    const unclassified = await repo.getUnclassifiedPosts();
    expect(unclassified).toEqual([{ id: post.id, text_content: 'hello' }]);

    await repo.updateSentiment(post.id!, 'positive');
    expect(await repo.getUnclassifiedPosts()).toEqual([]);
  });

  it('updateSentiment sets the sentiment field on the matching post', async () => {
    const repo = new FakeTopicSocialDataRepository();
    await repo.upsertPosts([
      { keyword: 'bitcoin', source: 'threads', date: '2026-08-23', post_url: 'https://threads.net/p/1' },
    ]);
    const [post] = repo.posts;

    const { error } = await repo.updateSentiment(post.id!, 'negative');

    expect(error).toBeNull();
    expect(repo.posts[0].sentiment).toBe('negative');
  });

  it('updateSentiment returns the configured error for a specific id and leaves sentiment unset', async () => {
    const repo = new FakeTopicSocialDataRepository();
    await repo.upsertPosts([
      { keyword: 'bitcoin', source: 'threads', date: '2026-08-23', post_url: 'https://threads.net/p/1' },
    ]);
    const [post] = repo.posts;
    repo.updateSentimentErrorForId[post.id!] = 'simulated failure';

    const { error } = await repo.updateSentiment(post.id!, 'positive');

    expect(error).toBe('simulated failure');
    expect(repo.posts[0].sentiment).toBeNull();
  });

  it('getPostsForDate returns only posts matching that date', async () => {
    const repo = new FakeTopicSocialDataRepository();
    await repo.upsertPosts([
      { keyword: 'bitcoin', source: 'threads', date: '2026-08-23', post_url: 'https://threads.net/p/1' },
      { keyword: 'bitcoin', source: 'threads', date: '2026-08-22', post_url: 'https://threads.net/p/2' },
    ]);

    const posts = await repo.getPostsForDate('2026-08-23');

    expect(posts).toHaveLength(1);
    expect(posts[0].post_url).toBe('https://threads.net/p/1');
  });
});
