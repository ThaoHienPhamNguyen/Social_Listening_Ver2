import { createClient } from '@supabase/supabase-js';
import { getRequiredEnv } from './lib/env';
import { SupabaseArticleRepository } from './lib/article-repository';
import { RssParserFetcher } from './lib/rss-fetcher';
import { ingestAllSources } from './ingest-rss';
import { sources } from '../config/sources.config';

async function main() {
  const client = createClient(getRequiredEnv('SUPABASE_URL'), getRequiredEnv('SUPABASE_SERVICE_KEY'));
  const repo = new SupabaseArticleRepository(client);
  const fetcher = new RssParserFetcher();

  const results = await ingestAllSources(sources, { fetcher, repo });

  let hasErrors = false;
  for (const r of results) {
    console.log(`[${r.sourceId}] fetched=${r.fetched} upserted=${r.upserted} errors=${r.errors.length}`);
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
