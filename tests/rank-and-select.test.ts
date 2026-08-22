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

  it('recomputes growth_rate for non-Google-Trends sources every run, even if an earlier run that same day already set one', async () => {
    // discovery-ingest.ts preserves growth_rate across same-day re-ingests (it's
    // omitted from the upsert payload once set), and metric_value keeps updating
    // on every re-ingest. If rank-and-select only recomputed growth_rate when it
    // was still null, a later run's fresher metric_value would never be reflected
    // — the shortlist would rank on a stale figure from earlier in the day.
    const repo = new FakeCandidateTopicRepository();
    repo.candidates.push(
      // Stale growth_rate=0.5 from an earlier run today; metric_value has since
      // risen to 400 via a later discovery-ingest run.
      candidate({ id: '1', keyword: 'bitcoin', source: 'youtube', metric_value: 400, growth_rate: 0.5, date: '2026-08-21' }),
      candidate({ id: '2', keyword: 'bitcoin', source: 'youtube', metric_value: 100, date: '2026-08-19' }),
      candidate({ id: '3', keyword: 'bitcoin', source: 'youtube', metric_value: 100, date: '2026-08-20' })
    );

    await rankAndSelect({ repo, now: NOW });

    // baseline avg = 100; fresh growth_rate = (400-100)/100 = 3, not the stale 0.5.
    expect(repo.candidates[0].growth_rate).toBe(3);
  });

  it('assigns the sentinel growth_rate to a keyword with no history at all', async () => {
    const repo = new FakeCandidateTopicRepository();
    // Non-Google-Trends source: growth_rate starts null and must be computed
    // (Google Trends' own growth_rate, once set, is never touched — see the
    // "keeps the growth_rate already provided by a source" test above).
    repo.candidates.push(candidate({ id: '1', source: 'youtube', keyword: 'topic mới', metric_value: 50 }));

    await rankAndSelect({ repo, now: NOW });

    expect(repo.candidates[0].growth_rate).toBe(999);
  });

  it('assigns the sentinel growth_rate when the baseline average is zero', async () => {
    const repo = new FakeCandidateTopicRepository();
    repo.candidates.push(
      candidate({ id: '1', source: 'youtube', keyword: 'y', metric_value: 10, date: '2026-08-21' }),
      candidate({ id: '2', source: 'youtube', keyword: 'y', metric_value: 0, date: '2026-08-20' })
    );

    await rankAndSelect({ repo, now: NOW });

    expect(repo.candidates[0].growth_rate).toBe(999);
  });

  it('shortlists only the top N per source by growth_rate, and marks every row (across sources) matching a shortlisted keyword', async () => {
    const repo = new FakeCandidateTopicRepository();
    repo.candidates.push(
      candidate({ id: '1', source: 'google_trends', keyword: 'a', growth_rate: 3 }),
      candidate({ id: '2', source: 'google_trends', keyword: 'b', growth_rate: 1 }),
      // The sole youtube candidate: growth_rate starts null (gets computed —
      // sentinel 999, no history) and is trivially youtube's own top-1 either way.
      candidate({ id: '3', source: 'youtube', keyword: 'a' })
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
      // Source B: keyword 'c' and 'd' both have baseline history (below), so their
      // growth_rate gets computed (youtube is never skipped) to 1 and 5
      // respectively — 'c' is outranked by 'd' and does NOT make B's own top-N.
      candidate({ id: '2', source: 'youtube', keyword: 'c', metric_value: 100, date: '2026-08-21' }),
      candidate({ id: '3', source: 'youtube', keyword: 'd', metric_value: 300, date: '2026-08-21' }),
      // Baseline history (outside today, picked up by getRecentMetrics only):
      // 'c': (100-50)/50 = 1. 'd': (300-50)/50 = 5.
      candidate({ id: 'h1', source: 'youtube', keyword: 'c', metric_value: 50, date: '2026-08-20' }),
      candidate({ id: 'h2', source: 'youtube', keyword: 'd', metric_value: 50, date: '2026-08-20' })
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

  it('shortlists a candidate that ranks in the top-10 within its own category even though it misses the source-wide top-10', async () => {
    const repo = new FakeCandidateTopicRepository();
    // 12 youtube candidates with no category, ranked 1..12 by growth_rate —
    // the source-wide top-10 keeps only the first 10, so ranks 11 and 12 miss it.
    for (let i = 1; i <= 12; i++) {
      repo.candidates.push(
        candidate({ id: `no-cat-${i}`, source: 'youtube', keyword: `kw${i}`, metric_value: 100 * i })
      );
    }
    // Historical data to establish baselines for growth_rate calculation
    for (let i = 1; i <= 12; i++) {
      repo.candidates.push(
        candidate({ id: `no-cat-h-${i}`, source: 'youtube', keyword: `kw${i}`, metric_value: 10, date: '2026-08-20' })
      );
    }
    // The only tai_chinh-tagged candidate in this source — automatically
    // top-1 within its own category even with a growth_rate lower than all
    // 12 above, so it misses the source-wide top-10 entirely.
    repo.candidates.push(
      candidate({
        id: 'tai-chinh-1',
        source: 'youtube',
        keyword: 'chứng khoán',
        metric_value: 50,
        category_hint: ['tai_chinh'],
      })
    );
    // Historical data for tai_chinh candidate
    repo.candidates.push(
      candidate({
        id: 'tai-chinh-h',
        source: 'youtube',
        keyword: 'chứng khoán',
        metric_value: 100,
        date: '2026-08-20',
      })
    );

    await rankAndSelect({ repo, now: NOW });

    const taiChinh = repo.candidates.find((c) => c.id === 'tai-chinh-1')!;
    expect(taiChinh.is_shortlisted).toBe(true);
  });

  it('does not shortlist a candidate with no category_hint just because same-source candidates elsewhere fill a category top-10', async () => {
    const repo = new FakeCandidateTopicRepository();
    // Today's candidates (date='2026-08-21')
    repo.candidates.push(
      candidate({ id: 'low-1', source: 'youtube', keyword: 'kw-low', metric_value: 50, category_hint: [] })
    );
    for (let i = 1; i <= 10; i++) {
      repo.candidates.push(
        candidate({ id: `du-lich-${i}`, source: 'youtube', keyword: `dl${i}`, metric_value: 100 + i, category_hint: ['du_lich'] })
      );
    }
    // Historical data (date='2026-08-20') to establish baselines for growth_rate calculation
    repo.candidates.push(
      candidate({ id: 'low-h', source: 'youtube', keyword: 'kw-low', metric_value: 100, date: '2026-08-20' })
    );
    for (let i = 1; i <= 10; i++) {
      repo.candidates.push(
        candidate({ id: `du-lich-h-${i}`, source: 'youtube', keyword: `dl${i}`, metric_value: 100, date: '2026-08-20' })
      );
    }

    await rankAndSelect({ repo, now: NOW });

    const low = repo.candidates.find((c) => c.id === 'low-1')!;
    expect(low.is_shortlisted).toBe(false);
  });
});
