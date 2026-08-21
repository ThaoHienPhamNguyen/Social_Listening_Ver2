import GoogleTrendsApiImport from '@alkalisummer/google-trends-js';
import type { DiscoverySource } from './discovery-source';
import type { RawCandidate } from '../types';

// This library's compiled CJS output does `exports.default = <instance>`.
// Under this project's `"type": "module"` + tsx (native ESM execution, not
// TypeScript-compiled-to-CommonJS), Node's own CJS/ESM interop binds
// `import X from 'pkg'` to the whole `module.exports` object rather than
// unwrapping to `module.exports.default` — so the value actually received
// here at runtime is `{ default: <instance> }`, not the instance itself,
// even though the .d.ts (written assuming TS's esModuleInterop, a
// compile-time-only transform that never runs when using tsx) types it as
// the already-unwrapped instance. tsc alone cannot catch this mismatch.
// Verified live in production (2026-08-21): "GoogleTrendsApi.dailyTrends is
// not a function" without this. Checked at runtime rather than assumed, so
// this stays correct if the interop behavior or the library's build changes.
export function resolveGoogleTrendsApi<T extends { dailyTrends?: unknown }>(
  imported: T | { default: T }
): T {
  return 'dailyTrends' in imported ? imported : (imported as { default: T }).default;
}

const GoogleTrendsApi = resolveGoogleTrendsApi(GoogleTrendsApiImport);

// Google Trends' trafficGrowthRate is a percentage (e.g. 1000 = +1000%);
// YouTube/RSS growth_rate (rank-and-select.ts) is a ratio (e.g. 2 = doubled).
// Normalize to the ratio unit so candidate_topics.growth_rate is consistent
// across all three sources.
export function normalizeGrowthRate(percentGrowth: number): number {
  return percentGrowth / 100;
}

export interface GoogleTrendsItem {
  keyword: string;
  traffic: number;
  trafficGrowthRate: number;
}

// Google's own trending list doesn't contain duplicates, but our own
// lowercase/trim normalization (below) can still collapse two distinct
// entries into the same keyword. A batch upsert with two rows sharing one
// (source, keyword, date) key fails Postgres's ON CONFLICT clause for the
// WHOLE batch — dedup here, keeping the higher-traffic (stronger-signal)
// entry, before that can ever happen.
export function toRawCandidates(items: GoogleTrendsItem[]): RawCandidate[] {
  const byKeyword = new Map<string, RawCandidate>();
  for (const item of items) {
    const keyword = item.keyword.toLowerCase().trim();
    const existing = byKeyword.get(keyword);
    if (existing && existing.metric_value >= item.traffic) continue;
    byKeyword.set(keyword, {
      keyword,
      metric_value: item.traffic,
      growth_rate: normalizeGrowthRate(item.trafficGrowthRate),
    });
  }
  return Array.from(byKeyword.values());
}

export class GoogleTrendsSource implements DiscoverySource {
  name = 'google_trends' as const;

  // Note: GoogleTrendsApi.dailyTrends's DailyTrendingTopicsOptions type only
  // accepts { geo, hl } — the library exposes no timeout/AbortSignal option
  // (verified against its .d.ts files), so no FETCH_TIMEOUT_MS is wired here
  // unlike youtube-source.ts / rss-fetcher.ts.
  async fetchCandidates(): Promise<RawCandidate[]> {
    const { data, error } = await GoogleTrendsApi.dailyTrends({ geo: 'VN', hl: 'vi' });
    if (error) {
      throw new Error(`GoogleTrendsApi.dailyTrends failed: ${error.message}`);
    }
    return toRawCandidates(data ?? []);
  }
}
