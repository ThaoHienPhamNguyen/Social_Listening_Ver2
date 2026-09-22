import type { CandidateTopicsReader } from './candidate-topics-reader';
import { getHotTopics } from './get-hot-topics';
import { flattenAndRankHotTopics } from './trending';
import type { CandidateTopic } from './types';

export interface TopicApiItem {
  keyword: string;
  source: CandidateTopic['source'];
  category: string[];
  metricValue: number;
  trendingScore: number | null;
  shareOfVoice: number | null;
}

export interface TopicsApiResult {
  date: string | null;
  topics: TopicApiItem[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDate(value: string): boolean {
  return DATE_RE.test(value);
}

export async function getTopicsForDate(
  reader: CandidateTopicsReader,
  category: string | null,
  date?: string
): Promise<TopicsApiResult> {
  const { date: resolvedDate, bySource } = await getHotTopics(reader, category, date);
  const ranked = flattenAndRankHotTopics(bySource);
  const topics: TopicApiItem[] = ranked.map((row) => ({
    keyword: row.keyword,
    source: row.source,
    category: row.categoryHint ?? [],
    metricValue: row.metricValue,
    trendingScore: row.trendingScore,
    shareOfVoice: row.shareOfVoice,
  }));
  return { date: resolvedDate, topics };
}
