import type { CandidateTopicsReader } from '../../lib/candidate-topics-reader';
import type { CandidateTopic } from '../../lib/types';

export class FakeCandidateTopicsReader implements CandidateTopicsReader {
  constructor(private candidates: CandidateTopic[] = []) {}

  async getLatestDate(): Promise<string | null> {
    const shortlisted = this.candidates.filter((c) => c.is_shortlisted);
    if (shortlisted.length === 0) return null;
    return [...shortlisted.map((c) => c.date)].sort().at(-1)!;
  }

  async getCandidatesForDate(date: string): Promise<CandidateTopic[]> {
    return this.candidates.filter((c) => c.date === date);
  }

  async getHistoryForKeyword(keyword: string, startDate: string, endDateExclusive: string): Promise<CandidateTopic[]> {
    return this.candidates.filter((c) => c.keyword === keyword && c.date >= startDate && c.date < endDateExclusive);
  }

  async getShortlistedForDateRange(
    category: string,
    startDate: string,
    endDateExclusive: string
  ): Promise<CandidateTopic[]> {
    return this.candidates.filter(
      (c) => c.is_shortlisted && c.category_hint.includes(category) && c.date >= startDate && c.date < endDateExclusive
    );
  }
}
