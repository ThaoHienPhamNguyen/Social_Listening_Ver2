import type { TopicArticleDataRepository } from '../../src/lib/topic-article-data-repository';
import type { TopicArticleData } from '../../src/types';

export class FakeTopicArticleDataRepository implements TopicArticleDataRepository {
  public links: TopicArticleData[] = [];
  public upsertError: string | null = null;

  async upsertLinks(rows: Partial<TopicArticleData>[]) {
    if (this.upsertError) return { error: this.upsertError, count: 0 };
    for (const row of rows) {
      this.links.push({
        id: row.id ?? crypto.randomUUID(),
        keyword: row.keyword!,
        source: row.source ?? 'rss',
        date: row.date!,
        article_url: row.article_url!,
        article_title: row.article_title ?? '',
        article_snippet: row.article_snippet ?? '',
      });
    }
    return { error: null, count: rows.length };
  }

  async getArticlesForDate(date: string) {
    return this.links.filter((l) => l.date === date);
  }
}
