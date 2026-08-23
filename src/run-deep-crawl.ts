import { createClient } from '@supabase/supabase-js';
import { getRequiredEnv } from './lib/env';
import { SupabaseCandidateTopicRepository } from './lib/candidate-topic-repository';
import { SupabaseTopicSocialDataRepository } from './lib/topic-social-data-repository';
import { ApifyThreadsSearchClient } from './lib/apify-threads-client';
import { runDeepCrawl } from './deep-crawl';

async function main() {
  const client = createClient(getRequiredEnv('SUPABASE_URL'), getRequiredEnv('SUPABASE_SERVICE_KEY'));
  const candidateRepo = new SupabaseCandidateTopicRepository(client);
  const socialRepo = new SupabaseTopicSocialDataRepository(client);
  const apifyClient = new ApifyThreadsSearchClient(getRequiredEnv('APIFY_TOKEN'));

  const result = await runDeepCrawl({ candidateRepo, socialRepo, client: apifyClient });

  if (result.skipped) {
    console.log('Deep-crawl already ran today — skipped.');
    return;
  }

  console.log(`topicsSelected=${result.topicsSelected} postsUpserted=${result.postsUpserted} errors=${result.errors.length}`);
  if (result.errors.length > 0) {
    result.errors.forEach((e) => console.error(`  - ${e}`));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
