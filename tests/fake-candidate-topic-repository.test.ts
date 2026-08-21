import { describe, it, expect } from 'vitest';
import { FakeCandidateTopicRepository } from './fakes/fake-candidate-topic-repository';

describe('FakeCandidateTopicRepository', () => {
  it('adds a new candidate on upsert', async () => {
    const repo = new FakeCandidateTopicRepository();
    const { error } = await repo.upsertCandidate({
      source: 'google_trends',
      keyword: 'bitcoin',
      date: '2026-08-21',
      metric_value: 100,
      growth_rate: 1.5,
      category_hint: ['tai_chinh'],
    });
    expect(error).toBeNull();
    expect(repo.candidates).toHaveLength(1);
  });

  it('overwrites the existing row for the same source+keyword+date instead of adding a duplicate', async () => {
    const repo = new FakeCandidateTopicRepository();
    await repo.upsertCandidate({ source: 'youtube', keyword: 'x', date: '2026-08-21', metric_value: 10 });
    await repo.upsertCandidate({ source: 'youtube', keyword: 'x', date: '2026-08-21', metric_value: 50 });

    expect(repo.candidates).toHaveLength(1);
    expect(repo.candidates[0].metric_value).toBe(50);
  });

  it('getTodayCandidates returns only rows matching the given date', async () => {
    const repo = new FakeCandidateTopicRepository();
    repo.candidates.push(
      { id: '1', source: 'rss', keyword: 'a', date: '2026-08-21', metric_value: 1, growth_rate: null, category_hint: [], is_shortlisted: false },
      { id: '2', source: 'rss', keyword: 'b', date: '2026-08-20', metric_value: 1, growth_rate: null, category_hint: [], is_shortlisted: false }
    );
    const today = await repo.getTodayCandidates('2026-08-21');
    expect(today.map((c) => c.id)).toEqual(['1']);
  });

  it('getRecentMetrics returns metric_value for the source+keyword within the date range', async () => {
    const repo = new FakeCandidateTopicRepository();
    repo.candidates.push(
      { id: '1', source: 'youtube', keyword: 'a', date: '2026-08-19', metric_value: 10, growth_rate: null, category_hint: [], is_shortlisted: false },
      { id: '2', source: 'youtube', keyword: 'a', date: '2026-08-21', metric_value: 99, growth_rate: null, category_hint: [], is_shortlisted: false },
      { id: '3', source: 'rss', keyword: 'a', date: '2026-08-19', metric_value: 5, growth_rate: null, category_hint: [], is_shortlisted: false }
    );
    const recent = await repo.getRecentMetrics('youtube', 'a', '2026-08-14', '2026-08-21');
    expect(recent).toEqual([10]);
  });

  it('updateGrowthRate sets the growth_rate on the matching row', async () => {
    const repo = new FakeCandidateTopicRepository();
    repo.candidates.push({ id: '1', source: 'youtube', keyword: 'a', date: '2026-08-21', metric_value: 1, growth_rate: null, category_hint: [], is_shortlisted: false });
    await repo.updateGrowthRate('1', 3.2);
    expect(repo.candidates[0].growth_rate).toBe(3.2);
  });

  it('markShortlisted sets is_shortlisted true for every given id', async () => {
    const repo = new FakeCandidateTopicRepository();
    repo.candidates.push(
      { id: '1', source: 'youtube', keyword: 'a', date: '2026-08-21', metric_value: 1, growth_rate: null, category_hint: [], is_shortlisted: false },
      { id: '2', source: 'youtube', keyword: 'b', date: '2026-08-21', metric_value: 1, growth_rate: null, category_hint: [], is_shortlisted: false }
    );
    await repo.markShortlisted(['1']);
    expect(repo.candidates[0].is_shortlisted).toBe(true);
    expect(repo.candidates[1].is_shortlisted).toBe(false);
  });

  it('upsertCandidates adds every candidate in the batch in one call', async () => {
    const repo = new FakeCandidateTopicRepository();
    const { error, count } = await repo.upsertCandidates([
      { source: 'youtube', keyword: 'a', date: '2026-08-21', metric_value: 1 },
      { source: 'youtube', keyword: 'b', date: '2026-08-21', metric_value: 2 },
    ]);
    expect(error).toBeNull();
    expect(count).toBe(2);
    expect(repo.candidates).toHaveLength(2);
  });

  it('upsertCandidates overwrites existing rows for the same source+keyword+date, same as upsertCandidate', async () => {
    const repo = new FakeCandidateTopicRepository();
    await repo.upsertCandidate({ source: 'rss', keyword: 'x', date: '2026-08-21', metric_value: 10 });
    await repo.upsertCandidates([{ source: 'rss', keyword: 'x', date: '2026-08-21', metric_value: 99 }]);

    expect(repo.candidates).toHaveLength(1);
    expect(repo.candidates[0].metric_value).toBe(99);
  });

  it('upsertCandidates returns the configured error and adds nothing when upsertCandidatesError is set', async () => {
    const repo = new FakeCandidateTopicRepository();
    repo.upsertCandidatesError = 'simulated batch failure';

    const { error, count } = await repo.upsertCandidates([
      { source: 'rss', keyword: 'x', date: '2026-08-21', metric_value: 1 },
    ]);

    expect(error).toBe('simulated batch failure');
    expect(count).toBe(0);
    expect(repo.candidates).toHaveLength(0);
  });
});
