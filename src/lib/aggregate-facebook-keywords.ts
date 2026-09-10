import { extractKeywords } from './keyword-extractor';
import { capCandidates } from './cap-candidates';
import type { RawCandidate, Category } from '../types';
import type { FacebookPost } from './apify-facebook-client';

const MAX_CANDIDATES = 200; // same cap as aggregate-youtube-keywords.ts / aggregate-threads-keywords.ts

// Shared by both FACEBOOK_SEED_GROUPS and FACEBOOK_SEED_PAGES (VTV24) —
// both produce the same FacebookPost shape, so one aggregation function
// covers both. See design spec §5.3.
export function aggregateFacebookKeywords(posts: FacebookPost[], category: Category): RawCandidate[] {
  const totals = new Map<string, number>();

  for (const post of posts) {
    if (!post.text_content) continue;
    const engagement = (post.like_count ?? 0) + (post.comment_count ?? 0) + (post.share_count ?? 0);
    for (const keyword of new Set(extractKeywords(post.text_content))) {
      totals.set(keyword, (totals.get(keyword) ?? 0) + engagement);
    }
  }

  const candidates = Array.from(totals.entries()).map(([keyword, metric_value]) => ({
    keyword,
    metric_value,
    growth_rate: null,
    knownCategories: [category],
  }));

  return capCandidates(candidates, MAX_CANDIDATES);
}
