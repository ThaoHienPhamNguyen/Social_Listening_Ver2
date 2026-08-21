import GoogleTrendsApi from '@alkalisummer/google-trends-js';
import type { DiscoverySource } from './discovery-source';
import type { RawCandidate } from '../types';

export class GoogleTrendsSource implements DiscoverySource {
  name = 'google_trends' as const;

  async fetchCandidates(): Promise<RawCandidate[]> {
    const result = await GoogleTrendsApi.dailyTrends({ geo: 'VN', hl: 'vi' });
    const items = result.data ?? [];
    return items.map((item) => ({
      keyword: item.keyword.toLowerCase().trim(),
      metric_value: item.traffic,
      growth_rate: item.trafficGrowthRate,
    }));
  }
}
