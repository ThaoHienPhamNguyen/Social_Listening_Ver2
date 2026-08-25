const H = 100;
const W = 400;
const PAD = { top: 6, bottom: 20, left: 4, right: 4 };

export function SingleLineChart({
  data,
  color,
}: {
  data: { date: string; value: number | null }[];
  color: string;
}) {
  if (data.length <= 1 || data.every((d) => d.value === null)) {
    return (
      <div className="flex items-center justify-center text-sm text-ink-3" style={{ height: H + 26 }}>
        Chưa có dữ liệu
      </div>
    );
  }

  const values = data.map((d) => d.value).filter((v): v is number => v !== null);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;

  const chartH = H - PAD.top - PAD.bottom;
  const chartW = W - PAD.left - PAD.right;
  const toX = (i: number) => PAD.left + (i / (data.length - 1)) * chartW;
  const toY = (v: number) => PAD.top + chartH - ((v - min) / range) * chartH;

  // Build the line path from only the non-null points, so a day with no
  // data leaves a visible gap in the line instead of being drawn as 0.
  let path = '';
  let afterGap = true;
  data.forEach((d, i) => {
    if (d.value === null) {
      afterGap = true;
      return;
    }
    path += `${afterGap ? 'M' : 'L'} ${toX(i)} ${toY(d.value)} `;
    afterGap = false;
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H + 6 }} aria-hidden="true">
      <path d={path.trim()} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {data.map((d, i) =>
        d.value === null ? null : <circle key={i} cx={toX(i)} cy={toY(d.value)} r={2} fill={color} />
      )}
      {data.map((d, i) => (
        <text key={i} x={toX(i)} y={H - 2} textAnchor="middle" fontSize={9} fill="var(--color-ink-3)">
          {d.date.slice(5)}
        </text>
      ))}
    </svg>
  );
}
