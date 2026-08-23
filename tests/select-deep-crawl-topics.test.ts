import { describe, it, expect } from 'vitest';
import { selectDeepCrawlTopics } from '../src/lib/select-deep-crawl-topics';
import type { CandidateTopic } from '../src/types';

function candidate(overrides: Partial<CandidateTopic>): CandidateTopic {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    source: 'google_trends',
    keyword: 'x',
    date: '2026-08-23',
    metric_value: 100,
    growth_rate: 1,
    category_hint: [],
    is_shortlisted: true,
    ...overrides,
  };
}

describe('selectDeepCrawlTopics', () => {
  it('ignores candidates that are not shortlisted', () => {
    const result = selectDeepCrawlTopics([
      candidate({ keyword: 'a', is_shortlisted: false, growth_rate: 100 }),
      candidate({ keyword: 'b', is_shortlisted: true, growth_rate: 1 }),
    ]);
    expect(result).toEqual(['b']);
  });

  it('dedupes a keyword appearing under multiple sources, keeping it once', () => {
    const result = selectDeepCrawlTopics([
      candidate({ keyword: 'bitcoin', source: 'google_trends', growth_rate: 1 }),
      candidate({ keyword: 'bitcoin', source: 'rss', growth_rate: 5 }),
    ]);
    expect(result).toEqual(['bitcoin']);
  });

  it('reserves top-2 per category even if they would miss the overall top-8 by growth_rate', () => {
    // 8 high-growth candidates with no category fill the general pool, but a
    // low-growth du_lich candidate must still get one of the 8 slots.
    const generic = Array.from({ length: 8 }, (_, i) =>
      candidate({ keyword: `generic${i}`, growth_rate: 100 - i, category_hint: [] })
    );
    const travel = candidate({ keyword: 'da-lat', growth_rate: 0.1, category_hint: ['du_lich'] });
    const result = selectDeepCrawlTopics([...generic, travel]);
    expect(result).toContain('da-lat');
    expect(result).toHaveLength(8);
  });

  it('fills remaining slots up to 8 by growth_rate after the per-category floor', () => {
    const finance1 = candidate({ keyword: 'f1', growth_rate: 10, category_hint: ['tai_chinh'] });
    const finance2 = candidate({ keyword: 'f2', growth_rate: 9, category_hint: ['tai_chinh'] });
    const generic = Array.from({ length: 5 }, (_, i) =>
      candidate({ keyword: `generic${i}`, growth_rate: 8 - i, category_hint: [] })
    );
    const result = selectDeepCrawlTopics([finance1, finance2, ...generic]);
    expect(result).toHaveLength(7); // 2 finance + 5 generic, total shortlisted < 8
    expect(result).toEqual(expect.arrayContaining(['f1', 'f2', 'generic0', 'generic1', 'generic2', 'generic3', 'generic4']));
  });

  it('caps at 8 total even when more than 8 shortlisted candidates exist', () => {
    const generic = Array.from({ length: 12 }, (_, i) =>
      candidate({ keyword: `generic${i}`, growth_rate: 12 - i, category_hint: [] })
    );
    const result = selectDeepCrawlTopics(generic);
    expect(result).toHaveLength(8);
    expect(result).toEqual(['generic0', 'generic1', 'generic2', 'generic3', 'generic4', 'generic5', 'generic6', 'generic7']);
  });

  it('returns an empty array when nothing is shortlisted', () => {
    const result = selectDeepCrawlTopics([candidate({ is_shortlisted: false })]);
    expect(result).toEqual([]);
  });
});
