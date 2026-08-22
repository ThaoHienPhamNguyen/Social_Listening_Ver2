import type { ArticleRepository, PendingArticle } from '../../src/lib/article-repository';
import type { Article } from '../../src/types';

export class FakeArticleRepository implements ArticleRepository {
  public articles: Article[] = [];
  /** Set to simulate a query failure — getPendingArticles throws this as an Error. */
  public getPendingArticlesError: string | null = null;
  /** Set to simulate a write failure — markDone returns this as {error} without mutating. */
  public markDoneError: string | null = null;
  /** Set to simulate a write failure — markRetryOrFailed returns this as {error} without mutating. */
  public markRetryOrFailedError: string | null = null;

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
    if (this.getPendingArticlesError) {
      throw new Error(this.getPendingArticlesError);
    }
    return this.articles
      .filter((a) => a.content_fetch_status === 'pending' && a.fetch_attempts < maxAttempts)
      .sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))
      .slice(0, limit)
      .map((a) => ({ id: a.id!, url: a.url, fetch_attempts: a.fetch_attempts, source_id: a.source_id, categories: a.categories }));
  }

  async markDone(id: string, fullContent: string, attempts: number, categories: string[]) {
    if (this.markDoneError) {
      return { error: this.markDoneError };
    }
    const a = this.articles.find((x) => x.id === id);
    if (a) {
      a.full_content = fullContent;
      a.content_fetch_status = 'done';
      a.fetch_attempts = attempts;
      a.categories = categories;
    }
    return { error: null };
  }

  async markRetryOrFailed(id: string, attempts: number, maxAttempts: number) {
    if (this.markRetryOrFailedError) {
      return { error: this.markRetryOrFailedError };
    }
    const a = this.articles.find((x) => x.id === id);
    if (a) {
      a.content_fetch_status = attempts >= maxAttempts ? 'failed' : 'pending';
      a.fetch_attempts = attempts;
    }
    return { error: null };
  }

  async getRecentTitles(days: number) {
    const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;
    return this.articles
      .filter((a) => a.created_at && new Date(a.created_at).getTime() >= sinceMs)
      .map((a) => ({ title: a.title, categories: a.categories }));
  }
}
