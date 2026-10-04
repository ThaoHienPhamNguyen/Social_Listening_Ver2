-- supabase/migrations/0009_topic_summary.sql

-- Stores a short LLM-generated summary of what's actually being said about
-- a shortlisted topic. Null means "not summarized yet" — either the source
-- (google_trends/youtube) has no underlying text to summarize, or the
-- summarization job hasn't run yet / failed for this row.
alter table candidate_topics add column summary text;

-- RSS has no existing link between an extracted keyword and the article(s)
-- that produced it. This captures that mapping the same way
-- topic_social_data already does for Threads (keyword <-> post), so the
-- summarization job can find real source text for an RSS topic.
create table if not exists topic_article_data (
  id uuid primary key default gen_random_uuid(),
  keyword text not null,
  source text not null check (source in ('rss')),
  date date not null,
  article_url text not null,
  article_title text not null,
  article_snippet text not null default '',
  fetched_at timestamptz not null default now(),
  unique (source, keyword, article_url)
);

create index if not exists topic_article_data_date_idx
  on topic_article_data (date);

alter table topic_article_data enable row level security;
