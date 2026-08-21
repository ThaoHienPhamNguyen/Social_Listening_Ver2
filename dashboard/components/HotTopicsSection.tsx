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
      <section>
        <h2 className="text-xl font-semibold mb-2">Topic đang hot</h2>
        <p className="text-gray-500">Chưa có dữ liệu — chờ lần chạy discovery layer tiếp theo.</p>
      </section>
    );
  }

  const sources = Object.keys(bySource) as CandidateTopic['source'][];
  const hasAny = sources.some((s) => bySource[s].length > 0);

  return (
    <section>
      <h2 className="text-xl font-semibold mb-2">Topic đang hot ({date})</h2>
      {!hasAny && <p className="text-gray-500">Không có topic nào được shortlist hôm nay.</p>}
      <div className="grid gap-6 md:grid-cols-3">
        {sources.map((source) => (
          <div key={source}>
            <h3 className="font-medium mb-1">{SOURCE_LABELS[source]}</h3>
            <ul className="space-y-1">
              {bySource[source].map((row) => (
                <li key={row.id} className="text-sm flex justify-between gap-2">
                  <span>{row.keyword}</span>
                  <span className="text-gray-500 whitespace-nowrap">
                    {formatTrendingScore(row.trendingScore)} · {formatPercent(row.shareOfVoice)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
