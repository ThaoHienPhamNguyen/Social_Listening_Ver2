import type { DiscoverySource } from './discovery-source';
import type { RawCandidate } from '../types';
import type { ArticleRepository } from './article-repository';
import { aggregateRssKeywords } from './aggregate-rss-keywords';

const LOOKBACK_DAYS = 5;

export class RssTopicSource implements DiscoverySource {
  name = 'rss' as const;

  constructor(private repo: Pick<ArticleRepository, 'getRecentTitles'>) {}

  async fetchCandidates(): Promise<RawCandidate[]> {
    const titles = await this.repo.getRecentTitles(LOOKBACK_DAYS);
    return aggregateRssKeywords(titles);
  }
}
