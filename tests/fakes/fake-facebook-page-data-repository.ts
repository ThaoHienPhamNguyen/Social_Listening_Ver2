import type { FacebookPageDataRepository } from '../../src/lib/facebook-page-data-repository';
import type { FacebookPageData } from '../../src/types';

export class FakeFacebookPageDataRepository implements FacebookPageDataRepository {
  public posts: FacebookPageData[] = [];
  // Set to simulate upsertPosts failing, e.g. to test deep-crawl-facebook's
  // batch error handling without a real database.
  public upsertError: string | null = null;

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
      });
    }
    return { error: null, count: rows.length };
  }
}
