import type { CandidateTopicRepository } from './lib/candidate-topic-repository';
import type { CandidateTopic } from './types';

export interface RankDeps {
  repo: CandidateTopicRepository;
  now?: () => Date;
}

export interface RankOptions {
  topPerSource?: number;
  baselineDays?: number;
}

export interface RankResult {
  evaluated: number;
  shortlisted: number;
}

const DEFAULT_TOP_PER_SOURCE = 10;
const DEFAULT_BASELINE_DAYS = 7;
const NEW_KEYWORD_GROWTH_RATE = 999;

export async function rankAndSelect(deps: RankDeps, options: RankOptions = {}): Promise<RankResult> {
  const now = deps.now ?? (() => new Date());
  const topPerSource = options.topPerSource ?? DEFAULT_TOP_PER_SOURCE;
  const baselineDays = options.baselineDays ?? DEFAULT_BASELINE_DAYS;
  const today = now().toISOString().slice(0, 10);
  const since = new Date(now().getTime() - baselineDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const candidates = await deps.repo.getTodayCandidates(today);

  for (const candidate of candidates) {
    if (candidate.growth_rate !== null) continue;

    const recent = await deps.repo.getRecentMetrics(candidate.source, candidate.keyword, since, today);

    let growthRate: number;
    if (recent.length === 0) {
      growthRate = NEW_KEYWORD_GROWTH_RATE;
    } else {
      const baseline = recent.reduce((sum, v) => sum + v, 0) / recent.length;
      growthRate = baseline === 0 ? NEW_KEYWORD_GROWTH_RATE : (candidate.metric_value - baseline) / baseline;
    }

    await deps.repo.updateGrowthRate(candidate.id!, growthRate);
    candidate.growth_rate = growthRate;
  }

  const bySource = new Map<string, CandidateTopic[]>();
  for (const candidate of candidates) {
    const list = bySource.get(candidate.source) ?? [];
    list.push(candidate);
    bySource.set(candidate.source, list);
  }

  const shortlistedKeywords = new Set<string>();
  for (const list of bySource.values()) {
    const top = [...list].sort((a, b) => (b.growth_rate ?? 0) - (a.growth_rate ?? 0)).slice(0, topPerSource);
    for (const item of top) {
      shortlistedKeywords.add(item.keyword);
    }
  }

  const shortlistIds = candidates.filter((c) => shortlistedKeywords.has(c.keyword)).map((c) => c.id!);
  if (shortlistIds.length > 0) {
    await deps.repo.markShortlisted(shortlistIds);
  }

  return { evaluated: candidates.length, shortlisted: shortlistedKeywords.size };
}
