import type { Article } from '../lib/types';

export function ArticlesSection({ articles }: { articles: Article[] }) {
  if (articles.length === 0) {
    return (
      <section className="bg-surface border border-line rounded-card shadow-card p-6">
        <h2 className="text-base font-bold text-ink mb-2">Bài báo gần đây</h2>
        <p className="text-sm text-ink-3">Chưa có bài báo nào.</p>
      </section>
    );
  }
  return (
    <section className="bg-surface border border-line rounded-card shadow-card p-6">
      <h2 className="text-base font-bold text-ink mb-4">Bài báo gần đây</h2>
      <ul className="space-y-1">
        {articles.map((a) => (
          <li key={a.id} className="px-3 py-2 rounded-[10px] hover:bg-muted transition-colors">
            <a
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-ink hover:text-brand"
            >
              {a.title}
            </a>
            {a.published_at && (
              <span className="text-xs text-ink-3 ml-2">
                {new Date(a.published_at).toLocaleDateString('vi-VN')}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
