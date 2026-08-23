import { describe, it, expect } from 'vitest';
import { FACEBOOK_SEED_PAGES } from '../src/lib/facebook-seed-pages';

describe('FACEBOOK_SEED_PAGES', () => {
  it('has exactly 6 pages, 2 per category', () => {
    expect(FACEBOOK_SEED_PAGES).toHaveLength(6);
    const byCategory = { tai_chinh: 0, giai_tri: 0, du_lich: 0 };
    for (const page of FACEBOOK_SEED_PAGES) {
      byCategory[page.category]++;
    }
    expect(byCategory).toEqual({ tai_chinh: 2, giai_tri: 2, du_lich: 2 });
  });

  it('has no duplicate page URLs', () => {
    const urls = FACEBOOK_SEED_PAGES.map((p) => p.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('every URL is a facebook.com URL', () => {
    for (const page of FACEBOOK_SEED_PAGES) {
      expect(page.url).toMatch(/^https:\/\/www\.facebook\.com\//);
    }
  });
});
