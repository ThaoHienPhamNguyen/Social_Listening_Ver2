import type { SupabaseClient } from '@supabase/supabase-js';
import type { TopicArticleData } from '../types';

export interface TopicArticleDataRepository {
  upsertLinks(rows: Partial<TopicArticleData>[]): Promise<{ error: string | null; count: number }>;
  getArticlesForDate(date: string): Promise<TopicArticleData[]>;
}

export class SupabaseTopicArticleDataRepository implements TopicArticleDataRepository {
  constructor(private client: SupabaseClient) {}

  async upsertLinks(rows: Partial<TopicArticleData>[]) {
    if (rows.length === 0) return { error: null, count: 0 };
    const { error } = await this.client
      .from('topic_article_data')
      .upsert(rows, { onConflict: 'source,keyword,article_url' });
    return { error: error?.message ?? null, count: error ? 0 : rows.length };
  }

  async getArticlesForDate(date: string) {
    const { data, error } = await this.client
      .from('topic_article_data')
      .select('*')
      .eq('date', date)
      .limit(5000);
    if (error) throw new Error(error.message);
    return (data ?? []) as TopicArticleData[];
  }
}
