import { describe, it, expect } from 'vitest';
import { categorize } from '../src/lib/categorize';

describe('categorize', () => {
  it('always includes the feed default category, even with no keyword match', () => {
    const result = categorize('du_lich', 'Một bài viết chung chung không liên quan gì đặc biệt');
    expect(result).toEqual(['du_lich']);
  });

  it('adds a keyword-matched category on top of the default', () => {
    const result = categorize('giai_tri', 'Ca sĩ ra mắt MV mới trong dịp lễ');
    expect(result.sort()).toEqual(['giai_tri'].sort());
  });

  it("supports multi-category when text matches a different category's keywords", () => {
    const result = categorize('du_lich', 'Ngân hàng tài trợ tour du lịch giá rẻ cho khách hàng');
    expect(result.sort()).toEqual(['du_lich', 'tai_chinh'].sort());
  });

  it("does not duplicate the default category when it also keyword-matches", () => {
    const result = categorize('tai_chinh', 'Cổ phiếu ngân hàng tăng mạnh phiên hôm nay');
    expect(result).toEqual(['tai_chinh']);
  });
});
