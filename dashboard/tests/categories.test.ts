import { describe, it, expect } from 'vitest';
import { CATEGORIES, getCategoryBySlug } from '../lib/categories';

describe('CATEGORIES', () => {
  it('has exactly the 3 sectors with their DB category values', () => {
    expect(CATEGORIES).toEqual([
      { slug: 'tai-chinh', value: 'tai_chinh', label: 'Tài chính', color: '#16a34a' },
      { slug: 'giai-tri', value: 'giai_tri', label: 'Giải trí', color: '#af006e' },
      { slug: 'du-lich', value: 'du_lich', label: 'Du lịch', color: '#3b82f6' },
    ]);
  });
});

describe('getCategoryBySlug', () => {
  it('returns the matching category for a known slug', () => {
    expect(getCategoryBySlug('tai-chinh')?.value).toBe('tai_chinh');
  });

  it('returns undefined for an unknown slug', () => {
    expect(getCategoryBySlug('not-a-real-slug')).toBeUndefined();
  });
});
