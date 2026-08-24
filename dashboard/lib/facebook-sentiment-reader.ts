import type { SupabaseClient } from '@supabase/supabase-js';
import type { SentimentLabel } from './types';

export interface FacebookSentimentReader {
  getForDate(date: string): Promise<{ category: string; sentiment: SentimentLabel | null }[]>;
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
    return (data ?? []) as { category: string; sentiment: SentimentLabel | null }[];
  }
}
