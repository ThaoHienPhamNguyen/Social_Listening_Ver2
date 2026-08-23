create table if not exists threads_engagement_daily (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  keyword text not null,
  category text,
  total_like_count integer not null default 0,
  total_reply_count integer not null default 0,
  total_repost_count integer not null default 0,
  total_quote_count integer not null default 0,
  total_share_count integer not null default 0,
  total_view_count integer not null default 0,
  post_count integer not null default 0,
  computed_at timestamptz not null default now(),
  unique (date, keyword)
);

create table if not exists facebook_engagement_daily (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  category text not null check (category in ('tai_chinh', 'giai_tri', 'du_lich')),
  total_like_count integer not null default 0,
  total_comment_count integer not null default 0,
  total_share_count integer not null default 0,
  post_count integer not null default 0,
  computed_at timestamptz not null default now(),
  unique (date, category)
);

create index if not exists threads_engagement_daily_date_idx
  on threads_engagement_daily (date);

create index if not exists facebook_engagement_daily_date_idx
  on facebook_engagement_daily (date);

alter table threads_engagement_daily enable row level security;
alter table facebook_engagement_daily enable row level security;
