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

const FETCH_TIMEOUT_MS = 120000;
const MAX_POSTS_PER_TOPIC = 50;
const MAX_TOTAL_CHARGE_USD = 0.5;
const ACTOR_ID = 'futurizerush~meta-threads-scraper';

// Real adapter over Apify's run-sync-get-dataset-items endpoint — blocks
// until the actor run finishes (or times out) and returns dataset items
// directly, so no separate poll loop is needed. maxTotalChargeUsd is a hard
// per-call safety cap (real measured cost ~$0.195/topic at 50 posts, see
// docs/superpowers/specs/2026-08-23-deep-crawl-threads-design.md §6) —
// Apify aborts the run itself if it would exceed this. FETCH_TIMEOUT_MS is
// much longer than this codebase's usual 15s: real runs were measured at
// 1-2+ minutes for 20 posts during the pricing spike that produced this design.
export class ApifyThreadsSearchClient implements ThreadsSearchClient {
  constructor(private apiToken: string) {}

  async searchByKeyword(keyword: string): Promise<ThreadsPost[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const url = `https://api.apify.com/v2/acts/${ACTOR_ID}/run-sync-get-dataset-items?token=${this.apiToken}`;
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
        throw new Error(`Apify request failed: ${response.status}`);
      }
      const items = (await response.json()) as Array<Record<string, unknown>>;
      return items
        .filter((item) => item.record_type === 'post' && typeof item.post_url === 'string')
        .map((item) => ({
          post_url: item.post_url as string,
          text_content: (item.text_content as string) ?? '',
          like_count: (item.like_count as number) ?? null,
          reply_count: (item.reply_count as number) ?? null,
          repost_count: (item.repost_count as number) ?? null,
          quote_count: (item.quote_count as number) ?? null,
          share_count: (item.share_count as number) ?? null,
          view_count: (item.view_count as number) ?? null,
          posted_at: (item.created_at as string) ?? null,
        }));
    } finally {
      clearTimeout(timeout);
    }
  }
}
