create table if not exists facebook_page_data (
  id uuid primary key default gen_random_uuid(),
  page_url text not null,
  category text not null check (category in ('tai_chinh', 'giai_tri', 'du_lich')),
  date date not null,
  post_url text not null,
  text_content text not null default '',
  like_count integer,
  comment_count integer,
  share_count integer,
  posted_at timestamptz,
  fetched_at timestamptz not null default now(),
  unique (page_url, post_url)
);

create index if not exists facebook_page_data_date_idx
  on facebook_page_data (date);

alter table facebook_page_data enable row level security;
