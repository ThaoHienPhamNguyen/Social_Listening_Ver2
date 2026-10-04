import { describe, it, expect } from 'vitest';
import { parseSummaryResponse } from '../src/lib/topic-summarizer';

describe('parseSummaryResponse', () => {
  it('parses a valid response into a positional array of summaries', () => {
    const content = JSON.stringify({ '0': 'Giá vàng tăng do nhu cầu trú ẩn.', '1': 'Ngân hàng siết room tín dụng.' });
    expect(parseSummaryResponse(content, 2)).toEqual([
      'Giá vàng tăng do nhu cầu trú ẩn.',
      'Ngân hàng siết room tín dụng.',
    ]);
  });

  it('throws on empty content', () => {
    expect(() => parseSummaryResponse('', 2)).toThrow('Topic summarization returned empty content');
  });

  it('throws on unparseable JSON', () => {
    expect(() => parseSummaryResponse('not json', 2)).toThrow();
  });

  it('throws when no index key is usable for any topic', () => {
    const content = JSON.stringify({ foo: 'bar' });
    expect(() => parseSummaryResponse(content, 2)).toThrow('no usable entries');
  });

  it('throws when a key is a 1-indexed, out-of-range position (model indexed from 1 instead of 0)', () => {
    const content = JSON.stringify({ '1': 'a', '2': 'b' });
    expect(() => parseSummaryResponse(content, 2)).toThrow('out-of-range index key');
  });

  it('nulls out only the malformed index, leaving the others intact', () => {
    const content = JSON.stringify({ '0': 'Tóm tắt hợp lệ.', '1': 42, '2': 'Tóm tắt khác.' });
    expect(parseSummaryResponse(content, 3)).toEqual(['Tóm tắt hợp lệ.', null, 'Tóm tắt khác.']);
  });

  it('treats a blank string value as null', () => {
    const content = JSON.stringify({ '0': '   ' });
    expect(parseSummaryResponse(content, 1)).toEqual([null]);
  });

  it('trims whitespace from a valid summary', () => {
    const content = JSON.stringify({ '0': '  Có khoảng trắng.  ' });
    expect(parseSummaryResponse(content, 1)).toEqual(['Có khoảng trắng.']);
  });
});
