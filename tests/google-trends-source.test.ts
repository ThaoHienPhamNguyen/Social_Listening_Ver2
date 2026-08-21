import { describe, it, expect } from 'vitest';
import { normalizeGrowthRate, toRawCandidates, resolveGoogleTrendsApi } from '../src/lib/google-trends-source';

describe('normalizeGrowthRate', () => {
  it('converts a percentage growth figure to the same ratio unit used by YouTube/RSS sources', () => {
    // Google Trends' trafficGrowthRate is a percentage (e.g. 1000 = +1000%);
    // YouTube/RSS growth_rate is a ratio (e.g. 2 = doubled). Divide by 100 to align units.
    expect(normalizeGrowthRate(1000)).toBe(10);
  });

  it('converts zero growth to zero', () => {
    expect(normalizeGrowthRate(0)).toBe(0);
  });

  it('preserves negative growth (a declining trend)', () => {
    expect(normalizeGrowthRate(-50)).toBe(-0.5);
  });
});

describe('toRawCandidates', () => {
  it('maps each item to a RawCandidate with a lowercase/trimmed keyword and a normalized growth_rate', () => {
    const result = toRawCandidates([{ keyword: '  Bitcoin  ', traffic: 5000, trafficGrowthRate: 200 }]);
    expect(result).toEqual([{ keyword: 'bitcoin', metric_value: 5000, growth_rate: 2 }]);
  });

  it('deduplicates items whose keyword collides after lowercase/trim normalization, keeping the higher-traffic one', () => {
    // A bulk upsert of a batch containing two rows with the same
    // (source, keyword, date) key fails Postgres's ON CONFLICT clause for the
    // WHOLE batch — dedup here before that can ever happen.
    const result = toRawCandidates([
      { keyword: 'Bitcoin', traffic: 100, trafficGrowthRate: 10 },
      { keyword: '  bitcoin', traffic: 9000, trafficGrowthRate: 50 },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ keyword: 'bitcoin', metric_value: 9000, growth_rate: 0.5 });
  });
});

describe('resolveGoogleTrendsApi', () => {
  it('returns the import as-is when dailyTrends is directly present', () => {
    const fakeApi = { dailyTrends: () => {} };
    expect(resolveGoogleTrendsApi(fakeApi)).toBe(fakeApi);
  });

  it('unwraps .default when the import is double-wrapped (this library\'s actual CJS/ESM interop shape under this project\'s "type": "module" + tsx execution — verified live in production 2026-08-21)', () => {
    const fakeApiInstance = { dailyTrends: () => {} };
    const doubleWrapped = { default: fakeApiInstance };
    expect(resolveGoogleTrendsApi(doubleWrapped)).toBe(fakeApiInstance);
  });
});
