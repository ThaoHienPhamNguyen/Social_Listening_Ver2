import type { FacebookSentimentReader } from '../../lib/facebook-sentiment-reader';
import type { SentimentLabel } from '../../lib/types';

export class FakeFacebookSentimentReader implements FacebookSentimentReader {
  constructor(private rows: { date: string; category: string; sentiment: SentimentLabel | null }[] = []) {}

  async getForDate(date: string): Promise<{ category: string; sentiment: SentimentLabel | null }[]> {
    return this.rows
      .filter((r) => r.date === date)
      .map((r) => ({ category: r.category, sentiment: r.sentiment }));
  }
}
