-- Auto-update articles.updated_at on every row update, so it actually
-- reflects reality instead of staying frozen at created_at forever.
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists articles_set_updated_at on articles;

create trigger articles_set_updated_at
  before update on articles
  for each row
  execute function set_updated_at();
