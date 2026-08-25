import type { SupabaseClient } from '@supabase/supabase-js';
import type { ThreadsEngagementDaily } from './types';

export interface ThreadsEngagementReader {
  getForDate(date: string): Promise<ThreadsEngagementDaily[]>;
  getForDateRange(startDate: string, endDateExclusive: string): Promise<ThreadsEngagementDaily[]>;
}

export class SupabaseThreadsEngagementReader implements ThreadsEngagementReader {
  constructor(private client: SupabaseClient) {}

  async getForDate(date: string): Promise<ThreadsEngagementDaily[]> {
    const { data, error } = await this.client
      .from('threads_engagement_daily')
      .select(
        'date, keyword, category, total_like_count, total_reply_count, total_repost_count, total_quote_count, total_share_count, total_view_count, post_count'
      )
      .eq('date', date);
    if (error) throw new Error(error.message);
    return (data ?? []) as ThreadsEngagementDaily[];
  }

  async getForDateRange(startDate: string, endDateExclusive: string): Promise<ThreadsEngagementDaily[]> {
    const { data, error } = await this.client
      .from('threads_engagement_daily')
      .select(
        'date, keyword, category, total_like_count, total_reply_count, total_repost_count, total_quote_count, total_share_count, total_view_count, post_count'
      )
      .gte('date', startDate)
      .lt('date', endDateExclusive);
    if (error) throw new Error(error.message);
    return (data ?? []) as ThreadsEngagementDaily[];
  }
}
