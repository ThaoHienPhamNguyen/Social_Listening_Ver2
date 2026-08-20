import type { ArticleRepository } from './lib/article-repository';
import type { ContentExtractor } from './lib/article-extractor';
import type { RssSource } from './types';
import { categorize } from './lib/categorize';

export const MAX_FETCH_ATTEMPTS = 3;

export interface CrawlDeps {
  repo: ArticleRepository;
  extractor: ContentExtractor;
  /** Feed configs, used to look up each article's default category by source_id
   *  so categories can be recomputed against the full crawled content. If a
   *  row's source_id isn't found here, its categories are left unchanged. */
  sources?: RssSource[];
}

export interface CrawlResult {
  processed: number;
  succeeded: number;
  failed: number;
}

export async function crawlPendingArticles(deps: CrawlDeps, limit = 200): Promise<CrawlResult> {
  const result: CrawlResult = { processed: 0, succeeded: 0, failed: 0 };
  const pending = await deps.repo.getPendingArticles(limit, MAX_FETCH_ATTEMPTS);

  for (const row of pending) {
    result.processed += 1;
    const attempts = row.fetch_attempts + 1;

    try {
      const extracted = await deps.extractor.extract(row.url);
      if (!extracted?.text) {
        throw new Error('no content extracted');
      }

      const source = (deps.sources ?? []).find((s) => s.id === row.source_id);
      const categories = source
        ? Array.from(new Set([...row.categories, ...categorize(source.defaultCategory, extracted.text)]))
        : row.categories;

      await deps.repo.markDone(row.id, extracted.text, attempts, categories);
      result.succeeded += 1;
    } catch {
      await deps.repo.markRetryOrFailed(row.id, attempts, MAX_FETCH_ATTEMPTS);
      result.failed += 1;
    }
  }

  return result;
}
