import { extract } from '@extractus/article-extractor';

export interface ContentExtractor {
  extract(url: string): Promise<{ text: string | null } | null>;
}

export class DefaultContentExtractor implements ContentExtractor {
  async extract(url: string) {
    const article = await extract(url);
    return article ? { text: article.content ?? null } : null;
  }
}
