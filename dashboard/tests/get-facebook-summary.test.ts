import { describe, it, expect } from 'vitest';
import { getFacebookSummary } from '../lib/get-facebook-summary';
import { FakeFacebookEngagementReader } from './fakes/fake-facebook-engagement-reader';
import { FakeFacebookSentimentReader } from './fakes/fake-facebook-sentiment-reader';

describe('getFacebookSummary', () => {
  it('returns a summary for the given category and date', async () => {
    const engagementReader = new FakeFacebookEngagementReader([
      { date: '2026-08-24', category: 'tai_chinh', total_like_count: 10, total_comment_count: 3, total_share_count: 2, post_count: 5 },
    ]);
    const sentimentReader = new FakeFacebookSentimentReader([
      { date: '2026-08-24', category: 'tai_chinh', sentiment: 'positive' },
      { date: '2026-08-24', category: 'tai_chinh', sentiment: 'negative' },
    ]);

    const result = await getFacebookSummary('tai_chinh', engagementReader, sentimentReader, '2026-08-24');

    expect(result?.totalEngagement).toBe(15);
    expect(result?.sentiment).toEqual({ positive: 1, negative: 1, neutral: 0 });
  });

  it('returns null when there is no engagement data for that category/date', async () => {
    const engagementReader = new FakeFacebookEngagementReader([]);
    const sentimentReader = new FakeFacebookSentimentReader([]);

    const result = await getFacebookSummary('tai_chinh', engagementReader, sentimentReader, '2026-08-24');

    expect(result).toBeNull();
  });
});
