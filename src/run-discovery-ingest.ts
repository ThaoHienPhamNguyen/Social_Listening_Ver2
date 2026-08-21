import { createClient } from '@supabase/supabase-js';
import { getRequiredEnv } from './lib/env';
import { SupabaseCandidateTopicRepository } from './lib/candidate-topic-repository';
import { SupabaseArticleRepository } from './lib/article-repository';
import { GoogleTrendsSource } from './lib/google-trends-source';
import { YouTubeTrendingSource } from './lib/youtube-source';
import { RssTopicSource } from './lib/rss-topic-source';
import { ingestAllDiscoverySources } from './discovery-ingest';

async function main() {
  const client = createClient(getRequiredEnv('SUPABASE_URL'), getRequiredEnv('SUPABASE_SERVICE_KEY'));
  const repo = new SupabaseCandidateTopicRepository(client);
  const articleRepo = new SupabaseArticleRepository(client);

  const sources = [
    new GoogleTrendsSource(),
    new YouTubeTrendingSource(getRequiredEnv('YOUTUBE_API_KEY')),
    new RssTopicSource(articleRepo),
  ];

  const results = await ingestAllDiscoverySources(sources, { repo });

  let hasErrors = false;
  for (const r of results) {
    console.log(`[${r.source}] fetched=${r.fetched} upserted=${r.upserted} errors=${r.errors.length}`);
    if (r.errors.length > 0) {
      hasErrors = true;
      r.errors.forEach((e) => console.error(`  - ${e}`));
    }
  }

  if (hasErrors) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
