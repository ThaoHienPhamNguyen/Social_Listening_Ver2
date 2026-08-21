import { describe, it, expect } from 'vitest';
import { ingestDiscoverySource, ingestAllDiscoverySources } from '../src/discovery-ingest';
import { rankAndSelect } from '../src/rank-and-select';
import { FakeCandidateTopicRepository } from './fakes/fake-candidate-topic-repository';
import type { DiscoverySource } from '../src/lib/discovery-source';

function fakeSource(
  name: 'google_trends' | 'youtube' | 'rss',
  candidates: Array<{ keyword: string; metric_value: number; growth_rate: number | null }>
): DiscoverySource {
  return { name, fetchCandidates: async () => candidates };
}

describe('ingestDiscoverySource', () => {
  it('upserts one candidate_topics row per fetched candidate, tagged with today and category hints', async () => {
    const repo = new FakeCandidateTopicRepository();
    const source = fakeSource('google_trends', [{ keyword: 'giá vàng', metric_value: 5000, growth_rate: 1.2 }]);

    const result = await ingestDiscoverySource(source, { repo, now: () => new Date('2026-08-21T09:00:00Z') });

    expect(result).toEqual({ source: 'google_trends', fetched: 1, upserted: 1, errors: [] });
    expect(repo.candidates).toHaveLength(1);
    expect(repo.candidates[0]).toMatchObject({
      source: 'google_trends',
      keyword: 'giá vàng',
      date: '2026-08-21',
      metric_value: 5000,
      growth_rate: 1.2,
      category_hint: ['tai_chinh'],
    });
  });

  it('records an error and returns early when fetchCandidates throws', async () => {
    const repo = new FakeCandidateTopicRepository();
    const source: DiscoverySource = {
      name: 'youtube',
      fetchCandidates: async () => {
        throw new Error('quota exceeded');
      },
    };

    const result = await ingestDiscoverySource(source, { repo, now: () => new Date() });

    expect(result.fetched).toBe(0);
    expect(result.errors[0]).toContain('quota exceeded');
  });

  it('writes candidates via a single batched upsert call instead of one call per candidate', async () => {
    const repo = new FakeCandidateTopicRepository();
    const source = fakeSource('rss', [
      { keyword: 'a', metric_value: 1, growth_rate: null },
      { keyword: 'b', metric_value: 2, growth_rate: null },
      { keyword: 'c', metric_value: 3, growth_rate: null },
    ]);

    const result = await ingestDiscoverySource(source, { repo, now: () => new Date('2026-08-21T09:00:00Z') });

    expect(result).toEqual({ source: 'rss', fetched: 3, upserted: 3, errors: [] });
    expect(repo.upsertCandidatesCallSizes).toEqual([3]);
  });

  it('splits a large batch into chunks of at most 200 candidates per write call', async () => {
    const repo = new FakeCandidateTopicRepository();
    const manyCandidates = Array.from({ length: 201 }, (_, i) => ({
      keyword: `kw${i}`,
      metric_value: i,
      growth_rate: null,
    }));
    const source = fakeSource('rss', manyCandidates);

    const result = await ingestDiscoverySource(source, { repo, now: () => new Date('2026-08-21T09:00:00Z') });

    expect(result.upserted).toBe(201);
    expect(repo.upsertCandidatesCallSizes).toEqual([200, 1]);
  });

  it('records one error for the whole chunk and does not count it as upserted when a batch write fails', async () => {
    const repo = new FakeCandidateTopicRepository();
    repo.upsertCandidatesError = 'db unavailable';
    const source = fakeSource('rss', [
      { keyword: 'a', metric_value: 1, growth_rate: null },
      { keyword: 'b', metric_value: 2, growth_rate: null },
    ]);

    const result = await ingestDiscoverySource(source, { repo, now: () => new Date('2026-08-21T09:00:00Z') });

    expect(result.fetched).toBe(2);
    expect(result.upserted).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('db unavailable');
  });

  it('does not reset an already-computed growth_rate/is_shortlisted when the same keyword is re-ingested later the same day', async () => {
    // The workflow runs discovery-ingest -> rank-and-select 3x/day, all writing
    // the same calendar `date`. A keyword that reappears in a later run's fetch
    // must not lose what an earlier run's rank-and-select already computed for it.
    const repo = new FakeCandidateTopicRepository();
    const now = () => new Date('2026-08-21T09:00:00Z');
    const source = fakeSource('rss', [{ keyword: 'bitcoin', metric_value: 10, growth_rate: null }]);

    // Run 1: ingest, then rank-and-select computes growth_rate and shortlists it.
    await ingestDiscoverySource(source, { repo, now });
    await rankAndSelect({ repo, now });

    const afterRun1 = repo.candidates.find((c) => c.keyword === 'bitcoin')!;
    expect(afterRun1.growth_rate).toBe(999); // sentinel: no prior history
    expect(afterRun1.is_shortlisted).toBe(true);

    // Run 2 (later that day): the same keyword reappears in the RSS fetch.
    await ingestDiscoverySource(source, { repo, now });

    const afterRun2 = repo.candidates.find((c) => c.keyword === 'bitcoin')!;
    expect(afterRun2.growth_rate).toBe(999);
    expect(afterRun2.is_shortlisted).toBe(true);
  });

  it('keeps growth_rate presence homogeneous within each batch write, even if a source returns a mix of null and non-null growth_rate', async () => {
    // Supabase/PostgREST's bulk upsert derives one column list from the union
    // of keys across ALL rows in a single array — a row that omits a key
    // present elsewhere in the same batch gets NULL written for it, not left
    // untouched. So every upsertCandidates() call must be homogeneous with
    // respect to which optional keys (growth_rate) it carries, regardless of
    // what any given source's fetchCandidates() returns.
    const repo = new FakeCandidateTopicRepository();
    const source = fakeSource('google_trends', [
      { keyword: 'a', metric_value: 1, growth_rate: 2.5 },
      { keyword: 'b', metric_value: 2, growth_rate: null },
    ]);

    await ingestDiscoverySource(source, { repo, now: () => new Date('2026-08-21T09:00:00Z') });

    for (const batch of repo.upsertCandidatesCallPayloads) {
      const hasGrowthRateFlags = new Set(batch.map((row) => 'growth_rate' in row));
      expect(hasGrowthRateFlags.size).toBe(1);
    }
  });
});

describe('ingestAllDiscoverySources', () => {
  it('runs ingestDiscoverySource for every source and aggregates results', async () => {
    const repo = new FakeCandidateTopicRepository();
    const sources = [
      fakeSource('google_trends', [{ keyword: 'a', metric_value: 1, growth_rate: 1 }]),
      fakeSource('youtube', [{ keyword: 'b', metric_value: 2, growth_rate: null }]),
    ];

    const results = await ingestAllDiscoverySources(sources, {
      repo,
      now: () => new Date('2026-08-21T09:00:00Z'),
    });

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.source)).toEqual(['google_trends', 'youtube']);
  });
});
