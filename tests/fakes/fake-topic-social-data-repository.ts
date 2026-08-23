import type { TopicSocialDataRepository } from '../../src/lib/topic-social-data-repository';
import type { TopicSocialData } from '../../src/types';

export class FakeTopicSocialDataRepository implements TopicSocialDataRepository {
  public posts: TopicSocialData[] = [];
  // Set to simulate upsertPosts failing, e.g. to test deep-crawl's batch
  // error handling without a real database.
  public upsertError: string | null = null;

  async hasDataForDate(date: string): Promise<boolean> {
    return this.posts.some((p) => p.date === date);
  }

  async upsertPosts(rows: Partial<TopicSocialData>[]) {
    if (this.upsertError) return { error: this.upsertError, count: 0 };
    for (const row of rows) {
      this.posts.push({
        id: row.id ?? crypto.randomUUID(),
        keyword: row.keyword!,
        source: row.source ?? 'threads',
        date: row.date!,
        post_url: row.post_url!,
        text_content: row.text_content ?? '',
        like_count: row.like_count ?? null,
        reply_count: row.reply_count ?? null,
        repost_count: row.repost_count ?? null,
        quote_count: row.quote_count ?? null,
        share_count: row.share_count ?? null,
        view_count: row.view_count ?? null,
        posted_at: row.posted_at ?? null,
      });
    }
    return { error: null, count: rows.length };
  }
}
