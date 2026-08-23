alter table topic_social_data
  add column sentiment text check (sentiment in ('positive', 'negative', 'neutral'));

alter table facebook_page_data
  add column sentiment text check (sentiment in ('positive', 'negative', 'neutral'));
