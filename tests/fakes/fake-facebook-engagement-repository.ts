import type { FacebookEngagementDailyRepository } from '../../src/lib/facebook-engagement-repository';
import type { FacebookEngagementDaily } from '../../src/types';

export class FakeFacebookEngagementDailyRepository implements FacebookEngagementDailyRepository {
  public rows: FacebookEngagementDaily[] = [];
  public upsertError: string | null = null;

  async upsertDaily(rows: Partial<FacebookEngagementDaily>[]) {
    if (this.upsertError) return { error: this.upsertError, count: 0 };
    for (const row of rows) {
      this.rows.push({
        id: row.id ?? crypto.randomUUID(),
        date: row.date!,
        category: row.category!,
        total_like_count: row.total_like_count ?? 0,
        total_comment_count: row.total_comment_count ?? 0,
        total_share_count: row.total_share_count ?? 0,
        post_count: row.post_count ?? 0,
      });
    }
    return { error: null, count: rows.length };
  }
}
