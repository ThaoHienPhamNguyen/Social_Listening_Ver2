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
