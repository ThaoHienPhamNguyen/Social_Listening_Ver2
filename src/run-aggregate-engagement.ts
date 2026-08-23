import { createClient } from '@supabase/supabase-js';
import { getRequiredEnv } from './lib/env';
import { SupabaseTopicSocialDataRepository } from './lib/topic-social-data-repository';
import { SupabaseFacebookPageDataRepository } from './lib/facebook-page-data-repository';
import { SupabaseCandidateTopicRepository } from './lib/candidate-topic-repository';
import { SupabaseThreadsEngagementDailyRepository } from './lib/threads-engagement-repository';
import { SupabaseFacebookEngagementDailyRepository } from './lib/facebook-engagement-repository';
import { runAggregateEngagement } from './aggregate-engagement';

async function main() {
  const client = createClient(getRequiredEnv('SUPABASE_URL'), getRequiredEnv('SUPABASE_SERVICE_KEY'));
  const threadsSocialRepo = new SupabaseTopicSocialDataRepository(client);
  const facebookSocialRepo = new SupabaseFacebookPageDataRepository(client);
  const candidateRepo = new SupabaseCandidateTopicRepository(client);
  const threadsEngagementRepo = new SupabaseThreadsEngagementDailyRepository(client);
  const facebookEngagementRepo = new SupabaseFacebookEngagementDailyRepository(client);

  const result = await runAggregateEngagement({
    threadsSocialRepo,
    facebookSocialRepo,
    candidateRepo,
    threadsEngagementRepo,
    facebookEngagementRepo,
  });

  console.log(
    `threadsRowsUpserted=${result.threadsRowsUpserted} facebookRowsUpserted=${result.facebookRowsUpserted} errors=${result.errors.length}`
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
