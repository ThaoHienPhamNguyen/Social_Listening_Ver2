import type { ThreadsEngagementReader } from './threads-engagement-reader';
import type { ThreadsSentimentReader } from './threads-sentiment-reader';
import { groupSentimentCounts, attachEngagement, type EnrichedHotTopicRow } from './topic-engagement';
import type { HotTopicRow } from './hot-topics';
import type { CandidateTopic } from './types';

export async function enrichHotTopicsWithThreadsData(
  bySource: Record<CandidateTopic['source'], HotTopicRow[]>,
  engagementReader: ThreadsEngagementReader,
  sentimentReader: ThreadsSentimentReader,
  date: string
): Promise<Record<CandidateTopic['source'], EnrichedHotTopicRow[]>> {
  const [engagementRows, sentimentRows] = await Promise.all([
    engagementReader.getForDate(date),
    sentimentReader.getForDate(date),
  ]);

  const engagementByKeyword = new Map(engagementRows.map((r) => [r.keyword, r]));
  const sentimentByKeyword = groupSentimentCounts(
    sentimentRows.map((r) => ({ key: r.keyword, sentiment: r.sentiment }))
  );

  const sources = Object.keys(bySource) as CandidateTopic['source'][];
  const result = {} as Record<CandidateTopic['source'], EnrichedHotTopicRow[]>;
  for (const source of sources) {
    result[source] = attachEngagement(bySource[source], engagementByKeyword, sentimentByKeyword);
  }
  return result;
}
