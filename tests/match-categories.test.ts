import { describe, it, expect } from 'vitest';
import { matchCategories } from '../src/lib/match-categories';

describe('matchCategories', () => {
  it('returns matching categories based on keyword content', () => {
    expect(matchCategories('giá vàng và chứng khoán')).toEqual(['tai_chinh']);
  });

  it('returns an empty array when no keyword matches', () => {
    expect(matchCategories('một cụm từ ngẫu nhiên không liên quan')).toEqual([]);
  });

  it('returns multiple categories when text matches more than one', () => {
    const result = matchCategories('ngân hàng tài trợ tour du lịch');
    expect(result.sort()).toEqual(['du_lich', 'tai_chinh'].sort());
  });
});
