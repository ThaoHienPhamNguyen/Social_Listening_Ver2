import { describe, it, expect } from 'vitest';
import { ingestDiscoverySource, ingestAllDiscoverySources } from '../src/discovery-ingest';
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
