import type { CandidateTopic } from './types';
import { NEW_KEYWORD_TRENDING_SCORE } from './hot-topics';

export const SOURCE_LABELS: Record<CandidateTopic['source'], string> = {
  google_trends: 'Google Trends',
  youtube: 'YouTube',
  rss: 'RSS',
};

export function formatPercent(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}%`;
}

// Render the ingestion pipeline's "no prior-week baseline" sentinel as "Mới"
// (new) instead of a nonsense percentage — see NEW_KEYWORD_TRENDING_SCORE's
// own comment for where the value comes from.
export function formatTrendingScore(value: number | null): string {
  if (value === null) return '—';
  if (value === NEW_KEYWORD_TRENDING_SCORE) return 'Mới';
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
