import { createClient } from '@supabase/supabase-js';
import { getRequiredEnv } from './lib/env';
import { SupabaseCandidateTopicRepository } from './lib/candidate-topic-repository';
import { SupabaseTopicArticleDataRepository } from './lib/topic-article-data-repository';
import { SupabaseTopicSocialDataRepository } from './lib/topic-social-data-repository';
import { OpenAiTopicSummarizer } from './lib/topic-summarizer';
import { summarizeTopics } from './summarize-topics';

async function main() {
  const client = createClient(getRequiredEnv('SUPABASE_URL'), getRequiredEnv('SUPABASE_SERVICE_KEY'));
  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    console.log('OPENAI_API_KEY not set — skipping topic summarization.');
    return;
  }

  const result = await summarizeTopics({
    candidateRepo: new SupabaseCandidateTopicRepository(client),
    articleLinkRepo: new SupabaseTopicArticleDataRepository(client),
    socialRepo: new SupabaseTopicSocialDataRepository(client),
    summarizer: new OpenAiTopicSummarizer(openaiApiKey),
  });

  console.log(`evaluated=${result.evaluated} summarized=${result.summarized} errors=${result.errors.length}`);
  if (result.errors.length > 0) {
    result.errors.forEach((e) => console.error(`  - ${e}`));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
