import type { SupabaseClient } from '@supabase/supabase-js';
import type { SentimentLabel } from './types';

export interface ThreadsSentimentReader {
  getForDate(date: string): Promise<{ keyword: string; sentiment: SentimentLabel | null }[]>;
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
    return (data ?? []) as { keyword: string; sentiment: SentimentLabel | null }[];
  }
}
