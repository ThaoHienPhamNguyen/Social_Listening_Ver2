import type { FacebookSummary } from '../lib/facebook-summary';
import { SentimentBar } from './SentimentBar';

export function FacebookSummarySection({ summary, date }: { summary: FacebookSummary | null; date: string | null }) {
  const heading = date === null ? 'Facebook' : `Facebook (${date})`;

  if (summary === null) {
    return (
      <section className="bg-surface border border-line rounded-card shadow-card p-6 mb-8">
        <h2 className="text-base font-bold text-ink mb-2">{heading}</h2>
        <p className="text-sm text-ink-3">Chưa có dữ liệu Facebook hôm nay.</p>
      </section>
    );
  }

  const total = summary.sentiment.positive + summary.sentiment.negative + summary.sentiment.neutral;

  return (
    <section className="bg-surface border border-line rounded-card shadow-card p-6 mb-8">
      <h2 className="text-base font-bold text-ink mb-4">
        {heading}: {summary.postCount} bài · {summary.totalEngagement.toLocaleString('vi-VN')} tương tác
      </h2>
      {total === 0 ? (
        <p className="text-sm text-ink-3">Chưa phân loại sentiment.</p>
      ) : (
        <>
          <SentimentBar label="Tích cực" count={summary.sentiment.positive} total={total} colorClass="bg-success" />
          <SentimentBar label="Trung lập" count={summary.sentiment.neutral} total={total} colorClass="bg-ink-3" />
          <SentimentBar label="Tiêu cực" count={summary.sentiment.negative} total={total} colorClass="bg-danger" />
        </>
      )}
    </section>
  );
}
