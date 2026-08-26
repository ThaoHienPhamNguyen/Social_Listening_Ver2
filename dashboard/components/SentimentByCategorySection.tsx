import { SentimentBar } from './SentimentBar';
import { MetricTooltip } from './MetricTooltip';
import { METRIC_TOOLTIPS } from '../lib/metric-tooltips';
import type { CategorySentiment } from '../lib/sentiment-by-category';

export function SentimentByCategorySection({ data }: { data: CategorySentiment[] }) {
  const hasAny = data.some((d) => d.counts.positive + d.counts.negative + d.counts.neutral > 0);

  return (
    <section className="bg-surface border border-line rounded-card shadow-card p-6">
      <h2 className="text-base font-bold text-ink mb-4">
        Sentiment theo lĩnh vực
        <MetricTooltip text={METRIC_TOOLTIPS.sentimentByCategory} />
      </h2>
      {!hasAny ? (
        <p className="text-sm text-ink-3">Chưa có dữ liệu.</p>
      ) : (
        <div className="space-y-4">
          {data.map((d) => {
            const total = d.counts.positive + d.counts.negative + d.counts.neutral;
            return (
              <div key={d.category}>
                <p className="text-xs font-semibold text-ink-2 mb-2">{d.label}</p>
                <SentimentBar label="Tích cực" count={d.counts.positive} total={total} colorClass="bg-success" />
                <SentimentBar label="Trung lập" count={d.counts.neutral} total={total} colorClass="bg-ink-3" />
                <SentimentBar label="Tiêu cực" count={d.counts.negative} total={total} colorClass="bg-danger" />
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
