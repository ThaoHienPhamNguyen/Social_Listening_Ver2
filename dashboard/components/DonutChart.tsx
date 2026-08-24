import { CATEGORIES } from '../lib/categories';
import type { DonutSegment } from '../lib/overview-metrics';

const R = 52;
const CX = 70;
const CY = 70;
const CIRCUMFERENCE = 2 * Math.PI * R;

function colorForCategory(category: string): string {
  return CATEGORIES.find((c) => c.value === category)?.color ?? '#888888';
}

export function DonutChart({ data }: { data: DonutSegment[] }) {
  let offset = 0;

  return (
    <div className="flex items-center gap-8">
      <svg width="140" height="140" viewBox="0 0 140 140" className="flex-shrink-0" aria-hidden="true">
        <circle cx={CX} cy={CY} r={R} fill="none" stroke="var(--color-muted)" strokeWidth="16" />
        {data.map((seg) => {
          const dash = (seg.pct / 100) * CIRCUMFERENCE;
          const el = (
            <circle
              key={seg.category}
              cx={CX}
              cy={CY}
              r={R}
              fill="none"
              stroke={colorForCategory(seg.category)}
              strokeWidth="16"
              strokeDasharray={`${dash} ${CIRCUMFERENCE}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${CX} ${CY})`}
            />
          );
          offset += dash;
          return el;
        })}
      </svg>
      <div className="flex flex-col gap-3">
        {data.map((seg) => (
          <div key={seg.category} className="flex items-center gap-2.5">
            <span
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ background: colorForCategory(seg.category) }}
            />
            <span className="text-sm text-ink-2 flex-1">{seg.label}</span>
            <span className="text-sm font-bold text-ink">{seg.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
