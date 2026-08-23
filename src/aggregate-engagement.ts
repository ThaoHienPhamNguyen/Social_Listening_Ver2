import type { TopicSocialDataRepository } from './lib/topic-social-data-repository';
import type { FacebookPageDataRepository } from './lib/facebook-page-data-repository';
import type { CandidateTopicRepository } from './lib/candidate-topic-repository';
import type { ThreadsEngagementDailyRepository } from './lib/threads-engagement-repository';
import type { FacebookEngagementDailyRepository } from './lib/facebook-engagement-repository';
import type {
  TopicSocialData,
  FacebookPageData,
  ThreadsEngagementDaily,
  FacebookEngagementDaily,
  Category,
} from './types';

export interface AggregateEngagementDeps {
  threadsSocialRepo: Pick<TopicSocialDataRepository, 'getPostsForDate'>;
  facebookSocialRepo: Pick<FacebookPageDataRepository, 'getPostsForDate'>;
  candidateRepo: Pick<CandidateTopicRepository, 'getTodayCandidates'>;
  threadsEngagementRepo: ThreadsEngagementDailyRepository;
  facebookEngagementRepo: FacebookEngagementDailyRepository;
  now?: () => Date;
}

export interface AggregateEngagementResult {
  threadsRowsUpserted: number;
  facebookRowsUpserted: number;
  errors: string[];
}

function sumField<T>(items: T[], field: keyof T): number {
  return items.reduce((total, item) => total + ((item[field] as unknown as number | null) ?? 0), 0);
}

export async function runAggregateEngagement(deps: AggregateEngagementDeps): Promise<AggregateEngagementResult> {
  const now = deps.now ?? (() => new Date());
  const date = now().toISOString().slice(0, 10);
  const result: AggregateEngagementResult = { threadsRowsUpserted: 0, facebookRowsUpserted: 0, errors: [] };

  // Isolated in its own try/catch so a Threads-side failure never blocks the
  // Facebook aggregation below — same isolation principle used throughout
  // this project.
  try {
    const posts = await deps.threadsSocialRepo.getPostsForDate(date);
    const candidates = await deps.candidateRepo.getTodayCandidates(date);
    const categoryByKeyword = new Map<string, Category | null>();
    for (const c of candidates) {
      categoryByKeyword.set(c.keyword, (c.category_hint[0] as Category) ?? null);
    }

    const byKeyword = new Map<string, TopicSocialData[]>();
    for (const post of posts) {
      const existing = byKeyword.get(post.keyword) ?? [];
      existing.push(post);
      byKeyword.set(post.keyword, existing);
    }

    const rows: Partial<ThreadsEngagementDaily>[] = [];
    for (const [keyword, keywordPosts] of byKeyword) {
      rows.push({
        date,
        keyword,
        category: categoryByKeyword.get(keyword) ?? null,
        total_like_count: sumField(keywordPosts, 'like_count'),
        total_reply_count: sumField(keywordPosts, 'reply_count'),
        total_repost_count: sumField(keywordPosts, 'repost_count'),
        total_quote_count: sumField(keywordPosts, 'quote_count'),
        total_share_count: sumField(keywordPosts, 'share_count'),
        total_view_count: sumField(keywordPosts, 'view_count'),
        post_count: keywordPosts.length,
      });
    }

    const { error, count } = await deps.threadsEngagementRepo.upsertDaily(rows);
    if (error) {
      result.errors.push(`threads aggregate upsert failed: ${error}`);
    } else {
      result.threadsRowsUpserted = count;
    }
  } catch (err) {
    result.errors.push(`threads aggregate failed: ${(err as Error).message}`);
  }

  try {
    const posts = await deps.facebookSocialRepo.getPostsForDate(date);
    const byCategory = new Map<Category, FacebookPageData[]>();
    for (const post of posts) {
      const existing = byCategory.get(post.category) ?? [];
      existing.push(post);
      byCategory.set(post.category, existing);
    }

    const rows: Partial<FacebookEngagementDaily>[] = [];
    for (const [category, categoryPosts] of byCategory) {
      rows.push({
        date,
        category,
        total_like_count: sumField(categoryPosts, 'like_count'),
        total_comment_count: sumField(categoryPosts, 'comment_count'),
        total_share_count: sumField(categoryPosts, 'share_count'),
        post_count: categoryPosts.length,
      });
    }

    const { error, count } = await deps.facebookEngagementRepo.upsertDaily(rows);
    if (error) {
      result.errors.push(`facebook aggregate upsert failed: ${error}`);
    } else {
      result.facebookRowsUpserted = count;
    }
  } catch (err) {
    result.errors.push(`facebook aggregate failed: ${(err as Error).message}`);
  }

  return result;
}
