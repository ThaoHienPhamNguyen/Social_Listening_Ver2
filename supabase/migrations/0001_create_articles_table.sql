create table if not exists articles (
  id uuid primary key default gen_random_uuid(),
  url text not null unique,
  title text not null,
  published_at timestamptz,
  source_id text not null,
  categories text[] not null default '{}',
  snippet text not null default '',
  full_content text,
  content_fetch_status text not null default 'pending'
    check (content_fetch_status in ('pending', 'done', 'failed')),
  fetch_attempts integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists articles_content_fetch_status_idx
  on articles (content_fetch_status);

create index if not exists articles_categories_idx
  on articles using gin (categories);
