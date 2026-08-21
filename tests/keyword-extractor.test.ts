import { describe, it, expect } from 'vitest';
import { extractKeywords } from '../src/lib/keyword-extractor';

describe('extractKeywords', () => {
  it('splits text into single words and 2-word phrases, lowercased', () => {
    const result = extractKeywords('Giá vàng tăng mạnh');
    expect(result).toContain('giá');
    expect(result).toContain('giá vàng');
    expect(result).toContain('vàng');
    expect(result).toContain('mạnh');
  });

  it('removes Vietnamese stop words', () => {
    const result = extractKeywords('vàng và bạc');
    expect(result).not.toContain('và');
  });

  it('drops words with 2 characters or fewer', () => {
    const result = extractKeywords('đi ra ngoài');
    expect(result).toContain('ngoài');
    expect(result).not.toContain('đi');
    expect(result).not.toContain('ra');
  });

  it('strips punctuation before tokenizing', () => {
    const result = extractKeywords('Bitcoin, Ethereum: tăng giá!');
    expect(result).toContain('bitcoin');
    expect(result).toContain('ethereum');
    expect(result).toContain('giá');
  });
});
