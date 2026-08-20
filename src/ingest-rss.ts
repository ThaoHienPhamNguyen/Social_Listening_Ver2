import type { RssSource, Article } from './types';
import type { ArticleRepository } from './lib/article-repository';
import type { FeedFetcher } from './lib/rss-fetcher';
import { categorize } from './lib/categorize';

export interface IngestDeps {
  fetcher: FeedFetcher;
  repo: ArticleRepository;
}

export interface IngestResult {
  sourceId: string;
  fetched: number;
  upserted: number;
  errors: string[];
}

export async function ingestSource(source: RssSource, deps: IngestDeps): Promise<IngestResult> {
  const result: IngestResult = { sourceId: source.id, fetched: 0, upserted: 0, errors: [] };

  let feed;
  try {
    feed = await deps.fetcher.parseURL(source.url);
  } catch (err) {
    result.errors.push(`fetch failed: ${(err as Error).message}`);
    return result;
  }

  const items = feed.items ?? [];
  result.fetched = items.length;

  for (const item of items) {
    if (!item.link || !item.title) continue;

    const snippet = item.contentSnippet ?? item.content ?? '';
    const categories = categorize(source.defaultCategory, `${item.title} ${snippet}`);

    const article: Partial<Article> = {
      url: item.link,
      title: item.title,
      published_at: item.isoDate ?? new Date().toISOString(),
      source_id: source.id,
      categories,
      snippet,
      full_content: null,
      content_fetch_status: 'pending',
      fetch_attempts: 0,
    };

    const { error } = await deps.repo.upsertArticle(article);
    if (error) {
      result.errors.push(`upsert failed for ${item.link}: ${error}`);
    } else {
      result.upserted += 1;
    }
  }

  return result;
}

export async function ingestAllSources(sources: RssSource[], deps: IngestDeps): Promise<IngestResult[]> {
  const results: IngestResult[] = [];
  for (const source of sources) {
    results.push(await ingestSource(source, deps));
  }
  return results;
}
