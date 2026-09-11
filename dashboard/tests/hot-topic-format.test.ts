import { describe, it, expect } from 'vitest';
import {
  SOURCE_LABELS,
  formatPercent,
  formatTrendingScore,
} from '../lib/hot-topic-format';

describe('SOURCE_LABELS', () => {
  it('has a Vietnamese-friendly label for every discovery source', () => {
    expect(SOURCE_LABELS.google_trends).toBe('Google Trends');
    expect(SOURCE_LABELS.youtube).toBe('YouTube');
    expect(SOURCE_LABELS.rss).toBe('RSS');
    expect(SOURCE_LABELS.threads).toBe('Threads');
    expect(SOURCE_LABELS.facebook).toBe('Facebook');
  });
});

describe('formatPercent', () => {
  it('formats a number to 1 decimal with a % sign', () => {
    expect(formatPercent(12.345)).toBe('12.3%');
  });
  it('renders null as an em dash', () => {
    expect(formatPercent(null)).toBe('—');
  });
});

describe('formatTrendingScore', () => {
  it('formats a normal score to 1 decimal with a % sign', () => {
    expect(formatTrendingScore(50)).toBe('50.0%');
  });
  it('renders the 99900 sentinel as "Mới"', () => {
    expect(formatTrendingScore(99900)).toBe('Mới');
  });
  it('renders null as an em dash', () => {
    expect(formatTrendingScore(null)).toBe('—');
  });
});
