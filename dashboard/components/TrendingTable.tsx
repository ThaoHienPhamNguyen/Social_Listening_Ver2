import Link from 'next/link';
import { CATEGORIES } from '../lib/categories';
import { SOURCE_LABELS, formatTrendingScore, sentimentBadgeClass, formatSentimentBadge } from '../lib/hot-topic-format';
import type { EnrichedHotTopicRow } from '../lib/topic-engagement';

function categoryMeta(categoryHint: string[] | undefined) {
  const value = categoryHint?.[0];
  return CATEGORIES.find((c) => c.value === value);
}

export function TrendingTable({ rows }: { rows: EnrichedHotTopicRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-ink-3 text-center py-12">Chưa có dữ liệu trending.</p>;
  }

  return (
    <div className="bg-surface border border-line rounded-card shadow-card overflow-hidden">
      <div className="divide-y divide-line">
        {rows.map((row, i) => {
          const meta = categoryMeta(row.categoryHint);
          return (
            <Link
              key={row.id}
              href={`/topic/${encodeURIComponent(row.keyword)}`}
              className="flex items-center gap-4 px-6 py-4 hover:bg-muted transition-colors group"
            >
              <span className="w-6 text-center text-xs font-bold text-ink-3 flex-shrink-0">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-ink truncate group-hover:text-brand transition-colors">
                  {row.keyword}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  {meta && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-ink-3">
                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: meta.color }} />
                      {meta.label}
                    </span>
                  )}
                  <span className="text-[11px] text-ink-3">{SOURCE_LABELS[row.source]}</span>
                </div>
              </div>
              <span className="text-xs font-bold text-ink-2 whitespace-nowrap flex-shrink-0">
                {formatTrendingScore(row.trendingScore)}
              </span>
              {row.engagement && row.engagement.sentimentIndex !== null ? (
                <span
                  className={`text-xs rounded-full px-2 py-0.5 whitespace-nowrap flex-shrink-0 ${sentimentBadgeClass(row.engagement.sentimentIndex)}`}
                >
                  {formatSentimentBadge(row.engagement.sentimentIndex)}
                </span>
              ) : (
                <span className="text-xs text-ink-3 w-20 text-right flex-shrink-0">—</span>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
