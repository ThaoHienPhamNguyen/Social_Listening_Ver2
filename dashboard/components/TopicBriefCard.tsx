import Link from 'next/link';
import { formatTrendingScore } from '../lib/hot-topic-format';
import type { HotTopicRow } from '../lib/hot-topics';

export function TopicBriefCard({ row }: { row: HotTopicRow }) {
  return (
    <Link
      href={`/topic/${encodeURIComponent(row.keyword)}`}
      className="block bg-surface border border-line rounded-card shadow-card p-5 hover:border-brand transition-colors"
    >
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <h3 className="text-sm font-bold text-ink truncate">{row.keyword}</h3>
        <span className="text-xs font-bold text-ink-2 whitespace-nowrap flex-shrink-0">
          {formatTrendingScore(row.trendingScore)}
        </span>
      </div>
      {row.summary ? (
        <p className="text-sm text-ink-2 line-clamp-2">{row.summary}</p>
      ) : (
        <p className="text-xs text-ink-3">{row.metricValue.toLocaleString('vi-VN')} lượt</p>
      )}
    </Link>
  );
}
