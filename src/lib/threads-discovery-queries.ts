import type { Category } from '../types';

// Broad category-level search terms Threads is searched with, instead of a
// specific pre-selected keyword — see design spec §4. Fixed list, sewable
// to edit later without any architecture change (same convention as
// FACEBOOK_SEED_GROUPS/FACEBOOK_SEED_PAGES).
export const THREADS_DISCOVERY_QUERIES: Record<Category, string[]> = {
  tai_chinh: ['chứng khoán', 'ngân hàng'],
  giai_tri: ['showbiz', 'phim chiếu rạp'],
  du_lich: ['du lịch', 'vé máy bay'],
};
