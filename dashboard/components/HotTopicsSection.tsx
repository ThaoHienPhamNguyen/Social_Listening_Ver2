import type { HotTopicRow } from '../lib/hot-topics';
import type { CandidateTopic } from '../lib/types';

const SOURCE_LABELS: Record<CandidateTopic['source'], string> = {
  google_trends: 'Google Trends',
  youtube: 'YouTube',
  rss: 'RSS',
};

function formatPercent(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}%`;
}

// growth_rate = 999 is the ingestion pipeline's sentinel for "no prior-week
// baseline" (see rank-and-select.ts). computeTrendingScore multiplies by
// 100, so it shows up here as exactly 99900. Render it as "Mới" (new)
// instead of a nonsense percentage.
function formatTrendingScore(value: number | null): string {
  if (value === null) return '—';
  if (value === 99900) return 'Mới';
  return `${value.toFixed(1)}%`;
}

export function HotTopicsSection({
  date,
  bySource,
}: {
  date: string | null;
  bySource: Record<CandidateTopic['source'], HotTopicRow[]>;
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
            <div className="space-y-0.5">
              {bySource[source].map((row, i) => (
                <div
                  key={row.id}
                  className="flex items-center gap-3 px-3 py-2 rounded-[10px] hover:bg-muted transition-colors"
                >
                  <span className="w-4 text-center text-xs font-bold text-ink-3 flex-shrink-0">{i + 1}</span>
                  <span className="flex-1 min-w-0 text-sm text-ink truncate">{row.keyword}</span>
                  <span className="text-xs text-ink-3 whitespace-nowrap flex-shrink-0">
                    {formatTrendingScore(row.trendingScore)} · {formatPercent(row.shareOfVoice)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
