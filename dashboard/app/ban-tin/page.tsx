import { createServerSupabaseClient } from '../../lib/supabase';
import { SupabaseCandidateTopicsReader } from '../../lib/candidate-topics-reader';
import { getHotTopics, type HotTopicsResult } from '../../lib/get-hot-topics';
import { flattenAndRankHotTopics } from '../../lib/trending';
import { CATEGORIES } from '../../lib/categories';
import { TopicBriefCard } from '../../components/TopicBriefCard';
import { Topbar } from '../../components/layout/Topbar';
import type { HotTopicRow } from '../../lib/hot-topics';

export const dynamic = 'force-dynamic';

const OVERALL_LIMIT = 10;
const SECTOR_LIMIT = 5;

async function loadOverall(): Promise<{ date: string | null; rows: HotTopicRow[] } | { error: string }> {
  try {
    const client = createServerSupabaseClient();
    const reader = new SupabaseCandidateTopicsReader(client);
    const result: HotTopicsResult = await getHotTopics(reader, null);
    const ranked = flattenAndRankHotTopics(result.bySource);
    return { date: result.date, rows: ranked.slice(0, OVERALL_LIMIT) };
  } catch (err) {
    console.error(err);
    return { error: 'Không tải được dữ liệu, vui lòng thử lại sau.' };
  }
}

async function loadSector(category: string, date: string | null): Promise<HotTopicRow[]> {
  if (date === null) return [];
  try {
    const client = createServerSupabaseClient();
    const reader = new SupabaseCandidateTopicsReader(client);
    const result = await getHotTopics(reader, category, date);
    return flattenAndRankHotTopics(result.bySource).slice(0, SECTOR_LIMIT);
  } catch (err) {
    console.error(err);
    return [];
  }
}

export default async function BanTinPage() {
  const overall = await loadOverall();
  const date = 'error' in overall ? null : overall.date;

  const sectorRows = await Promise.all(CATEGORIES.map((c) => loadSector(c.value, date)));

  return (
    <>
      <Topbar title="Bản tin hôm nay" />
      <main className="max-w-4xl mx-auto p-6 space-y-8">
        <section>
          <h2 className="text-base font-bold text-ink mb-4">Tổng hợp</h2>
          {'error' in overall ? (
            <p className="text-red-600">{overall.error}</p>
          ) : overall.rows.length === 0 ? (
            <p className="text-sm text-ink-3">Chưa có dữ liệu.</p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {overall.rows.map((row) => (
                <TopicBriefCard key={row.id} row={row} />
              ))}
            </div>
          )}
        </section>

        {CATEGORIES.map((categoryDef, i) => {
          const rows = sectorRows[i];
          return (
            <section key={categoryDef.value}>
              <h2 className="text-base font-bold text-ink mb-4 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: categoryDef.color }} />
                {categoryDef.label}
              </h2>
              {rows.length === 0 ? (
                <p className="text-sm text-ink-3">Chưa có dữ liệu.</p>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {rows.map((row) => (
                    <TopicBriefCard key={row.id} row={row} />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </main>
    </>
  );
}
