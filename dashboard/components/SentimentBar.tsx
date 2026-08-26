export function SentimentBar({
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
