import type { FacebookEngagementReader } from './facebook-engagement-reader';
import type { FacebookSentimentReader } from './facebook-sentiment-reader';
import { groupSentimentCounts } from './topic-engagement';
import { buildFacebookSummary, type FacebookSummary } from './facebook-summary';

export async function getFacebookSummary(
  category: string,
  engagementReader: FacebookEngagementReader,
  sentimentReader: FacebookSentimentReader,
  date: string
): Promise<FacebookSummary | null> {
  const [engagementRows, sentimentRows] = await Promise.all([
    engagementReader.getForDate(date),
    sentimentReader.getForDate(date),
  ]);

  const sentimentByCategory = groupSentimentCounts(
    sentimentRows.map((r) => ({ key: r.category, sentiment: r.sentiment }))
  );

  return buildFacebookSummary(category, engagementRows, sentimentByCategory);
}
