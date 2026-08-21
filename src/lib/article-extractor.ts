import { extract } from '@extractus/article-extractor';
import { htmlToText } from './html-to-text';

const FETCH_TIMEOUT_MS = 15000;

export interface ContentExtractor {
  extract(url: string): Promise<{ text: string | null } | null>;
}

export class DefaultContentExtractor implements ContentExtractor {
  async extract(url: string) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const article = await extract(url, undefined, { signal: controller.signal });
      if (!article) return null;
      return { text: article.content ? htmlToText(article.content) : null };
    } finally {
      clearTimeout(timeout);
    }
  }
}
