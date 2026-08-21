import type { Article } from '../lib/types';

export function ArticlesSection({ articles }: { articles: Article[] }) {
  if (articles.length === 0) {
    return (
      <section>
        <h2 className="text-xl font-semibold mb-2">Bài báo gần đây</h2>
        <p className="text-gray-500">Chưa có bài báo nào.</p>
      </section>
    );
  }
  return (
    <section>
      <h2 className="text-xl font-semibold mb-2">Bài báo gần đây</h2>
      <ul className="space-y-2">
        {articles.map((a) => (
          <li key={a.id}>
            <a href={a.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
              {a.title}
            </a>
            {a.published_at && (
              <span className="text-gray-400 text-sm ml-2">
                {new Date(a.published_at).toLocaleDateString('vi-VN')}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
