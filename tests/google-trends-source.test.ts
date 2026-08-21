import { describe, it, expect } from 'vitest';
import { normalizeGrowthRate } from '../src/lib/google-trends-source';

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
