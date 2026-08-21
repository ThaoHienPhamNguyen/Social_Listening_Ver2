import { createClient } from '@supabase/supabase-js';
import { getRequiredEnv } from './lib/env';
import { SupabaseCandidateTopicRepository } from './lib/candidate-topic-repository';
import { rankAndSelect } from './rank-and-select';

async function main() {
  const client = createClient(getRequiredEnv('SUPABASE_URL'), getRequiredEnv('SUPABASE_SERVICE_KEY'));
  const repo = new SupabaseCandidateTopicRepository(client);

  const result = await rankAndSelect({ repo });
  console.log(`evaluated=${result.evaluated} shortlisted=${result.shortlisted}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
