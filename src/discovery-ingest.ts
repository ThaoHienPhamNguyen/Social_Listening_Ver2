import type { DiscoverySource } from './lib/discovery-source';
import type { CandidateTopicRepository } from './lib/candidate-topic-repository';
import type { CandidateTopic } from './types';
import { matchCategories } from './lib/match-categories';
import type { CandidateClassifier } from './lib/candidate-classifier';

export interface DiscoveryIngestDeps {
  repo: CandidateTopicRepository;
  now?: () => Date;
  classifier?: CandidateClassifier;
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

  // category_hint starts as matchCategories() (substring match) unioned with
  // whatever the source already knew for sure (RSS ground-truth categories,
  // a YouTube seed's category). Anything still empty after that is a
  // candidate LLM classification (below) gets a shot at — named entities
  // (people, places) that no static keyword list can enumerate.
  const categoryHints = new Map<string, string[]>();
  for (const candidate of candidates) {
    const hints = Array.from(
      new Set([...matchCategories(candidate.keyword), ...(candidate.knownCategories ?? [])])
    );
    categoryHints.set(candidate.keyword, hints);
  }

  if (deps.classifier) {
    const uniqueEmpty = Array.from(
      new Set(candidates.map((c) => c.keyword).filter((keyword) => (categoryHints.get(keyword) ?? []).length === 0))
    );
    if (uniqueEmpty.length > 0) {
      try {
        const classified = await deps.classifier.classify(uniqueEmpty);
        for (const [keyword, label] of Object.entries(classified)) {
          if (label !== 'none') {
            categoryHints.set(keyword, [label]);
          }
        }
      } catch (err) {
        // Classification failure must not drop or block the rest of this
        // source's candidates — they're written with whatever category_hint
        // they already had (possibly still empty), same isolation principle
        // as the fetch/upsert failure handling elsewhere in this function.
        result.errors.push(`classification failed: ${(err as Error).message}`);
      }
    }
  }

  // The workflow runs discovery-ingest -> rank-and-select up to 3x/day, all
  // writing the same `date`. A keyword that reappears in a later run's fetch
  // must not lose what an earlier run's rank-and-select already computed for
  // it that day. Supabase/PostgREST's upsert only touches the columns present
  // in the payload on conflict (leaves the rest of the row alone) — so
  // `growth_rate` is included only when the source supplies one directly
  // (e.g. Google Trends, which is fresh every fetch and safe to overwrite),
  // and `is_shortlisted` is never included here at all, since only
  // rank-and-select is allowed to set it.
  //
  // PostgREST derives one column list from the UNION of keys across every
  // row in a single bulk upsert call — a row that omits `growth_rate` in a
  // batch that also contains rows supplying it would get NULL written
  // instead of being left untouched, silently reproducing the bug this
  // omission is meant to prevent. So rows are split by growth_rate presence
  // *before* chunking, keeping every single upsertCandidates() call
  // homogeneous, regardless of whether a given source's fetch ever mixes
  // null and non-null growth_rate (none of the three built-in sources do
  // today, but nothing enforces that they never will).
  const rowsWithGrowthRate: Partial<CandidateTopic>[] = [];
  const rowsWithoutGrowthRate: Partial<CandidateTopic>[] = [];
  for (const candidate of candidates) {
    const row: Partial<CandidateTopic> = {
      source: source.name,
      keyword: candidate.keyword,
      date,
      metric_value: candidate.metric_value,
      category_hint: categoryHints.get(candidate.keyword) ?? [],
    };
    if (candidate.growth_rate !== null) {
      rowsWithGrowthRate.push({ ...row, growth_rate: candidate.growth_rate });
    } else {
      rowsWithoutGrowthRate.push(row);
    }
  }

  const batches = [...chunk(rowsWithGrowthRate, UPSERT_CHUNK_SIZE), ...chunk(rowsWithoutGrowthRate, UPSERT_CHUNK_SIZE)];

  for (const batch of batches) {
    try {
      const { error, count } = await deps.repo.upsertCandidates(batch);
      if (error) {
        result.errors.push(`batch upsert failed for ${batch.length} candidate(s): ${error}`);
      } else {
        result.upserted += count;
      }
    } catch (err) {
      // A network-level exception (unlike a PostgREST-level {error} result)
      // would otherwise propagate out of ingestAllDiscoverySources' loop and
      // abort every source queued after this one for the day — isolate it
      // the same way the fetchCandidates() failure above is isolated.
      result.errors.push(`batch upsert threw for ${batch.length} candidate(s): ${(err as Error).message}`);
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
