import { createClient } from '@supabase/supabase-js';
import { getRequiredEnv } from './lib/env';
import { SupabaseCandidateTopicRepository } from './lib/candidate-topic-repository';
import { SupabaseArticleRepository } from './lib/article-repository';
import { GoogleTrendsSource } from './lib/google-trends-source';
import { YouTubeTrendingSource } from './lib/youtube-source';
import { RssTopicSource } from './lib/rss-topic-source';
import { RealYouTubeSearchClient } from './lib/youtube-search-client';
import { OpenAiCandidateClassifier } from './lib/candidate-classifier';
import type { DiscoverySource } from './lib/discovery-source';
import type { CandidateClassifier } from './lib/candidate-classifier';
import { ingestAllDiscoverySources } from './discovery-ingest';

async function main() {
  const client = createClient(getRequiredEnv('SUPABASE_URL'), getRequiredEnv('SUPABASE_SERVICE_KEY'));
  const repo = new SupabaseCandidateTopicRepository(client);
  const articleRepo = new SupabaseArticleRepository(client);

  const sources: DiscoverySource[] = [new GoogleTrendsSource(), new RssTopicSource(articleRepo)];

  const youtubeApiKey = process.env.YOUTUBE_API_KEY;
  if (youtubeApiKey) {
    sources.push(new YouTubeTrendingSource(youtubeApiKey, new RealYouTubeSearchClient(youtubeApiKey)));
  } else {
    console.error('YOUTUBE_API_KEY not set — skipping YouTube source');
  }

  const openaiApiKey = process.env.OPENAI_API_KEY;
  let classifier: CandidateClassifier | undefined;
  if (openaiApiKey) {
    classifier = new OpenAiCandidateClassifier(openaiApiKey);
  } else {
    console.error('OPENAI_API_KEY not set — skipping LLM classification for unmatched candidates');
  }

  const results = await ingestAllDiscoverySources(sources, { repo, classifier });

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
