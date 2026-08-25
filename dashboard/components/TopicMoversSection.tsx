import Link from 'next/link';
import { CATEGORIES } from '../lib/categories';
import type { TopicMover } from '../lib/topic-movers';

function categoryMeta(value: string) {
  return CATEGORIES.find((c) => c.value === value);
}

function MoverList({ movers }: { movers: TopicMover[] }) {
  if (movers.length === 0) {
    return <p className="text-sm text-ink-3 text-center py-4">Chưa có dữ liệu.</p>;
  }
  return (
    <div className="space-y-3">
      {movers.map((m, i) => {
        const meta = categoryMeta(m.category);
        const positive = m.deltaPct >= 0;
        return (
          <Link
            key={m.keyword}
            href={meta ? `/${meta.slug}` : '/'}
            className="flex items-center gap-3 p-3 rounded-[10px] hover:bg-muted transition-colors group"
          >
            <span className="text-xs font-bold text-ink-3 w-4 flex-shrink-0">{i + 1}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-ink truncate group-hover:text-brand transition-colors">
                {m.keyword}
              </p>
              {meta && (
                <span className="inline-flex items-center gap-1 text-[11px] text-ink-3 mt-0.5">
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: meta.color }} />
                  {meta.label}
                </span>
              )}
            </div>
            <div className="text-right flex-shrink-0">
              <p className={`text-sm font-bold ${positive ? 'text-success' : 'text-danger'}`}>
                {positive ? '▲' : '▼'} {Math.abs(m.deltaPct).toFixed(0)}%
              </p>
              <p className="text-[11px] text-ink-3">{m.buzz.toLocaleString('vi-VN')} buzz</p>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

export function TopicMoversSection({
  gainers,
  losers,
  hasRealLosers,
}: {
  gainers: TopicMover[];
  losers: TopicMover[];
  hasRealLosers: boolean;
}) {
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <div className="bg-surface border border-line rounded-card shadow-card p-6">
        <h2 className="text-base font-bold text-ink mb-1">Top Gainers</h2>
        <p className="text-xs text-ink-3 mb-4">Tăng trưởng mạnh nhất so với kỳ trước</p>
        <MoverList movers={gainers} />
      </div>
      <div className="bg-surface border border-line rounded-card shadow-card p-6">
        <h2 className="text-base font-bold text-ink mb-1">{hasRealLosers ? 'Top Losers' : 'Tăng trưởng chậm nhất'}</h2>
        <p className="text-xs text-ink-3 mb-4">
          {hasRealLosers ? 'Sụt giảm mạnh nhất so với kỳ trước' : 'Buzz tăng ít nhất so với kỳ trước'}
        </p>
        <MoverList movers={losers} />
      </div>
    </div>
  );
}
