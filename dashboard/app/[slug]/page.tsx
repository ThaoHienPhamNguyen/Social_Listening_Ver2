import { notFound } from 'next/navigation';
import { createServerSupabaseClient } from '../../lib/supabase';
import { SupabaseCandidateTopicsReader } from '../../lib/candidate-topics-reader';
import { SupabaseArticlesReader } from '../../lib/articles-reader';
import { SupabaseThreadsEngagementReader } from '../../lib/threads-engagement-reader';
import { SupabaseThreadsSentimentReader } from '../../lib/threads-sentiment-reader';
import { SupabaseFacebookEngagementReader } from '../../lib/facebook-engagement-reader';
import { SupabaseFacebookSentimentReader } from '../../lib/facebook-sentiment-reader';
import { getHotTopics, type HotTopicsResult } from '../../lib/get-hot-topics';
import { enrichHotTopicsWithThreadsData } from '../../lib/get-topic-engagement';
import { withoutEngagement } from '../../lib/topic-engagement';
import { getFacebookSummary } from '../../lib/get-facebook-summary';
import type { FacebookSummary } from '../../lib/facebook-summary';
import { getCategoryBySlug } from '../../lib/categories';
import { getSectorMetrics } from '../../lib/get-sector-metrics';
import { flattenAndRankHotTopics } from '../../lib/trending';
import { sortByRecency } from '../../lib/hot-topics';
import { extractTopKeywords } from '../../lib/top-keywords';
import { computeBuzzByPlatform, type PlatformBuzz } from '../../lib/buzz-by-platform';
import { ArticlesSection } from '../../components/ArticlesSection';
import { FacebookSummarySection } from '../../components/FacebookSummarySection';
import { TrendingTabs } from '../../components/TrendingTabs';
import { BuzzByPlatformSection } from '../../components/BuzzByPlatformSection';
import { KpiCard } from '../../components/KpiCard';
import { Topbar } from '../../components/layout/Topbar';
import { MetricTooltip } from '../../components/MetricTooltip';
import { METRIC_TOOLTIPS } from '../../lib/metric-tooltips';
import type { Article, CandidateTopic } from '../../lib/types';
import type { HotTopicRow } from '../../lib/hot-topics';

export const dynamic = 'force-dynamic';

function addDaysUTC(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function loadHotTopics(category: string): Promise<HotTopicsResult | { error: string }> {
  try {
    const client = createServerSupabaseClient();
    return await getHotTopics(new SupabaseCandidateTopicsReader(client), category);
  } catch (err) {
    console.error(err);
    return { error: 'Không tải được dữ liệu topic, vui lòng thử lại sau.' };
  }
}

async function loadArticles(category: string): Promise<Article[] | { error: string }> {
  try {
    const client = createServerSupabaseClient();
    return await new SupabaseArticlesReader(client).getRecentArticles(20, category);
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

async function loadFacebookSummary(category: string, date: string | null): Promise<FacebookSummary | null> {
  if (date === null) return null;
  try {
    const client = createServerSupabaseClient();
    return await getFacebookSummary(category, new SupabaseFacebookEngagementReader(client), new SupabaseFacebookSentimentReader(client), date);
  } catch (err) {
    console.error(err);
    return null;
  }
}

async function loadSectorMetrics(category: string, date: string | null) {
  if (date === null) return null;
  try {
    const client = createServerSupabaseClient();
    return await getSectorMetrics(
      new SupabaseCandidateTopicsReader(client),
      new SupabaseArticlesReader(client),
      new SupabaseThreadsEngagementReader(client),
      new SupabaseFacebookEngagementReader(client),
      category,
      date
    );
  } catch (err) {
    console.error(err);
    return null;
  }
}

async function loadTopKeywords(category: string, date: string | null): Promise<string[]> {
  if (date === null) return [];
  try {
    const client = createServerSupabaseClient();
    const candidates = await new SupabaseCandidateTopicsReader(client).getShortlistedForDateRange(
      category,
      addDaysUTC(date, -6),
      addDaysUTC(date, 1)
    );
    return extractTopKeywords(candidates);
  } catch (err) {
    console.error(err);
    return [];
  }
}

async function loadBuzzByPlatform(category: string, date: string | null): Promise<PlatformBuzz[] | null> {
  if (date === null) return null;
  try {
    const client = createServerSupabaseClient();
    const rangeStart = addDaysUTC(date, -6);
    const rangeEndExclusive = addDaysUTC(date, 1);
    const [articles, threadsRows, facebookRows] = await Promise.all([
      new SupabaseArticlesReader(client).getForDateRange(rangeStart, rangeEndExclusive),
      new SupabaseThreadsEngagementReader(client).getForDateRange(rangeStart, rangeEndExclusive),
      new SupabaseFacebookEngagementReader(client).getForDateRange(rangeStart, rangeEndExclusive),
    ]);
    return computeBuzzByPlatform(
      articles.filter((a) => a.categories.includes(category)),
      threadsRows.filter((r) => r.category === category),
      facebookRows.filter((r) => r.category === category)
    );
  } catch (err) {
    console.error(err);
    return null;
  }
}

export default async function SectorPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const categoryDef = getCategoryBySlug(slug);
  if (!categoryDef) notFound();

  const [hotTopics, articles] = await Promise.all([
    loadHotTopics(categoryDef.value),
    loadArticles(categoryDef.value),
  ]);
  const date = 'error' in hotTopics ? null : hotTopics.date;

  const [threadsEnrichedBySource, facebookSummary, sectorMetrics, topKeywords, buzzByPlatform] = await Promise.all([
    'error' in hotTopics ? Promise.resolve(null) : loadThreadsEngagement(hotTopics.bySource, hotTopics.date),
    loadFacebookSummary(categoryDef.value, date),
    loadSectorMetrics(categoryDef.value, date),
    loadTopKeywords(categoryDef.value, date),
    loadBuzzByPlatform(categoryDef.value, date),
  ]);

  const hotTopicsWithEngagement =
    'error' in hotTopics
      ? hotTopics
      : { ...hotTopics, bySource: threadsEnrichedBySource ?? withoutEngagement(hotTopics.bySource) };

  const rankedTrending =
    'error' in hotTopicsWithEngagement ? [] : flattenAndRankHotTopics(hotTopicsWithEngagement.bySource);

  return (
    <>
      <Topbar title={categoryDef.label} color={categoryDef.color} />
      <main className="max-w-4xl mx-auto p-6">
        {sectorMetrics ? (
          <div className="grid gap-4 md:grid-cols-3 mb-8">
            <KpiCard
              label="Buzz Volume (7 ngày)"
              value={sectorMetrics.metrics.buzzVolume7d.toLocaleString('vi-VN')}
              tooltip={METRIC_TOOLTIPS.sectorBuzzVolume}
              delta={sectorMetrics.buzzVolumeDelta.text}
              deltaPositive={sectorMetrics.buzzVolumeDelta.positive}
            />
            <KpiCard
              label="Chủ đề hoạt động"
              value={sectorMetrics.metrics.activeTopics.toLocaleString('vi-VN')}
              tooltip={METRIC_TOOLTIPS.sectorActiveTopics}
              delta="trong 7 ngày qua"
              deltaPositive={true}
            />
            <KpiCard
              label="Audience Scale"
              value={sectorMetrics.metrics.audienceScale7d.toLocaleString('vi-VN')}
              tooltip={METRIC_TOOLTIPS.audienceScale}
              delta={sectorMetrics.audienceScaleDelta.text}
              deltaPositive={sectorMetrics.audienceScaleDelta.positive}
            />
          </div>
        ) : (
          <div className="mb-8">
            <p className="text-sm text-ink-3">Chưa có dữ liệu.</p>
          </div>
        )}
        <section className="mb-8">
          <h2 className="text-base font-bold text-ink mb-4">
            Chủ đề đang trending
            <MetricTooltip text={METRIC_TOOLTIPS.topTrending} />
          </h2>
          {'error' in hotTopics ? (
            <p className="text-red-600">{hotTopics.error}</p>
          ) : (
            <TrendingTabs trending={rankedTrending} recent={sortByRecency(rankedTrending)} />
          )}
        </section>
        {topKeywords.length > 0 ? (
          <section className="bg-surface border border-line rounded-card shadow-card p-6 mb-8">
            <h2 className="text-base font-bold text-ink mb-4">Từ khóa nổi bật</h2>
            <div className="flex flex-wrap gap-2">
              {topKeywords.map((k) => (
                <span key={k} className="text-xs px-2.5 py-1 rounded-full bg-muted text-ink-2">
                  {k}
                </span>
              ))}
            </div>
          </section>
        ) : (
          <div className="mb-8">
            <p className="text-sm text-ink-3">Chưa có dữ liệu.</p>
          </div>
        )}
        {buzzByPlatform ? (
          <div className="mb-8">
            <BuzzByPlatformSection data={buzzByPlatform} />
          </div>
        ) : (
          <div className="mb-8">
            <p className="text-sm text-ink-3">Chưa có dữ liệu.</p>
          </div>
        )}
        <FacebookSummarySection summary={facebookSummary} date={date} />
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
