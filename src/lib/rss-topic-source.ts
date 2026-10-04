import type { DiscoverySource } from './discovery-source';
import type { RawCandidate, TopicArticleData } from '../types';
import type { ArticleRepository } from './article-repository';
import type { TopicExtractor } from './topic-extractor';
import type { TopicArticleDataRepository } from './topic-article-data-repository';
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
    private extractor?: TopicExtractor,
    private articleLinkRepo?: Pick<TopicArticleDataRepository, 'upsertLinks'>,
    private now: () => Date = () => new Date()
  ) {}

  async fetchCandidates(): Promise<RawCandidate[]> {
    const articles = await this.repo.getRecentTitles(LOOKBACK_DAYS);
    const withTopics: { topics: string[]; categories: string[] }[] = [];
    const linkRows: Partial<TopicArticleData>[] = [];
    const date = this.now().toISOString().slice(0, 10);

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
        const topics = topicsPerTitle[i] ?? [];
        withTopics.push({ topics, categories: article.categories });
        // Dedupe before building link rows: extractKeywords()'s regex
        // fallback can return the same keyword twice for one title (its
        // entity-phrase pass and bigram pass can independently produce the
        // same string), and all of a run's linkRows go into ONE upsertLinks
        // call keyed on (source, keyword, article_url) — Postgres rejects an
        // upsert outright if that conflict target repeats within one batch
        // ("ON CONFLICT DO UPDATE command cannot affect row a second time"),
        // which would silently fail the whole day's link write for every
        // article in the batch, not just this one. Same reasoning as
        // deep-crawl.ts's post_url dedupe before its upsert, and the same
        // dedupe aggregateRssKeywords already does with `new Set` for
        // counting purposes.
        for (const topic of new Set(topics)) {
          linkRows.push({
            keyword: topic,
            source: 'rss',
            date,
            article_url: article.url,
            article_title: article.title,
            article_snippet: article.snippet,
          });
        }
      });
    }

    if (this.articleLinkRepo && linkRows.length > 0) {
      // Best-effort: a failure here must never block RSS's candidates for
      // the day from being discovered — it only means those keywords have
      // no linked source text for the summarize-topics job to find later,
      // which already degrades gracefully (that topic stays unsummarized).
      try {
        const { error } = await this.articleLinkRepo.upsertLinks(linkRows);
        if (error) console.error(`Failed to persist RSS topic→article links: ${error}`);
      } catch (err) {
        console.error(`Failed to persist RSS topic→article links: ${(err as Error).message}`);
      }
    }

    return aggregateRssKeywords(withTopics);
  }
}
