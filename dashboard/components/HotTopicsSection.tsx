import type { EnrichedHotTopicRow } from '../lib/topic-engagement';
import type { CandidateTopic } from '../lib/types';
import { SOURCE_LABELS, formatPercent, formatTrendingScore, sentimentBadgeClass, formatSentimentBadge } from '../lib/hot-topic-format';

export function HotTopicsSection({
  date,
  bySource,
}: {
  date: string | null;
  bySource: Record<CandidateTopic['source'], EnrichedHotTopicRow[]>;
}) {
  if (date === null) {
    return (
      <section className="bg-surface border border-line rounded-card shadow-card p-6">
        <h2 className="text-base font-bold text-ink mb-2">Topic đang hot</h2>
        <p className="text-sm text-ink-3">Chưa có dữ liệu — chờ lần chạy discovery layer tiếp theo.</p>
      </section>
    );
  }

  const sources = Object.keys(bySource) as CandidateTopic['source'][];
  const hasAny = sources.some((s) => bySource[s].length > 0);

  return (
    <section className="bg-surface border border-line rounded-card shadow-card p-6">
      <h2 className="text-base font-bold text-ink mb-4">Topic đang hot ({date})</h2>
      {!hasAny && <p className="text-sm text-ink-3">Không có topic nào được shortlist hôm nay.</p>}
      <div className="grid gap-6 md:grid-cols-3">
        {sources.map((source) => (
          <div key={source}>
            <p className="text-[11px] font-semibold text-ink-3 tracking-wider uppercase mb-2">
              {SOURCE_LABELS[source]}
            </p>
            <ul className="space-y-0.5">
              {bySource[source].map((row, i) => (
                <li key={row.id} className="px-3 py-2 rounded-[10px] hover:bg-muted transition-colors">
                  <div className="flex items-center gap-3">
                    <span className="w-4 text-center text-xs font-bold text-ink-3 flex-shrink-0">{i + 1}</span>
                    <span className="flex-1 min-w-0 text-sm text-ink truncate">{row.keyword}</span>
                    <span className="text-xs text-ink-3 whitespace-nowrap flex-shrink-0">
                      {formatTrendingScore(row.trendingScore)} · {formatPercent(row.shareOfVoice)}
                    </span>
                  </div>
                  {row.engagement && (
                    <div className="flex items-center gap-2 mt-1 pl-7">
                      <span className="text-xs text-ink-3">
                        <span aria-hidden="true">💬</span> {row.engagement.totalEngagement.toLocaleString('vi-VN')} tương tác
                      </span>
                      {row.engagement.sentimentIndex !== null && (
                        <span
                          className={`text-xs rounded-full px-2 py-0.5 ${sentimentBadgeClass(row.engagement.sentimentIndex)}`}
                        >
                          {formatSentimentBadge(row.engagement.sentimentIndex)}
                        </span>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
