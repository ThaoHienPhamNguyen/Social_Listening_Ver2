import { createClient } from '@supabase/supabase-js';
import { getRequiredEnv } from './lib/env';
import { SupabaseFacebookPageDataRepository } from './lib/facebook-page-data-repository';
import { ApifyFacebookPageScrapeClient } from './lib/apify-facebook-client';
import { runDeepCrawlFacebook } from './deep-crawl-facebook';

async function main() {
  const client = createClient(getRequiredEnv('SUPABASE_URL'), getRequiredEnv('SUPABASE_SERVICE_KEY'));
  const socialRepo = new SupabaseFacebookPageDataRepository(client);
  const apifyClient = new ApifyFacebookPageScrapeClient(getRequiredEnv('APIFY_TOKEN'));

  const result = await runDeepCrawlFacebook({ socialRepo, client: apifyClient });

  if (result.skipped) {
    console.log('Facebook deep-crawl already ran today — skipped.');
    return;
  }

  console.log(
    `pagesAttempted=${result.pagesAttempted} postsUpserted=${result.postsUpserted} errors=${result.errors.length}`
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
