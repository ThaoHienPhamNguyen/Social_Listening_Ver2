import type { DiscoverySource } from './discovery-source';
import type { Category, RawCandidate } from '../types';
import { aggregateYouTubeKeywords, type YouTubeVideoItem } from './aggregate-youtube-keywords';
import { capCandidates } from './cap-candidates';
import { youtubeSeedKeywords } from '../../config/categories.config';
import type { YouTubeSearchClient } from './youtube-search-client';

const FETCH_TIMEOUT_MS = 15000;
const MAX_MERGED_CANDIDATES = 200;

export class YouTubeTrendingSource implements DiscoverySource {
  name = 'youtube' as const;

  constructor(private apiKey: string, private searchClient: YouTubeSearchClient) {}

  async fetchCandidates(): Promise<RawCandidate[]> {
    const generic = await this.fetchMostPopular();
    const seeded = await this.fetchSeeded();
    return mergeCandidates(generic, seeded);
  }

  private async fetchMostPopular(): Promise<RawCandidate[]> {
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

  // Each seed keyword is its own network call and isolated from the others:
  // one seed timing out or erroring (quota, transient network failure) must
  // not discard the other seeds' results, and must not propagate up to
  // fetchCandidates() and void the already-succeeded mostPopular fetch too.
  private async fetchSeeded(): Promise<RawCandidate[]> {
    const results: RawCandidate[] = [];
    for (const [category, seeds] of Object.entries(youtubeSeedKeywords) as [Category, string[]][]) {
      for (const seed of seeds) {
        let items: YouTubeVideoItem[];
        try {
          items = await this.searchClient.searchByKeyword(seed);
        } catch (err) {
          console.error(`YouTube seed search failed for "${seed}" (${category}): ${(err as Error).message}`);
          continue;
        }
        const candidates = aggregateYouTubeKeywords(items);
        for (const candidate of candidates) {
          results.push({ ...candidate, knownCategories: [category] });
        }
      }
    }
    return results;
  }
}

// Exported for its own unit tests. Merges two RawCandidate lists (the
// unseeded mostPopular fetch and the seeded per-category fetch), summing
// metric_value and unioning knownCategories when the same keyword appears
// in both, then re-applies the 200-keyword cap since each input list was
// already capped independently before merging.
export function mergeCandidates(a: RawCandidate[], b: RawCandidate[]): RawCandidate[] {
  const byKeyword = new Map<string, RawCandidate>();
  for (const candidate of [...a, ...b]) {
    const existing = byKeyword.get(candidate.keyword);
    if (!existing) {
      byKeyword.set(candidate.keyword, { ...candidate, knownCategories: candidate.knownCategories ?? [] });
      continue;
    }
    existing.metric_value += candidate.metric_value;
    existing.knownCategories = Array.from(
      new Set([...(existing.knownCategories ?? []), ...(candidate.knownCategories ?? [])])
    );
  }
  return capCandidates(Array.from(byKeyword.values()), MAX_MERGED_CANDIDATES);
}
