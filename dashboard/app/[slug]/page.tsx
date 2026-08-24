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
import { HotTopicsSection } from '../../components/HotTopicsSection';
import { ArticlesSection } from '../../components/ArticlesSection';
import { FacebookSummarySection } from '../../components/FacebookSummarySection';
import { Topbar } from '../../components/layout/Topbar';
import type { Article, CandidateTopic } from '../../lib/types';
import type { HotTopicRow } from '../../lib/hot-topics';

export const dynamic = 'force-dynamic';

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

// Errors/missing data here are swallowed on purpose (spec §5) — see
// app/page.tsx's identical comment.
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
    return await getFacebookSummary(
      category,
      new SupabaseFacebookEngagementReader(client),
      new SupabaseFacebookSentimentReader(client),
      date
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

  const [threadsEnrichedBySource, facebookSummary] = await Promise.all([
    'error' in hotTopics ? Promise.resolve(null) : loadThreadsEngagement(hotTopics.bySource, hotTopics.date),
    'error' in hotTopics ? Promise.resolve(null) : loadFacebookSummary(categoryDef.value, hotTopics.date),
  ]);

  const hotTopicsWithEngagement =
    'error' in hotTopics
      ? hotTopics
      : { ...hotTopics, bySource: threadsEnrichedBySource ?? withoutEngagement(hotTopics.bySource) };

  return (
    <>
      <Topbar title={categoryDef.label} color={categoryDef.color} />
      <main className="max-w-4xl mx-auto p-6">
        <FacebookSummarySection summary={facebookSummary} date={'error' in hotTopics ? null : hotTopics.date} />
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
