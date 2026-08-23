import type { SupabaseClient } from '@supabase/supabase-js';
import type { FacebookEngagementDaily } from '../types';

export interface FacebookEngagementDailyRepository {
  upsertDaily(rows: Partial<FacebookEngagementDaily>[]): Promise<{ error: string | null; count: number }>;
}

export class SupabaseFacebookEngagementDailyRepository implements FacebookEngagementDailyRepository {
  constructor(private client: SupabaseClient) {}

  async upsertDaily(rows: Partial<FacebookEngagementDaily>[]) {
    if (rows.length === 0) return { error: null, count: 0 };
    const { error } = await this.client
      .from('facebook_engagement_daily')
      .upsert(rows, { onConflict: 'date,category' });
    return { error: error?.message ?? null, count: error ? 0 : rows.length };
  }
}
