import type { CandidateTopicRepository } from '../../src/lib/candidate-topic-repository';
import type { CandidateTopic } from '../../src/types';

export class FakeCandidateTopicRepository implements CandidateTopicRepository {
  public candidates: CandidateTopic[] = [];
  // Set to simulate upsertCandidates failing, e.g. to test discovery-ingest's
  // batch error handling without a real database.
  public upsertCandidatesError: string | null = null;
  // Records the size of each upsertCandidates call, so tests can verify
  // callers actually chunk large batches instead of sending one giant call.
  public upsertCandidatesCallSizes: number[] = [];

  async upsertCandidate(candidate: Partial<CandidateTopic>) {
    const existing = this.candidates.find(
      (c) => c.source === candidate.source && c.keyword === candidate.keyword && c.date === candidate.date
    );
    if (existing) {
      Object.assign(existing, candidate);
    } else {
      this.candidates.push({
        id: candidate.id ?? crypto.randomUUID(),
        is_shortlisted: false,
        growth_rate: null,
        category_hint: [],
        ...candidate,
      } as CandidateTopic);
    }
    return { error: null };
  }

  async upsertCandidates(candidates: Partial<CandidateTopic>[]) {
    this.upsertCandidatesCallSizes.push(candidates.length);
    if (this.upsertCandidatesError) {
      return { error: this.upsertCandidatesError, count: 0 };
    }
    for (const candidate of candidates) {
      await this.upsertCandidate(candidate);
    }
    return { error: null, count: candidates.length };
  }

  async getTodayCandidates(date: string) {
    return this.candidates.filter((c) => c.date === date);
  }

  async getRecentMetrics(source: string, keyword: string, sinceDate: string, beforeDate: string) {
    return this.candidates
      .filter(
        (c) => c.source === source && c.keyword === keyword && c.date >= sinceDate && c.date < beforeDate
      )
      .map((c) => c.metric_value);
  }

  async updateGrowthRate(id: string, growthRate: number) {
    const c = this.candidates.find((x) => x.id === id);
    if (c) c.growth_rate = growthRate;
    return { error: null };
  }

  async markShortlisted(ids: string[]) {
    for (const id of ids) {
      const c = this.candidates.find((x) => x.id === id);
      if (c) c.is_shortlisted = true;
    }
    return { error: null };
  }
}
