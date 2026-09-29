import { describe, it, expect } from 'vitest';
import { FakeRssTopicExtractor } from './fakes/fake-rss-topic-extractor';

describe('FakeRssTopicExtractor', () => {
  it('records the titles it was called with', async () => {
    const extractor = new FakeRssTopicExtractor();
    await extractor.extractTopics(['a', 'b']);
    expect(extractor.calls).toEqual([['a', 'b']]);
  });

  it('returns the configured topics for each title, defaulting to an empty array', async () => {
    const extractor = new FakeRssTopicExtractor();
    extractor.topicsByTitle = { 'Giá vàng tăng mạnh': ['giá vàng'] };

    const result = await extractor.extractTopics(['Giá vàng tăng mạnh', 'Một tiêu đề khác']);

    expect(result).toEqual([['giá vàng'], []]);
  });

  it('throws when shouldThrow is set, instead of returning topics', async () => {
    const extractor = new FakeRssTopicExtractor();
    extractor.shouldThrow = true;

    await expect(extractor.extractTopics(['bất kỳ'])).rejects.toThrow();
  });
});
