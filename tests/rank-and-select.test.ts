import { describe, it, expect } from 'vitest';
import { rankAndSelect } from '../src/rank-and-select';
import { FakeCandidateTopicRepository } from './fakes/fake-candidate-topic-repository';
import type { CandidateTopic } from '../src/types';

function candidate(overrides: Partial<CandidateTopic>): CandidateTopic {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    source: 'google_trends',
    keyword: 'x',
    date: '2026-08-21',
    metric_value: 100,
    growth_rate: null,
    category_hint: [],
    is_shortlisted: false,
    ...overrides,
  };
}

const NOW = () => new Date('2026-08-21T09:00:00Z');

describe('rankAndSelect', () => {
  it('keeps the growth_rate already provided by a source (e.g. Google Trends) unchanged', async () => {
    const repo = new FakeCandidateTopicRepository();
    repo.candidates.push(candidate({ id: '1', growth_rate: 2.5 }));

    await rankAndSelect({ repo, now: NOW });

    expect(repo.candidates[0].growth_rate).toBe(2.5);
  });

  it('computes growth_rate from the 7-day baseline average when missing', async () => {
    const repo = new FakeCandidateTopicRepository();
    repo.candidates.push(
      candidate({ id: '1', keyword: 'bitcoin', source: 'youtube', metric_value: 300, date: '2026-08-21' }),
      candidate({ id: '2', keyword: 'bitcoin', source: 'youtube', metric_value: 100, date: '2026-08-19' }),
      candidate({ id: '3', keyword: 'bitcoin', source: 'youtube', metric_value: 100, date: '2026-08-20' })
    );

    await rankAndSelect({ repo, now: NOW });

    expect(repo.candidates[0].growth_rate).toBe(2);
  });

  it('assigns the sentinel growth_rate to a keyword with no history at all', async () => {
    const repo = new FakeCandidateTopicRepository();
    repo.candidates.push(candidate({ id: '1', keyword: 'topic mới', metric_value: 50 }));

    await rankAndSelect({ repo, now: NOW });

    expect(repo.candidates[0].growth_rate).toBe(999);
  });

  it('assigns the sentinel growth_rate when the baseline average is zero', async () => {
    const repo = new FakeCandidateTopicRepository();
    repo.candidates.push(
      candidate({ id: '1', keyword: 'y', metric_value: 10, date: '2026-08-21' }),
      candidate({ id: '2', keyword: 'y', metric_value: 0, date: '2026-08-20' })
    );

    await rankAndSelect({ repo, now: NOW });

    expect(repo.candidates[0].growth_rate).toBe(999);
  });

  it('shortlists only the top N per source by growth_rate, and marks every row (across sources) matching a shortlisted keyword', async () => {
    const repo = new FakeCandidateTopicRepository();
    repo.candidates.push(
      candidate({ id: '1', source: 'google_trends', keyword: 'a', growth_rate: 3 }),
      candidate({ id: '2', source: 'google_trends', keyword: 'b', growth_rate: 1 }),
      candidate({ id: '3', source: 'youtube', keyword: 'a', growth_rate: 5 })
    );

    const result = await rankAndSelect({ repo, now: NOW }, { topPerSource: 1 });

    expect(result).toEqual({ evaluated: 3, shortlisted: 1 });
    expect(repo.candidates.find((c) => c.id === '1')!.is_shortlisted).toBe(true);
    expect(repo.candidates.find((c) => c.id === '2')!.is_shortlisted).toBe(false);
    expect(repo.candidates.find((c) => c.id === '3')!.is_shortlisted).toBe(true);
  });

  it('marks a row shortlisted via a keyword that is top-N in a different source, even when it is not top-N in its own source', async () => {
    const repo = new FakeCandidateTopicRepository();
    repo.candidates.push(
      // Source A: keyword 'c' is the only candidate, so it's trivially A's top-N.
      candidate({ id: '1', source: 'google_trends', keyword: 'c', growth_rate: 10 }),
      // Source B: keyword 'c' is present but outranked by 'd', so 'c' does NOT make B's own top-N.
      candidate({ id: '2', source: 'youtube', keyword: 'c', growth_rate: 1 }),
      candidate({ id: '3', source: 'youtube', keyword: 'd', growth_rate: 5 })
    );

    const result = await rankAndSelect({ repo, now: NOW }, { topPerSource: 1 });

    expect(result).toEqual({ evaluated: 3, shortlisted: 2 });
    // 'c' is shortlisted because source A confirmed it, so B's 'c' row must also be marked,
    // despite not ranking in B's own top-N slice.
    expect(repo.candidates.find((c) => c.id === '2')!.is_shortlisted).toBe(true);
    expect(repo.candidates.find((c) => c.id === '1')!.is_shortlisted).toBe(true);
    expect(repo.candidates.find((c) => c.id === '3')!.is_shortlisted).toBe(true);
  });

  it('shortlists the top 10 candidates per source by default when topPerSource is not specified', async () => {
    const repo = new FakeCandidateTopicRepository();
    // 10 candidates in one source, ranked 1st (highest growth_rate) through 10th.
    for (let i = 1; i <= 10; i++) {
      repo.candidates.push(
        candidate({ id: String(i), source: 'google_trends', keyword: `kw${i}`, growth_rate: 11 - i })
      );
    }
    // An 11th, lowest-ranked candidate that should NOT make the default top-10.
    repo.candidates.push(
      candidate({ id: '11', source: 'google_trends', keyword: 'kw11', growth_rate: 0 })
    );

    const result = await rankAndSelect({ repo, now: NOW });

    expect(result.shortlisted).toBe(10);
    for (let i = 1; i <= 10; i++) {
      expect(repo.candidates.find((c) => c.id === String(i))!.is_shortlisted).toBe(true);
    }
    expect(repo.candidates.find((c) => c.id === '11')!.is_shortlisted).toBe(false);
  });
});
