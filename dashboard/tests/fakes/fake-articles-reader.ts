import type { ArticlesReader } from '../../lib/articles-reader';
import type { Article } from '../../lib/types';

export class FakeArticlesReader implements ArticlesReader {
  constructor(private articles: Article[] = []) {}

  async getRecentArticles(limit: number, category: string | null): Promise<Article[]> {
    const filtered = category
      ? this.articles.filter((a) => a.categories.includes(category))
      : this.articles;
    return [...filtered]
      .sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? ''))
      .slice(0, limit);
  }

  async getForDate(date: string): Promise<{ id: string; categories: string[] }[]> {
    return this.articles
      .filter((a) => a.published_at?.slice(0, 10) === date)
      .map((a) => ({ id: a.id, categories: a.categories }));
  }
}
