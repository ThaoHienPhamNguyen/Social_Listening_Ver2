import { extractKeywords } from './keyword-extractor';
import { capCandidates } from './cap-candidates';
import type { RawCandidate, Category } from '../types';
import type { ThreadsPost } from './apify-threads-client';

// Same cap as aggregate-youtube-keywords.ts — only the top MAX_CANDIDATES
// survive into candidate_topics, bounding write cost without affecting the
// shortlist outcome.
const MAX_CANDIDATES = 200;

export function aggregateThreadsKeywords(posts: ThreadsPost[], category: Category): RawCandidate[] {
  const totals = new Map<string, number>();

  for (const post of posts) {
    if (!post.text_content) continue;
    const engagement =
      (post.like_count ?? 0) +
      (post.reply_count ?? 0) +
      (post.repost_count ?? 0) +
      (post.quote_count ?? 0) +
      (post.share_count ?? 0);
    // Dedupe bigrams within one post before summing — same reasoning as
    // aggregate-youtube-keywords.ts's `new Set(...)`: a post repeating a
    // phrase must not inflate its own engagement contribution.
    for (const keyword of new Set(extractKeywords(post.text_content))) {
      totals.set(keyword, (totals.get(keyword) ?? 0) + engagement);
    }
  }

  const candidates = Array.from(totals.entries()).map(([keyword, metric_value]) => ({
    keyword,
    metric_value,
    growth_rate: null,
    // Category is known for certain from the search query's own category —
    // no substring-matching/LLM-classification needed downstream.
    knownCategories: [category],
  }));

  return capCandidates(candidates, MAX_CANDIDATES);
}
