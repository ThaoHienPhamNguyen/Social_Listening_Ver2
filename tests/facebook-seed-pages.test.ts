import { describe, it, expect } from 'vitest';
import { FACEBOOK_SEED_PAGES } from '../src/lib/facebook-seed-pages';

describe('FACEBOOK_SEED_PAGES', () => {
  it('has exactly 1 page (the VTV24 exception), category tai_chinh', () => {
    expect(FACEBOOK_SEED_PAGES).toHaveLength(1);
    expect(FACEBOOK_SEED_PAGES[0]).toMatchObject({ category: 'tai_chinh' });
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
