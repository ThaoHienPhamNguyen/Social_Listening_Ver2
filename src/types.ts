export type ContentFetchStatus = 'pending' | 'done' | 'failed';

export type Category = 'tai_chinh' | 'giai_tri' | 'du_lich';

export interface Article {
  id?: string;
  url: string;
  title: string;
  published_at: string | null;
  source_id: string;
  categories: string[];
  snippet: string;
  full_content: string | null;
  content_fetch_status: ContentFetchStatus;
  fetch_attempts: number;
  created_at?: string;
  updated_at?: string;
}

export interface RssSource {
  id: string;
  name: string;
  url: string;
  defaultCategory: Category;
}

export interface FeedItem {
  link?: string;
  title?: string;
  contentSnippet?: string;
  content?: string;
  isoDate?: string;
}

export type DiscoverySourceName = 'google_trends' | 'youtube' | 'rss';

export interface RawCandidate {
  keyword: string;
  metric_value: number;
  growth_rate: number | null;
  // Category already known from the source itself (RSS: the article's real
  // `categories`; YouTube: which seed keyword's category produced this
  // candidate) — bypasses matchCategories()'s substring guessing for these.
  knownCategories?: Category[];
}

export interface CandidateTopic {
  id?: string;
  source: DiscoverySourceName;
  keyword: string;
  date: string;
  metric_value: number;
  growth_rate: number | null;
  category_hint: string[];
  is_shortlisted: boolean;
  created_at?: string;
  updated_at?: string;
}

export type DeepCrawlSourceName = 'threads';

export interface TopicSocialData {
  id?: string;
  keyword: string;
  source: DeepCrawlSourceName;
  date: string;
  post_url: string;
  text_content: string;
  like_count: number | null;
  reply_count: number | null;
  repost_count: number | null;
  quote_count: number | null;
  share_count: number | null;
  view_count: number | null;
  posted_at: string | null;
  fetched_at?: string;
}
