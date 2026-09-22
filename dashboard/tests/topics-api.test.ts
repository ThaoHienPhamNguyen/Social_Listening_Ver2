// dashboard/tests/topics-api.test.ts
import { describe, it, expect } from 'vitest';
import { getTopicsForDate, isValidDate } from '../lib/topics-api';
import { FakeCandidateTopicsReader } from './fakes/fake-candidate-topics-reader';
import type { CandidateTopic } from '../lib/types';

function candidate(overrides: Partial<CandidateTopic> = {}): CandidateTopic {
  return {
    id: 'id-1',
    source: 'rss',
    keyword: 'bitcoin',
    date: '2026-09-16',
    metric_value: 10,
    growth_rate: 0.5,
    category_hint: ['tai_chinh'],
    is_shortlisted: true,
    ...overrides,
  };
}

describe('isValidDate', () => {
  it('accepts YYYY-MM-DD', () => {
    expect(isValidDate('2026-09-16')).toBe(true);
  });

  it('rejects malformed strings', () => {
    expect(isValidDate('16-09-2026')).toBe(false);
    expect(isValidDate('2026-9-16')).toBe(false);
    expect(isValidDate('not-a-date')).toBe(false);
    expect(isValidDate('')).toBe(false);
  });
});

describe('getTopicsForDate', () => {
  it('returns a null date and empty topics when the reader has no data', async () => {
    const reader = new FakeCandidateTopicsReader([]);
    const result = await getTopicsForDate(reader, null);
    expect(result).toEqual({ date: null, topics: [] });
  });

  it('defaults to the latest date when none is given', async () => {
    const older = candidate({ id: 'old', date: '2026-09-15', keyword: 'old-topic' });
    const newer = candidate({ id: 'new', date: '2026-09-16', keyword: 'new-topic' });
    const reader = new FakeCandidateTopicsReader([older, newer]);
    const result = await getTopicsForDate(reader, null);
    expect(result.date).toBe('2026-09-16');
    expect(result.topics.map((t) => t.keyword)).toEqual(['new-topic']);
  });

  it('uses an explicit date instead of the latest one', async () => {
    const older = candidate({ id: 'old', date: '2026-09-15', keyword: 'old-topic' });
    const newer = candidate({ id: 'new', date: '2026-09-16', keyword: 'new-topic' });
    const reader = new FakeCandidateTopicsReader([older, newer]);
    const result = await getTopicsForDate(reader, null, '2026-09-15');
    expect(result.date).toBe('2026-09-15');
    expect(result.topics.map((t) => t.keyword)).toEqual(['old-topic']);
  });

  it('filters to one category when given', async () => {
    const inCat = candidate({ id: 'in', keyword: 'in-topic', category_hint: ['tai_chinh'] });
    const outOfCat = candidate({ id: 'out', keyword: 'out-topic', category_hint: ['giai_tri'] });
    const reader = new FakeCandidateTopicsReader([inCat, outOfCat]);
    const result = await getTopicsForDate(reader, 'tai_chinh');
    expect(result.topics.map((t) => t.keyword)).toEqual(['in-topic']);
  });

  it('only returns shortlisted candidates, ranked like Trending Now', async () => {
    const notShortlisted = candidate({ id: 'skip', keyword: 'skip-topic', is_shortlisted: false });
    const lowGrowth = candidate({
      id: 'low',
      keyword: 'low-topic',
      is_shortlisted: true,
      growth_rate: 0.1,
      metric_value: 5,
    });
    const highGrowth = candidate({
      id: 'high',
      keyword: 'high-topic',
      is_shortlisted: true,
      growth_rate: 0.9,
      metric_value: 5,
    });
    const reader = new FakeCandidateTopicsReader([notShortlisted, lowGrowth, highGrowth]);
    const result = await getTopicsForDate(reader, 'tai_chinh');
    expect(result.topics.map((t) => t.keyword)).toEqual(['high-topic', 'low-topic']);
  });

  it('shapes each topic with keyword/source/category/metricValue/trendingScore/shareOfVoice', async () => {
    const reader = new FakeCandidateTopicsReader([candidate()]);
    const result = await getTopicsForDate(reader, 'tai_chinh');
    expect(result.topics).toEqual([
      {
        keyword: 'bitcoin',
        source: 'rss',
        category: ['tai_chinh'],
        metricValue: 10,
        trendingScore: 50,
        shareOfVoice: 100,
      },
    ]);
  });
});
