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
import { getOverviewMetrics, type OverviewMetricsResult } from '../lib/get-overview-metrics';
import { getBuzzTrend } from '../lib/get-buzz-trend';
import { flattenAndRankHotTopics } from '../lib/trending';
import { sortByRecency, type HotTopicRow } from '../lib/hot-topics';
import { extractTopKeywords } from '../lib/top-keywords';
import { computeSentimentByCategory, type CategorySentiment } from '../lib/sentiment-by-category';
import { computeBuzzByPlatform, type PlatformBuzz } from '../lib/buzz-by-platform';
import { CATEGORIES } from '../lib/categories';
import type { BuzzTrendPoint } from '../lib/buzz-trend';
import Link from 'next/link';
import { ArticlesSection } from '../components/ArticlesSection';
import { OverviewMetricsSection } from '../components/OverviewMetricsSection';
import { SectorMiniCard } from '../components/SectorMiniCard';
import { SentimentByCategorySection } from '../components/SentimentByCategorySection';
import { BuzzByPlatformSection } from '../components/BuzzByPlatformSection';
import { TrendingTable } from '../components/TrendingTable';
import { MetricTooltip } from '../components/MetricTooltip';
import { METRIC_TOOLTIPS } from '../lib/metric-tooltips';
import { Topbar } from '../components/layout/Topbar';
import type { Article, CandidateTopic } from '../lib/types';

export const dynamic = 'force-dynamic';

function addDaysUTC(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

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

async function loadOverviewMetrics(date: string | null): Promise<(OverviewMetricsResult & { date: string }) | null> {
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

async function loadSectorMiniCards(date: string | null) {
  if (date === null) return null;
  try {
    const client = createServerSupabaseClient();
    const candidateReader = new SupabaseCandidateTopicsReader(client);
    const results = await Promise.all(
      CATEGORIES.map(async (cat) => {
        const hotTopics = await getHotTopics(candidateReader, cat.value);
        const enriched = await loadThreadsEngagement(hotTopics.bySource, hotTopics.date);
        const flattened = flattenAndRankHotTopics(enriched);
        return {
          category: cat.value,
          trending: flattened,
          recent: sortByRecency(flattened),
          keywords: extractTopKeywords(
            await candidateReader.getShortlistedForDateRange(cat.value, date, addDaysUTC(date, 1)),
            8
          ),
        };
      })
    );
    return results;
  } catch (err) {
    console.error(err);
    return null;
  }
}

async function loadSentimentByCategory(date: string | null): Promise<CategorySentiment[] | null> {
  if (date === null) return null;
  try {
    const client = createServerSupabaseClient();
    const candidateReader = new SupabaseCandidateTopicsReader(client);
    const [candidates, threadsSentiment, facebookSentiment] = await Promise.all([
      candidateReader.getCandidatesForDate(date),
      new SupabaseThreadsSentimentReader(client).getForDate(date),
      new SupabaseFacebookSentimentReader(client).getForDate(date),
    ]);
    return computeSentimentByCategory(threadsSentiment, candidates, facebookSentiment);
  } catch (err) {
    console.error(err);
    return null;
  }
}

async function loadBuzzByPlatform(date: string | null): Promise<PlatformBuzz[] | null> {
  if (date === null) return null;
  try {
    const client = createServerSupabaseClient();
    const [articles, threadsRows, facebookRows] = await Promise.all([
      new SupabaseArticlesReader(client).getForDate(date),
      new SupabaseThreadsEngagementReader(client).getForDate(date),
      new SupabaseFacebookEngagementReader(client).getForDate(date),
    ]);
    return computeBuzzByPlatform(articles, threadsRows, facebookRows);
  } catch (err) {
    console.error(err);
    return null;
  }
}

export default async function OverviewPage() {
  const [hotTopics, articles] = await Promise.all([loadHotTopics(), loadArticles()]);
  const date = 'error' in hotTopics ? null : hotTopics.date;

  const [threadsEnrichedBySource, overviewMetrics, buzzTrend, sectorMiniCards, sentimentByCategory, buzzByPlatform] =
    await Promise.all([
      'error' in hotTopics ? Promise.resolve(null) : loadThreadsEngagement(hotTopics.bySource, hotTopics.date),
      loadOverviewMetrics(date),
      loadBuzzTrend(date),
      loadSectorMiniCards(date),
      loadSentimentByCategory(date),
      loadBuzzByPlatform(date),
    ]);

  const hotTopicsWithEngagement =
    'error' in hotTopics
      ? hotTopics
      : { ...hotTopics, bySource: threadsEnrichedBySource ?? withoutEngagement(hotTopics.bySource) };

  const rankedTrending =
    'error' in hotTopicsWithEngagement ? [] : flattenAndRankHotTopics(hotTopicsWithEngagement.bySource);

  return (
    <>
      <Topbar title="Tổng quan thị trường" />
      <main className="max-w-4xl mx-auto p-6">
        {overviewMetrics && (
          <OverviewMetricsSection
            metrics={overviewMetrics.metrics}
            donut={overviewMetrics.donut}
            buzzTrend={buzzTrend}
            date={overviewMetrics.date}
            deltas={overviewMetrics.deltas}
          />
        )}
        <section className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-bold text-ink">
              🔥 Top Trending hôm nay
              <MetricTooltip text={METRIC_TOOLTIPS.topTrending} />
            </h2>
            <Link href="/trending" className="text-sm font-semibold text-brand hover:underline">
              Xem tất cả →
            </Link>
          </div>
          {'error' in hotTopics ? (
            <p className="text-red-600">{hotTopics.error}</p>
          ) : (
            <TrendingTable rows={rankedTrending.slice(0, 10)} />
          )}
        </section>
        {sectorMiniCards && (
          <div className="grid gap-6 md:grid-cols-3 mb-8">
            {sectorMiniCards.map((c) => (
              <SectorMiniCard key={c.category} {...c} />
            ))}
          </div>
        )}
        {(sentimentByCategory || buzzByPlatform) && (
          <div className="grid gap-6 lg:grid-cols-2 mb-8">
            {sentimentByCategory && <SentimentByCategorySection data={sentimentByCategory} />}
            {buzzByPlatform && <BuzzByPlatformSection data={buzzByPlatform} />}
          </div>
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
