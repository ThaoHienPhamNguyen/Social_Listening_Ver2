import { describe, it, expect } from 'vitest';
import { fetchAllPages, PAGE_SIZE } from '../lib/paginated-fetch';

function makePage(from: number, to: number, total: number): number[] {
  const page: number[] = [];
  for (let i = from; i <= to && i < total; i++) page.push(i);
  return page;
}

describe('fetchAllPages', () => {
  it('returns everything in one call when the result fits in a single page', async () => {
    const calls: Array<[number, number]> = [];
    const result = await fetchAllPages<number>(async (from, to) => {
      calls.push([from, to]);
      return { data: makePage(from, to, 3), error: null };
    });
    expect(result).toEqual([0, 1, 2]);
    expect(calls).toEqual([[0, PAGE_SIZE - 1]]);
  });

  it('keeps requesting the next page until a short page signals the end', async () => {
    const total = PAGE_SIZE * 2 + 5; // spans 3 pages
    const calls: Array<[number, number]> = [];
    const result = await fetchAllPages<number>(async (from, to) => {
      calls.push([from, to]);
      return { data: makePage(from, to, total), error: null };
    });
    expect(result).toHaveLength(total);
    expect(result[0]).toBe(0);
    expect(result[total - 1]).toBe(total - 1);
    expect(calls).toEqual([
      [0, PAGE_SIZE - 1],
      [PAGE_SIZE, PAGE_SIZE * 2 - 1],
      [PAGE_SIZE * 2, PAGE_SIZE * 3 - 1],
    ]);
  });

  it('stops after exactly one call when the table is empty', async () => {
    const result = await fetchAllPages<number>(async () => ({ data: [], error: null }));
    expect(result).toEqual([]);
  });

  it('throws with the underlying message when a page errors', async () => {
    await expect(
      fetchAllPages<number>(async () => ({ data: null, error: { message: 'boom' } }))
    ).rejects.toThrow('boom');
  });

  it('treats a null data page as empty rather than throwing', async () => {
    const result = await fetchAllPages<number>(async () => ({ data: null, error: null }));
    expect(result).toEqual([]);
  });
});
