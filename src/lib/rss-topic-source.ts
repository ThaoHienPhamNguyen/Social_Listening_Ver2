import type { DiscoverySource } from './discovery-source';
import type { RawCandidate } from '../types';
import type { ArticleRepository } from './article-repository';
import type { TopicExtractor } from './topic-extractor';
import { aggregateRssKeywords } from './aggregate-rss-keywords';
import { extractKeywords } from './keyword-extractor';

// metric_value should reflect one day's frequency (per spec §4), not a
// multi-day rolling count — the 7-day growth_rate baseline (rank-and-select.ts)
// already handles the multi-day comparison from candidate_topics' own history.
const LOOKBACK_DAYS = 1;

// Titles per LLM call — full sentences are heavier than the single keywords
// candidate-classifier.ts batches at 50/call, so this stays smaller, matching
// the same-shaped precedent already established for per-article text calls
// (sentiment-engagement-metrics-design.md's 20 bài/lần gọi).
const CHUNK_SIZE = 20;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export class RssTopicSource implements DiscoverySource {
  name = 'rss' as const;

  constructor(
    private repo: Pick<ArticleRepository, 'getRecentTitles'>,
    private extractor?: TopicExtractor
  ) {}

  async fetchCandidates(): Promise<RawCandidate[]> {
    const articles = await this.repo.getRecentTitles(LOOKBACK_DAYS);
    const withTopics: { topics: string[]; categories: string[] }[] = [];

    for (const batch of chunk(articles, CHUNK_SIZE)) {
      const titles = batch.map((a) => a.title);
      let topicsPerTitle: string[][];

      if (this.extractor) {
        try {
          topicsPerTitle = await this.extractor.extractTopics(titles);
        } catch (err) {
          // One chunk's LLM failure must not drop or block any other chunk,
          // or RSS's candidates for the day entirely — fall back to the
          // regex extractor for exactly this chunk's titles. Logged (not
          // pushed to result.errors — that's a deliberate scope boundary for
          // this fix wave, see final-fix-report.md finding 3) so a silently
          // failing API key/quota/model doesn't run 100% on regex forever
          // with zero production visibility.
          console.error(
            `RSS topic extraction failed for a chunk of ${titles.length} titles, falling back to regex: ${(err as Error).message}`
          );
          topicsPerTitle = titles.map((t) => extractKeywords(t));
        }
      } else {
        topicsPerTitle = titles.map((t) => extractKeywords(t));
      }

      batch.forEach((article, i) => {
        withTopics.push({ topics: topicsPerTitle[i] ?? [], categories: article.categories });
      });
    }

    return aggregateRssKeywords(withTopics);
  }
}
