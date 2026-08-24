import type { FacebookEngagementReader } from '../../lib/facebook-engagement-reader';
import type { FacebookEngagementDaily } from '../../lib/types';

export class FakeFacebookEngagementReader implements FacebookEngagementReader {
  constructor(private rows: FacebookEngagementDaily[] = []) {}

  async getForDate(date: string): Promise<FacebookEngagementDaily[]> {
    return this.rows.filter((r) => r.date === date);
  }
}
