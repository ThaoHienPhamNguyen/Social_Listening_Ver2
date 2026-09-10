import type { Category } from '../types';

export interface FacebookSeedGroup {
  url: string;
  category: Category;
}

// Community discussion groups, verified live + on-topic via real Apify
// calls during this feature's spec work (2026-09-04) — see design spec §5.1.
// giai_tri has only 1 verified group (the 2nd candidate tested, "Bí Mật
// Showbiz", returned not_available — locked, a known real-world failure
// mode for large VN groups, not a bug). Add a 2nd giai_tri group here when
// one is found; no architecture change needed (spec §9).
export const FACEBOOK_SEED_GROUPS: FacebookSeedGroup[] = [
  { url: 'https://www.facebook.com/groups/1978945002151603/', category: 'tai_chinh' }, // Cộng Đồng Chứng Khoán Việt Nam
  { url: 'https://www.facebook.com/groups/vnsic89/', category: 'tai_chinh' },           // VNSIC - Cộng Đồng Đầu Tư Chứng Khoán
  { url: 'https://www.facebook.com/groups/honghotshowbiz/', category: 'giai_tri' },     // Hóng hớt showbiz - 8 chuyện thiên hạ
  { url: 'https://www.facebook.com/groups/phuotluon/', category: 'du_lich' },           // Phượt Luôn
  { url: 'https://www.facebook.com/groups/YAN.VietNamOi/', category: 'du_lich' },       // Việt Nam Ơi (group)
];
