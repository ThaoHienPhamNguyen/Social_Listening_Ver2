export type ContentFetchStatus = 'pending' | 'done' | 'failed';

export interface Article {
  id?: string;
  url: string;
  title: string;
  published_at: string;
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
  defaultCategory: string;
}

export interface FeedItem {
  link?: string;
  title?: string;
  contentSnippet?: string;
  content?: string;
  isoDate?: string;
}
