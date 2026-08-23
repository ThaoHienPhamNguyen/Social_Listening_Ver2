export interface ThreadsPost {
  post_url: string;
  text_content: string;
  like_count: number | null;
  reply_count: number | null;
  repost_count: number | null;
  quote_count: number | null;
  share_count: number | null;
  view_count: number | null;
  posted_at: string | null;
}

export interface ThreadsSearchClient {
  searchByKeyword(keyword: string): Promise<ThreadsPost[]>;
}

const FETCH_TIMEOUT_MS = 300000;
const MAX_POSTS_PER_TOPIC = 50;
const MAX_TOTAL_CHARGE_USD = 0.5;
const ACTOR_ID = 'futurizerush~meta-threads-scraper';

function toNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null;
}

function toStringOrDefault(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

// Real adapter over Apify's run-sync-get-dataset-items endpoint — blocks
// until the actor run finishes (or times out) and returns dataset items
// directly, so no separate poll loop is needed. maxTotalChargeUsd is a hard
// per-call safety cap (real measured cost ~$0.195/topic at 50 posts, see
// docs/superpowers/specs/2026-08-23-deep-crawl-threads-design.md §6) —
// Apify aborts the run itself if it would exceed this. It's passed both as a
// URL query param (Apify's run-options convention, like token/timeout/memory
// — this is what actually enforces the cap) and in the body (harmless
// belt-and-braces in case the actor also reads it from its own input).
// FETCH_TIMEOUT_MS is much longer than this codebase's usual 15s: real runs
// were measured at 1-2+ minutes for 20 posts during the pricing spike that
// produced this design, and 50-post runs need more headroom than that
// baseline — 300s matches Apify's own server-side cutoff for run-sync-*
// endpoints, the natural ceiling for this timeout.
export class ApifyThreadsSearchClient implements ThreadsSearchClient {
  constructor(private apiToken: string) {}

  async searchByKeyword(keyword: string): Promise<ThreadsPost[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const url = `https://api.apify.com/v2/acts/${ACTOR_ID}/run-sync-get-dataset-items?token=${this.apiToken}&maxTotalChargeUsd=${MAX_TOTAL_CHARGE_USD}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          mode: 'search',
          keywords: [keyword],
          max_posts: MAX_POSTS_PER_TOPIC,
          search_filter: 'top',
          maxTotalChargeUsd: MAX_TOTAL_CHARGE_USD,
        }),
      });
      if (!response.ok) {
        const bodyText = await response.text().catch(() => '');
        throw new Error(`Apify request failed: ${response.status} ${bodyText.slice(0, 200)}`);
      }
      const items = (await response.json()) as Array<Record<string, unknown>>;
      return items
        .filter((item) => item.record_type === 'post' && typeof item.post_url === 'string')
        .map((item) => ({
          post_url: item.post_url as string,
          text_content: toStringOrDefault(item.text_content, ''),
          like_count: toNumberOrNull(item.like_count),
          reply_count: toNumberOrNull(item.reply_count),
          repost_count: toNumberOrNull(item.repost_count),
          quote_count: toNumberOrNull(item.quote_count),
          share_count: toNumberOrNull(item.share_count),
          view_count: toNumberOrNull(item.view_count),
          posted_at: toStringOrNull(item.created_at),
        }));
    } finally {
      clearTimeout(timeout);
    }
  }
}
