import type { CandidateTopicsReader } from './candidate-topics-reader';
import type { ArticlesReader } from './articles-reader';
import type { ThreadsEngagementReader } from './threads-engagement-reader';
import type { FacebookEngagementReader } from './facebook-engagement-reader';
import { computeSectorMetrics, type SectorMetrics } from './sector-metrics';
import { computeKpiDelta } from './overview-metrics';

function addDaysUTC(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function getSectorMetrics(
  candidateReader: CandidateTopicsReader,
  articlesReader: ArticlesReader,
  threadsEngagementReader: ThreadsEngagementReader,
  facebookEngagementReader: FacebookEngagementReader,
  category: string,
  latestDate: string
): Promise<{
  metrics: SectorMetrics;
  buzzVolumeDelta: { text: string; positive: boolean };
  audienceScaleDelta: { text: string; positive: boolean };
}> {
  const currentStart = addDaysUTC(latestDate, -6);
  const endDateExclusive = addDaysUTC(latestDate, 1);
  const previousStart = addDaysUTC(latestDate, -13);

  const [allCandidates, allArticles, allThreadsRows, allFacebookRows] = await Promise.all([
    candidateReader.getShortlistedForDateRange(category, previousStart, endDateExclusive),
    articlesReader.getForDateRange(previousStart, endDateExclusive),
    threadsEngagementReader.getForDateRange(previousStart, endDateExclusive),
    facebookEngagementReader.getForDateRange(previousStart, endDateExclusive),
  ]);

  const articlesInCategory = allArticles.filter((a) => a.categories.includes(category));
  const threadsInCategory = allThreadsRows.filter((r) => r.category === category);
  const facebookInCategory = allFacebookRows.filter((r) => r.category === category);

  const currentMetrics = computeSectorMetrics(
    allCandidates.filter((c) => c.date >= currentStart),
    articlesInCategory.filter((a) => a.date >= currentStart),
    threadsInCategory.filter((r) => r.date >= currentStart),
    facebookInCategory.filter((r) => r.date >= currentStart)
  );
  const previousMetrics = computeSectorMetrics(
    allCandidates.filter((c) => c.date < currentStart),
    articlesInCategory.filter((a) => a.date < currentStart),
    threadsInCategory.filter((r) => r.date < currentStart),
    facebookInCategory.filter((r) => r.date < currentStart)
  );

  return {
    metrics: currentMetrics,
    buzzVolumeDelta: computeKpiDelta(currentMetrics.buzzVolume7d, previousMetrics.buzzVolume7d),
    audienceScaleDelta: computeKpiDelta(currentMetrics.audienceScale7d, previousMetrics.audienceScale7d),
  };
}
