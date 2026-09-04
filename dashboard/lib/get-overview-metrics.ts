import type { CandidateTopicsReader } from './candidate-topics-reader';
import type { ArticlesReader } from './articles-reader';
import type { ThreadsEngagementReader } from './threads-engagement-reader';
import type { FacebookEngagementReader } from './facebook-engagement-reader';
import type { ThreadsSentimentReader } from './threads-sentiment-reader';
import type { FacebookSentimentReader } from './facebook-sentiment-reader';
import {
  computeOverviewMetrics,
  computeDonutSegments,
  computeKpiDelta,
  type OverviewMetrics,
  type DonutSegment,
} from './overview-metrics';

function addDaysUTC(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface OverviewMetricsResult {
  metrics: OverviewMetrics;
  donut: DonutSegment[];
  deltas: {
    buzzVolume: { text: string; positive: boolean };
    audienceScale: { text: string; positive: boolean };
  };
}

export async function getOverviewMetrics(
  candidateReader: CandidateTopicsReader,
  articlesReader: ArticlesReader,
  threadsEngagementReader: ThreadsEngagementReader,
  facebookEngagementReader: FacebookEngagementReader,
  threadsSentimentReader: ThreadsSentimentReader,
  facebookSentimentReader: FacebookSentimentReader,
  date: string
): Promise<OverviewMetricsResult> {
  const previousDate = addDaysUTC(date, -7);

  const [candidates, articles, threadsRows, facebookRows, threadsSentimentRows, facebookSentimentRows] =
    await Promise.all([
      candidateReader.getCandidatesForDate(date),
      articlesReader.getForDate(date),
      threadsEngagementReader.getForDate(date),
      facebookEngagementReader.getForDate(date),
      threadsSentimentReader.getForDate(date),
      facebookSentimentReader.getForDate(date),
    ]);

  const [prevArticles, prevThreadsRows, prevFacebookRows] = await Promise.all([
    articlesReader.getForDate(previousDate),
    threadsEngagementReader.getForDate(previousDate),
    facebookEngagementReader.getForDate(previousDate),
  ]);

  const sentimentRows = [...threadsSentimentRows, ...facebookSentimentRows];
  const metrics = computeOverviewMetrics(candidates, articles, threadsRows, facebookRows, sentimentRows);
  const donut = computeDonutSegments(articles, threadsRows, facebookRows);

  // Reuse computeOverviewMetrics for the previous-day figures too, passing
  // empty arrays for candidates/sentimentRows since those only feed
  // topicsTrending/sentimentScore — fields this delta computation doesn't
  // need — rather than re-deriving the buzzVolume/audienceScale formulas
  // inline a second time.
  const prevMetrics = computeOverviewMetrics([], prevArticles, prevThreadsRows, prevFacebookRows, []);

  return {
    metrics,
    donut,
    deltas: {
      buzzVolume: computeKpiDelta(metrics.buzzVolume, prevMetrics.buzzVolume, 'so với cùng kỳ tuần trước'),
      audienceScale: computeKpiDelta(metrics.audienceScale, prevMetrics.audienceScale, 'so với cùng kỳ tuần trước'),
    },
  };
}
