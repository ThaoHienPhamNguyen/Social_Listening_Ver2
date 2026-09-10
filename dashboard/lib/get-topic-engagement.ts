import type { ThreadsEngagementReader } from './threads-engagement-reader';
import { attachEngagement, type EnrichedHotTopicRow } from './topic-engagement';
import type { HotTopicRow } from './hot-topics';
import type { CandidateTopic } from './types';

export async function enrichHotTopicsWithThreadsData(
  bySource: Record<CandidateTopic['source'], HotTopicRow[]>,
  engagementReader: ThreadsEngagementReader,
  date: string
): Promise<Record<CandidateTopic['source'], EnrichedHotTopicRow[]>> {
  const engagementRows = await engagementReader.getForDate(date);

  const engagementByKeyword = new Map(engagementRows.map((r) => [r.keyword, r]));

  const sources = Object.keys(bySource) as CandidateTopic['source'][];
  const result = {} as Record<CandidateTopic['source'], EnrichedHotTopicRow[]>;
  for (const source of sources) {
    result[source] = attachEngagement(bySource[source], engagementByKeyword);
  }
  return result;
}
