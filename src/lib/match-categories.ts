import { categoryKeywords } from '../../config/categories.config';

export function matchCategories(text: string): string[] {
  const categories: string[] = [];
  const lower = text.toLowerCase();

  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    if (keywords.some((kw) => lower.includes(kw.toLowerCase()))) {
      categories.push(category);
    }
  }

  return categories;
}
