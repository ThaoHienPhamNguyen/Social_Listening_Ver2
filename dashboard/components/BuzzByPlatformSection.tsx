import { MetricTooltip } from './MetricTooltip';
import { METRIC_TOOLTIPS } from '../lib/metric-tooltips';
import type { PlatformBuzz } from '../lib/buzz-by-platform';

export function BuzzByPlatformSection({ data }: { data: PlatformBuzz[] }) {
  const hasAny = data.some((d) => d.pct > 0);

  return (
    <section className="bg-surface border border-line rounded-card shadow-card p-6">
      <h2 className="text-base font-bold text-ink mb-4">
        Buzz theo nền tảng
        <MetricTooltip text={METRIC_TOOLTIPS.buzzByPlatform} />
      </h2>
      {!hasAny ? (
        <p className="text-sm text-ink-3">Chưa có dữ liệu.</p>
      ) : (
        <div className="space-y-3">
          {data.map((d) => (
            <div key={d.label} className="flex items-center gap-3">
              <span className="text-xs text-ink-3 w-24 flex-shrink-0">{d.label}</span>
              <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                <div className="h-full rounded-full bg-brand" style={{ width: `${d.pct}%` }} />
              </div>
              <span className="text-xs font-bold w-9 text-right text-ink-3">{d.pct}%</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
