// dashboard/lib/get-hot-topics.ts
import type { CandidateTopicsReader } from './candidate-topics-reader';
import { buildHotTopicsForCategory, buildHotTopicsOverview, type HotTopicRow } from './hot-topics';
import { CATEGORIES } from './categories';
import type { CandidateTopic } from './types';

export interface HotTopicsResult {
  date: string | null;
  bySource: Record<CandidateTopic['source'], HotTopicRow[]>;
}

function emptyBySource(): Record<CandidateTopic['source'], HotTopicRow[]> {
  return { google_trends: [], youtube: [], rss: [] };
}

export async function getHotTopics(
  reader: CandidateTopicsReader,
  category: string | null
): Promise<HotTopicsResult> {
  const date = await reader.getLatestDate();
  if (date === null) {
    return { date: null, bySource: emptyBySource() };
  }
  const allCandidates = await reader.getCandidatesForDate(date);
  const bySource = category
    ? buildHotTopicsForCategory(allCandidates, category)
    : buildHotTopicsOverview(allCandidates, CATEGORIES.map((c) => c.value));
  return { date, bySource };
}
