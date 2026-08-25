import Link from 'next/link';
import { createServerSupabaseClient } from '../../lib/supabase';
import { SupabaseCandidateTopicsReader } from '../../lib/candidate-topics-reader';
import { SupabaseThreadsEngagementReader } from '../../lib/threads-engagement-reader';
import { SupabaseThreadsSentimentReader } from '../../lib/threads-sentiment-reader';
import { getHotTopics, type HotTopicsResult } from '../../lib/get-hot-topics';
import { enrichHotTopicsWithThreadsData } from '../../lib/get-topic-engagement';
import { withoutEngagement } from '../../lib/topic-engagement';
import { flattenAndRankHotTopics } from '../../lib/trending';
import { CATEGORIES } from '../../lib/categories';
import { TrendingTable } from '../../components/TrendingTable';
import { Topbar } from '../../components/layout/Topbar';
import { MetricTooltip } from '../../components/MetricTooltip';
import { METRIC_TOOLTIPS } from '../../lib/metric-tooltips';
import type { CandidateTopic } from '../../lib/types';
import type { HotTopicRow } from '../../lib/hot-topics';

export const dynamic = 'force-dynamic';

const FILTER_OPTIONS: { value: string | null; label: string }[] = [
  { value: null, label: 'Tất cả' },
  ...CATEGORIES.map((c) => ({ value: c.value, label: c.label })),
];

async function loadHotTopics(category: string | null): Promise<HotTopicsResult | { error: string }> {
  try {
    const client = createServerSupabaseClient();
    return await getHotTopics(new SupabaseCandidateTopicsReader(client), category);
  } catch (err) {
    console.error(err);
    return { error: 'Không tải được dữ liệu trending, vui lòng thử lại sau.' };
  }
}

async function loadThreadsEngagement(
  bySource: Record<CandidateTopic['source'], HotTopicRow[]>,
  date: string | null
) {
  if (date === null) return withoutEngagement(bySource);
  try {
    const client = createServerSupabaseClient();
    return await enrichHotTopicsWithThreadsData(
      bySource,
      new SupabaseThreadsEngagementReader(client),
      new SupabaseThreadsSentimentReader(client),
      date
    );
  } catch (err) {
    console.error(err);
    return withoutEngagement(bySource);
  }
}

export default async function TrendingPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const { category: categoryParam } = await searchParams;
  const category = CATEGORIES.some((c) => c.value === categoryParam) ? (categoryParam as string) : null;

  const hotTopics = await loadHotTopics(category);

  const threadsEnrichedBySource =
    'error' in hotTopics ? null : await loadThreadsEngagement(hotTopics.bySource, hotTopics.date);

  return (
    <>
      <Topbar title="Trending Now" />
      <main className="max-w-4xl mx-auto p-6">
        <p className="text-xs text-ink-3 mb-4">
          Xếp hạng theo Trending Score
          <MetricTooltip text={METRIC_TOOLTIPS.trendingScore} position="bottom" />
        </p>
        <div className="flex gap-2 flex-wrap mb-6">
          {FILTER_OPTIONS.map((opt) => (
            <Link
              key={opt.label}
              href={opt.value === null ? '/trending' : `/trending?category=${opt.value}`}
              className={`px-4 py-1.5 rounded-btn text-sm font-semibold border transition-colors ${
                category === opt.value
                  ? 'bg-brand text-white border-brand'
                  : 'bg-surface text-ink-2 border-line hover:bg-muted'
              }`}
            >
              {opt.label}
            </Link>
          ))}
        </div>
        {'error' in hotTopics ? (
          <p className="text-red-600">{hotTopics.error}</p>
        ) : (
          <TrendingTable
            rows={flattenAndRankHotTopics(threadsEnrichedBySource ?? withoutEngagement(hotTopics.bySource))}
          />
        )}
      </main>
    </>
  );
}
