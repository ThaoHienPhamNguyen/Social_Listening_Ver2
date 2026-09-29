import { describe, it, expect } from 'vitest';
import { FakeTopicExtractor } from './fakes/fake-topic-extractor';

describe('FakeTopicExtractor', () => {
  it('records the texts it was called with', async () => {
    const extractor = new FakeTopicExtractor();
    await extractor.extractTopics(['a', 'b']);
    expect(extractor.calls).toEqual([['a', 'b']]);
  });

  it('returns the configured topics for each text, defaulting to an empty array', async () => {
    const extractor = new FakeTopicExtractor();
    extractor.topicsByText = { 'Giá vàng tăng mạnh': ['giá vàng'] };

    const result = await extractor.extractTopics(['Giá vàng tăng mạnh', 'Một đoạn khác']);

    expect(result).toEqual([['giá vàng'], []]);
  });

  it('throws when shouldThrow is set, instead of returning topics', async () => {
    const extractor = new FakeTopicExtractor();
    extractor.shouldThrow = true;

    await expect(extractor.extractTopics(['bất kỳ'])).rejects.toThrow();
  });
});
