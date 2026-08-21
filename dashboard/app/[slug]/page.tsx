import { notFound } from 'next/navigation';
import { createServerSupabaseClient } from '../../lib/supabase';
import { SupabaseCandidateTopicsReader } from '../../lib/candidate-topics-reader';
import { SupabaseArticlesReader } from '../../lib/articles-reader';
import { getHotTopics, type HotTopicsResult } from '../../lib/get-hot-topics';
import { getCategoryBySlug } from '../../lib/categories';
import { HotTopicsSection } from '../../components/HotTopicsSection';
import { ArticlesSection } from '../../components/ArticlesSection';
import { CategoryNav } from '../../components/CategoryNav';
import type { Article } from '../../lib/types';

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

export default async function SectorPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const categoryDef = getCategoryBySlug(slug);
  if (!categoryDef) notFound();

  const [hotTopics, articles] = await Promise.all([
    loadHotTopics(categoryDef.value),
    loadArticles(categoryDef.value),
  ]);

  return (
    <main className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4" style={{ color: categoryDef.color }}>
        {categoryDef.label}
      </h1>
      <CategoryNav />
      {'error' in hotTopics ? (
        <p className="text-red-600">{hotTopics.error}</p>
      ) : (
        <HotTopicsSection date={hotTopics.date} bySource={hotTopics.bySource} />
      )}
      <div className="mt-8">
        {'error' in articles ? (
          <p className="text-red-600">{articles.error}</p>
        ) : (
          <ArticlesSection articles={articles} />
        )}
      </div>
    </main>
  );
}
