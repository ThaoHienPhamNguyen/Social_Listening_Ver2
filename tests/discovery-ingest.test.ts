import { describe, it, expect } from 'vitest';
import { ingestDiscoverySource, ingestAllDiscoverySources } from '../src/discovery-ingest';
import { rankAndSelect } from '../src/rank-and-select';
import { FakeCandidateTopicRepository } from './fakes/fake-candidate-topic-repository';
import { FakeCandidateClassifier } from './fakes/fake-candidate-classifier';
import type { DiscoverySource } from '../src/lib/discovery-source';
import type { CandidateTopicRepository } from '../src/lib/candidate-topic-repository';
import type { CandidateClassifier } from '../src/lib/candidate-classifier';
import type { Category } from '../src/types';

function fakeSource(
  name: 'google_trends' | 'youtube' | 'rss',
  candidates: Array<{
    keyword: string;
    metric_value: number;
    growth_rate: number | null;
    knownCategories?: Category[];
  }>
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

  it('classifies candidates that still have no category_hint after matchCategories() and knownCategories', async () => {
    const repo = new FakeCandidateTopicRepository();
    const classifier = new FakeCandidateClassifier();
    classifier.labels = { 'quang dũng': 'giai_tri' };
    const source = fakeSource('google_trends', [{ keyword: 'quang dũng', metric_value: 100, growth_rate: null }]);

    await ingestDiscoverySource(source, { repo, classifier, now: () => new Date('2026-08-21T09:00:00Z') });

    expect(repo.candidates[0].category_hint).toEqual(['giai_tri']);
    expect(classifier.calls).toEqual([['quang dũng']]);
  });

  it('does not call the classifier for candidates that already have a category_hint', async () => {
    const repo = new FakeCandidateTopicRepository();
    const classifier = new FakeCandidateClassifier();
    const source = fakeSource('google_trends', [{ keyword: 'giá vàng', metric_value: 100, growth_rate: null }]);

    await ingestDiscoverySource(source, { repo, classifier, now: () => new Date('2026-08-21T09:00:00Z') });

    expect(classifier.calls).toEqual([]);
  });

  it('leaves category_hint empty and records an error, without dropping the candidate, when classification throws', async () => {
    const repo = new FakeCandidateTopicRepository();
    const classifier: CandidateClassifier = {
      classify: async () => {
        throw new Error('openai timeout');
      },
    };
    const source = fakeSource('google_trends', [{ keyword: 'quang dũng', metric_value: 100, growth_rate: null }]);

    const result = await ingestDiscoverySource(source, {
      repo,
      classifier,
      now: () => new Date('2026-08-21T09:00:00Z'),
    });

    expect(repo.candidates[0].category_hint).toEqual([]);
    expect(result.errors.some((e) => e.includes('openai timeout'))).toBe(true);
    expect(result.upserted).toBe(1);
  });

  it('skips classification entirely when no classifier dependency is provided', async () => {
    const repo = new FakeCandidateTopicRepository();
    const source = fakeSource('google_trends', [{ keyword: 'quang dũng', metric_value: 100, growth_rate: null }]);

    await ingestDiscoverySource(source, { repo, now: () => new Date('2026-08-21T09:00:00Z') });

    expect(repo.candidates[0].category_hint).toEqual([]);
  });

  it('uses knownCategories from the candidate (e.g. RSS ground truth or a YouTube seed match) even when matchCategories() finds nothing', async () => {
    const repo = new FakeCandidateTopicRepository();
    const source = fakeSource('rss', [
      { keyword: 'quang dũng', metric_value: 100, growth_rate: null, knownCategories: ['giai_tri'] },
    ]);

    await ingestDiscoverySource(source, { repo, now: () => new Date('2026-08-21T09:00:00Z') });

    expect(repo.candidates[0].category_hint).toEqual(['giai_tri']);
  });

  it('does not let the classifier overwrite a category_hint that was already resolved via matchCategories(), even if the classifier response includes that keyword', async () => {
    const repo = new FakeCandidateTopicRepository();
    const calls: string[][] = [];
    const classifier: CandidateClassifier = {
      classify: async (keywords) => {
        calls.push(keywords);
        // A lenient/misbehaving response that includes a keyword never asked
        // for, with a label that contradicts the already-resolved hint.
        return { 'giá vàng': 'giai_tri', 'quang dũng': 'giai_tri' };
      },
    };
    const source = fakeSource('google_trends', [
      { keyword: 'giá vàng', metric_value: 100, growth_rate: null },
      { keyword: 'quang dũng', metric_value: 50, growth_rate: null },
    ]);

    await ingestDiscoverySource(source, { repo, classifier, now: () => new Date('2026-08-21T09:00:00Z') });

    const giaVang = repo.candidates.find((c) => c.keyword === 'giá vàng')!;
    expect(giaVang.category_hint).toEqual(['tai_chinh']);
    expect(calls).toEqual([['quang dũng']]);
  });

  it('ignores a classifier label that is not one of the 3 known categories, leaving category_hint empty', async () => {
    const repo = new FakeCandidateTopicRepository();
    const classifier: CandidateClassifier = {
      // Cast past ClassificationLabel's type — this simulates the real
      // OpenAI adapter parsing raw, untrusted LLM JSON output that doesn't
      // actually conform to the type the interface promises.
      classify: async () => ({ 'quang dũng': 'sports' }) as unknown as Record<string, 'tai_chinh'>,
    };
    const source = fakeSource('google_trends', [{ keyword: 'quang dũng', metric_value: 100, growth_rate: null }]);

    await ingestDiscoverySource(source, { repo, classifier, now: () => new Date('2026-08-21T09:00:00Z') });

    expect(repo.candidates[0].category_hint).toEqual([]);
  });

  it('splits a large batch of uncategorized keywords into multiple classify() calls of at most 50 each', async () => {
    const repo = new FakeCandidateTopicRepository();
    const classifier = new FakeCandidateClassifier();
    const keywords = Array.from({ length: 120 }, (_, i) => `keyword${i}`);
    const source = fakeSource(
      'google_trends',
      keywords.map((keyword) => ({ keyword, metric_value: 1, growth_rate: null }))
    );

    await ingestDiscoverySource(source, { repo, classifier, now: () => new Date('2026-08-21T09:00:00Z') });

    expect(classifier.calls).toHaveLength(3);
    expect(classifier.calls.map((c) => c.length)).toEqual([50, 50, 20]);
    expect(new Set(classifier.calls.flat())).toEqual(new Set(keywords));
  });

  it('keeps other chunks classified when one chunk throws, isolating the failure per chunk', async () => {
    const repo = new FakeCandidateTopicRepository();
    const keywords = Array.from({ length: 60 }, (_, i) => `keyword${i}`);
    let callCount = 0;
    const classifier: CandidateClassifier = {
      classify: async (chunk) => {
        callCount += 1;
        if (callCount === 1) throw new Error('This operation was aborted');
        const result: Record<string, 'tai_chinh'> = {};
        for (const keyword of chunk) result[keyword] = 'tai_chinh';
        return result;
      },
    };
    const source = fakeSource(
      'google_trends',
      keywords.map((keyword) => ({ keyword, metric_value: 1, growth_rate: null }))
    );

    const result = await ingestDiscoverySource(source, {
      repo,
      classifier,
      now: () => new Date('2026-08-21T09:00:00Z'),
    });

    expect(callCount).toBe(2);
    expect(result.errors.some((e) => e.includes('This operation was aborted'))).toBe(true);
    // First 50 (the failed chunk) stay uncategorized; the second chunk (10 more) got classified.
    const secondChunkKeyword = repo.candidates.find((c) => c.keyword === 'keyword50')!;
    expect(secondChunkKeyword.category_hint).toEqual(['tai_chinh']);
    const firstChunkKeyword = repo.candidates.find((c) => c.keyword === 'keyword0')!;
    expect(firstChunkKeyword.category_hint).toEqual([]);
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

  it('records an error and still processes the remaining sources when a batch write throws instead of resolving with an error', async () => {
    // Unlike a PostgREST-level failure (which resolves { error }), a network
    // exception from the underlying fetch call can reject the promise —
    // ingestDiscoverySource must isolate that the same way it isolates a
    // fetchCandidates() failure, or one source's network blip aborts every
    // source queued after it for the day.
    const throwingRepo: CandidateTopicRepository = {
      upsertCandidate: async () => ({ error: null }),
      upsertCandidates: async () => {
        throw new Error('network exception');
      },
      getTodayCandidates: async () => [],
      getRecentMetrics: async () => [],
      updateGrowthRate: async () => ({ error: null }),
      markShortlisted: async () => ({ error: null }),
    };
    const sources = [
      fakeSource('google_trends', [{ keyword: 'a', metric_value: 1, growth_rate: 1 }]),
      fakeSource('youtube', [{ keyword: 'b', metric_value: 2, growth_rate: null }]),
    ];

    const results = await ingestAllDiscoverySources(sources, {
      repo: throwingRepo,
      now: () => new Date('2026-08-21T09:00:00Z'),
    });

    expect(results).toHaveLength(2);
    expect(results[0].upserted).toBe(0);
    expect(results[0].errors[0]).toContain('network exception');
    expect(results[1].upserted).toBe(0);
    expect(results[1].errors[0]).toContain('network exception');
  });
});
