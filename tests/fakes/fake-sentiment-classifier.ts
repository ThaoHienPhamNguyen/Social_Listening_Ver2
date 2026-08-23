import type { SentimentClassifier } from '../../src/lib/openai-sentiment-classifier';
import type { SentimentLabel } from '../../src/types';

export class FakeSentimentClassifier implements SentimentClassifier {
  public calls: { id: string; text: string }[][] = [];
  // Typed as string, not SentimentLabel — this fake can simulate an LLM
  // returning an out-of-set label, the same way the real client's return
  // type is just an unverified assertion on untrusted JSON.
  public labels: Record<string, string> = {};
  // 0-indexed call number to throw on, for testing per-chunk error isolation.
  public errorOnCall: number | null = null;

  async classify(posts: { id: string; text: string }[]): Promise<Record<string, SentimentLabel>> {
    const callIndex = this.calls.length;
    this.calls.push(posts);
    if (this.errorOnCall === callIndex) {
      throw new Error('simulated classifier failure');
    }
    const result: Record<string, SentimentLabel> = {};
    for (const post of posts) {
      if (this.labels[post.id] !== undefined) {
        result[post.id] = this.labels[post.id] as SentimentLabel;
      }
    }
    return result;
  }
}
