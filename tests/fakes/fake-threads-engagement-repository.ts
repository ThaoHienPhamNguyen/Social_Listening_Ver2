import type { ThreadsEngagementDailyRepository } from '../../src/lib/threads-engagement-repository';
import type { ThreadsEngagementDaily } from '../../src/types';

export class FakeThreadsEngagementDailyRepository implements ThreadsEngagementDailyRepository {
  public rows: ThreadsEngagementDaily[] = [];
  public upsertError: string | null = null;

  async upsertDaily(rows: Partial<ThreadsEngagementDaily>[]) {
    if (this.upsertError) return { error: this.upsertError, count: 0 };
    for (const row of rows) {
      this.rows.push({
        id: row.id ?? crypto.randomUUID(),
        date: row.date!,
        keyword: row.keyword!,
        category: row.category ?? null,
        total_like_count: row.total_like_count ?? 0,
        total_reply_count: row.total_reply_count ?? 0,
        total_repost_count: row.total_repost_count ?? 0,
        total_quote_count: row.total_quote_count ?? 0,
        total_share_count: row.total_share_count ?? 0,
        total_view_count: row.total_view_count ?? 0,
        post_count: row.post_count ?? 0,
      });
    }
    return { error: null, count: rows.length };
  }
}
