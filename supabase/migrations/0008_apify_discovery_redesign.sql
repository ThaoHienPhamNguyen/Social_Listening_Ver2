-- Threads and Facebook become independent discovery sources — widen the
-- source check constraint accordingly (spec §6).
alter table candidate_topics drop constraint candidate_topics_source_check;
alter table candidate_topics add constraint candidate_topics_source_check
  check (source in ('google_trends', 'youtube', 'rss', 'threads', 'facebook'));

-- facebook_page_data now stores self-extracted keywords per post (same
-- shape topic_social_data already has) instead of only page/category — a
-- post can yield 2-3 keywords, so the same post_url can legitimately repeat
-- under different keyword values. Existing rows get keyword = null (no
-- extracted-keyword data exists for historical rows); every future write
-- always supplies it.
alter table facebook_page_data add column keyword text;
alter table facebook_page_data drop constraint facebook_page_data_page_url_post_url_key;
alter table facebook_page_data add constraint facebook_page_data_page_url_keyword_post_url_key
  unique (page_url, keyword, post_url);

-- Sentiment classification is discontinued (spec §2 point 5) — drop the
-- columns it wrote. Historical sentiment values are not migrated anywhere;
-- this is a deliberate deletion, not an archive.
alter table topic_social_data drop column sentiment;
alter table facebook_page_data drop column sentiment;
