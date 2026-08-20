import Parser from 'rss-parser';
import type { FeedItem } from '../types';

export interface FeedFetcher {
  parseURL(url: string): Promise<{ items: FeedItem[] }>;
}

export class RssParserFetcher implements FeedFetcher {
  private parser = new Parser();

  async parseURL(url: string) {
    const feed = await this.parser.parseURL(url);
    return { items: (feed.items ?? []) as FeedItem[] };
  }
}
