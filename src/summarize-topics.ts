import type { CandidateTopicRepository } from './lib/candidate-topic-repository';
import type { TopicArticleDataRepository } from './lib/topic-article-data-repository';
import type { TopicSocialDataRepository } from './lib/topic-social-data-repository';
import type { TopicSummarizer } from './lib/topic-summarizer';
import type { CandidateTopic } from './types';

const SUMMARIZABLE_SOURCES = new Set<CandidateTopic['source']>(['rss', 'threads']);
const CHUNK_SIZE = 10;

export interface SummarizeDeps {
  candidateRepo: CandidateTopicRepository;
  articleLinkRepo: TopicArticleDataRepository;
  socialRepo: TopicSocialDataRepository;
  summarizer: TopicSummarizer;
  now?: () => Date;
}

export interface SummarizeResult {
  evaluated: number;
  summarized: number;
  errors: string[];
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

export async function summarizeTopics(deps: SummarizeDeps): Promise<SummarizeResult> {
  const now = deps.now ?? (() => new Date());
  const today = now().toISOString().slice(0, 10);
  const result: SummarizeResult = { evaluated: 0, summarized: 0, errors: [] };

  const candidates = (await deps.candidateRepo.getShortlistedCandidates(today)).filter((c) =>
    SUMMARIZABLE_SOURCES.has(c.source)
  );
  if (candidates.length === 0) return result;
  result.evaluated = candidates.length;

  const [articles, posts] = await Promise.all([
    deps.articleLinkRepo.getArticlesForDate(today),
    deps.socialRepo.getPostsForDate(today),
  ]);

  const articlesByKeyword = new Map<string, string[]>();
  for (const a of articles) {
    const list = articlesByKeyword.get(a.keyword) ?? [];
    list.push(`${a.article_title}. ${a.article_snippet}`.trim());
    articlesByKeyword.set(a.keyword, list);
  }
  const postsByKeyword = new Map<string, string[]>();
  for (const p of posts) {
    const list = postsByKeyword.get(p.keyword) ?? [];
    list.push(p.text_content);
    postsByKeyword.set(p.keyword, list);
  }

  const inputs = candidates.map((c) => ({
    candidate: c,
    texts: c.source === 'rss' ? articlesByKeyword.get(c.keyword) ?? [] : postsByKeyword.get(c.keyword) ?? [],
  }));
  // A candidate with no linked source text (link write failed earlier, or
  // data from before this feature existed) can't be grounded in anything
  // real — skip it rather than sending an empty-text prompt.
  const summarizable = inputs.filter((i) => i.texts.length > 0);

  for (const batch of chunk(summarizable, CHUNK_SIZE)) {
    try {
      const summaries = await deps.summarizer.summarizeTopics(
        batch.map((b) => ({ keyword: b.candidate.keyword, texts: b.texts }))
      );
      for (let i = 0; i < batch.length; i++) {
        const summary = summaries[i];
        if (!summary) continue;
        const { error } = await deps.candidateRepo.updateSummary(batch[i].candidate.id!, summary);
        if (error) {
          result.errors.push(`update failed for "${batch[i].candidate.keyword}": ${error}`);
        } else {
          result.summarized++;
        }
      }
    } catch (err) {
      // One chunk's LLM failure must not block any other chunk's topics —
      // same isolation principle as rss-topic-source.ts's chunk fallback.
      // There is no regex fallback for "what is this about" (unlike keyword
      // extraction) — these topics simply stay unsummarized (summary: null)
      // until tomorrow's run.
      result.errors.push(
        `summarization failed for a chunk of ${batch.length} topic(s): ${(err as Error).message}`
      );
    }
  }

  return result;
}
