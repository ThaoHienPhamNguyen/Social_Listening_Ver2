import { describe, it, expect } from 'vitest';
import {
  SOURCE_LABELS,
  formatPercent,
  formatTrendingScore,
  sentimentBadgeClass,
  formatSentimentBadge,
} from '../lib/hot-topic-format';

describe('SOURCE_LABELS', () => {
  it('has a Vietnamese-friendly label for every discovery source', () => {
    expect(SOURCE_LABELS.google_trends).toBe('Google Trends');
    expect(SOURCE_LABELS.youtube).toBe('YouTube');
    expect(SOURCE_LABELS.rss).toBe('RSS');
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

describe('sentimentBadgeClass', () => {
  it('returns success classes for a positive index', () => {
    expect(sentimentBadgeClass(5)).toBe('bg-success-bg text-success');
  });
  it('returns danger classes for a negative index', () => {
    expect(sentimentBadgeClass(-5)).toBe('bg-danger-bg text-danger');
  });
  it('returns neutral classes for a zero index', () => {
    expect(sentimentBadgeClass(0)).toBe('bg-muted text-ink-3');
  });
});

describe('formatSentimentBadge', () => {
  it('prefixes a positive index with a plus sign', () => {
    expect(formatSentimentBadge(5)).toBe('Sentiment +5');
  });
  it('shows a negative index as-is (already has a minus sign)', () => {
    expect(formatSentimentBadge(-5)).toBe('Sentiment -5');
  });
  it('shows a zero index as "Sentiment 0"', () => {
    expect(formatSentimentBadge(0)).toBe('Sentiment 0');
  });
});
