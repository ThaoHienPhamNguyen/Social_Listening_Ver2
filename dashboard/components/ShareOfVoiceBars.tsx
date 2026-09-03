import { CATEGORIES } from '../lib/categories';
import type { DonutSegment } from '../lib/overview-metrics';

function colorForCategory(category: string): string {
  return CATEGORIES.find((c) => c.value === category)?.color ?? '#888888';
}

export function ShareOfVoiceBars({ data }: { data: DonutSegment[] }) {
  return (
    <div className="space-y-2">
      {data.map((seg) => (
        <div key={seg.category} className="flex items-center gap-3">
          <span className="text-xs text-ink-2 w-16 flex-shrink-0">{seg.label}</span>
          <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${seg.pct}%`, background: colorForCategory(seg.category) }} />
          </div>
          <span className="text-xs font-bold w-9 text-right text-ink">{seg.pct}%</span>
        </div>
      ))}
    </div>
  );
}
