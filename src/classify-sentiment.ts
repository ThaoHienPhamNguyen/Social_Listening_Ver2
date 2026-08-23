import type { TopicSocialDataRepository } from './lib/topic-social-data-repository';
import type { FacebookPageDataRepository } from './lib/facebook-page-data-repository';
import type { SentimentClassifier } from './lib/openai-sentiment-classifier';
import type { SentimentLabel } from './types';

export interface ClassifySentimentDeps {
  threadsRepo: Pick<TopicSocialDataRepository, 'getUnclassifiedPosts' | 'updateSentiment'>;
  facebookRepo: Pick<FacebookPageDataRepository, 'getUnclassifiedPosts' | 'updateSentiment'>;
  classifier: SentimentClassifier;
}

export interface ClassifySentimentResult {
  classified: number;
  errors: string[];
}

// Smaller than discovery-ingest.ts's CLASSIFY_CHUNK_SIZE=50 for category
// classification — post text is much longer than a bare keyword, so a
// smaller chunk keeps each call's prompt size (and expected latency)
// bounded, avoiding the same "This operation was aborted" timeout observed
// in production 2026-08-22 for over-large category-classification batches.
const CHUNK_SIZE = 20;

const KNOWN_LABELS = new Set<SentimentLabel>(['positive', 'negative', 'neutral']);

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

interface TaggedPost {
  id: string;
  text_content: string;
  source: 'threads' | 'facebook';
}

export async function runClassifySentiment(deps: ClassifySentimentDeps): Promise<ClassifySentimentResult> {
  const result: ClassifySentimentResult = { classified: 0, errors: [] };

  const threadsPosts = await deps.threadsRepo.getUnclassifiedPosts();
  const facebookPosts = await deps.facebookRepo.getUnclassifiedPosts();

  const tagged: TaggedPost[] = [
    ...threadsPosts.map((p) => ({ ...p, source: 'threads' as const })),
    ...facebookPosts.map((p) => ({ ...p, source: 'facebook' as const })),
  ];

  for (const postChunk of chunk(tagged, CHUNK_SIZE)) {
    try {
      const classified = await deps.classifier.classify(
        postChunk.map((p) => ({ id: p.id, text: p.text_content }))
      );
      const byId = new Map(postChunk.map((p) => [p.id, p]));
      for (const [id, label] of Object.entries(classified)) {
        // Only ever apply a label for a post that was actually sent in
        // *this* chunk, and only a label within the known set — the real
        // adapter parses raw LLM JSON output, so an out-of-set string or an
        // id belonging to a different chunk must never be applied. Same
        // defensive pattern as discovery-ingest.ts's classification loop.
        const post = byId.get(id);
        if (!post || !KNOWN_LABELS.has(label as SentimentLabel)) continue;
        try {
          const repo = post.source === 'threads' ? deps.threadsRepo : deps.facebookRepo;
          const { error } = await repo.updateSentiment(id, label as SentimentLabel);
          if (error) {
            result.errors.push(`update failed for post "${id}": ${error}`);
          } else {
            result.classified += 1;
          }
        } catch (err) {
          // One post's update failure must not abort the rest of the chunk.
          result.errors.push(`update threw for post "${id}": ${(err as Error).message}`);
        }
      }
    } catch (err) {
      // One chunk's classification failure must not block any other chunk —
      // same isolation principle used throughout this project.
      result.errors.push(`classification failed for a chunk of ${postChunk.length}: ${(err as Error).message}`);
    }
  }

  return result;
}
