import { describe, it, expect } from 'vitest';
import { parseTopicsResponse } from '../src/lib/topic-extractor';

describe('parseTopicsResponse', () => {
  it('parses a valid response into a positional string[][]', () => {
    const content = JSON.stringify({
      '0': ['novaland', 'chào bán cổ phiếu'],
      '1': ['niên hạn công trình'],
    });

    const result = parseTopicsResponse(content, 2);

    expect(result).toEqual([['novaland', 'chào bán cổ phiếu'], ['niên hạn công trình']]);
  });

  it('throws when content is empty', () => {
    expect(() => parseTopicsResponse('', 2)).toThrow();
  });

  it('throws when the parsed object has no usable entries for any index', () => {
    const content = JSON.stringify({ foo: 'bar' });

    expect(() => parseTopicsResponse(content, 2)).toThrow();
  });

  it('throws when the parsed object is empty', () => {
    expect(() => parseTopicsResponse('{}', 2)).toThrow();
  });

  it('treats a non-array value for one index as empty topics, not a throw, when another index is usable', () => {
    const content = JSON.stringify({ '0': 'novaland', '1': ['niên hạn công trình'] });

    const result = parseTopicsResponse(content, 2);

    expect(result).toEqual([[], ['niên hạn công trình']]);
  });

  it('filters out non-string array elements', () => {
    const content = JSON.stringify({ '0': ['novaland', 42, null, { nested: true }, 'trả nợ'] });

    const result = parseTopicsResponse(content, 1);

    expect(result).toEqual([['novaland', 'trả nợ']]);
  });

  it('trims strings and drops whitespace-only entries', () => {
    const content = JSON.stringify({ '0': ['  novaland  ', '   ', ''] });

    const result = parseTopicsResponse(content, 1);

    expect(result).toEqual([['novaland']]);
  });

  it('lowercases mixed-case input to match the regex fallback convention', () => {
    const content = JSON.stringify({ '0': ['Novaland', 'CHÀO BÁN Cổ Phiếu'] });

    const result = parseTopicsResponse(content, 1);

    expect(result).toEqual([['novaland', 'chào bán cổ phiếu']]);
  });

  it('returns an empty array for an index with no entry at all, when another index is usable', () => {
    const content = JSON.stringify({ '1': ['niên hạn công trình'] });

    const result = parseTopicsResponse(content, 2);

    expect(result).toEqual([[], ['niên hạn công trình']]);
  });
});
