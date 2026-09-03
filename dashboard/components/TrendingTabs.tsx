'use client';

import { useState } from 'react';
import { TrendingTable } from './TrendingTable';
import type { EnrichedHotTopicRow } from '../lib/topic-engagement';

// Both `trending` and `recent` are pre-sorted server-side (flattenAndRankHotTopics
// and sortByRecency respectively) — this component only toggles which
// already-computed array is displayed, no client-side sorting/fetching.
export function TrendingTabs({
  trending,
  recent,
  limit,
}: {
  trending: EnrichedHotTopicRow[];
  recent: EnrichedHotTopicRow[];
  limit?: number;
}) {
  const [tab, setTab] = useState<'trending' | 'recent'>('trending');
  const rows = tab === 'trending' ? trending : recent;
  const shown = limit ? rows.slice(0, limit) : rows;

  return (
    <div>
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setTab('trending')}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
            tab === 'trending' ? 'bg-brand text-white' : 'bg-muted text-ink-2 hover:bg-line'
          }`}
        >
          Trending
        </button>
        <button
          onClick={() => setTab('recent')}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
            tab === 'recent' ? 'bg-brand text-white' : 'bg-muted text-ink-2 hover:bg-line'
          }`}
        >
          Mới nhất
        </button>
      </div>
      <TrendingTable rows={shown} />
    </div>
  );
}
