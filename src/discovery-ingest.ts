import type { DiscoverySource } from './lib/discovery-source';
import type { CandidateTopicRepository } from './lib/candidate-topic-repository';
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

  for (const candidate of candidates) {
    const { error } = await deps.repo.upsertCandidate({
      source: source.name,
      keyword: candidate.keyword,
      date,
      metric_value: candidate.metric_value,
      growth_rate: candidate.growth_rate,
      category_hint: matchCategories(candidate.keyword),
      is_shortlisted: false,
    });
    if (error) {
      result.errors.push(`upsert failed for "${candidate.keyword}": ${error}`);
    } else {
      result.upserted += 1;
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
