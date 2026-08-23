import Parser from 'rss-parser';
import type { FeedItem } from '../types';

const FETCH_TIMEOUT_MS = 15000;

export interface FeedFetcher {
  parseURL(url: string): Promise<{ items: FeedItem[] }>;
}

export class RssParserFetcher implements FeedFetcher {
  // Only used for its parseString() (pure XML->object parsing) — parseURL()
  // is deliberately not used, see below.
  private parser = new Parser();

  async parseURL(url: string) {
    // rss-parser's own parseURL() fetches via raw http/https.get and never
    // decompresses the response — it just res.setEncoding('utf8')s the raw
    // bytes. Some publishers (Nhân Dân, VietnamPlus — found 2026-08-23) gzip
    // their RSS response unconditionally, regardless of whether the client
    // sent Accept-Encoding: gzip, which corrupts the body into unparseable
    // garbage under that naive handling ("Non-whitespace before first tag").
    // Native fetch() decompresses gzip/deflate/br transparently, so fetching
    // the body ourselves and handing the decoded text to rss-parser's
    // parseString() (the XML-parsing half, which is fine) sidesteps the
    // broken HTTP layer entirely — works for both gzip and plain responses.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`Status code ${res.status}`);
      const xml = await res.text();
      const feed = await this.parser.parseString(xml);
      return { items: (feed.items ?? []) as FeedItem[] };
    } finally {
      clearTimeout(timeout);
    }
  }
}
