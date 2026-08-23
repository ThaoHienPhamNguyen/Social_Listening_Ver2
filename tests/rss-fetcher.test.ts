import { describe, it, expect, afterEach } from 'vitest';
import http from 'http';
import zlib from 'zlib';
import { RssParserFetcher } from '../src/lib/rss-fetcher';

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Test</title>
<item><title>Bài viết test</title><link>https://example.com/1</link></item>
</channel></rss>`;

// nhandan.vn/vietnamplus.vn were found (2026-08-23) to gzip-compress their
// RSS response unconditionally, regardless of whether the client sent
// Accept-Encoding: gzip. rss-parser's own HTTP client (raw http/https.get)
// never decompresses — it just treats the response bytes as text — so a
// server that does this corrupts the feed into unparseable garbage.
function startServer(opts: { gzip: boolean }): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      if (opts.gzip) {
        res.setHeader('Content-Type', 'text/xml; charset=utf-8');
        res.setHeader('Content-Encoding', 'gzip');
        res.end(zlib.gzipSync(SAMPLE_RSS));
      } else {
        res.setHeader('Content-Type', 'text/xml; charset=utf-8');
        res.end(SAMPLE_RSS);
      }
    });
    server.listen(0, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({
        url: `http://localhost:${port}/rss`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

describe('RssParserFetcher', () => {
  let closeServer: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (closeServer) await closeServer();
    closeServer = null;
  });

  it('parses a feed the server sends unconditionally gzip-compressed', async () => {
    const { url, close } = await startServer({ gzip: true });
    closeServer = close;
    const fetcher = new RssParserFetcher();

    const feed = await fetcher.parseURL(url);

    expect(feed.items).toHaveLength(1);
    expect(feed.items[0].title).toBe('Bài viết test');
  });

  it('still parses a plain (non-gzip) feed', async () => {
    const { url, close } = await startServer({ gzip: false });
    closeServer = close;
    const fetcher = new RssParserFetcher();

    const feed = await fetcher.parseURL(url);

    expect(feed.items).toHaveLength(1);
    expect(feed.items[0].title).toBe('Bài viết test');
  });
});
