import type { SupabaseClient } from '@supabase/supabase-js';
import type { Article } from './types';

export interface ArticlesReader {
  getRecentArticles(limit: number, category: string | null): Promise<Article[]>;
}

export class SupabaseArticlesReader implements ArticlesReader {
  constructor(private client: SupabaseClient) {}

  async getRecentArticles(limit: number, category: string | null): Promise<Article[]> {
    let query = this.client
      .from('articles')
      .select('id, url, title, published_at, source_id, categories, snippet')
      .order('published_at', { ascending: false })
      .limit(limit);
    if (category) {
      query = query.contains('categories', [category]);
    }
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data ?? []) as Article[];
  }
}
