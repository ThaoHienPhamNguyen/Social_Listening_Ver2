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
