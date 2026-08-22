import type { Category } from '../src/types';

export const categoryKeywords: Record<Category, string[]> = {
  tai_chinh: [
    'chứng khoán', 'ngân hàng', 'lãi suất', 'cổ phiếu', 'tài chính',
    'đầu tư', 'vàng', 'tỷ giá', 'lạm phát', 'gdp', 'doanh nghiệp', 'kinh doanh',
  ],
  giai_tri: [
    'ca sĩ', 'diễn viên', 'phim', 'showbiz', 'âm nhạc', 'nghệ sĩ',
    'hoa hậu', 'concert', 'mv', 'chương trình truyền hình',
  ],
  du_lich: [
    'du lịch', 'tour', 'khách sạn', 'resort', 'điểm đến', 'vé máy bay',
    'homestay', 'phượt', 'check in', 'lữ hành',
  ],
};

// Curated by hand — 2 broad/representative terms per category, used to
// actively query YouTube search.list (100 quota units/call) instead of only
// waiting for a keyword to show up in generic trending. Kept small and
// separate from categoryKeywords above (which is used for substring
// matching, not search queries) to bound daily quota cost: 2 seeds × 3
// categories × 101 units (search.list + 1 videos.list stats call) × 3 runs/
// day ≈ 1,818 units/day, well under the 10,000/day default. Review by hand
// if search results for a seed look off-topic — not auto-derived.
export const youtubeSeedKeywords: Record<Category, string[]> = {
  tai_chinh: ['chứng khoán', 'tài chính'],
  giai_tri: ['showbiz', 'âm nhạc'],
  du_lich: ['du lịch', 'tour'],
};
