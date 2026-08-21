import Link from 'next/link';
import { CATEGORIES } from '../lib/categories';

export function CategoryNav() {
  return (
    <nav className="flex gap-4 mb-6">
      <Link href="/" className="font-medium hover:underline">
        Overview
      </Link>
      {CATEGORIES.map((c) => (
        <Link key={c.slug} href={`/${c.slug}`} style={{ color: c.color }} className="font-medium hover:underline">
          {c.label}
        </Link>
      ))}
    </nav>
  );
}
