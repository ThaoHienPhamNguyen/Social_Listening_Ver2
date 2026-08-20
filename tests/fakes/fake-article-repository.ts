import type { ArticleRepository, PendingArticle } from '../../src/lib/article-repository';
import type { Article } from '../../src/types';

export class FakeArticleRepository implements ArticleRepository {
  public articles: Article[] = [];

  async upsertArticle(article: Partial<Article>) {
    const exists = this.articles.some((a) => a.url === article.url);
    if (!exists) {
      const newArticle = {
        ...article,
        id: article.id ?? crypto.randomUUID(),
      } as Article;
      this.articles.push(newArticle);
    }
    return { error: null };
  }

  async getPendingArticles(limit: number, maxAttempts: number): Promise<PendingArticle[]> {
    return this.articles
      .filter((a) => a.content_fetch_status === 'pending' && a.fetch_attempts < maxAttempts)
      .slice(0, limit)
      .map((a) => ({ id: a.id!, url: a.url, fetch_attempts: a.fetch_attempts }));
  }

  async markDone(id: string, fullContent: string, attempts: number) {
    const a = this.articles.find((x) => x.id === id);
    if (a) {
      a.full_content = fullContent;
      a.content_fetch_status = 'done';
      a.fetch_attempts = attempts;
    }
  }

  async markRetryOrFailed(id: string, attempts: number, maxAttempts: number) {
    const a = this.articles.find((x) => x.id === id);
    if (a) {
      a.content_fetch_status = attempts >= maxAttempts ? 'failed' : 'pending';
      a.fetch_attempts = attempts;
    }
  }
}
