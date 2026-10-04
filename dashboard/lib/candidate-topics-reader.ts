import type { SupabaseClient } from '@supabase/supabase-js';
import type { CandidateTopic } from './types';
import { fetchAllPages } from './paginated-fetch';

export interface CandidateTopicsReader {
  // Most recent date (YYYY-MM-DD) that has at least one shortlisted
  // candidate, or null if none exists yet. Deliberately NOT "latest date
  // with any row at all": discovery-ingest can write today's first raw
  // candidate hours before rank-and-select gets a chance to run today, and
  // during that gap a "latest = today" definition would make every reader
  // that keys off this date (Overview, sector pages, Analytics, Topic
  // Detail, the public /api/topics endpoint) flip to a today that has
  // nothing shortlisted yet — hiding yesterday's fully-populated results
  // behind a false "no data" state every single day until today's first
  // run completes.
  getLatestDate(): Promise<string | null>;
  // Every candidate_topics row for the given date — NOT filtered by category
  // or is_shortlisted. Callers need the full set to compute correct
  // share-of-voice denominators (see lib/hot-topics.ts).
  getCandidatesForDate(date: string): Promise<CandidateTopic[]>;
  // Every candidate_topics row for one keyword within [startDate, endDateExclusive)
  // — used by Topic Detail's history timelines.
  getHistoryForKeyword(keyword: string, startDate: string, endDateExclusive: string): Promise<CandidateTopic[]>;
  // Every shortlisted candidate_topics row for one category within
  // [startDate, endDateExclusive) — used by getSectorMetrics's 7-day
  // window (current + previous period fetched together, split by date
  // locally — same pattern as getTopicMovers/getBuzzTrend).
  getShortlistedForDateRange(category: string, startDate: string, endDateExclusive: string): Promise<CandidateTopic[]>;
}

export class SupabaseCandidateTopicsReader implements CandidateTopicsReader {
  constructor(private client: SupabaseClient) {}

  async getLatestDate(): Promise<string | null> {
    const { data, error } = await this.client
      .from('candidate_topics')
      .select('date')
      .eq('is_shortlisted', true)
      .order('date', { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);
    return data && data.length > 0 ? (data[0].date as string) : null;
  }

  async getCandidatesForDate(date: string): Promise<CandidateTopic[]> {
    return fetchAllPages<CandidateTopic>((from, to) =>
      this.client
        .from('candidate_topics')
        .select('id, source, keyword, date, metric_value, growth_rate, category_hint, is_shortlisted, created_at, summary')
        .eq('date', date)
        .order('metric_value', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to)
    );
  }

  async getHistoryForKeyword(keyword: string, startDate: string, endDateExclusive: string): Promise<CandidateTopic[]> {
    return fetchAllPages<CandidateTopic>((from, to) =>
      this.client
        .from('candidate_topics')
        .select('id, source, keyword, date, metric_value, growth_rate, category_hint, is_shortlisted, created_at, summary')
        .eq('keyword', keyword)
        .gte('date', startDate)
        .lt('date', endDateExclusive)
        .order('id', { ascending: true })
        .range(from, to)
    );
  }

  async getShortlistedForDateRange(
    category: string,
    startDate: string,
    endDateExclusive: string
  ): Promise<CandidateTopic[]> {
    return fetchAllPages<CandidateTopic>((from, to) =>
      this.client
        .from('candidate_topics')
        .select('id, source, keyword, date, metric_value, growth_rate, category_hint, is_shortlisted, created_at, summary')
        .eq('is_shortlisted', true)
        .contains('category_hint', [category])
        .gte('date', startDate)
        .lt('date', endDateExclusive)
        .order('id', { ascending: true })
        .range(from, to)
    );
  }
}
