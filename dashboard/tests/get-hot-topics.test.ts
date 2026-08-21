// dashboard/tests/get-hot-topics.test.ts
import { describe, it, expect } from 'vitest';
import { getHotTopics } from '../lib/get-hot-topics';
import { FakeCandidateTopicsReader } from './fakes/fake-candidate-topics-reader';
import type { CandidateTopic } from '../lib/types';

function candidate(overrides: Partial<CandidateTopic> = {}): CandidateTopic {
  return {
    id: 'id-1',
    source: 'rss',
    keyword: 'bitcoin',
    date: '2026-08-21',
    metric_value: 10,
    growth_rate: 0.5,
    category_hint: ['tai_chinh'],
    is_shortlisted: true,
    ...overrides,
  };
}

describe('getHotTopics', () => {
  it('returns a null date and empty groups when the reader has no data', async () => {
    const reader = new FakeCandidateTopicsReader([]);
    const result = await getHotTopics(reader, 'tai_chinh');
    expect(result.date).toBeNull();
    expect(result.bySource).toEqual({ google_trends: [], youtube: [], rss: [] });
  });

  it('filters to one category when a category is given', async () => {
    const inCat = candidate({ id: 'in', category_hint: ['tai_chinh'] });
    const outOfCat = candidate({ id: 'out', category_hint: ['giai_tri'] });
    const reader = new FakeCandidateTopicsReader([inCat, outOfCat]);
    const result = await getHotTopics(reader, 'tai_chinh');
    expect(result.date).toBe('2026-08-21');
    expect(result.bySource.rss.map((r) => r.id)).toEqual(['in']);
  });

  it('returns candidates from every category when category is null (Overview)', async () => {
    const a = candidate({ id: 'a', category_hint: ['tai_chinh'] });
    const b = candidate({ id: 'b', category_hint: ['giai_tri'] });
    const reader = new FakeCandidateTopicsReader([a, b]);
    const result = await getHotTopics(reader, null);
    expect(result.bySource.rss.map((r) => r.id).sort()).toEqual(['a', 'b']);
  });
});
