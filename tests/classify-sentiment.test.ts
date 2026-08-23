import { describe, it, expect } from 'vitest';
import { runClassifySentiment } from '../src/classify-sentiment';
import { FakeTopicSocialDataRepository } from './fakes/fake-topic-social-data-repository';
import { FakeFacebookPageDataRepository } from './fakes/fake-facebook-page-data-repository';
import { FakeSentimentClassifier } from './fakes/fake-sentiment-classifier';

describe('runClassifySentiment', () => {
  it('classifies unclassified posts from both Threads and Facebook, tagging the right repo', async () => {
    const threadsRepo = new FakeTopicSocialDataRepository();
    await threadsRepo.upsertPosts([
      { keyword: 'bitcoin', source: 'threads', date: '2026-08-23', post_url: 'https://threads.net/p/1', text_content: 'great news' },
    ]);
    const facebookRepo = new FakeFacebookPageDataRepository();
    await facebookRepo.upsertPosts([
      { page_url: 'https://www.facebook.com/cafef.vn', category: 'tai_chinh', date: '2026-08-23', post_url: 'p1', text_content: 'bad news' },
    ]);
    const classifier = new FakeSentimentClassifier();
    const threadsId = threadsRepo.posts[0].id!;
    const facebookId = facebookRepo.posts[0].id!;
    classifier.labels[threadsId] = 'positive';
    classifier.labels[facebookId] = 'negative';

    const result = await runClassifySentiment({ threadsRepo, facebookRepo, classifier });

    expect(result.classified).toBe(2);
    expect(result.errors).toEqual([]);
    expect(threadsRepo.posts[0].sentiment).toBe('positive');
    expect(facebookRepo.posts[0].sentiment).toBe('negative');
  });

  it('does nothing and makes no classifier calls when there are no unclassified posts', async () => {
    const threadsRepo = new FakeTopicSocialDataRepository();
    const facebookRepo = new FakeFacebookPageDataRepository();
    const classifier = new FakeSentimentClassifier();

    const result = await runClassifySentiment({ threadsRepo, facebookRepo, classifier });

    expect(result.classified).toBe(0);
    expect(classifier.calls).toEqual([]);
  });

  it('chunks posts into groups of 20 per classifier call', async () => {
    const threadsRepo = new FakeTopicSocialDataRepository();
    const rows = [];
    for (let i = 0; i < 25; i++) {
      rows.push({ keyword: 'bitcoin', source: 'threads' as const, date: '2026-08-23', post_url: `https://threads.net/p/${i}`, text_content: `post ${i}` });
    }
    await threadsRepo.upsertPosts(rows);
    const facebookRepo = new FakeFacebookPageDataRepository();
    const classifier = new FakeSentimentClassifier();

    await runClassifySentiment({ threadsRepo, facebookRepo, classifier });

    expect(classifier.calls).toHaveLength(2);
    expect(classifier.calls[0]).toHaveLength(20);
    expect(classifier.calls[1]).toHaveLength(5);
  });

  it("isolates one chunk's classification failure from the rest", async () => {
    const threadsRepo = new FakeTopicSocialDataRepository();
    const rows = [];
    for (let i = 0; i < 25; i++) {
      rows.push({ keyword: 'bitcoin', source: 'threads' as const, date: '2026-08-23', post_url: `https://threads.net/p/${i}`, text_content: `post ${i}` });
    }
    await threadsRepo.upsertPosts(rows);
    const facebookRepo = new FakeFacebookPageDataRepository();
    const classifier = new FakeSentimentClassifier();
    classifier.errorOnCall = 0;
    for (const post of threadsRepo.posts.slice(20)) {
      classifier.labels[post.id!] = 'neutral';
    }

    const result = await runClassifySentiment({ threadsRepo, facebookRepo, classifier });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('classification failed');
    expect(result.classified).toBe(5);
  });

  it("isolates one post's updateSentiment failure from the rest", async () => {
    const threadsRepo = new FakeTopicSocialDataRepository();
    await threadsRepo.upsertPosts([
      { keyword: 'bitcoin', source: 'threads', date: '2026-08-23', post_url: 'https://threads.net/p/1', text_content: 'a' },
      { keyword: 'bitcoin', source: 'threads', date: '2026-08-23', post_url: 'https://threads.net/p/2', text_content: 'b' },
    ]);
    const facebookRepo = new FakeFacebookPageDataRepository();
    const classifier = new FakeSentimentClassifier();
    const [post1, post2] = threadsRepo.posts;
    classifier.labels[post1.id!] = 'positive';
    classifier.labels[post2.id!] = 'negative';
    threadsRepo.updateSentimentErrorForId[post1.id!] = 'db down';

    const result = await runClassifySentiment({ threadsRepo, facebookRepo, classifier });

    expect(result.errors).toEqual([`update failed for post "${post1.id}": db down`]);
    expect(result.classified).toBe(1);
    expect(post1.sentiment).toBeNull();
    expect(post2.sentiment).toBe('negative');
  });

  it('ignores a label outside the known sentiment set', async () => {
    const threadsRepo = new FakeTopicSocialDataRepository();
    await threadsRepo.upsertPosts([
      { keyword: 'bitcoin', source: 'threads', date: '2026-08-23', post_url: 'https://threads.net/p/1', text_content: 'a' },
    ]);
    const facebookRepo = new FakeFacebookPageDataRepository();
    const classifier = new FakeSentimentClassifier();
    const post = threadsRepo.posts[0];
    classifier.labels[post.id!] = 'happy';

    const result = await runClassifySentiment({ threadsRepo, facebookRepo, classifier });

    expect(result.classified).toBe(0);
    expect(post.sentiment).toBeNull();
  });
});
