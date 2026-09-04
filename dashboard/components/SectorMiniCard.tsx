import Link from 'next/link';
import { CATEGORIES } from '../lib/categories';
import { TrendingTabs } from './TrendingTabs';
import type { EnrichedHotTopicRow } from '../lib/topic-engagement';

export function SectorMiniCard({
  category,
  trending,
  recent,
  keywords,
}: {
  category: string;
  trending: EnrichedHotTopicRow[];
  recent: EnrichedHotTopicRow[];
  keywords: string[];
}) {
  const meta = CATEGORIES.find((c) => c.value === category);
  if (!meta) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="flex items-center gap-2 text-sm font-bold text-ink">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: meta.color }} />
          {meta.label}
        </h3>
        <Link href={`/${meta.slug}`} className="text-xs font-semibold text-brand hover:underline">
          Thêm →
        </Link>
      </div>
      <TrendingTabs trending={trending} recent={recent} limit={4} />
      {keywords.length > 0 && (
        <div className="mt-4 pt-4 border-t border-line">
          <p className="text-[11px] font-semibold text-ink-3 tracking-wider uppercase mb-2">Từ khóa nổi bật</p>
          <div className="flex flex-wrap gap-2">
            {keywords.map((k) => (
              <span
                key={k}
                className="text-xs px-2.5 py-1 rounded-full"
                style={{ background: `${meta.color}1a`, color: meta.color }}
              >
                {k}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
