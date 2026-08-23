export interface FacebookPost {
  post_url: string;
  text_content: string;
  like_count: number | null;
  comment_count: number | null;
  share_count: number | null;
  posted_at: string | null;
}

export interface FacebookPageScrapeClient {
  scrapePage(pageUrl: string): Promise<FacebookPost[]>;
}

const FETCH_TIMEOUT_MS = 300000;
const MAX_POSTS_PER_PAGE = 15;
const MAX_TOTAL_CHARGE_USD = 0.3;
const ACTOR_ID = 'apify~facebook-posts-scraper';

function toNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null;
}

function toStringOrDefault(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

// Real adapter over Apify's run-sync-get-dataset-items endpoint — same
// pattern as apify-threads-client.ts (2b): blocks until the run finishes or
// times out, no separate poll loop. maxTotalChargeUsd is a hard per-call
// safety cap, passed both as a URL query param (what Apify actually
// enforces — learned in 2b) and in the body (harmless belt-and-braces).
// FETCH_TIMEOUT_MS matches Apify's own server-side cutoff for
// run-sync-* endpoints, same reasoning as 2b.
export class ApifyFacebookPageScrapeClient implements FacebookPageScrapeClient {
  constructor(private apiToken: string) {}

  async scrapePage(pageUrl: string): Promise<FacebookPost[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const url = `https://api.apify.com/v2/acts/${ACTOR_ID}/run-sync-get-dataset-items?token=${this.apiToken}&maxTotalChargeUsd=${MAX_TOTAL_CHARGE_USD}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          startUrls: [{ url: pageUrl }],
          resultsLimit: MAX_POSTS_PER_PAGE,
          maxTotalChargeUsd: MAX_TOTAL_CHARGE_USD,
        }),
      });
      if (!response.ok) {
        const bodyText = await response.text().catch(() => '');
        throw new Error(`Apify request failed: ${response.status} ${bodyText.slice(0, 200)}`);
      }
      const items = (await response.json()) as Array<Record<string, unknown>>;
      return items
        .filter((item) => typeof item.url === 'string')
        .map((item) => ({
          post_url: item.url as string,
          text_content: toStringOrDefault(item.text, ''),
          like_count: toNumberOrNull(item.likes),
          comment_count: toNumberOrNull(item.comments),
          share_count: toNumberOrNull(item.shares),
          posted_at: toStringOrNull(item.time),
        }));
    } finally {
      clearTimeout(timeout);
    }
  }
}
