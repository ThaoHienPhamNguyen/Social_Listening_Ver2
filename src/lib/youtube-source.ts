import type { DiscoverySource } from './discovery-source';
import type { RawCandidate } from '../types';
import { aggregateYouTubeKeywords, type YouTubeVideoItem } from './aggregate-youtube-keywords';

const FETCH_TIMEOUT_MS = 15000;

export class YouTubeTrendingSource implements DiscoverySource {
  name = 'youtube' as const;

  constructor(private apiKey: string) {}

  async fetchCandidates(): Promise<RawCandidate[]> {
    const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&chart=mostPopular&regionCode=VN&maxResults=50&key=${this.apiKey}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`YouTube API request failed: ${response.status}`);
      }
      const body = (await response.json()) as { items?: YouTubeVideoItem[] };
      return aggregateYouTubeKeywords(body.items ?? []);
    } finally {
      clearTimeout(timeout);
    }
  }
}
