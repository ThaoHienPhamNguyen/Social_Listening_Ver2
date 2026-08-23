import type { SupabaseClient } from '@supabase/supabase-js';
import type { TopicSocialData } from '../types';

export interface TopicSocialDataRepository {
  hasDataForDate(date: string): Promise<boolean>;
  upsertPosts(rows: Partial<TopicSocialData>[]): Promise<{ error: string | null; count: number }>;
}

export class SupabaseTopicSocialDataRepository implements TopicSocialDataRepository {
  constructor(private client: SupabaseClient) {}

  async hasDataForDate(date: string): Promise<boolean> {
    const { count, error } = await this.client
      .from('topic_social_data')
      .select('id', { count: 'exact', head: true })
      .eq('date', date);
    if (error) throw new Error(error.message);
    return (count ?? 0) > 0;
  }

  async upsertPosts(rows: Partial<TopicSocialData>[]) {
    if (rows.length === 0) return { error: null, count: 0 };
    const { error } = await this.client
      .from('topic_social_data')
      .upsert(rows, { onConflict: 'source,keyword,post_url' });
    return { error: error?.message ?? null, count: error ? 0 : rows.length };
  }
}
