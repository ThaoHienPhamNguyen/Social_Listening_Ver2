import type { ArticlesReader } from './articles-reader';
import type { ThreadsEngagementReader } from './threads-engagement-reader';
import type { FacebookEngagementReader } from './facebook-engagement-reader';
import { computeBuzzTrend, type BuzzTrendPoint } from './buzz-trend';

function addDaysUTC(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function getBuzzTrend(
  articlesReader: ArticlesReader,
  threadsEngagementReader: ThreadsEngagementReader,
  facebookEngagementReader: FacebookEngagementReader,
  latestDate: string
): Promise<BuzzTrendPoint[]> {
  const startDate = addDaysUTC(latestDate, -6);
  const endDateExclusive = addDaysUTC(latestDate, 1);
  const dates = Array.from({ length: 7 }, (_, i) => addDaysUTC(startDate, i));

  const [articles, threadsRows, facebookRows] = await Promise.all([
    articlesReader.getForDateRange(startDate, endDateExclusive),
    threadsEngagementReader.getForDateRange(startDate, endDateExclusive),
    facebookEngagementReader.getForDateRange(startDate, endDateExclusive),
  ]);

  return computeBuzzTrend(articles, threadsRows, facebookRows, dates);
}
