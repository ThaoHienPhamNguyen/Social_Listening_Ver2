export interface YouTubeSearchResultItem {
  snippet?: { title?: string; tags?: string[] };
  statistics?: { viewCount?: string };
}

export interface YouTubeSearchClient {
  searchByKeyword(keyword: string): Promise<YouTubeSearchResultItem[]>;
}

const FETCH_TIMEOUT_MS = 15000;
const SEARCH_MAX_RESULTS = 25;
const PUBLISHED_AFTER_DAYS = 2;

// Real adapter over 2 real YouTube Data API v3 calls — search.list doesn't
// return `statistics` in its response, so a video's viewCount (needed by
// aggregateYouTubeKeywords) requires a follow-up videos.list call with the
// ids search.list returned. Verified manually against the live API once a
// key exists, not by an automated unit test — same convention as
// YouTubeTrendingSource's existing mostPopular fetch and
// RssParserFetcher/DefaultContentExtractor/GoogleTrendsSource elsewhere in
// this codebase. searchByKeyword's merge/aggregation logic downstream is
// what's unit-tested, via this interface's fake.
export class RealYouTubeSearchClient implements YouTubeSearchClient {
  constructor(private apiKey: string) {}

  async searchByKeyword(keyword: string): Promise<YouTubeSearchResultItem[]> {
    const publishedAfter = new Date(Date.now() - PUBLISHED_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const searchUrl =
      `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&regionCode=VN` +
      `&order=viewCount&maxResults=${SEARCH_MAX_RESULTS}` +
      `&publishedAfter=${encodeURIComponent(publishedAfter)}` +
      `&q=${encodeURIComponent(keyword)}&key=${this.apiKey}`;

    const searchBody = await this.fetchJson<{ items?: Array<{ id?: { videoId?: string } }> }>(searchUrl);
    const videoIds = (searchBody.items ?? [])
      .map((item) => item.id?.videoId)
      .filter((id): id is string => !!id);
    if (videoIds.length === 0) return [];

    const statsUrl =
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics` +
      `&id=${videoIds.join(',')}&key=${this.apiKey}`;
    const statsBody = await this.fetchJson<{ items?: YouTubeSearchResultItem[] }>(statsUrl);
    return statsBody.items ?? [];
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`YouTube API request failed: ${response.status}`);
      }
      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}
