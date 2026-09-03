import type { SentimentTrendPoint } from '../lib/sentiment-trend';

const H = 140;
const W = 500;
const PAD = { top: 8, bottom: 24, left: 4, right: 4 };
const SERIES = [
  { key: 'positive' as const, label: 'Tích cực', color: 'var(--color-success)' },
  { key: 'neutral' as const, label: 'Trung lập', color: 'var(--color-ink-3)' },
  { key: 'negative' as const, label: 'Tiêu cực', color: 'var(--color-danger)' },
];

export function SentimentTrendChart({ data }: { data: SentimentTrendPoint[] }) {
  if (data.length <= 1) {
    return (
      <div className="flex items-center justify-center text-sm text-ink-3" style={{ height: H + 32 }}>
        Chưa có dữ liệu
      </div>
    );
  }

  const allVals = data.flatMap((p) => SERIES.map((s) => p[s.key]));
  const max = Math.max(...allVals, 1);

  const chartH = H - PAD.top - PAD.bottom;
  const chartW = W - PAD.left - PAD.right;
  const toX = (i: number) => PAD.left + (i / (data.length - 1)) * chartW;
  const toY = (v: number) => PAD.top + chartH - (v / max) * chartH;

  const step = Math.max(1, Math.floor((data.length - 1) / 6));
  const labelIdxs = [
    ...new Set([...Array.from({ length: 7 }, (_, i) => Math.min(i * step, data.length - 1)), data.length - 1]),
  ];

  const seriesPaths = SERIES.map((s) => {
    const coords = data.map((p, i) => ({ x: toX(i), y: toY(p[s.key]) }));
    const linePath = coords.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x} ${pt.y}`).join(' ');
    return { s, linePath };
  });

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H + 8 }} aria-hidden="true">
        {[0, 0.25, 0.5, 0.75, 1].map((v) => {
          const y = PAD.top + chartH - v * chartH;
          return (
            <line key={v} x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} stroke="var(--color-line)" strokeWidth={0.5} strokeDasharray="3 3" />
          );
        })}
        {seriesPaths.map(({ s, linePath }) => (
          <path key={s.key} d={linePath} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {labelIdxs.map((i) => (
          <text key={i} x={toX(i)} y={H - 2} textAnchor="middle" fontSize={9} fill="var(--color-ink-3)">
            {data[i].date.slice(5)}
          </text>
        ))}
      </svg>
      <div className="flex items-center gap-5 mt-1">
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 text-[11px] text-ink-3">
            <span className="w-6 h-0.5 inline-block rounded-full" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
