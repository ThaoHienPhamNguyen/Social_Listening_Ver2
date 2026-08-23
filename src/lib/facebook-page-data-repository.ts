import type { SupabaseClient } from '@supabase/supabase-js';
import type { FacebookPageData, SentimentLabel } from '../types';

export interface FacebookPageDataRepository {
  hasDataForDate(date: string): Promise<boolean>;
  upsertPosts(rows: Partial<FacebookPageData>[]): Promise<{ error: string | null; count: number }>;
  getUnclassifiedPosts(): Promise<{ id: string; text_content: string }[]>;
  updateSentiment(id: string, sentiment: SentimentLabel): Promise<{ error: string | null }>;
  getPostsForDate(date: string): Promise<FacebookPageData[]>;
}

export class SupabaseFacebookPageDataRepository implements FacebookPageDataRepository {
  constructor(private client: SupabaseClient) {}

  async hasDataForDate(date: string): Promise<boolean> {
    const { count, error } = await this.client
      .from('facebook_page_data')
      .select('id', { count: 'exact', head: true })
      .eq('date', date);
    if (error) throw new Error(error.message);
    return (count ?? 0) > 0;
  }

  async upsertPosts(rows: Partial<FacebookPageData>[]) {
    if (rows.length === 0) return { error: null, count: 0 };
    const { error } = await this.client
      .from('facebook_page_data')
      .upsert(rows, { onConflict: 'page_url,post_url' });
    return { error: error?.message ?? null, count: error ? 0 : rows.length };
  }

  async getUnclassifiedPosts() {
    const { data, error } = await this.client
      .from('facebook_page_data')
      .select('id, text_content')
      .is('sentiment', null)
      .limit(5000);
    if (error) throw new Error(error.message);
    return (data ?? []) as { id: string; text_content: string }[];
  }

  async updateSentiment(id: string, sentiment: SentimentLabel) {
    const { error } = await this.client
      .from('facebook_page_data')
      .update({ sentiment })
      .eq('id', id);
    return { error: error?.message ?? null };
  }

  async getPostsForDate(date: string) {
    const { data, error } = await this.client
      .from('facebook_page_data')
      .select('*')
      .eq('date', date)
      .limit(5000);
    if (error) throw new Error(error.message);
    return (data ?? []) as FacebookPageData[];
  }
}
