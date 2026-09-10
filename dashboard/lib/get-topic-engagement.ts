import type { ThreadsEngagementReader } from './threads-engagement-reader';
import type { ThreadsSentimentReader } from './threads-sentiment-reader';
import { attachEngagement, type EnrichedHotTopicRow } from './topic-engagement';
import type { HotTopicRow } from './hot-topics';
import type { CandidateTopic } from './types';

// sentimentReader is still fetched here but no longer feeds attachEngagement
// (sentiment was dropped from TopicEngagement in Task 14). Kept in place for
// Task 17, which finishes removing sentiment-reader wiring from this file.
export async function enrichHotTopicsWithThreadsData(
  bySource: Record<CandidateTopic['source'], HotTopicRow[]>,
  engagementReader: ThreadsEngagementReader,
  sentimentReader: ThreadsSentimentReader,
  date: string
): Promise<Record<CandidateTopic['source'], EnrichedHotTopicRow[]>> {
  const [engagementRows] = await Promise.all([
    engagementReader.getForDate(date),
    sentimentReader.getForDate(date),
  ]);

  const engagementByKeyword = new Map(engagementRows.map((r) => [r.keyword, r]));

  const sources = Object.keys(bySource) as CandidateTopic['source'][];
  const result = {} as Record<CandidateTopic['source'], EnrichedHotTopicRow[]>;
  for (const source of sources) {
    result[source] = attachEngagement(bySource[source], engagementByKeyword);
  }
  return result;
}
