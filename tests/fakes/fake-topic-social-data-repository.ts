import type { TopicSocialDataRepository } from '../../src/lib/topic-social-data-repository';
import type { TopicSocialData, SentimentLabel } from '../../src/types';

export class FakeTopicSocialDataRepository implements TopicSocialDataRepository {
  public posts: TopicSocialData[] = [];
  // Set to simulate upsertPosts failing, e.g. to test deep-crawl's batch
  // error handling without a real database.
  public upsertError: string | null = null;
  // Set to simulate updateSentiment failing for a specific post id, e.g. to
  // test classify-sentiment's per-post error isolation without a real DB.
  public updateSentimentErrorForId: Record<string, string> = {};

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
        sentiment: row.sentiment ?? null,
      });
    }
    return { error: null, count: rows.length };
  }

  async getUnclassifiedPosts() {
    return this.posts
      .filter((p) => p.sentiment == null)
      .map((p) => ({ id: p.id!, text_content: p.text_content }));
  }

  async updateSentiment(id: string, sentiment: SentimentLabel) {
    if (this.updateSentimentErrorForId[id]) {
      return { error: this.updateSentimentErrorForId[id] };
    }
    const post = this.posts.find((p) => p.id === id);
    if (post) post.sentiment = sentiment;
    return { error: null };
  }

  async getPostsForDate(date: string) {
    return this.posts.filter((p) => p.date === date);
  }
}
