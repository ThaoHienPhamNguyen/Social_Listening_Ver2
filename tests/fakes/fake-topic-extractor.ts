import type { TopicExtractor } from '../../src/lib/topic-extractor';

export class FakeTopicExtractor implements TopicExtractor {
  public calls: string[][] = [];
  public topicsByText: Record<string, string[]> = {};
  public shouldThrow = false;

  async extractTopics(texts: string[]): Promise<string[][]> {
    this.calls.push(texts);
    if (this.shouldThrow) {
      throw new Error('FakeTopicExtractor: extractTopics failed');
    }
    return texts.map((t) => this.topicsByText[t] ?? []);
  }
}
