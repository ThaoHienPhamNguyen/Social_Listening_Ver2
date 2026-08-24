import { KpiCard } from './KpiCard';
import { DonutChart } from './DonutChart';
import type { OverviewMetrics, DonutSegment } from '../lib/overview-metrics';

function formatNumber(n: number): string {
  return n.toLocaleString('vi-VN');
}

function formatSentimentScore(score: number | null): string {
  if (score === null) return '—';
  return score > 0 ? `+${score}` : `${score}`;
}

export function OverviewMetricsSection({
  metrics,
  donut,
  date,
}: {
  metrics: OverviewMetrics;
  donut: DonutSegment[];
  date: string;
}) {
  if (metrics.buzzVolume === 0) {
    return (
      <section className="mb-8">
        <p className="text-sm text-ink-3">Chưa có dữ liệu tổng quan hôm nay.</p>
      </section>
    );
  }

  return (
    <section className="mb-8">
      <p className="text-xs text-ink-3 mb-2">{date}</p>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 mb-6">
        <KpiCard label="Buzz Volume" value={formatNumber(metrics.buzzVolume)} />
        <KpiCard label="Topics Trending" value={formatNumber(metrics.topicsTrending)} />
        <KpiCard label="Audience Scale" value={formatNumber(metrics.audienceScale)} />
        <KpiCard label="Sentiment Score" value={formatSentimentScore(metrics.sentimentScore)} />
      </div>
      <div className="bg-surface border border-line rounded-card shadow-card p-6">
        <h2 className="text-base font-bold text-ink mb-4">Phân bổ lĩnh vực</h2>
        <DonutChart data={donut} />
      </div>
    </section>
  );
}
