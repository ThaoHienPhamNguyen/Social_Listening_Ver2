import { MetricTooltip } from './MetricTooltip';

export function KpiCard({
  label,
  value,
  tooltip,
  icon,
  iconBgClass,
  iconColor,
  delta,
  deltaPositive,
}: {
  label: string;
  value: string;
  tooltip?: string;
  icon?: string;
  iconBgClass?: string;
  iconColor?: string;
  delta?: string;
  deltaPositive?: boolean;
}) {
  return (
    <div className="bg-surface border border-line rounded-card shadow-card p-6">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] font-semibold text-ink-3 tracking-wider uppercase">
          {label}
          {tooltip && <MetricTooltip text={tooltip} />}
        </div>
        {icon && iconBgClass && iconColor && (
          <div className={`w-9 h-9 rounded-[10px] flex items-center justify-center flex-shrink-0 ${iconBgClass}`}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d={icon} />
            </svg>
          </div>
        )}
      </div>
      <div className="text-2xl font-extrabold text-ink">{value}</div>
      {delta && (
        <div className={`text-xs font-semibold mt-2 ${deltaPositive ? 'text-success' : 'text-danger'}`}>{delta}</div>
      )}
    </div>
  );
}
