// dashboard/lib/types.ts
// Mirrors the shapes of the root ingestion project's src/types.ts, trimmed
// to the fields this dashboard actually reads.

export type DiscoverySourceName = 'google_trends' | 'youtube' | 'rss';

export interface CandidateTopic {
  id: string;
  source: DiscoverySourceName;
  keyword: string;
  date: string;
  metric_value: number;
  growth_rate: number | null;
  category_hint: string[];
  is_shortlisted: boolean;
}

export interface Article {
  id: string;
  url: string;
  title: string;
  published_at: string | null;
  source_id: string;
  categories: string[];
  snippet: string;
}

export type SentimentLabel = 'positive' | 'negative' | 'neutral';

export interface ThreadsEngagementDaily {
  date: string;
  keyword: string;
  category: string | null;
  total_like_count: number;
  total_reply_count: number;
  total_repost_count: number;
  total_quote_count: number;
  total_share_count: number;
  total_view_count: number;
  post_count: number;
}

export interface FacebookEngagementDaily {
  date: string;
  category: string;
  total_like_count: number;
  total_comment_count: number;
  total_share_count: number;
  post_count: number;
}
