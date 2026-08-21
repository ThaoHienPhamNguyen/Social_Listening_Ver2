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

  // The workflow runs discovery-ingest -> rank-and-select up to 3x/day, all
  // writing the same `date`. A keyword that reappears in a later run's fetch
  // must not lose what an earlier run's rank-and-select already computed for
  // it that day. Supabase/PostgREST's upsert only touches the columns present
  // in the payload on conflict (leaves the rest of the row alone) — so
  // `growth_rate` is included only when the source supplies one directly
  // (e.g. Google Trends, which is fresh every fetch and safe to overwrite),
  // and `is_shortlisted` is never included here at all, since only
  // rank-and-select is allowed to set it.
  const rows: Partial<CandidateTopic>[] = candidates.map((candidate) => {
    const row: Partial<CandidateTopic> = {
      source: source.name,
      keyword: candidate.keyword,
      date,
      metric_value: candidate.metric_value,
      category_hint: matchCategories(candidate.keyword),
    };
    if (candidate.growth_rate !== null) {
      row.growth_rate = candidate.growth_rate;
    }
    return row;
  });

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
