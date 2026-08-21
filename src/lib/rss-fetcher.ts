import Parser from 'rss-parser';
import type { FeedItem } from '../types';

const FETCH_TIMEOUT_MS = 15000;

export interface FeedFetcher {
  parseURL(url: string): Promise<{ items: FeedItem[] }>;
}

export class RssParserFetcher implements FeedFetcher {
  private parser = new Parser({ timeout: FETCH_TIMEOUT_MS });

  async parseURL(url: string) {
    const feed = await this.parser.parseURL(url);
    return { items: (feed.items ?? []) as FeedItem[] };
  }
}
