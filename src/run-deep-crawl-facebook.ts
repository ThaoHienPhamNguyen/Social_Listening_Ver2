import { createClient } from '@supabase/supabase-js';
import { getRequiredEnv } from './lib/env';
import { SupabaseFacebookPageDataRepository } from './lib/facebook-page-data-repository';
import { SupabaseCandidateTopicRepository } from './lib/candidate-topic-repository';
import { ApifyFacebookPageScrapeClient } from './lib/apify-facebook-client';
import { ApifyFacebookGroupsScrapeClient } from './lib/apify-facebook-groups-client';
import { runDeepCrawlFacebook } from './deep-crawl-facebook';

async function main() {
  const client = createClient(getRequiredEnv('SUPABASE_URL'), getRequiredEnv('SUPABASE_SERVICE_KEY'));
  const socialRepo = new SupabaseFacebookPageDataRepository(client);
  const candidateRepo = new SupabaseCandidateTopicRepository(client);
  const apifyToken = getRequiredEnv('APIFY_TOKEN');
  const groupsClient = new ApifyFacebookGroupsScrapeClient(apifyToken);
  const pagesClient = new ApifyFacebookPageScrapeClient(apifyToken);

  const result = await runDeepCrawlFacebook({ socialRepo, candidateRepo, groupsClient, pagesClient });

  if (result.skipped) {
    console.log('Facebook deep-crawl already ran today — skipped.');
    return;
  }

  console.log(
    `seedsAttempted=${result.seedsAttempted} candidatesUpserted=${result.candidatesUpserted} postsUpserted=${result.postsUpserted} errors=${result.errors.length}`
  );
  if (result.errors.length > 0) {
    result.errors.forEach((e) => console.error(`  - ${e}`));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
