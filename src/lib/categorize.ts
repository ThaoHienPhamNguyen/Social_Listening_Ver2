import { categoryKeywords } from '../../config/categories.config';

export function categorize(defaultCategory: string, text: string): string[] {
  const categories = new Set<string>([defaultCategory]);
  const lower = text.toLowerCase();

  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    if (keywords.some((kw) => lower.includes(kw.toLowerCase()))) {
      categories.add(category);
    }
  }

  return Array.from(categories);
}
