import type { SupabaseClient } from '@supabase/supabase-js';
import type { SentimentLabel } from './types';

export interface FacebookSentimentReader {
  getForDate(date: string): Promise<{ category: string; sentiment: SentimentLabel | null }[]>;
  getForDateRange(startDate: string, endDateExclusive: string): Promise<{ category: string; date: string; sentiment: SentimentLabel | null }[]>;
}

export class SupabaseFacebookSentimentReader implements FacebookSentimentReader {
  constructor(private client: SupabaseClient) {}

  async getForDate(date: string): Promise<{ category: string; sentiment: SentimentLabel | null }[]> {
    const { data, error } = await this.client
      .from('facebook_page_data')
      .select('category, sentiment')
      .eq('date', date)
      .limit(5000);
    if (error) throw new Error(error.message);
    if (data && data.length === 5000) {
      console.warn(`facebook-sentiment-reader: hit the 5000-row limit for date ${date} — sentiment counts may be truncated.`);
    }
    return (data ?? []) as { category: string; sentiment: SentimentLabel | null }[];
  }

  async getForDateRange(
    startDate: string,
    endDateExclusive: string
  ): Promise<{ category: string; date: string; sentiment: SentimentLabel | null }[]> {
    const { data, error } = await this.client
      .from('facebook_page_data')
      .select('category, date, sentiment')
      .gte('date', startDate)
      .lt('date', endDateExclusive)
      .limit(5000);
    if (error) throw new Error(error.message);
    if (data && data.length === 5000) {
      console.warn(
        `facebook-sentiment-reader: hit the 5000-row limit for range [${startDate}, ${endDateExclusive}) — sentiment trend may be truncated.`
      );
    }
    return (data ?? []) as { category: string; date: string; sentiment: SentimentLabel | null }[];
  }
}
