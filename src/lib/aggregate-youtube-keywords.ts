import { extractKeywords } from './keyword-extractor';
import { capCandidates } from './cap-candidates';
import type { RawCandidate } from '../types';

export interface YouTubeVideoItem {
  snippet?: { title?: string; tags?: string[] };
  statistics?: { viewCount?: string };
}

// Only the top MAX_CANDIDATES survive into candidate_topics — anything ranked
// below this never has a chance at the top-N shortlist anyway, so capping
// here bounds per-day row volume and write cost without affecting outcomes.
const MAX_CANDIDATES = 200;

export function aggregateYouTubeKeywords(videos: YouTubeVideoItem[]): RawCandidate[] {
  const totals = new Map<string, number>();

  for (const video of videos) {
    const viewCount = Number(video.statistics?.viewCount ?? 0);
    const titleKeywords = extractKeywords(video.snippet?.title ?? '');
    const tags = (video.snippet?.tags ?? []).map((t) => t.toLowerCase().trim());
    const keywords = new Set([...titleKeywords, ...tags]);

    for (const keyword of keywords) {
      totals.set(keyword, (totals.get(keyword) ?? 0) + viewCount);
    }
  }

  const candidates = Array.from(totals.entries()).map(([keyword, metric_value]) => ({
    keyword,
    metric_value,
    growth_rate: null,
  }));

  return capCandidates(candidates, MAX_CANDIDATES);
}
