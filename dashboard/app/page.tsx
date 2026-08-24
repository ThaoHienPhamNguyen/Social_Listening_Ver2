import { createServerSupabaseClient } from '../lib/supabase';
import { SupabaseCandidateTopicsReader } from '../lib/candidate-topics-reader';
import { SupabaseArticlesReader } from '../lib/articles-reader';
import { SupabaseThreadsEngagementReader } from '../lib/threads-engagement-reader';
import { SupabaseThreadsSentimentReader } from '../lib/threads-sentiment-reader';
import { getHotTopics, type HotTopicsResult } from '../lib/get-hot-topics';
import { enrichHotTopicsWithThreadsData } from '../lib/get-topic-engagement';
import { withoutEngagement } from '../lib/topic-engagement';
import { HotTopicsSection } from '../components/HotTopicsSection';
import { ArticlesSection } from '../components/ArticlesSection';
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

// Errors/missing data here are swallowed on purpose (spec §5): engagement +
// sentiment is supplementary context, not primary content — a failure must
// not block hot topics from rendering, and degrades silently to "no
// engagement data" rather than a red error banner.
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

export default async function OverviewPage() {
  const [hotTopics, articles] = await Promise.all([loadHotTopics(), loadArticles()]);

  const hotTopicsWithEngagement =
    'error' in hotTopics
      ? hotTopics
      : { ...hotTopics, bySource: await loadThreadsEngagement(hotTopics.bySource, hotTopics.date) };

  return (
    <>
      <Topbar title="Overview" />
      <main className="max-w-4xl mx-auto p-6">
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
