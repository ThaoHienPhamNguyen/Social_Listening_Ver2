import type { TopicSummarizer, TopicSummaryInput } from '../../src/lib/topic-summarizer';

export class FakeTopicSummarizer implements TopicSummarizer {
  public calls: TopicSummaryInput[][] = [];
  public summaryByKeyword: Record<string, string> = {};
  public shouldThrow = false;

  async summarizeTopics(inputs: TopicSummaryInput[]): Promise<(string | null)[]> {
    this.calls.push(inputs);
    if (this.shouldThrow) {
      throw new Error('FakeTopicSummarizer: summarizeTopics failed');
    }
    return inputs.map((i) => this.summaryByKeyword[i.keyword] ?? null);
  }
}
