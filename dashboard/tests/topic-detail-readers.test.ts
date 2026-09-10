import { describe, it, expect } from 'vitest';
import { FakeCandidateTopicsReader } from './fakes/fake-candidate-topics-reader';
import type { CandidateTopic } from '../lib/types';

function candidate(overrides: Partial<CandidateTopic> = {}): CandidateTopic {
  return {
    id: 'c-1',
    source: 'rss',
    keyword: 'bitcoin',
    date: '2026-08-20',
    metric_value: 10,
    growth_rate: 0.5,
    category_hint: ['tai_chinh'],
    is_shortlisted: true,
    ...overrides,
  };
}

describe('FakeCandidateTopicsReader.getHistoryForKeyword', () => {
  it('filters by keyword AND date range [startDate, endDateExclusive)', async () => {
    const reader = new FakeCandidateTopicsReader([
      candidate({ id: 'a', keyword: 'bitcoin', date: '2026-08-18' }),
      candidate({ id: 'b', keyword: 'bitcoin', date: '2026-08-20' }), // out of range (end excl)
      candidate({ id: 'c', keyword: 'ethereum', date: '2026-08-18' }), // wrong keyword
      candidate({ id: 'd', keyword: 'bitcoin', date: '2026-08-17' }), // before range
    ]);
    const result = await reader.getHistoryForKeyword('bitcoin', '2026-08-18', '2026-08-20');
    expect(result.map((c) => c.id)).toEqual(['a']);
  });
});
