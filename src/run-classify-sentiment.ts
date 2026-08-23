import { createClient } from '@supabase/supabase-js';
import { getRequiredEnv } from './lib/env';
import { SupabaseTopicSocialDataRepository } from './lib/topic-social-data-repository';
import { SupabaseFacebookPageDataRepository } from './lib/facebook-page-data-repository';
import { OpenAiSentimentClassifier } from './lib/openai-sentiment-classifier';
import { runClassifySentiment } from './classify-sentiment';

async function main() {
  // Optional secret, matching run-discovery-ingest.ts's existing convention
  // for OPENAI_API_KEY: skip gracefully rather than fail the whole job if
  // it's not set, since it's not required for the other jobs in this workflow.
  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    console.log('OPENAI_API_KEY not set — skipping sentiment classification');
    return;
  }

  const client = createClient(getRequiredEnv('SUPABASE_URL'), getRequiredEnv('SUPABASE_SERVICE_KEY'));
  const threadsRepo = new SupabaseTopicSocialDataRepository(client);
  const facebookRepo = new SupabaseFacebookPageDataRepository(client);
  const classifier = new OpenAiSentimentClassifier(openaiApiKey);

  const result = await runClassifySentiment({ threadsRepo, facebookRepo, classifier });

  console.log(`classified=${result.classified} errors=${result.errors.length}`);
  if (result.errors.length > 0) {
    result.errors.forEach((e) => console.error(`  - ${e}`));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
