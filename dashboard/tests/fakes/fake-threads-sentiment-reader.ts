import type { ThreadsSentimentReader } from '../../lib/threads-sentiment-reader';
import type { SentimentLabel } from '../../lib/types';

export class FakeThreadsSentimentReader implements ThreadsSentimentReader {
  constructor(private rows: { date: string; keyword: string; sentiment: SentimentLabel | null }[] = []) {}

  async getForDate(date: string): Promise<{ keyword: string; sentiment: SentimentLabel | null }[]> {
    return this.rows
      .filter((r) => r.date === date)
      .map((r) => ({ keyword: r.keyword, sentiment: r.sentiment }));
  }

  async getForDateRange(
    startDate: string,
    endDateExclusive: string
  ): Promise<{ keyword: string; date: string; sentiment: SentimentLabel | null }[]> {
    return this.rows.filter((r) => r.date >= startDate && r.date < endDateExclusive);
  }
}
