import type { SupabaseClient } from '@supabase/supabase-js';
import type { Article } from './types';

export interface ArticlesReader {
  getRecentArticles(limit: number, category: string | null): Promise<Article[]>;
  getForDate(date: string): Promise<{ id: string; categories: string[] }[]>;
  getForDateRange(startDate: string, endDateExclusive: string): Promise<{ id: string; categories: string[]; date: string }[]>;
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

  // articles has no `date` column (unlike candidate_topics/topic_social_data/
  // facebook_page_data) — only `published_at` (a timestamptz). Filter by the
  // [date, date+1) range in UTC. Rows with published_at === null never match
  // any range, so they're correctly excluded.
  async getForDate(date: string): Promise<{ id: string; categories: string[] }[]> {
    const nextDate = new Date(`${date}T00:00:00Z`);
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);
    const nextDateStr = nextDate.toISOString().slice(0, 10);

    const { data, error } = await this.client
      .from('articles')
      .select('id, categories')
      .gte('published_at', `${date}T00:00:00Z`)
      .lt('published_at', `${nextDateStr}T00:00:00Z`)
      .limit(5000);
    if (error) throw new Error(error.message);
    if (data && data.length === 5000) {
      console.warn(`articles-reader: hit the 5000-row limit for date ${date} — Buzz Volume/donut counts may be truncated.`);
    }
    return (data ?? []) as { id: string; categories: string[] }[];
  }

  // Same [date, date+1) UTC boundary logic as getForDate, generalized to an
  // arbitrary [startDate, endDateExclusive) range. Rows in this range always
  // have a non-null published_at (a null published_at can't match any
  // gte/lt range), so the `date` field below is always derivable.
  async getForDateRange(
    startDate: string,
    endDateExclusive: string
  ): Promise<{ id: string; categories: string[]; date: string }[]> {
    const { data, error } = await this.client
      .from('articles')
      .select('id, categories, published_at')
      .gte('published_at', `${startDate}T00:00:00Z`)
      .lt('published_at', `${endDateExclusive}T00:00:00Z`)
      .limit(5000);
    if (error) throw new Error(error.message);
    if (data && data.length === 5000) {
      console.warn(
        `articles-reader: hit the 5000-row limit for range [${startDate}, ${endDateExclusive}) — Buzz Trend counts may be truncated.`
      );
    }
    return ((data ?? []) as { id: string; categories: string[]; published_at: string }[]).map((row) => ({
      id: row.id,
      categories: row.categories,
      date: row.published_at.slice(0, 10),
    }));
  }
}
