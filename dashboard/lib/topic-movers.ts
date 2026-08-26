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
  categoryDate: string | null; // date of the row that supplied `category` — tracked
  // independently of buzz/date-of-last-row-seen so category resolution is not
  // order-dependent (a later-arriving row with category:null must not erase
  // an earlier row's valid category, regardless of which row the Supabase
  // query happens to return first — see final-review finding 1)
}

function aggregateByKeyword(rows: ThreadsEngagementDaily[]): Map<string, KeywordAgg> {
  const map = new Map<string, KeywordAgg>();
  for (const row of rows) {
    const existing = map.get(row.keyword) ?? { buzz: 0, category: null, categoryDate: null };
    const buzz = existing.buzz + threadsEngagementTotal(row);
    const shouldUpdateCategory =
      row.category !== null && (existing.categoryDate === null || row.date >= existing.categoryDate);
    const category = shouldUpdateCategory ? row.category : existing.category;
    const categoryDate = shouldUpdateCategory ? row.date : existing.categoryDate;
    map.set(row.keyword, { buzz, category, categoryDate });
  }
  return map;
}

// See this task's plan notes for why category resolution falls back to the
// previous period: a keyword can vanish entirely from the current period
// (its most useful "loser" case) and still needs a category to link to.
export function computeTopicMovers(
  currentRows: ThreadsEngagementDaily[],
  previousRows: ThreadsEngagementDaily[]
): { gainers: TopicMover[]; losers: TopicMover[]; hasRealGainers: boolean; hasRealLosers: boolean } {
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

  // Secondary sort by buzz breaks ties when every mover shares the same
  // deltaPct (e.g. all 100% because every keyword is new this period,
  // prevBuzz=0 for all of them) — without it, gainers-fallback and
  // losers-fallback both resolve to the same stable-sort order and end up
  // showing identical lists under different headings.
  const gainersSort = (a: TopicMover, b: TopicMover) => b.deltaPct - a.deltaPct || b.buzz - a.buzz;
  const losersSort = (a: TopicMover, b: TopicMover) => a.deltaPct - b.deltaPct || a.buzz - b.buzz;

  const trueGainers = movers.filter((m) => m.deltaPct > 0).sort(gainersSort);
  const gainers = trueGainers.length > 0 ? trueGainers.slice(0, 5) : [...movers].sort(gainersSort).slice(0, 5);
  const trueLosers = movers.filter((m) => m.deltaPct < 0).sort(losersSort);
  const losers = trueLosers.length > 0 ? trueLosers.slice(0, 5) : [...movers].sort(losersSort).slice(0, 5);

  return { gainers, losers, hasRealGainers: trueGainers.length > 0, hasRealLosers: trueLosers.length > 0 };
}
