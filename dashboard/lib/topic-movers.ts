import { threadsEngagementTotal } from './topic-engagement';
import type { ThreadsEngagementDaily } from './types';

export interface TopicMover {
  keyword: string;
  category: string;
  buzz: number;
  deltaPct: number;
}

interface KeywordAgg {
  buzz: number;
  category: string | null;
  latestDate: string;
}

function aggregateByKeyword(rows: ThreadsEngagementDaily[]): Map<string, KeywordAgg> {
  const map = new Map<string, KeywordAgg>();
  for (const row of rows) {
    const existing = map.get(row.keyword);
    const buzz = (existing?.buzz ?? 0) + threadsEngagementTotal(row);
    const isNewest = existing === undefined || row.date >= existing.latestDate;
    const category = row.category !== null && isNewest ? row.category : (existing?.category ?? null);
    const latestDate = existing === undefined || row.date > existing.latestDate ? row.date : existing.latestDate;
    map.set(row.keyword, { buzz, category, latestDate });
  }
  return map;
}

// See this task's plan notes for why category resolution falls back to the
// previous period: a keyword can vanish entirely from the current period
// (its most useful "loser" case) and still needs a category to link to.
export function computeTopicMovers(
  currentRows: ThreadsEngagementDaily[],
  previousRows: ThreadsEngagementDaily[]
): { gainers: TopicMover[]; losers: TopicMover[]; hasRealLosers: boolean } {
  const current = aggregateByKeyword(currentRows);
  const previous = aggregateByKeyword(previousRows);

  const keywords = new Set([...current.keys(), ...previous.keys()]);
  const movers: TopicMover[] = [];
  for (const keyword of keywords) {
    const curr = current.get(keyword);
    const prev = previous.get(keyword);
    const category = curr?.category ?? prev?.category ?? null;
    if (category === null) continue;

    const buzz = curr?.buzz ?? 0;
    const prevBuzz = prev?.buzz ?? 0;
    if (buzz === 0 && prevBuzz === 0) continue;

    const deltaPct = prevBuzz > 0 ? ((buzz - prevBuzz) / prevBuzz) * 100 : 100;
    movers.push({ keyword, category, buzz, deltaPct });
  }

  const gainers = [...movers].sort((a, b) => b.deltaPct - a.deltaPct).slice(0, 5);
  const trueLosers = movers.filter((m) => m.deltaPct < 0).sort((a, b) => a.deltaPct - b.deltaPct);
  const losers =
    trueLosers.length > 0 ? trueLosers.slice(0, 5) : [...movers].sort((a, b) => a.deltaPct - b.deltaPct).slice(0, 5);

  return { gainers, losers, hasRealLosers: trueLosers.length > 0 };
}
