import type { CandidateTopic } from './types';

export const SOURCE_LABELS: Record<CandidateTopic['source'], string> = {
  google_trends: 'Google Trends',
  youtube: 'YouTube',
  rss: 'RSS',
};

export function formatPercent(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}%`;
}

// growth_rate = 999 is the ingestion pipeline's sentinel for "no prior-week
// baseline" (see rank-and-select.ts). computeTrendingScore multiplies by
// 100, so it shows up here as exactly 99900. Render it as "Mới" (new)
// instead of a nonsense percentage.
export function formatTrendingScore(value: number | null): string {
  if (value === null) return '—';
  if (value === 99900) return 'Mới';
  return `${value.toFixed(1)}%`;
}

export function sentimentBadgeClass(index: number): string {
  if (index > 0) return 'bg-success-bg text-success';
  if (index < 0) return 'bg-danger-bg text-danger';
  return 'bg-muted text-ink-3';
}

export function formatSentimentBadge(index: number): string {
  if (index > 0) return `Sentiment +${index}`;
  if (index < 0) return `Sentiment ${index}`;
  return 'Sentiment 0';
}
