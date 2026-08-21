import type { DiscoverySource } from './discovery-source';
import type { RawCandidate } from '../types';
import type { ArticleRepository } from './article-repository';
import { aggregateRssKeywords } from './aggregate-rss-keywords';

// metric_value should reflect one day's frequency (per spec §4), not a
// multi-day rolling count — the 7-day growth_rate baseline (rank-and-select.ts)
// already handles the multi-day comparison from candidate_topics' own history.
const LOOKBACK_DAYS = 1;

export class RssTopicSource implements DiscoverySource {
  name = 'rss' as const;

  constructor(private repo: Pick<ArticleRepository, 'getRecentTitles'>) {}

  async fetchCandidates(): Promise<RawCandidate[]> {
    const titles = await this.repo.getRecentTitles(LOOKBACK_DAYS);
    return aggregateRssKeywords(titles);
  }
}
