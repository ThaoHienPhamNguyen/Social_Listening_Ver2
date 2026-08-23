import type { Category } from '../types';

export interface FacebookSeedPage {
  url: string;
  category: Category;
}

// Hard-coded seed list, deliberately over-provisioned (2 pages/category) to
// survive the per-page unreliability measured during 2b's pricing spike
// (2/3 test pages failed with "not_available"/"no_items"). Each page is
// picked to be thematically focused on its category (not a general news
// outlet posting a mix of everything) so the per-page category label is
// meaningfully accurate — see the design spec §2/§3 and the schema doc's
// "Known gaps" note on category being per-Page, not per-post.
//
// To scale up later (more pages, or raise MAX_POSTS_PER_PAGE in
// apify-facebook-client.ts), just edit this array/constant — no
// architecture change needed. See design spec §5.
export const FACEBOOK_SEED_PAGES: FacebookSeedPage[] = [
  { url: 'https://www.facebook.com/cafef.vn', category: 'tai_chinh' },
  { url: 'https://www.facebook.com/vneconomy.vn', category: 'tai_chinh' },
  { url: 'https://www.facebook.com/kenh14', category: 'giai_tri' },
  { url: 'https://www.facebook.com/Saostar.vn', category: 'giai_tri' },
  { url: 'https://www.facebook.com/vietravel', category: 'du_lich' },
  { url: 'https://www.facebook.com/klook.vietnam', category: 'du_lich' },
];
