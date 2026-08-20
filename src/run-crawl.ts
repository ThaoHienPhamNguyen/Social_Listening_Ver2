import { createClient } from '@supabase/supabase-js';
import { getRequiredEnv } from './lib/env';
import { SupabaseArticleRepository } from './lib/article-repository';
import { DefaultContentExtractor } from './lib/article-extractor';
import { crawlPendingArticles } from './crawl-content';

async function main() {
  const client = createClient(getRequiredEnv('SUPABASE_URL'), getRequiredEnv('SUPABASE_SERVICE_KEY'));
  const repo = new SupabaseArticleRepository(client);
  const extractor = new DefaultContentExtractor();

  const result = await crawlPendingArticles({ repo, extractor });
  console.log(`processed=${result.processed} succeeded=${result.succeeded} failed=${result.failed}`);

  if (result.failed > 0 && result.succeeded === 0 && result.processed > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
