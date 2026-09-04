import type { EnrichedHotTopicRow } from './topic-engagement';
import type { CandidateTopic } from './types';
import { NEW_KEYWORD_TRENDING_SCORE } from './hot-topics';

// 3 tầng xếp hạng, cao xuống thấp:
//   0. trendingScore thật (% tăng trưởng thật, so được với nhau) — sort desc
//   1. "Mới" (NEW_KEYWORD_TRENDING_SCORE — chưa có baseline 7 ngày, không
//      phải % tăng trưởng thật) — sort theo metricValue, không dùng điểm ảo
//      99900 để so vì nó luôn thắng mọi % thật, dồn hết từ khóa "mới" (đa
//      số đến từ YouTube — tiêu đề video đổi mỗi ngày nên hiếm khi có
//      baseline) lên đầu bảng bất kể độ hot thật sự
//   2. Không có điểm (trendingScore null)
// Trong tầng 1 và 2, sort phụ theo metricValue desc.
function tierOf(row: EnrichedHotTopicRow): 0 | 1 | 2 {
  if (row.trendingScore === null) return 2;
  if (row.trendingScore === NEW_KEYWORD_TRENDING_SCORE) return 1;
  return 0;
}

// Gộp bySource (dùng cho Overview/sector pages, chia theo 3 nguồn) thành 1
// mảng duy nhất cho Trending Now.
export function flattenAndRankHotTopics(
  bySource: Record<CandidateTopic['source'], EnrichedHotTopicRow[]>
): EnrichedHotTopicRow[] {
  const sources = Object.keys(bySource) as CandidateTopic['source'][];
  const all = sources.flatMap((source) => bySource[source]);
  return [...all].sort((a, b) => {
    const tierDiff = tierOf(a) - tierOf(b);
    if (tierDiff !== 0) return tierDiff;
    if (tierOf(a) === 0) return b.trendingScore! - a.trendingScore!;
    return b.metricValue - a.metricValue;
  });
}
