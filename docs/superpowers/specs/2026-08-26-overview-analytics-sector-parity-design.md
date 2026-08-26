# Overview + Analytics + Trang lĩnh vực — Design Spec (ver1-parity, mở rộng)

**Ngày:** 2026-08-26
**Trạng thái:** Design approved, chưa implement.

## Bối cảnh

Người dùng gửi ảnh chụp production ver1 (`C:\Users\user\Social Listening`, chạy bằng Prisma + dữ liệu mock riêng — KHÔNG chung Supabase với ver2) làm ảnh mẫu, kỳ vọng ver2 hiển thị tương tự. So sánh ban đầu bị nhầm cổng (localhost:3000 lúc đó là ver1, không phải ver2) dẫn tới kết luận sai là "đã khớp". Sau khi chụp lại đúng **production ver2 thật** (`social-listening-ver2.vercel.app`) và đọc source `app/page.tsx`, `app/analytics/page.tsx`, `app/[slug]/page.tsx`, khoảng cách thật lớn hơn nhiều — trải trên cả 3 trang, không chỉ Overview. Spec này gộp cả 3 trang vì chúng dùng chung components/data layer (KpiCard, delta computation, ranked-list component), làm 1 lần cho nhất quán.

**Lưu ý quan trọng:** ver1 dùng dữ liệu mock/seed tĩnh (`lib/mock-data.ts`) — số liệu trong ảnh mẫu (891, 16, 955.3K...) không phản ánh dữ liệu Supabase thật của ver2. Spec này copy **cấu trúc/UI/công thức tính** từ ver1, KHÔNG copy số liệu.

## Mục tiêu

1. **Overview** (`/`): KpiCard có icon + delta; thêm 3 mini-card lĩnh vực; thêm "Sentiment theo lĩnh vực"; thêm "Buzz theo nền tảng"; "Topic đang hot" đổi từ 3-cột-thô sang danh sách xếp hạng "Top Trending hôm nay"; sửa tiêu đề Topbar sang tiếng Việt.
2. **Analytics** (`/analytics`): thêm 3 KPI card đầu trang; thêm chart "Xu hướng Sentiment"; fix bug Top Gainers/Losers hiển thị trùng data khi mọi keyword đều mới.
3. **Trang lĩnh vực** (`/[slug]`): thêm 3 KPI card scoped theo category; thêm danh sách "Chủ đề đang trending" xếp hạng với 2 tab Trending/Mới nhất; thêm "Từ khóa nổi bật"; thêm "Buzz theo nền tảng" scoped theo category.
4. Dịch tiêu đề Topbar các trang sang tiếng Việt, giữ pattern động theo trang (không copy nguyên văn kiểu ver1 tĩnh 1 tiêu đề cho mọi trang).

## Ngoài phạm vi

- **Không copy số liệu/dữ liệu mock** từ ver1 — mọi số liệu ver2 tính từ Supabase thật.
- **Không có mô tả (description) cho từng topic** trong danh sách trending — `CandidateTopic` không có cột description, ver1's mock data có nhưng đó là dữ liệu giả. Danh sách trending ở ver2 giữ format hiện có của `TrendingTable.tsx` (keyword + category dot + nguồn + trending score + sentiment badge), KHÔNG thêm dòng mô tả giả.
- **Không đổi cụm nút Topbar** (Live/date-pill/Làm mới/dark mode) — đã hỏi riêng ở phiên trước, người dùng chưa quyết định, giữ nguyên phạm vi spec này.
- **Không sửa "0 topics trending hôm nay"** — đây là vấn đề dữ liệu (discovery layer chưa chạy xong ngày hôm đó), không phải lỗi code.
- **Không đổi period toggle 7d/30d hiện có trên Analytics/sector page** (nút bấm chưa có logic thật ở ver2 hiện tại — không thuộc phạm vi spec này, giữ nguyên).
- **Không đổi "Bài báo gần đây"** — giữ nguyên vị trí cuối trang trên Overview + sector page (quyết định đã chốt với user).

## Quyết định thiết kế quan trọng

### 1. Delta ở Overview KPI card: so sánh single-day, KHÔNG phải window-sum

`computeOverviewMetrics` (sub-project A, đã test/duyệt) tính `buzzVolume`/`topicsTrending`/`audienceScale`/`sentimentScore` từ dữ liệu **1 ngày** (`getForDate(latestDate)`), không phải tổng 7 ngày. Để giữ nguyên ý nghĩa headline number đã duyệt (không đổi semantics sub-project A), delta so sánh **cùng 1 phép tính, 2 mốc thời gian**: `latestDate` vs `latestDate - 7 ngày` (cũng single-day, không phải tổng cửa sổ). Nhãn text đổi thành "so với 7 ngày trước" (chính xác hơn "so với tuần trước" của ver1 vì đúng là so 1 ngày với 1 ngày, không phải tổng tuần với tổng tuần).

Ngược lại, ở **trang lĩnh vực**, headline "Buzz Volume (7 ngày)" tự nó ĐÃ LÀ tổng cửa sổ 7 ngày (mục 4 dưới) — delta ở đây so sánh đúng kiểu window-sum vs window-sum (cửa sổ hiện tại vs cửa sổ 7 ngày liền trước, cùng pattern 14-day-split đã dùng ở sub-project B's `topic-movers.ts`), vì lúc này headline và delta cùng 1 loại phép tính.

### 2. "Mới nhất" tab: sort theo `candidate_topics.created_at`, không phải theo `date`

Dữ liệu candidates fetch theo 1 ngày (`getCandidatesForDate`) nên mọi row cùng `date` — sort theo `date` là vô nghĩa. `candidate_topics` có sẵn cột `created_at timestamptz` (thời điểm discovery layer ghi/refresh row đó trong ngày — pipeline chạy 2-3 lần/ngày nên cột này phân biệt được "mới cập nhật gần đây nhất trong hôm nay" so với "Trending" (sort theo trending score)). Cần thêm `created_at` vào `CandidateTopic` type + câu `select` của reader.

### 3. "Từ khóa nổi bật" = keyword nổi bật của category, không phải tag riêng

Không có cột tag/description tách biệt. "Từ khóa nổi bật" lấy từ `keyword` của các candidate đã shortlist trong category đó (7 ngày gần nhất), distinct, sort theo tổng `metric_value` giảm dần, cap 10-12 items — thực chất là rút gọn danh sách trending thành dạng pill.

### 4. "Buzz theo nền tảng": 3 nguồn thật của ver2, không phải ver1's 4 nguồn

Ver1 hiển thị Báo điện tử/Facebook/Diễn đàn (forum) — ver2 không crawl "Diễn đàn". 3 nguồn thật: **Báo điện tử** (article count), **Threads** (threads post_count), **Facebook** (facebook post_count) — % theo tỉ trọng post count trong cửa sổ 7 ngày, scoped theo category khi ở sector page, toàn bộ khi ở Overview.

## Kiến trúc

### A. Data layer mới

**`lib/types.ts`** — thêm `created_at: string` vào `CandidateTopic`.

**`lib/candidate-topics-reader.ts`** — `getCandidatesForDate` thêm `created_at` vào câu `select`; thêm method mới:
```typescript
getShortlistedForDateRange(category: string | null, startDate: string, endDateExclusive: string): Promise<CandidateTopic[]>
```
(`.eq('is_shortlisted', true)`, `.gte('date', startDate).lt('date', endDateExclusive)`, `.eq('category_hint', ...)` dùng `.contains('category_hint', [category])` khi category không null, cap 5000 + `console.warn`, cùng convention các reader khác.)

**`lib/overview-metrics.ts`** — thêm hàm thuần:
```typescript
export function computeKpiDelta(curr: number, prev: number): { text: string; positive: boolean } {
  if (prev === 0) return { text: 'Chưa có dữ liệu 7 ngày trước', positive: true };
  const pct = ((curr - prev) / prev) * 100;
  const up = pct >= 0;
  return { text: `${up ? '▲' : '▼'} ${up ? '+' : ''}${pct.toFixed(0)}% so với 7 ngày trước`, positive: up };
}
```

**`lib/get-overview-metrics.ts`** — mở rộng để fetch thêm dữ liệu ngày `latestDate - 7` (dùng `addDaysUTC` helper cục bộ, cùng pattern đã lặp lại 3 lần ở `get-topic-movers.ts`/`get-buzz-trend.ts`/`get-topic-detail.ts` — chấp nhận lặp lần thứ 4, đã có ruling trước đó rằng hàm 4 dòng này không đáng tách file dùng chung), gọi `computeOverviewMetrics` lần 2 cho ngày đó, trả thêm `deltas: { buzzVolume: KpiDelta; audienceScale: KpiDelta }` (topicsTrending và sentimentScore không cần delta số — xem UI bên dưới).

**`lib/sector-metrics.ts`** (mới) — pure logic cho 3 KPI card trang lĩnh vực:
```typescript
export interface SectorMetrics {
  buzzVolume7d: number;
  activeTopics: number;
  audienceScale7d: number;
}
export function computeSectorMetrics(
  candidates: CandidateTopic[],       // đã filter theo category, cửa sổ 7 ngày
  articles: { categories: string[] }[],
  threadsRows: ThreadsEngagementDaily[],
  facebookRows: FacebookEngagementDaily[]
): SectorMetrics
```
(`buzzVolume7d` = articles.length + tổng post_count threads/facebook; `activeTopics` = distinct shortlisted keyword; `audienceScale7d` = tổng threadsEngagementTotal + facebookEngagementTotal — công thức giống hệt `computeOverviewMetrics` nhưng input đã pre-filter theo category+window thay vì toàn bộ 1 ngày.)

**`lib/get-sector-metrics.ts`** (mới) — orchestration: fetch 7 ngày hiện tại + 7 ngày liền trước (category-scoped, dùng `getForDateRange`/`getShortlistedForDateRange` đã có/mới thêm), gọi `computeSectorMetrics` 2 lần, trả metrics + `computeKpiDelta` cho buzzVolume7d/audienceScale7d (window-sum vs window-sum, đúng mục "Quyết định thiết kế" #1).

**`lib/top-keywords.ts`** (mới) — pure logic:
```typescript
export function extractTopKeywords(candidates: CandidateTopic[], limit = 12): string[]
```
(input đã filter category+shortlisted+window; group theo keyword, tổng `metric_value`, sort desc, distinct, slice.)

**`lib/hot-topics.ts`** — thêm hàm thuần:
```typescript
export function sortByRecency(rows: (HotTopicRow & { createdAt: string })[]): (HotTopicRow & { createdAt: string })[]
```
(sort `createdAt` desc — cần `HotTopicRow` mang thêm field `createdAt?: string`, populate ở `buildHotTopicsForCategory`/`buildHotTopicsOverview` giống cách `categoryHint` đã optional-populate.)

**`lib/sentiment-by-category.ts`** (mới) — pure logic cho "Sentiment theo lĩnh vực":
```typescript
export interface CategorySentiment { category: string; label: string; counts: SentimentCounts }
export function computeSentimentByCategory(
  threadsSentimentRows: { keyword: string; sentiment: SentimentLabel | null }[],
  candidatesForCategoryLookup: CandidateTopic[], // để map keyword -> category qua category_hint
  facebookSentimentRows: { category: string; sentiment: SentimentLabel | null }[]
): CategorySentiment[]
```
(map keyword→category dùng `category_hint[0]` của candidate mới nhất có category (cùng nguyên tắc order-independent đã dùng ở `topic-movers.ts`/`topic-detail.ts`, áp dụng đơn giản hơn vì chỉ 1 ngày); gộp Threads (qua keyword) + Facebook (đã có category sẵn) theo category, đếm bằng `groupSentimentCounts`/`countAllSentiment` tái dùng.)

**`lib/buzz-by-platform.ts`** (mới) — pure logic:
```typescript
export interface PlatformBuzz { label: string; pct: number }
export function computeBuzzByPlatform(
  articles: { categories: string[] }[],
  threadsRows: ThreadsEngagementDaily[],
  facebookRows: FacebookEngagementDaily[]
): PlatformBuzz[] // 3 phần tử cố định: Báo điện tử / Threads / Facebook, theo post count, làm tròn kiểu largest-remainder giống computeDonutSegments
```
(Hàm thuần không quan tâm cửa sổ thời gian — caller truyền rows đã lọc sẵn: Overview truyền dữ liệu 1 ngày `latestDate` (giống các input khác của `computeOverviewMetrics`/`computeDonutSegments`), trang lĩnh vực truyền dữ liệu cửa sổ 7 ngày đã lọc theo category (giống input của `computeSectorMetrics`) — cùng pattern "pure function nhận input đã pre-scope, không tự quyết định window" xuyên suốt codebase.)

**`lib/topic-movers.ts`** — fix bug tie-break: `gainers`/`losers` fallback (khi `trueGainers`/`trueLosers` rỗng) hiện sort chỉ theo `deltaPct` — khi mọi row cùng giá trị (vd. toàn bộ mới, `deltaPct=100`), sort ổn định giữ nguyên thứ tự gốc → 2 danh sách trùng nhau. Sửa: thêm sort phụ theo `buzz` khi `deltaPct` bằng nhau — gainers-fallback ưu tiên `buzz` cao (nổi bật nhất trong nhóm "mới"), losers-fallback ưu tiên `buzz` thấp (ít nổi bật nhất). Test case mới: input mọi row cùng `deltaPct`, khác `buzz` → 2 danh sách phải khác thứ tự nhau.

### B. Components mới/sửa

**`KpiCard.tsx`** — thêm prop `icon?: string` (SVG path, dùng inline `<svg><path d={icon}/></svg>` giống ver1) + `iconBgClass?: string` + `delta?: string` + `deltaPositive?: boolean`. Icon path/màu lấy nguyên từ ver1's `lib/dashboard-data.ts` (đã đọc, path cụ thể cho 4 KPI: Buzz Volume/Topics Trending/Audience Scale/Sentiment Score).

**`OverviewMetricsSection.tsx`** — truyền `icon`/`iconBgClass`/`delta`/`deltaPositive` vào 4 `KpiCard`. Topics Trending's "delta" luôn là text mô tả (không phải so sánh số): `"${topicsTrending} chủ đề được shortlist hôm nay"` (sửa từ "trong 7 ngày qua" hiện tại — không khớp thực tế 1-ngày, xem "Quyết định thiết kế" #1), `deltaPositive` luôn true (màu success, giống ver1's brand-color info). Sentiment Score's "delta" là `"Xu hướng tích cực"/"Xu hướng tiêu cực"` theo dấu, không có %.

**`SectorMiniCard.tsx`** (mới) — card lĩnh vực rút gọn cho Overview: tên + dot màu, 2 tab Trending/Mới nhất (client component, state cục bộ chuyển đổi giữa 2 mảng đã fetch sẵn từ server — không fetch lại khi đổi tab), tái dùng `TrendingTable` trực tiếp với `rows.slice(0, 4)` cho mỗi tab (không tạo biến thể `compact` riêng — cùng 1 component, chỉ khác số lượng row truyền vào), "Từ khóa nổi bật" pill list, link "Thêm →" sang `/${slug}`.

**`SentimentByCategorySection.tsx`** (mới) — lặp `computeSentimentByCategory`'s kết quả, mỗi category render lại đúng `SentimentBar` (tách `SentimentBar` ra khỏi `FacebookSummarySection.tsx` thành file dùng chung `components/SentimentBar.tsx`, import lại ở cả 2 nơi — tránh copy-paste 25 dòng).

**`BuzzByPlatformSection.tsx`** (mới) — danh sách 3 thanh progress ngang (label + % + bar), style tương tự `SentimentBar` nhưng 1 màu cố định mỗi hàng (không cần success/danger).

**`SentimentTrendChart.tsx`** (mới, cho Analytics) — 3 đường (Tích cực/Trung lập/Tiêu cực theo ngày, 7 điểm) — tái dùng cấu trúc `SingleLineChart` nhưng cần biến thể multi-line (3 series). Đặt trong 1 component riêng thay vì mở rộng `SingleLineChart` (giữ `SingleLineChart` đơn giản, 1 series, đúng nguyên tắc "mỗi file 1 trách nhiệm" — `SentimentTrendChart` compose 3 path riêng, tái dùng `null`-gap logic y hệt `SingleLineChart`'s `afterGap` pattern).

**`app/page.tsx`** (Overview) — thêm fetch: `getSectorMetrics` × 3 category (song song `Promise.all`) cho mini-card, `computeSentimentByCategory`, `computeBuzzByPlatform` (dùng lại `articles`/`threadsRows`/`facebookRows` đã fetch cho `getOverviewMetrics` — cần đổi `getOverviewMetrics` để trả thêm raw rows, hoặc fetch riêng 1 lần nữa ở page-level cho 2 hàm mới — chọn fetch riêng để giữ `getOverviewMetrics`'s interface không đổi, tránh phá vỡ test hiện có của sub-project A). Thay `HotTopicsSection` bằng `TrendingTable` (dùng `flattenAndRankHotTopics(hotTopicsWithEngagement.bySource).slice(0, 10)`) + link "Xem tất cả →" sang `/trending`. Đổi `<Topbar title="Overview" />` → `<Topbar title="Tổng quan thị trường" />`.

**`app/analytics/page.tsx`** — thêm fetch `getOverviewMetrics` (đã có, tái dùng nguyên) cho 3 KPI card đầu trang (Tổng Buzz Volume dùng `metrics.buzzVolume`, Sentiment Index dùng `metrics.sentimentScore`, Share of Voice dùng `donut` render dạng thanh ngang thay vì ring — component mới nhỏ `ShareOfVoiceBars.tsx` tái dùng `DonutSegment[]` input). Thêm `SentimentTrendChart` cạnh `BuzzTrendChart` (cần data layer mới `computeSentimentTrend` — theo ngày, gộp Threads+Facebook sentiment 7 ngày, tương tự `computeSentimentByCategory` nhưng group theo ngày thay vì category). Đổi `<Topbar title="Analytics" />` → `<Topbar title="Phân tích" />`.

**`app/[slug]/page.tsx`** — thêm fetch `getSectorMetrics` (3 KPI card), `getShortlistedForDateRange` + `sortByRecency` (2 tab), `extractTopKeywords`, `computeBuzzByPlatform` (category-scoped). Đổi `HotTopicsSection`+`ArticlesSection` order: KPI cards → ranked list (2 tab) → Từ khóa nổi bật → Buzz theo nền tảng → FacebookSummarySection (giữ nguyên, đã có) → Bài báo gần đây (giữ nguyên cuối trang, theo quyết định không đổi).

**`components/layout/Topbar.tsx`** — không đổi code, chỉ đổi giá trị `title` truyền vào ở các trang gọi nó (`app/trending/page.tsx`: "Trending Now" → "Xu hướng"; các trang khác nêu trên).

### C. Error handling

Theo đúng convention silent-degradation đã thiết lập (sub-project 3's spec §5, §7): mọi fetch mới (sector metrics, sentiment-by-category, buzz-by-platform, sentiment trend) bọc try/catch, lỗi → `console.error` + trả `null`, section tương ứng hiện "Chưa có dữ liệu." thay vì banner đỏ. Chỉ giữ banner đỏ (`text-red-600`) cho 2 luồng hiện có đã dùng nó (`loadHotTopics`/`loadArticles` — nội dung chính, không phải context bổ sung).

### D. Testing

- Pure logic mới (`computeKpiDelta`, `computeSectorMetrics`, `extractTopKeywords`, `sortByRecency`, `computeSentimentByCategory`, `computeBuzzByPlatform`, `computeSentimentTrend`, sửa `computeTopicMovers`) — unit test đầy đủ theo pattern hiện có (fake data, edge case rỗng/1-phần-tử/toàn-bộ-bằng-nhau).
- Orchestration mới (`getSectorMetrics`) test bằng fake reader, mở rộng các Fake reader hiện có (`FakeCandidateTopicsReader` thêm `getShortlistedForDateRange`).
- Component/page không test (đúng convention đã thống nhất từ đầu dự án).
- Regression: chạy lại toàn bộ suite hiện có (103 test) đảm bảo không phá vỡ `computeOverviewMetrics`/`computeDonutSegments` (không đổi signature, chỉ thêm hàm mới cạnh).
