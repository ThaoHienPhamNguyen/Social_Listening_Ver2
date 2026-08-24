import type { FacebookSummary } from '../lib/facebook-summary';

function SentimentBar({
  label,
  count,
  total,
  colorClass,
}: {
  label: string;
  count: number;
  total: number;
  colorClass: string;
}) {
  const pct = total === 0 ? 0 : Math.round((count / total) * 100);
  return (
    <div className="flex items-center gap-3 mb-2 last:mb-0">
      <span className="text-xs text-ink-3 w-16 flex-shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${colorClass}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-bold w-9 text-right text-ink-3">{pct}%</span>
    </div>
  );
}

export function FacebookSummarySection({ summary }: { summary: FacebookSummary | null }) {
  if (summary === null) {
    return (
      <section className="bg-surface border border-line rounded-card shadow-card p-6 mb-8">
        <h2 className="text-base font-bold text-ink mb-2">Facebook</h2>
        <p className="text-sm text-ink-3">Chưa có dữ liệu Facebook hôm nay.</p>
      </section>
    );
  }

  const total = summary.sentiment.positive + summary.sentiment.negative + summary.sentiment.neutral;

  return (
    <section className="bg-surface border border-line rounded-card shadow-card p-6 mb-8">
      <h2 className="text-base font-bold text-ink mb-4">
        Facebook hôm nay: {summary.postCount} bài · {summary.totalEngagement} tương tác
      </h2>
      <SentimentBar label="Tích cực" count={summary.sentiment.positive} total={total} colorClass="bg-success" />
      <SentimentBar label="Trung lập" count={summary.sentiment.neutral} total={total} colorClass="bg-ink-3" />
      <SentimentBar label="Tiêu cực" count={summary.sentiment.negative} total={total} colorClass="bg-danger" />
    </section>
  );
}
