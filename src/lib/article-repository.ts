import type { SupabaseClient } from '@supabase/supabase-js';
import type { Article } from '../types';

export interface PendingArticle {
  id: string;
  url: string;
  fetch_attempts: number;
}

export interface ArticleRepository {
  upsertArticle(article: Partial<Article>): Promise<{ error: string | null }>;
  getPendingArticles(limit: number, maxAttempts: number): Promise<PendingArticle[]>;
  markDone(id: string, fullContent: string, attempts: number): Promise<void>;
  markRetryOrFailed(id: string, attempts: number, maxAttempts: number): Promise<void>;
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
      .select('id, url, fetch_attempts')
      .eq('content_fetch_status', 'pending')
      .lt('fetch_attempts', maxAttempts)
      .limit(limit);
    if (error || !data) return [];
    return data as PendingArticle[];
  }

  async markDone(id: string, fullContent: string, attempts: number) {
    await this.client
      .from('articles')
      .update({ full_content: fullContent, content_fetch_status: 'done', fetch_attempts: attempts })
      .eq('id', id);
  }

  async markRetryOrFailed(id: string, attempts: number, maxAttempts: number) {
    await this.client
      .from('articles')
      .update({
        content_fetch_status: attempts >= maxAttempts ? 'failed' : 'pending',
        fetch_attempts: attempts,
      })
      .eq('id', id);
  }
}
