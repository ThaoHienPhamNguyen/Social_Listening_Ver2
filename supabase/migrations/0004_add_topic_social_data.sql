create table if not exists topic_social_data (
  id uuid primary key default gen_random_uuid(),
  keyword text not null,
  source text not null check (source in ('threads')),
  date date not null,
  post_url text not null,
  text_content text not null default '',
  like_count integer,
  reply_count integer,
  repost_count integer,
  quote_count integer,
  share_count integer,
  view_count integer,
  posted_at timestamptz,
  fetched_at timestamptz not null default now(),
  unique (source, keyword, post_url)
);

create index if not exists topic_social_data_date_idx
  on topic_social_data (date);

alter table topic_social_data enable row level security;
