import type { SupabaseClient } from '@supabase/supabase-js';
import type { ThreadsEngagementDaily } from '../types';

export interface ThreadsEngagementDailyRepository {
  upsertDaily(rows: Partial<ThreadsEngagementDaily>[]): Promise<{ error: string | null; count: number }>;
}

export class SupabaseThreadsEngagementDailyRepository implements ThreadsEngagementDailyRepository {
  constructor(private client: SupabaseClient) {}

  async upsertDaily(rows: Partial<ThreadsEngagementDaily>[]) {
    if (rows.length === 0) return { error: null, count: 0 };
    const { error } = await this.client
      .from('threads_engagement_daily')
      .upsert(rows, { onConflict: 'date,keyword' });
    return { error: error?.message ?? null, count: error ? 0 : rows.length };
  }
}
