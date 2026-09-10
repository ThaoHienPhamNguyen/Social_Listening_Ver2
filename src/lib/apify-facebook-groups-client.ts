import type { FacebookPageScrapeClient, FacebookPost } from './apify-facebook-client';

const FETCH_TIMEOUT_MS = 300000; // matches apify-facebook-client.ts / apify-threads-client.ts
const RESULTS_LIMIT = 50;
const MAX_TOTAL_CHARGE_USD = 0.1;
const ACTOR_ID = 'apify~facebook-groups-scraper';

function toNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null;
}

function toStringOrDefault(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

// Real adapter over Apify's run-sync-get-dataset-items endpoint, same
// pattern as apify-threads-client.ts / apify-facebook-client.ts. Field
// mapping verified live against real groups 2026-09-04 (design spec §5.2a):
// item.url / item.text / item.likesCount / item.commentsCount /
// item.sharesCount / item.time. Some items come back as
// { error: "not_available", ... } instead of a real post (a locked/removed
// group, or a removed post) — filtered out by the `typeof item.url ===
// 'string'` check below, same pattern apify-facebook-client.ts already uses.
export class ApifyFacebookGroupsScrapeClient implements FacebookPageScrapeClient {
  constructor(private apiToken: string) {}

  async scrapePage(groupUrl: string): Promise<FacebookPost[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const url = `https://api.apify.com/v2/acts/${ACTOR_ID}/run-sync-get-dataset-items?token=${this.apiToken}&maxTotalChargeUsd=${MAX_TOTAL_CHARGE_USD}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          startUrls: [{ url: groupUrl }],
          resultsLimit: RESULTS_LIMIT,
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
          like_count: toNumberOrNull(item.likesCount),
          comment_count: toNumberOrNull(item.commentsCount),
          share_count: toNumberOrNull(item.sharesCount),
          posted_at: toStringOrNull(item.time),
        }));
    } finally {
      clearTimeout(timeout);
    }
  }
}
