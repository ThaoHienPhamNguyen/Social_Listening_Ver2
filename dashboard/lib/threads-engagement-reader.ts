import type { SupabaseClient } from '@supabase/supabase-js';
import type { ThreadsEngagementDaily } from './types';
import { fetchAllPages } from './paginated-fetch';

export interface ThreadsEngagementReader {
  getForDate(date: string): Promise<ThreadsEngagementDaily[]>;
  getForDateRange(startDate: string, endDateExclusive: string): Promise<ThreadsEngagementDaily[]>;
}

export class SupabaseThreadsEngagementReader implements ThreadsEngagementReader {
  constructor(private client: SupabaseClient) {}

  async getForDate(date: string): Promise<ThreadsEngagementDaily[]> {
    return fetchAllPages<ThreadsEngagementDaily>((from, to) =>
      this.client
        .from('threads_engagement_daily')
        .select(
          'date, keyword, category, total_like_count, total_reply_count, total_repost_count, total_quote_count, total_share_count, total_view_count, post_count, id'
        )
        .eq('date', date)
        .order('id', { ascending: true })
        .range(from, to)
    );
  }

  async getForDateRange(startDate: string, endDateExclusive: string): Promise<ThreadsEngagementDaily[]> {
    return fetchAllPages<ThreadsEngagementDaily>((from, to) =>
      this.client
        .from('threads_engagement_daily')
        .select(
          'date, keyword, category, total_like_count, total_reply_count, total_repost_count, total_quote_count, total_share_count, total_view_count, post_count, id'
        )
        .gte('date', startDate)
        .lt('date', endDateExclusive)
        .order('id', { ascending: true })
        .range(from, to)
    );
  }
}
