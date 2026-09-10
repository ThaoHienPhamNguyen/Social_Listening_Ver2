import type { CandidateTopicsReader } from './candidate-topics-reader';
import type { ArticlesReader } from './articles-reader';
import type { ThreadsEngagementReader } from './threads-engagement-reader';
import type { FacebookEngagementReader } from './facebook-engagement-reader';
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
  date: string
): Promise<OverviewMetricsResult> {
  const previousDate = addDaysUTC(date, -7);

  const [candidates, articles, threadsRows, facebookRows] =
    await Promise.all([
      candidateReader.getCandidatesForDate(date),
      articlesReader.getForDate(date),
      threadsEngagementReader.getForDate(date),
      facebookEngagementReader.getForDate(date),
    ]);

  const [prevArticles, prevThreadsRows, prevFacebookRows] = await Promise.all([
    articlesReader.getForDate(previousDate),
    threadsEngagementReader.getForDate(previousDate),
    facebookEngagementReader.getForDate(previousDate),
  ]);

  const metrics = computeOverviewMetrics(candidates, articles, threadsRows, facebookRows);
  const donut = computeDonutSegments(articles, threadsRows, facebookRows);

  // Reuse computeOverviewMetrics for the previous-day figures too, passing
  // an empty array for candidates since that only feeds topicsTrending — a
  // field this delta computation doesn't need — rather than re-deriving the
  // buzzVolume/audienceScale formulas inline a second time.
  const prevMetrics = computeOverviewMetrics([], prevArticles, prevThreadsRows, prevFacebookRows);

  return {
    metrics,
    donut,
    deltas: {
      buzzVolume: computeKpiDelta(metrics.buzzVolume, prevMetrics.buzzVolume, 'so với cùng kỳ tuần trước'),
      audienceScale: computeKpiDelta(metrics.audienceScale, prevMetrics.audienceScale, 'so với cùng kỳ tuần trước'),
    },
  };
}
