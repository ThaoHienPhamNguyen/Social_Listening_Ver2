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

  it('extracts a run of capitalized words as one named-entity phrase, lowercased', () => {
    const result = extractKeywords('Nhiều công trình APEC 2027 ở Phú Quốc đang vượt tiến độ');
    expect(result).toContain('apec 2027');
    expect(result).toContain('phú quốc');
  });

  it('extracts a single capitalized proper noun even though standalone generic words are dropped', () => {
    const result = extractKeywords('Chu kỳ sản phẩm mới của Apple mang lại gì');
    expect(result).toContain('apple');
  });

  it('lets a digit continue an already-started capitalized run but never start one', () => {
    const result = extractKeywords('Sự kiện ra mắt Toyota Camry 2024 diễn ra hôm 9-9');
    expect(result).toContain('toyota camry 2024');
    expect(result).not.toContain('9 9');
  });

  it('never lets the first word of a clause start or extend a named-entity phrase', () => {
    // "Chung" is capitalized only because it opens the sentence — "chung cư"
    // (apartment) is an ordinary noun, not a name.
    const result = extractKeywords('Chung cư có thời hạn sử dụng theo niên hạn công trình');
    expect(result).not.toContain('chung');
  });

  it('treats each clause (split on . ! ? : ;) as its own sentence start', () => {
    const result = extractKeywords('Chứng khoán 22-9: Câu chuyện nâng hạng hạ nhiệt');
    expect(result).not.toContain('câu');
    expect(result).not.toContain('chứng');
  });

  it('still returns the generic bigrams alongside any named-entity phrases found', () => {
    const result = extractKeywords('Novaland chào bán cổ phiếu tỉ lệ 3:1');
    expect(result).toContain('novaland chào');
  });
});
