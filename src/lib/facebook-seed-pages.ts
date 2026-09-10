import type { Category } from '../types';

export interface FacebookSeedPage {
  url: string;
  category: Category;
}

// Deliberate exception to the group-based model in facebook-seed-groups.ts
// — VTV24 is a Page, not a community group, kept at the user's explicit
// request for its reach (4.7M likes) despite being general/mixed news, not
// tai_chinh-specific content (only 1/5 sampled posts was finance-related
// when verified live 2026-09-04). Keywords extracted from it will legitimately
// include non-finance topics — not a bug, see design spec §5.1b.
export const FACEBOOK_SEED_PAGES: FacebookSeedPage[] = [
  { url: 'https://www.facebook.com/tintucvtv24/', category: 'tai_chinh' }, // Trung tâm Tin tức VTV24
];
