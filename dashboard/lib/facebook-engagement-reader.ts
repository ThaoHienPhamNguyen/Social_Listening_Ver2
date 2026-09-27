import type { SupabaseClient } from '@supabase/supabase-js';
import type { FacebookEngagementDaily } from './types';
import { fetchAllPages } from './paginated-fetch';

export interface FacebookEngagementReader {
  getForDate(date: string): Promise<FacebookEngagementDaily[]>;
  getForDateRange(startDate: string, endDateExclusive: string): Promise<FacebookEngagementDaily[]>;
}

export class SupabaseFacebookEngagementReader implements FacebookEngagementReader {
  constructor(private client: SupabaseClient) {}

  async getForDate(date: string): Promise<FacebookEngagementDaily[]> {
    return fetchAllPages<FacebookEngagementDaily>((from, to) =>
      this.client
        .from('facebook_engagement_daily')
        .select('date, category, total_like_count, total_comment_count, total_share_count, post_count, id')
        .eq('date', date)
        .order('id', { ascending: true })
        .range(from, to)
    );
  }

  async getForDateRange(startDate: string, endDateExclusive: string): Promise<FacebookEngagementDaily[]> {
    return fetchAllPages<FacebookEngagementDaily>((from, to) =>
      this.client
        .from('facebook_engagement_daily')
        .select('date, category, total_like_count, total_comment_count, total_share_count, post_count, id')
        .gte('date', startDate)
        .lt('date', endDateExclusive)
        .order('id', { ascending: true })
        .range(from, to)
    );
  }
}
