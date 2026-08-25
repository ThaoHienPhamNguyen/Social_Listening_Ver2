import { createServerSupabaseClient } from '../lib/supabase';
import { SupabaseCandidateTopicsReader } from '../lib/candidate-topics-reader';
import { SupabaseArticlesReader } from '../lib/articles-reader';
import { SupabaseThreadsEngagementReader } from '../lib/threads-engagement-reader';
import { SupabaseThreadsSentimentReader } from '../lib/threads-sentiment-reader';
import { SupabaseFacebookEngagementReader } from '../lib/facebook-engagement-reader';
import { SupabaseFacebookSentimentReader } from '../lib/facebook-sentiment-reader';
import { getHotTopics, type HotTopicsResult } from '../lib/get-hot-topics';
import { enrichHotTopicsWithThreadsData } from '../lib/get-topic-engagement';
import { withoutEngagement } from '../lib/topic-engagement';
import { getOverviewMetrics } from '../lib/get-overview-metrics';
import { getBuzzTrend } from '../lib/get-buzz-trend';
import type { OverviewMetrics, DonutSegment } from '../lib/overview-metrics';
import type { BuzzTrendPoint } from '../lib/buzz-trend';
import { HotTopicsSection } from '../components/HotTopicsSection';
import { ArticlesSection } from '../components/ArticlesSection';
import { OverviewMetricsSection } from '../components/OverviewMetricsSection';
import { Topbar } from '../components/layout/Topbar';
import type { Article, CandidateTopic } from '../lib/types';
import type { HotTopicRow } from '../lib/hot-topics';

export const dynamic = 'force-dynamic';

async function loadHotTopics(): Promise<HotTopicsResult | { error: string }> {
  try {
    const client = createServerSupabaseClient();
    return await getHotTopics(new SupabaseCandidateTopicsReader(client), null);
  } catch (err) {
    console.error(err);
    return { error: 'Không tải được dữ liệu topic, vui lòng thử lại sau.' };
  }
}

async function loadArticles(): Promise<Article[] | { error: string }> {
  try {
    const client = createServerSupabaseClient();
    return await new SupabaseArticlesReader(client).getRecentArticles(20, null);
  } catch (err) {
    console.error(err);
    return { error: 'Không tải được bài báo, vui lòng thử lại sau.' };
  }
}

// Errors/missing data here are swallowed on purpose (sub-project 3's spec
// §5): engagement + sentiment is supplementary context, not primary
// content — a failure must not block hot topics from rendering, and
// degrades silently rather than a red error banner.
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

// Same silent-degradation rule (this spec's §7): a KPI/donut load failure
// just means the section doesn't render, no red banner.
async function loadOverviewMetrics(
  date: string | null
): Promise<{ metrics: OverviewMetrics; donut: DonutSegment[]; date: string } | null> {
  if (date === null) return null;
  try {
    const client = createServerSupabaseClient();
    const result = await getOverviewMetrics(
      new SupabaseCandidateTopicsReader(client),
      new SupabaseArticlesReader(client),
      new SupabaseThreadsEngagementReader(client),
      new SupabaseFacebookEngagementReader(client),
      new SupabaseThreadsSentimentReader(client),
      new SupabaseFacebookSentimentReader(client),
      date
    );
    return { ...result, date };
  } catch (err) {
    console.error(err);
    return null;
  }
}

// Same silent-degradation rule — a chart load failure just means the chart
// doesn't render (falls back to the "Chưa có dữ liệu." message already
// built into OverviewMetricsSection), no red banner.
async function loadBuzzTrend(date: string | null): Promise<BuzzTrendPoint[] | null> {
  if (date === null) return null;
  try {
    const client = createServerSupabaseClient();
    return await getBuzzTrend(
      new SupabaseArticlesReader(client),
      new SupabaseThreadsEngagementReader(client),
      new SupabaseFacebookEngagementReader(client),
      date
    );
  } catch (err) {
    console.error(err);
    return null;
  }
}

export default async function OverviewPage() {
  const [hotTopics, articles] = await Promise.all([loadHotTopics(), loadArticles()]);

  const [threadsEnrichedBySource, overviewMetrics, buzzTrend] = await Promise.all([
    'error' in hotTopics ? Promise.resolve(null) : loadThreadsEngagement(hotTopics.bySource, hotTopics.date),
    'error' in hotTopics ? Promise.resolve(null) : loadOverviewMetrics(hotTopics.date),
    'error' in hotTopics ? Promise.resolve(null) : loadBuzzTrend(hotTopics.date),
  ]);

  const hotTopicsWithEngagement =
    'error' in hotTopics
      ? hotTopics
      : { ...hotTopics, bySource: threadsEnrichedBySource ?? withoutEngagement(hotTopics.bySource) };

  return (
    <>
      <Topbar title="Overview" />
      <main className="max-w-4xl mx-auto p-6">
        {overviewMetrics && (
          <OverviewMetricsSection
            metrics={overviewMetrics.metrics}
            donut={overviewMetrics.donut}
            buzzTrend={buzzTrend}
            date={overviewMetrics.date}
          />
        )}
        {'error' in hotTopicsWithEngagement ? (
          <p className="text-red-600">{hotTopicsWithEngagement.error}</p>
        ) : (
          <HotTopicsSection date={hotTopicsWithEngagement.date} bySource={hotTopicsWithEngagement.bySource} />
        )}
        <div className="mt-8">
          {'error' in articles ? (
            <p className="text-red-600">{articles.error}</p>
          ) : (
            <ArticlesSection articles={articles} />
          )}
        </div>
      </main>
    </>
  );
}
