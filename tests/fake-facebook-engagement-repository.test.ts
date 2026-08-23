import { describe, it, expect } from 'vitest';
import { FakeFacebookEngagementDailyRepository } from './fakes/fake-facebook-engagement-repository';

describe('FakeFacebookEngagementDailyRepository', () => {
  it('upsertDaily adds every row in the batch', async () => {
    const repo = new FakeFacebookEngagementDailyRepository();
    const { error, count } = await repo.upsertDaily([
      { date: '2026-08-23', category: 'tai_chinh', total_like_count: 10, post_count: 2 },
    ]);
    expect(error).toBeNull();
    expect(count).toBe(1);
    expect(repo.rows).toHaveLength(1);
    expect(repo.rows[0]).toMatchObject({ date: '2026-08-23', category: 'tai_chinh', total_like_count: 10, post_count: 2 });
  });

  it('upsertDaily returns the configured error and adds nothing when upsertError is set', async () => {
    const repo = new FakeFacebookEngagementDailyRepository();
    repo.upsertError = 'simulated failure';
    const { error, count } = await repo.upsertDaily([{ date: '2026-08-23', category: 'tai_chinh' }]);
    expect(error).toBe('simulated failure');
    expect(count).toBe(0);
    expect(repo.rows).toHaveLength(0);
  });
});
