import { createServerSupabaseClient } from '../lib/supabase';
import { SupabaseCandidateTopicsReader } from '../lib/candidate-topics-reader';
import { SupabaseArticlesReader } from '../lib/articles-reader';
import { getHotTopics, type HotTopicsResult } from '../lib/get-hot-topics';
import { HotTopicsSection } from '../components/HotTopicsSection';
import { ArticlesSection } from '../components/ArticlesSection';
import { CategoryNav } from '../components/CategoryNav';
import type { Article } from '../lib/types';

export const dynamic = 'force-dynamic';

async function loadHotTopics(): Promise<HotTopicsResult | { error: string }> {
  try {
    const client = createServerSupabaseClient();
    return await getHotTopics(new SupabaseCandidateTopicsReader(client), null);
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

async function loadArticles(): Promise<Article[] | { error: string }> {
  try {
    const client = createServerSupabaseClient();
    return await new SupabaseArticlesReader(client).getRecentArticles(20, null);
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

export default async function OverviewPage() {
  const [hotTopics, articles] = await Promise.all([loadHotTopics(), loadArticles()]);

  return (
    <main className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">Social Listening — Overview</h1>
      <CategoryNav />
      {'error' in hotTopics ? (
        <p className="text-red-600">Không tải được dữ liệu topic: {hotTopics.error}</p>
      ) : (
        <HotTopicsSection date={hotTopics.date} bySource={hotTopics.bySource} />
      )}
      <div className="mt-8">
        {'error' in articles ? (
          <p className="text-red-600">Không tải được bài báo: {articles.error}</p>
        ) : (
          <ArticlesSection articles={articles} />
        )}
      </div>
    </main>
  );
}
