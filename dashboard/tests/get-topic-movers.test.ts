import { describe, it, expect } from 'vitest';
import { getTopicMovers } from '../lib/get-topic-movers';
import { FakeThreadsEngagementReader } from './fakes/fake-threads-engagement-reader';
import type { ThreadsEngagementDaily } from '../lib/types';

function row(overrides: Partial<ThreadsEngagementDaily> = {}): ThreadsEngagementDaily {
  return {
    date: '2026-08-24',
    keyword: 'bitcoin',
    category: 'tai_chinh',
    total_like_count: 10,
    total_reply_count: 0,
    total_repost_count: 0,
    total_quote_count: 0,
    total_share_count: 0,
    total_view_count: 0,
    post_count: 1,
    ...overrides,
  };
}

describe('getTopicMovers', () => {
  it('splits the 14-day fetch into current (last 7 days) vs previous (7 days before that) at the latestDate-6 boundary', async () => {
    const reader = new FakeThreadsEngagementReader([
      row({ date: '2026-08-17', total_like_count: 5 }), // previous period (last day before the boundary)
      row({ date: '2026-08-10', total_like_count: 999 }), // outside the 14-day window entirely
      row({ date: '2026-08-18', total_like_count: 20 }), // current period (first day, inclusive boundary)
    ]);
    const { gainers } = await getTopicMovers(reader, '2026-08-24');
    expect(gainers[0].buzz).toBe(20); // only the current-period row counts toward buzz
    expect(gainers[0].deltaPct).toBe(300); // (20-5)/5*100
  });
});
