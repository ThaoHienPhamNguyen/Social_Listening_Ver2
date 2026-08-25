import type { SupabaseClient } from '@supabase/supabase-js';
import type { SentimentLabel } from './types';

export interface ThreadsSentimentReader {
  getForDate(date: string): Promise<{ keyword: string; sentiment: SentimentLabel | null }[]>;
  getForDateRange(
    startDate: string,
    endDateExclusive: string
  ): Promise<{ keyword: string; date: string; sentiment: SentimentLabel | null }[]>;
}

export class SupabaseThreadsSentimentReader implements ThreadsSentimentReader {
  constructor(private client: SupabaseClient) {}

  async getForDate(date: string): Promise<{ keyword: string; sentiment: SentimentLabel | null }[]> {
    const { data, error } = await this.client
      .from('topic_social_data')
      .select('keyword, sentiment')
      .eq('date', date)
      .limit(5000);
    if (error) throw new Error(error.message);
    if (data && data.length === 5000) {
      console.warn(`threads-sentiment-reader: hit the 5000-row limit for date ${date} — sentiment counts may be truncated.`);
    }
    return (data ?? []) as { keyword: string; sentiment: SentimentLabel | null }[];
  }

  async getForDateRange(
    startDate: string,
    endDateExclusive: string
  ): Promise<{ keyword: string; date: string; sentiment: SentimentLabel | null }[]> {
    const { data, error } = await this.client
      .from('topic_social_data')
      .select('keyword, date, sentiment')
      .gte('date', startDate)
      .lt('date', endDateExclusive)
      .limit(5000);
    if (error) throw new Error(error.message);
    if (data && data.length === 5000) {
      console.warn(
        `threads-sentiment-reader: hit the 5000-row limit for range [${startDate}, ${endDateExclusive}) — sentiment counts may be truncated.`
      );
    }
    return (data ?? []) as { keyword: string; date: string; sentiment: SentimentLabel | null }[];
  }
}
