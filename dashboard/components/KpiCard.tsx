import { MetricTooltip } from './MetricTooltip';

export function KpiCard({ label, value, tooltip }: { label: string; value: string; tooltip?: string }) {
  return (
    <div className="bg-surface border border-line rounded-card shadow-card p-6">
      <div className="text-[11px] font-semibold text-ink-3 tracking-wider uppercase mb-2">
        {label}
        {tooltip && <MetricTooltip text={tooltip} />}
      </div>
      <div className="text-2xl font-extrabold text-ink">{value}</div>
    </div>
  );
}
