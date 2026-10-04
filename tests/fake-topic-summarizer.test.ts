import { describe, it, expect } from 'vitest';
import { FakeTopicSummarizer } from './fakes/fake-topic-summarizer';

describe('FakeTopicSummarizer', () => {
  it('returns the configured summary for a matching keyword, null otherwise', async () => {
    const fake = new FakeTopicSummarizer();
    fake.summaryByKeyword['vàng'] = 'Giá vàng tăng.';

    const result = await fake.summarizeTopics([{ keyword: 'vàng', texts: ['t'] }, { keyword: 'khác', texts: ['t'] }]);

    expect(result).toEqual(['Giá vàng tăng.', null]);
    expect(fake.calls).toHaveLength(1);
  });

  it('throws when shouldThrow is set', async () => {
    const fake = new FakeTopicSummarizer();
    fake.shouldThrow = true;
    await expect(fake.summarizeTopics([{ keyword: 'x', texts: [] }])).rejects.toThrow();
  });
});
