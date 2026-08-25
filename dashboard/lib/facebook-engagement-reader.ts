import type { SupabaseClient } from '@supabase/supabase-js';
import type { FacebookEngagementDaily } from './types';

export interface FacebookEngagementReader {
  getForDate(date: string): Promise<FacebookEngagementDaily[]>;
  getForDateRange(startDate: string, endDateExclusive: string): Promise<FacebookEngagementDaily[]>;
}

export class SupabaseFacebookEngagementReader implements FacebookEngagementReader {
  constructor(private client: SupabaseClient) {}

  async getForDate(date: string): Promise<FacebookEngagementDaily[]> {
    const { data, error } = await this.client
      .from('facebook_engagement_daily')
      .select('date, category, total_like_count, total_comment_count, total_share_count, post_count')
      .eq('date', date);
    if (error) throw new Error(error.message);
    return (data ?? []) as FacebookEngagementDaily[];
  }

  async getForDateRange(startDate: string, endDateExclusive: string): Promise<FacebookEngagementDaily[]> {
    const { data, error } = await this.client
      .from('facebook_engagement_daily')
      .select('date, category, total_like_count, total_comment_count, total_share_count, post_count')
      .gte('date', startDate)
      .lt('date', endDateExclusive)
      .limit(5000);
    if (error) throw new Error(error.message);
    if (data && data.length === 5000) {
      console.warn(
        `facebook-engagement-reader: hit the 5000-row limit for range [${startDate}, ${endDateExclusive}) — Buzz Trend counts may be truncated.`
      );
    }
    return (data ?? []) as FacebookEngagementDaily[];
  }
}
