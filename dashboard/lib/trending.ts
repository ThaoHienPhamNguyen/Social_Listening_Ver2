import type { HotTopicRow } from './hot-topics';
import type { CandidateTopic } from './types';
import { NEW_KEYWORD_TRENDING_SCORE } from './hot-topics';

// 3 tầng xếp hạng, cao xuống thấp:
//   0. trendingScore thật (% tăng trưởng thật, so được với nhau) — sort desc,
//      rồi phụ theo metricValue desc khi trùng % (Google Trends báo tăng
//      trưởng theo bậc thang tròn — 100%, 500%, 1000%... — không phải số
//      chính xác, nên nhiều từ khóa hợp lệ trùng % nhau cùng lúc; volume tìm
//      kiếm thật là cách duy nhất phân biệt độ hot thật giữa chúng)
//   1. "Mới" (NEW_KEYWORD_TRENDING_SCORE — chưa có baseline 7 ngày, không
//      phải % tăng trưởng thật) — sort theo metricValue, không dùng điểm ảo
//      99900 để so vì nó luôn thắng mọi % thật, dồn hết từ khóa "mới" (đa
//      số đến từ YouTube — tiêu đề video đổi mỗi ngày nên hiếm khi có
//      baseline) lên đầu bảng bất kể độ hot thật sự
//   2. Không có điểm (trendingScore null)
// Trong tầng 1 và 2, sort phụ theo metricValue desc.
function tierOf(row: HotTopicRow): 0 | 1 | 2 {
  if (row.trendingScore === null) return 2;
  if (row.trendingScore === NEW_KEYWORD_TRENDING_SCORE) return 1;
  return 0;
}

function compareByRank(a: HotTopicRow, b: HotTopicRow): number {
  const tierDiff = tierOf(a) - tierOf(b);
  if (tierDiff !== 0) return tierDiff;
  if (tierOf(a) === 0) {
    const scoreDiff = b.trendingScore! - a.trendingScore!;
    if (scoreDiff !== 0) return scoreDiff;
  }
  return b.metricValue - a.metricValue;
}

// A keyword discovered independently by more than one source that day (e.g.
// both Threads and YouTube surface "việt nam" as their own candidate) would
// otherwise take up more than one slot in a short top-N list. Collapsing
// same-keyword rows into one: metricValue sums across sources (their real
// combined volume); trendingScore/categoryHint/createdAt/id come from
// whichever source ranks best by the exact tier rule the final list sorts
// by (compareByRank), so a merged row is never ranked worse than showing
// that source alone would have been. shareOfVoice is dropped to null — it's
// a % of one source's own daily total, and summing or averaging that across
// sources with different totals wouldn't mean anything.
function mergeSameKeyword<T extends HotTopicRow>(rows: T[]): T[] {
  const byKeyword = new Map<string, T[]>();
  for (const row of rows) {
    const group = byKeyword.get(row.keyword);
    if (group) group.push(row);
    else byKeyword.set(row.keyword, [row]);
  }

  const merged: T[] = [];
  for (const group of byKeyword.values()) {
    if (group.length === 1) {
      merged.push(group[0]);
      continue;
    }
    const representative = [...group].sort(compareByRank)[0];
    const dominant = [...group].sort((a, b) => b.metricValue - a.metricValue)[0];
    const createdAt = group
      .map((r) => r.createdAt)
      .filter((d): d is string => d !== undefined)
      .sort()
      .at(-1);
    merged.push({
      ...representative,
      source: dominant.source,
      sources: Array.from(new Set(group.map((r) => r.source))).sort(),
      metricValue: group.reduce((sum, r) => sum + r.metricValue, 0),
      shareOfVoice: null,
      categoryHint: Array.from(new Set(group.flatMap((r) => r.categoryHint ?? []))),
      createdAt,
    });
  }
  return merged;
}

// Gộp bySource (dùng cho Overview/sector pages, chia theo 3 nguồn) thành 1
// mảng duy nhất. Nhận HotTopicRow (không chỉ EnrichedHotTopicRow) vì chỉ
// đụng tới trendingScore/metricValue — dùng chung cho Trending Now (rows đã
// enrich engagement) và cho API /api/topics (rows chưa enrich).
export function flattenAndRankHotTopics<T extends HotTopicRow>(
  bySource: Record<CandidateTopic['source'], T[]>
): T[] {
  const sources = Object.keys(bySource) as CandidateTopic['source'][];
  const all = sources.flatMap((source) => bySource[source]);
  return mergeSameKeyword(all).sort(compareByRank);
}
