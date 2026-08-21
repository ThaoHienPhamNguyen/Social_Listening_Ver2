create table if not exists candidate_topics (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('google_trends', 'youtube', 'rss')),
  keyword text not null,
  date date not null,
  metric_value numeric not null default 0,
  growth_rate numeric,
  category_hint text[] not null default '{}',
  is_shortlisted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, keyword, date)
);

create index if not exists candidate_topics_date_idx
  on candidate_topics (date);

create index if not exists candidate_topics_shortlisted_idx
  on candidate_topics (is_shortlisted);

alter table candidate_topics enable row level security;

create trigger candidate_topics_set_updated_at
  before update on candidate_topics
  for each row
  execute function set_updated_at();
