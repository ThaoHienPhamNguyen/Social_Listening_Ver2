import type { ThreadsEngagementReader } from '../../lib/threads-engagement-reader';
import type { ThreadsEngagementDaily } from '../../lib/types';

export class FakeThreadsEngagementReader implements ThreadsEngagementReader {
  constructor(private rows: ThreadsEngagementDaily[] = []) {}

  async getForDate(date: string): Promise<ThreadsEngagementDaily[]> {
    return this.rows.filter((r) => r.date === date);
  }

  async getForDateRange(startDate: string, endDateExclusive: string): Promise<ThreadsEngagementDaily[]> {
    return this.rows.filter((r) => r.date >= startDate && r.date < endDateExclusive);
  }
}
