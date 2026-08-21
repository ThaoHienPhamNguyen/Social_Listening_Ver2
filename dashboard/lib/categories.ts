// DB values are snake_case and must match config/sources.config.ts in the
// root ingestion project — that's what tags candidate_topics.category_hint
// and articles.categories.
export interface CategoryDef {
  slug: string;
  value: 'tai_chinh' | 'giai_tri' | 'du_lich';
  label: string;
  color: string;
}

export const CATEGORIES: CategoryDef[] = [
  { slug: 'tai-chinh', value: 'tai_chinh', label: 'Tài chính', color: '#16a34a' },
  { slug: 'giai-tri', value: 'giai_tri', label: 'Giải trí', color: '#af006e' },
  { slug: 'du-lich', value: 'du_lich', label: 'Du lịch', color: '#3b82f6' },
];

export function getCategoryBySlug(slug: string): CategoryDef | undefined {
  return CATEGORIES.find((c) => c.slug === slug);
}
