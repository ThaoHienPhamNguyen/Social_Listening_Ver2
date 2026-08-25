import type { SupabaseClient } from '@supabase/supabase-js';
import type { CandidateTopic } from './types';

export interface CandidateTopicsReader {
  // Most recent date (YYYY-MM-DD) with any candidate_topics rows, or null if
  // the table is empty (e.g. before the discovery layer's first run).
  getLatestDate(): Promise<string | null>;
  // Every candidate_topics row for the given date — NOT filtered by category
  // or is_shortlisted. Callers need the full set to compute correct
  // share-of-voice denominators (see lib/hot-topics.ts).
  getCandidatesForDate(date: string): Promise<CandidateTopic[]>;
  // Every candidate_topics row for one keyword within [startDate, endDateExclusive)
  // — used by Topic Detail's history timelines. Capped lower than the other
  // readers (1000 vs 5000) since it's already filtered to a single keyword —
  // 3 sources × 7 days = 21 rows in the normal case, 1000 is a wide safety margin.
  getHistoryForKeyword(keyword: string, startDate: string, endDateExclusive: string): Promise<CandidateTopic[]>;
}

export class SupabaseCandidateTopicsReader implements CandidateTopicsReader {
  constructor(private client: SupabaseClient) {}

  async getLatestDate(): Promise<string | null> {
    const { data, error } = await this.client
      .from('candidate_topics')
      .select('date')
      .order('date', { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);
    return data && data.length > 0 ? (data[0].date as string) : null;
  }

  async getCandidatesForDate(date: string): Promise<CandidateTopic[]> {
    const { data, error } = await this.client
      .from('candidate_topics')
      .select('id, source, keyword, date, metric_value, growth_rate, category_hint, is_shortlisted')
      .eq('date', date)
      .order('metric_value', { ascending: false })
      .limit(5000);
    if (error) throw new Error(error.message);
    return (data ?? []) as CandidateTopic[];
  }

  async getHistoryForKeyword(keyword: string, startDate: string, endDateExclusive: string): Promise<CandidateTopic[]> {
    const { data, error } = await this.client
      .from('candidate_topics')
      .select('id, source, keyword, date, metric_value, growth_rate, category_hint, is_shortlisted')
      .eq('keyword', keyword)
      .gte('date', startDate)
      .lt('date', endDateExclusive)
      .limit(1000);
    if (error) throw new Error(error.message);
    if (data && data.length === 1000) {
      console.warn(
        `candidate-topics-reader: hit the 1000-row limit for keyword "${keyword}" range [${startDate}, ${endDateExclusive}) — Topic detail history may be truncated.`
      );
    }
    return (data ?? []) as CandidateTopic[];
  }
}
