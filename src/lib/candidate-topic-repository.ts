import type { SupabaseClient } from '@supabase/supabase-js';
import type { CandidateTopic } from '../types';

export interface CandidateTopicRepository {
  upsertCandidate(candidate: Partial<CandidateTopic>): Promise<{ error: string | null }>;
  getTodayCandidates(date: string): Promise<CandidateTopic[]>;
  getRecentMetrics(
    source: string,
    keyword: string,
    sinceDate: string,
    beforeDate: string
  ): Promise<number[]>;
  updateGrowthRate(id: string, growthRate: number): Promise<{ error: string | null }>;
  markShortlisted(ids: string[]): Promise<{ error: string | null }>;
}

export class SupabaseCandidateTopicRepository implements CandidateTopicRepository {
  constructor(private client: SupabaseClient) {}

  async upsertCandidate(candidate: Partial<CandidateTopic>) {
    const { error } = await this.client
      .from('candidate_topics')
      .upsert(candidate, { onConflict: 'source,keyword,date' });
    return { error: error?.message ?? null };
  }

  async getTodayCandidates(date: string) {
    // Supabase-hosted PostgREST applies a project-level "Max rows" cap
    // (commonly 1000 by default) that silently truncates unbounded reads.
    // 5000 is a generous safety net, not a tuned value. Ordering by
    // metric_value descending means that if the cap is ever hit, the
    // highest-signal candidates survive, best serving rankAndSelect's
    // downstream top-N selection.
    const { data, error } = await this.client
      .from('candidate_topics')
      .select('*')
      .eq('date', date)
      .order('metric_value', { ascending: false })
      .limit(5000);
    if (error) throw new Error(error.message);
    return (data ?? []) as CandidateTopic[];
  }

  async getRecentMetrics(source: string, keyword: string, sinceDate: string, beforeDate: string) {
    const { data, error } = await this.client
      .from('candidate_topics')
      .select('metric_value')
      .eq('source', source)
      .eq('keyword', keyword)
      .gte('date', sinceDate)
      .lt('date', beforeDate);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => row.metric_value as number);
  }

  async updateGrowthRate(id: string, growthRate: number) {
    const { error } = await this.client
      .from('candidate_topics')
      .update({ growth_rate: growthRate })
      .eq('id', id);
    return { error: error?.message ?? null };
  }

  async markShortlisted(ids: string[]) {
    const { error } = await this.client
      .from('candidate_topics')
      .update({ is_shortlisted: true })
      .in('id', ids);
    return { error: error?.message ?? null };
  }
}
