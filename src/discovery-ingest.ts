import type { DiscoverySource } from './lib/discovery-source';
import type { CandidateTopicRepository } from './lib/candidate-topic-repository';
import type { CandidateTopic } from './types';
import { matchCategories } from './lib/match-categories';

export interface DiscoveryIngestDeps {
  repo: CandidateTopicRepository;
  now?: () => Date;
}

export interface DiscoveryIngestResult {
  source: string;
  fetched: number;
  upserted: number;
  errors: string[];
}

// One upsert call per chunk instead of one per candidate. Each source is
// already capped to ~200 candidates (aggregate-rss-keywords.ts,
// aggregate-youtube-keywords.ts), so this is normally a single call — the
// chunking is a safety net for any source that isn't capped (e.g. Google
// Trends, whose own upstream response size isn't under this codebase's control).
const UPSERT_CHUNK_SIZE = 200;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export async function ingestDiscoverySource(
  source: DiscoverySource,
  deps: DiscoveryIngestDeps
): Promise<DiscoveryIngestResult> {
  const now = deps.now ?? (() => new Date());
  const result: DiscoveryIngestResult = { source: source.name, fetched: 0, upserted: 0, errors: [] };
  const date = now().toISOString().slice(0, 10);

  let candidates;
  try {
    candidates = await source.fetchCandidates();
  } catch (err) {
    result.errors.push(`fetch failed: ${(err as Error).message}`);
    return result;
  }

  result.fetched = candidates.length;

  const rows: Partial<CandidateTopic>[] = candidates.map((candidate) => ({
    source: source.name,
    keyword: candidate.keyword,
    date,
    metric_value: candidate.metric_value,
    growth_rate: candidate.growth_rate,
    category_hint: matchCategories(candidate.keyword),
    is_shortlisted: false,
  }));

  for (const batch of chunk(rows, UPSERT_CHUNK_SIZE)) {
    const { error, count } = await deps.repo.upsertCandidates(batch);
    if (error) {
      result.errors.push(`batch upsert failed for ${batch.length} candidate(s): ${error}`);
    } else {
      result.upserted += count;
    }
  }

  return result;
}

export async function ingestAllDiscoverySources(
  sources: DiscoverySource[],
  deps: DiscoveryIngestDeps
): Promise<DiscoveryIngestResult[]> {
  const results: DiscoveryIngestResult[] = [];
  for (const source of sources) {
    results.push(await ingestDiscoverySource(source, deps));
  }
  return results;
}
