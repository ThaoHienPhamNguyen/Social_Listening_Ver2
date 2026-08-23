import type { FacebookPageDataRepository } from '../../src/lib/facebook-page-data-repository';
import type { FacebookPageData, SentimentLabel } from '../../src/types';

export class FakeFacebookPageDataRepository implements FacebookPageDataRepository {
  public posts: FacebookPageData[] = [];
  // Set to simulate upsertPosts failing, e.g. to test deep-crawl-facebook's
  // batch error handling without a real database.
  public upsertError: string | null = null;
  // Set to simulate updateSentiment failing for a specific post id, e.g. to
  // test classify-sentiment's per-post error isolation without a real DB.
  public updateSentimentErrorForId: Record<string, string> = {};

  async hasDataForDate(date: string): Promise<boolean> {
    return this.posts.some((p) => p.date === date);
  }

  async upsertPosts(rows: Partial<FacebookPageData>[]) {
    if (this.upsertError) return { error: this.upsertError, count: 0 };
    for (const row of rows) {
      this.posts.push({
        id: row.id ?? crypto.randomUUID(),
        page_url: row.page_url!,
        category: row.category!,
        date: row.date!,
        post_url: row.post_url!,
        text_content: row.text_content ?? '',
        like_count: row.like_count ?? null,
        comment_count: row.comment_count ?? null,
        share_count: row.share_count ?? null,
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
