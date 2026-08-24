import type { CandidateTopicsReader } from './candidate-topics-reader';
import type { ArticlesReader } from './articles-reader';
import type { ThreadsEngagementReader } from './threads-engagement-reader';
import type { FacebookEngagementReader } from './facebook-engagement-reader';
import type { ThreadsSentimentReader } from './threads-sentiment-reader';
import type { FacebookSentimentReader } from './facebook-sentiment-reader';
import { computeOverviewMetrics, computeDonutSegments, type OverviewMetrics, type DonutSegment } from './overview-metrics';

export async function getOverviewMetrics(
  candidateReader: CandidateTopicsReader,
  articlesReader: ArticlesReader,
  threadsEngagementReader: ThreadsEngagementReader,
  facebookEngagementReader: FacebookEngagementReader,
  threadsSentimentReader: ThreadsSentimentReader,
  facebookSentimentReader: FacebookSentimentReader,
  date: string
): Promise<{ metrics: OverviewMetrics; donut: DonutSegment[] }> {
  const [candidates, articles, threadsRows, facebookRows, threadsSentimentRows, facebookSentimentRows] =
    await Promise.all([
      candidateReader.getCandidatesForDate(date),
      articlesReader.getForDate(date),
      threadsEngagementReader.getForDate(date),
      facebookEngagementReader.getForDate(date),
      threadsSentimentReader.getForDate(date),
      facebookSentimentReader.getForDate(date),
    ]);

  const sentimentRows = [...threadsSentimentRows, ...facebookSentimentRows];

  return {
    metrics: computeOverviewMetrics(candidates, articles, threadsRows, facebookRows, sentimentRows),
    donut: computeDonutSegments(articles, threadsRows, facebookRows),
  };
}
