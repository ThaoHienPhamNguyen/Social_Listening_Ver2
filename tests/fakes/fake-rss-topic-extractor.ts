import type { RssTopicExtractor } from '../../src/lib/rss-topic-extractor';

export class FakeRssTopicExtractor implements RssTopicExtractor {
  public calls: string[][] = [];
  public topicsByTitle: Record<string, string[]> = {};
  public shouldThrow = false;

  async extractTopics(titles: string[]): Promise<string[][]> {
    this.calls.push(titles);
    if (this.shouldThrow) {
      throw new Error('FakeRssTopicExtractor: extractTopics failed');
    }
    return titles.map((t) => this.topicsByTitle[t] ?? []);
  }
}
