import Link from 'next/link';
import { KpiCard } from './KpiCard';
import { DonutChart } from './DonutChart';
import { BuzzTrendChart } from './BuzzTrendChart';
import { MetricTooltip } from './MetricTooltip';
import { METRIC_TOOLTIPS } from '../lib/metric-tooltips';
import type { OverviewMetrics, DonutSegment } from '../lib/overview-metrics';
import type { BuzzTrendPoint } from '../lib/buzz-trend';

function formatNumber(n: number): string {
  return n.toLocaleString('vi-VN');
}

function formatSentimentScore(score: number | null): string {
  if (score === null) return '—';
  return score > 0 ? `+${score}` : `${score}`;
}

const ICONS = {
  buzzVolume: { icon: 'M22 12h-4l-3 9L9 3l-3 9H2', iconBgClass: 'bg-success-bg', iconColor: 'var(--color-success)' },
  topicsTrending: { icon: 'M22 7L13.5 15.5L8.5 10.5L2 17M16 7H22V13', iconBgClass: 'bg-brand-faint', iconColor: 'var(--color-brand)' },
  audienceScale: {
    icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
    iconBgClass: 'bg-info-bg',
    iconColor: 'var(--color-info)',
  },
  sentimentScore: {
    icon: 'M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10-4.477 10-10 10zM8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01',
    iconBgClass: 'bg-warning-bg',
    iconColor: 'var(--color-warning)',
  },
};

export function OverviewMetricsSection({
  metrics,
  donut,
  buzzTrend,
  date,
  deltas,
}: {
  metrics: OverviewMetrics;
  donut: DonutSegment[];
  buzzTrend: BuzzTrendPoint[] | null;
  date: string;
  deltas: { buzzVolume: { text: string; positive: boolean }; audienceScale: { text: string; positive: boolean } };
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
        <KpiCard
          label="Buzz Volume"
          value={formatNumber(metrics.buzzVolume)}
          tooltip={METRIC_TOOLTIPS.buzzVolume}
          {...ICONS.buzzVolume}
          delta={deltas.buzzVolume.text}
          deltaPositive={deltas.buzzVolume.positive}
        />
        <KpiCard
          label="Topics Trending"
          value={formatNumber(metrics.topicsTrending)}
          tooltip={METRIC_TOOLTIPS.topicsTrending}
          {...ICONS.topicsTrending}
          delta={`${metrics.topicsTrending} chủ đề được shortlist hôm nay`}
          deltaPositive={true}
        />
        <KpiCard
          label="Audience Scale"
          value={formatNumber(metrics.audienceScale)}
          tooltip={METRIC_TOOLTIPS.audienceScale}
          {...ICONS.audienceScale}
          delta={deltas.audienceScale.text}
          deltaPositive={deltas.audienceScale.positive}
        />
        <KpiCard
          label="Sentiment Score"
          value={formatSentimentScore(metrics.sentimentScore)}
          tooltip={METRIC_TOOLTIPS.sentimentScore}
          {...ICONS.sentimentScore}
          delta={metrics.sentimentScore !== null && metrics.sentimentScore >= 0 ? 'Xu hướng tích cực' : 'Xu hướng tiêu cực'}
          deltaPositive={metrics.sentimentScore !== null && metrics.sentimentScore >= 0}
        />
      </div>
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3 bg-surface border border-line rounded-card shadow-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-bold text-ink">
              Buzz Trend — 7 ngày qua
              <MetricTooltip text={METRIC_TOOLTIPS.buzzTrend} />
            </h2>
            <Link href="/analytics" className="text-sm font-semibold text-brand hover:underline">
              Xem chi tiết →
            </Link>
          </div>
          {buzzTrend ? <BuzzTrendChart data={buzzTrend} /> : <p className="text-sm text-ink-3">Chưa có dữ liệu.</p>}
        </div>
        <div className="lg:col-span-2 bg-surface border border-line rounded-card shadow-card p-6">
          <h2 className="text-base font-bold text-ink mb-4">
            Phân bổ lĩnh vực
            <MetricTooltip text={METRIC_TOOLTIPS.sectorShare} />
          </h2>
          <DonutChart data={donut} />
        </div>
      </div>
    </section>
  );
}
