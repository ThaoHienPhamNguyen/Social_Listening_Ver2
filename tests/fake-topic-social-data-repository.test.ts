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
});
