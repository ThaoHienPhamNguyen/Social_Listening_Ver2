import { describe, it, expect } from 'vitest';
import { FakeThreadsEngagementDailyRepository } from './fakes/fake-threads-engagement-repository';

describe('FakeThreadsEngagementDailyRepository', () => {
  it('upsertDaily adds every row in the batch, defaulting category to null', async () => {
    const repo = new FakeThreadsEngagementDailyRepository();
    const { error, count } = await repo.upsertDaily([
      { date: '2026-08-23', keyword: 'bitcoin', total_like_count: 10, post_count: 2 },
    ]);
    expect(error).toBeNull();
    expect(count).toBe(1);
    expect(repo.rows).toHaveLength(1);
    expect(repo.rows[0]).toMatchObject({ date: '2026-08-23', keyword: 'bitcoin', category: null, total_like_count: 10, post_count: 2 });
  });

  it('upsertDaily returns the configured error and adds nothing when upsertError is set', async () => {
    const repo = new FakeThreadsEngagementDailyRepository();
    repo.upsertError = 'simulated failure';
    const { error, count } = await repo.upsertDaily([{ date: '2026-08-23', keyword: 'bitcoin' }]);
    expect(error).toBe('simulated failure');
    expect(count).toBe(0);
    expect(repo.rows).toHaveLength(0);
  });
});
