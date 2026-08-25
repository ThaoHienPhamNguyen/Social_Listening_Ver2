import type { ThreadsEngagementReader } from './threads-engagement-reader';
import { computeTopicMovers, type TopicMover } from './topic-movers';

function addDaysUTC(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function getTopicMovers(
  threadsEngagementReader: ThreadsEngagementReader,
  latestDate: string
): Promise<{ gainers: TopicMover[]; losers: TopicMover[]; hasRealGainers: boolean; hasRealLosers: boolean }> {
  const currentStart = addDaysUTC(latestDate, -6);
  const endDateExclusive = addDaysUTC(latestDate, 1);
  const previousStart = addDaysUTC(latestDate, -13);

  const allRows = await threadsEngagementReader.getForDateRange(previousStart, endDateExclusive);
  const currentRows = allRows.filter((r) => r.date >= currentStart);
  const previousRows = allRows.filter((r) => r.date < currentStart);

  return computeTopicMovers(currentRows, previousRows);
}
