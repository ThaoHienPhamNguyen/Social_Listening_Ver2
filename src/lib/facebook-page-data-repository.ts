import type { SupabaseClient } from '@supabase/supabase-js';
import type { FacebookPageData } from '../types';

export interface FacebookPageDataRepository {
  hasDataForDate(date: string): Promise<boolean>;
  upsertPosts(rows: Partial<FacebookPageData>[]): Promise<{ error: string | null; count: number }>;
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
}
