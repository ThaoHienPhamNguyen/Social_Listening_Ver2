import type { SupabaseClient } from '@supabase/supabase-js';
import type { Article } from '../types';

export interface PendingArticle {
  id: string;
  url: string;
  fetch_attempts: number;
  source_id: string;
  categories: string[];
}

export interface ArticleRepository {
  upsertArticle(article: Partial<Article>): Promise<{ error: string | null }>;
  /** Throws if the underlying query fails — a caller should not treat a
   *  thrown error the same as "nothing pending". */
  getPendingArticles(limit: number, maxAttempts: number): Promise<PendingArticle[]>;
  markDone(id: string, fullContent: string, attempts: number, categories: string[]): Promise<{ error: string | null }>;
  markRetryOrFailed(id: string, attempts: number, maxAttempts: number): Promise<{ error: string | null }>;
  getRecentTitles(days: number): Promise<string[]>;
}

export class SupabaseArticleRepository implements ArticleRepository {
  constructor(private client: SupabaseClient) {}

  async upsertArticle(article: Partial<Article>) {
    const { error } = await this.client
      .from('articles')
      .upsert(article, { onConflict: 'url', ignoreDuplicates: true });
    return { error: error?.message ?? null };
  }

  async getPendingArticles(limit: number, maxAttempts: number) {
    const { data, error } = await this.client
      .from('articles')
      .select('id, url, fetch_attempts, source_id, categories')
      .eq('content_fetch_status', 'pending')
      .lt('fetch_attempts', maxAttempts)
      .order('created_at', { ascending: true })
      .limit(limit);
    if (error) throw new Error(error.message);
    return (data ?? []) as PendingArticle[];
  }

  async markDone(id: string, fullContent: string, attempts: number, categories: string[]) {
    const { error } = await this.client
      .from('articles')
      .update({ full_content: fullContent, content_fetch_status: 'done', fetch_attempts: attempts, categories })
      .eq('id', id);
    return { error: error?.message ?? null };
  }

  async markRetryOrFailed(id: string, attempts: number, maxAttempts: number) {
    const { error } = await this.client
      .from('articles')
      .update({
        content_fetch_status: attempts >= maxAttempts ? 'failed' : 'pending',
        fetch_attempts: attempts,
      })
      .eq('id', id);
    return { error: error?.message ?? null };
  }

  async getRecentTitles(days: number) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await this.client
      .from('articles')
      .select('title')
      .gte('created_at', since);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => row.title as string);
  }
}
