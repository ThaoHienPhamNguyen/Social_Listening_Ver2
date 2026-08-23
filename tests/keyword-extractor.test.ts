import { describe, it, expect } from 'vitest';
import { extractKeywords } from '../src/lib/keyword-extractor';

describe('extractKeywords', () => {
  it('splits text into 2-word phrases only, lowercased — no standalone single words', () => {
    const result = extractKeywords('Giá vàng tăng mạnh');
    expect(result).toEqual(['giá vàng', 'vàng tăng', 'tăng mạnh']);
  });

  it('removes Vietnamese stop words before pairing', () => {
    const result = extractKeywords('vàng và bạc');
    expect(result).not.toContain('và');
    expect(result.some((k) => k.includes('và '))).toBe(false);
  });

  it('drops words with 2 characters or fewer before pairing', () => {
    const result = extractKeywords('đi ra ngoài trời');
    expect(result).toEqual(['ngoài trời']);
  });

  it('strips punctuation before tokenizing', () => {
    const result = extractKeywords('Bitcoin, Ethereum: tăng giá!');
    expect(result).toContain('bitcoin ethereum');
    expect(result).toContain('ethereum tăng');
    expect(result).toContain('tăng giá');
  });

  it('produces no keywords when fewer than 2 meaningful words remain', () => {
    const result = extractKeywords('Bitcoin');
    expect(result).toEqual([]);
  });
});
