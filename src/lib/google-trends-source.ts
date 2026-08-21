import GoogleTrendsApi from '@alkalisummer/google-trends-js';
import type { DiscoverySource } from './discovery-source';
import type { RawCandidate } from '../types';

// Google Trends' trafficGrowthRate is a percentage (e.g. 1000 = +1000%);
// YouTube/RSS growth_rate (rank-and-select.ts) is a ratio (e.g. 2 = doubled).
// Normalize to the ratio unit so candidate_topics.growth_rate is consistent
// across all three sources.
export function normalizeGrowthRate(percentGrowth: number): number {
  return percentGrowth / 100;
}

export class GoogleTrendsSource implements DiscoverySource {
  name = 'google_trends' as const;

  // Note: GoogleTrendsApi.dailyTrends's DailyTrendingTopicsOptions type only
  // accepts { geo, hl } — the library exposes no timeout/AbortSignal option
  // (verified against its .d.ts files), so no FETCH_TIMEOUT_MS is wired here
  // unlike youtube-source.ts / rss-fetcher.ts.
  async fetchCandidates(): Promise<RawCandidate[]> {
    const { data, error } = await GoogleTrendsApi.dailyTrends({ geo: 'VN', hl: 'vi' });
    if (error) {
      throw new Error(`GoogleTrendsApi.dailyTrends failed: ${error.message}`);
    }
    const items = data ?? [];
    return items.map((item) => ({
      keyword: item.keyword.toLowerCase().trim(),
      metric_value: item.traffic,
      growth_rate: normalizeGrowthRate(item.trafficGrowthRate),
    }));
  }
}
