import { createServerSupabaseClient } from '../../../lib/supabase';
import { SupabaseCandidateTopicsReader } from '../../../lib/candidate-topics-reader';
import { SupabaseThreadsEngagementReader } from '../../../lib/threads-engagement-reader';
import { SupabaseThreadsSentimentReader } from '../../../lib/threads-sentiment-reader';
import { getTopicDetail } from '../../../lib/get-topic-detail';
import type { TopicDetailData } from '../../../lib/topic-detail';
import { computeSentimentIndex } from '../../../lib/topic-engagement';
import { CATEGORIES } from '../../../lib/categories';
import { SOURCE_LABELS } from '../../../lib/hot-topic-format';
import { SingleLineChart } from '../../../components/SingleLineChart';
import { Topbar } from '../../../components/layout/Topbar';

export const dynamic = 'force-dynamic';

async function loadTopicDetail(keyword: string): Promise<TopicDetailData | null | { error: string }> {
  try {
    const client = createServerSupabaseClient();
    const candidateReader = new SupabaseCandidateTopicsReader(client);
    const latestDate = await candidateReader.getLatestDate();
    if (latestDate === null) return null;
    return await getTopicDetail(
      candidateReader,
      new SupabaseThreadsEngagementReader(client),
      new SupabaseThreadsSentimentReader(client),
      keyword,
      latestDate
    );
  } catch (err) {
    console.error(err);
    return { error: 'Không tải được dữ liệu topic, vui lòng thử lại sau.' };
  }
}

export default async function TopicDetailPage({ params }: { params: Promise<{ keyword: string }> }) {
  const { keyword: encodedKeyword } = await params;
  const keyword = decodeURIComponent(encodedKeyword);
  const detail = await loadTopicDetail(keyword);

  if (detail !== null && 'error' in detail) {
    return (
      <>
        <Topbar title={keyword} />
        <main className="max-w-4xl mx-auto p-6">
          <p className="text-red-600">{detail.error}</p>
        </main>
      </>
    );
  }

  if (detail === null) {
    return (
      <>
        <Topbar title={keyword} />
        <main className="max-w-4xl mx-auto p-6">
          <p className="text-sm text-ink-3">Không tìm thấy topic này.</p>
        </main>
      </>
    );
  }

  const categoryMeta = CATEGORIES.find((c) => c.value === detail.category);

  return (
    <>
      <Topbar title={keyword} color={categoryMeta?.color} />
      <main className="max-w-4xl mx-auto p-6 space-y-6">
        <div className="flex items-center gap-3 flex-wrap">
          {categoryMeta && (
            <span className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-badge text-xs font-semibold text-ink-3 bg-muted">
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: categoryMeta.color }} />
              {categoryMeta.label}
            </span>
          )}
          {detail.sources.map((source) => (
            <span key={source} className="text-xs text-ink-3">
              {SOURCE_LABELS[source]}
            </span>
          ))}
        </div>

        <div className="bg-surface border border-line rounded-card shadow-card p-6">
          <h2 className="text-base font-bold text-ink mb-4">Trending Score — 7 ngày qua</h2>
          <SingleLineChart
            data={detail.trendingScoreTimeline.map((p) => ({ date: p.date, value: p.score }))}
            color="var(--color-brand)"
          />
        </div>

        <div className="bg-surface border border-line rounded-card shadow-card p-6">
          <h2 className="text-base font-bold text-ink mb-4">Engagement Threads — 7 ngày qua</h2>
          <SingleLineChart
            data={detail.engagementTimeline.map((p) => ({
              date: p.date,
              value: p.postCount === 0 ? null : p.totalEngagement,
            }))}
            color="var(--color-brand)"
          />
        </div>

        <div className="bg-surface border border-line rounded-card shadow-card p-6">
          <h2 className="text-base font-bold text-ink mb-4">Sentiment Threads — 7 ngày qua</h2>
          <SingleLineChart
            data={detail.sentimentTimeline.map((p) => ({ date: p.date, value: computeSentimentIndex(p) }))}
            color="var(--color-brand)"
          />
        </div>
      </main>
    </>
  );
}
