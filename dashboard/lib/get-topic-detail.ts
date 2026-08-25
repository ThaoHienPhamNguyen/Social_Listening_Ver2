import type { CandidateTopicsReader } from './candidate-topics-reader';
import type { ThreadsEngagementReader } from './threads-engagement-reader';
import type { ThreadsSentimentReader } from './threads-sentiment-reader';
import { computeTopicDetail, type TopicDetailData } from './topic-detail';

function addDaysUTC(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function getTopicDetail(
  candidateReader: CandidateTopicsReader,
  threadsEngagementReader: ThreadsEngagementReader,
  threadsSentimentReader: ThreadsSentimentReader,
  keyword: string,
  latestDate: string
): Promise<TopicDetailData | null> {
  const startDate = addDaysUTC(latestDate, -6);
  const endDateExclusive = addDaysUTC(latestDate, 1);
  const dates = Array.from({ length: 7 }, (_, i) => addDaysUTC(startDate, i));

  const [candidateHistory, threadsRows, sentimentRows] = await Promise.all([
    candidateReader.getHistoryForKeyword(keyword, startDate, endDateExclusive),
    threadsEngagementReader.getForDateRange(startDate, endDateExclusive),
    threadsSentimentReader.getForDateRange(startDate, endDateExclusive),
  ]);

  const keywordThreadsRows = threadsRows.filter((r) => r.keyword === keyword);
  const keywordSentimentRows = sentimentRows.filter((r) => r.keyword === keyword);

  return computeTopicDetail(keyword, candidateHistory, keywordThreadsRows, keywordSentimentRows, dates);
}
