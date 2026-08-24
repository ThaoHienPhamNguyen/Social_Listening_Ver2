# Overview KPI Cards + Donut Chart — Design Spec (ver1-parity, phần A)

**Ngày:** 2026-08-24
**Trạng thái:** Design approved, chưa implement.

## Bối cảnh

Sau khi hỏi "tại sao dashboard không giống ver1 hoàn toàn" — quyết định làm dần 5 mảnh độc lập hướng tới full parity: **(A) KPI cards + Donut chart** (spec này) → (B) Trend/Buzz line chart + Gainers/Losers → (C) Trang Trending Now + Topic detail → (D) Trang Help + Tooltip → (E) Dark mode.

Phát hiện quan trọng: ver2 **không xóa dữ liệu theo ngày** ở bất kỳ bảng nào (`candidate_topics`, `articles`, `topic_social_data`, `facebook_page_data`, `threads_engagement_daily`, `facebook_engagement_daily`) — lịch sử đã tích lũy từ 2026-08-21. Vì vậy **không cần bảng "Topic/BuzzSnapshot" bền vững như ver1** — chỉ cần query group-by-date/keyword trên data đã có.

## Mục tiêu

Thêm 4 KPI card (Buzz Volume, Topics Trending, Audience Scale, Sentiment Score) + 1 donut chart (% buzz theo lĩnh vực) lên **đầu trang Overview**, trên `HotTopicsSection`. Chỉ đọc data đã có — không backend/migration mới.

## Ngoài phạm vi

- Không có ở trang lĩnh vực (sector page) — chỉ Overview, vì donut/KPI này mang tính tổng quan toàn dashboard.
- Không có delta so với kỳ trước ("▲ +12% so với tuần trước" như ver1) — cần query thêm 1 khoảng ngày nữa, để dành cho lần sau nếu cần, tránh phình spec này.
- Không có icon màu trong KpiCard (khác ver1) — giữ tối giản đúng phong cách hiện tại, tránh phải thêm token màu `info`/`warning` mới cho việc này.
- Không đụng `Analytics`/`Trending Now` page — đó là sub-project B/C.

## Kiến trúc

### 1. Định nghĩa 4 chỉ số

- **Buzz Volume** = `count(articles hôm nay) + Σ(threads_engagement_daily.post_count hôm nay) + Σ(facebook_engagement_daily.post_count hôm nay)` — tổng số bài thật (đã chốt).
- **Topics Trending** = số `keyword` **distinct** trong `candidate_topics` có `is_shortlisted=true` hôm nay (không đếm trùng 1 keyword bị nhiều source cùng shortlist).
- **Audience Scale** = Σ tổng engagement Threads (like+reply+repost+quote+share, loại view_count — đúng công thức sub-project 3) + Σ tổng engagement Facebook (like+comment+share).
- **Sentiment Score** = `computeSentimentIndex` áp dụng lên **tổng hợp tất cả** bài đã classify hôm nay (Threads + Facebook gộp chung, không tách theo keyword/category) — `null` nếu chưa bài nào được classify.

### 2. Donut chart — % Buzz Volume theo lĩnh vực

Với mỗi nguồn, gán trọng số vào lĩnh vực:
- **Article**: `categories: string[]` sẵn có — nếu thuộc N lĩnh vực, mỗi lĩnh vực nhận `1/N` (tránh double-count tổng, khớp cách Overview page hiện tại đã average share-of-voice cho candidate đa lĩnh vực). Article rỗng `categories: []` bị loại khỏi mẫu số donut.
- **Threads**: `category: string | null` (join từ `candidate_topics`, sub-project 3 đã có) — full trọng số vào lĩnh vực đó nếu có, loại khỏi mẫu số nếu `null`.
- **Facebook**: `category` luôn có sẵn (non-null) — full trọng số.

`pct` mỗi lĩnh vực = `(tổng trọng số lĩnh vực đó / tổng trọng số toàn bộ, đã loại phần null) × 100`, làm tròn.

### 3. Data layer — mở rộng, không tạo bảng mới

**Reader mới cần thêm 1 method** vào `dashboard/lib/articles-reader.ts` (interface `ArticlesReader`):
```typescript
getForDate(date: string): Promise<{ id: string; categories: string[] }[]>
```
(chỉ lấy 2 cột cần thiết, giống cách các reader sub-project 3 đã làm — không lấy nguyên `Article` đầy đủ).

**Tái dùng nguyên vẹn, không đổi:**
- `CandidateTopicsReader.getCandidatesForDate(date)` (đã có)
- `ThreadsEngagementReader.getForDate(date)` (sub-project 3) — đã trả về **toàn bộ** row trong ngày, không lọc theo keyword
- `FacebookEngagementReader.getForDate(date)` (sub-project 3) — tương tự
- `ThreadsSentimentReader.getForDate(date)` / `FacebookSentimentReader.getForDate(date)` (sub-project 3)

**Refactor nhỏ đi kèm (DRY, xuất hiện consumer thứ 3):**
- Export `threadsEngagementTotal(row: ThreadsEngagementDaily): number` từ `dashboard/lib/topic-engagement.ts` (hiện đang là hàm private, chỉ dùng nội bộ) — dùng lại ở đây thay vì viết lại công thức.
- Thêm `facebookEngagementTotal(row: FacebookEngagementDaily): number` vào `dashboard/lib/facebook-summary.ts`, và sửa `buildFacebookSummary` dùng lại hàm này thay vì công thức inline hiện có (tránh trùng lặp công thức ở 2 nơi).
- Thêm `countAllSentiment(rows: { sentiment: SentimentLabel | null }[]): SentimentCounts` vào `topic-engagement.ts` — biến thể không group-by-key của `groupSentimentCounts`, dùng cho Sentiment Score (1 con số tổng, không phải Map theo keyword/category).

### 4. Pure logic mới

**`dashboard/lib/overview-metrics.ts`** (mới):
```typescript
export interface OverviewMetrics {
  buzzVolume: number;
  topicsTrending: number;
  audienceScale: number;
  sentimentScore: number | null;
}

export interface DonutSegment {
  category: string;
  label: string;
  pct: number;
}

export function computeOverviewMetrics(
  candidates: CandidateTopic[],
  articles: { categories: string[] }[],
  threadsRows: ThreadsEngagementDaily[],
  facebookRows: FacebookEngagementDaily[],
  sentimentRows: { sentiment: SentimentLabel | null }[]
): OverviewMetrics;

export function computeDonutSegments(
  articles: { categories: string[] }[],
  threadsRows: ThreadsEngagementDaily[],
  facebookRows: FacebookEngagementDaily[]
): DonutSegment[];  // dùng CATEGORIES từ lib/categories.ts để lấy label/màu khi render
```

### 5. Orchestration

**`dashboard/lib/get-overview-metrics.ts`** (mới) — nhận reader qua tham số (đúng pattern hiện có), tự fetch riêng (không tái dùng candidate list đã fetch trong `getHotTopics`, để không đụng code đang chạy tốt — cái giá là 1 query phụ, chấp nhận được):
```typescript
export async function getOverviewMetrics(
  candidateReader: CandidateTopicsReader,
  articlesReader: ArticlesReader,
  threadsEngagementReader: ThreadsEngagementReader,
  facebookEngagementReader: FacebookEngagementReader,
  threadsSentimentReader: ThreadsSentimentReader,
  facebookSentimentReader: FacebookSentimentReader,
  date: string
): Promise<{ metrics: OverviewMetrics; donut: DonutSegment[] }>;
```

`getOverviewMetrics` fetches from all 6 readers (in parallel via `Promise.all`), then **concatenates** `threadsSentimentRows` and `facebookSentimentRows` into one array before passing to `computeOverviewMetrics`'s `sentimentRows` param (both reader shapes — `{keyword,sentiment}`/`{category,sentiment}` — structurally satisfy `{sentiment: SentimentLabel|null}[]`, no mapping needed). `computeDonutSegments` only needs `articles`/`threadsRows`/`facebookRows` — `candidates` is irrelevant to the donut (discovery-layer interest doesn't factor into Buzz Volume weighting), only used for the separate `topicsTrending` KPI.

### 6. UI

**`dashboard/components/KpiCard.tsx`** (mới) — adapt từ ver1, **bỏ icon**: chỉ `label` (uppercase, nhỏ) → `value` (số lớn, đậm) → không có delta (đã loại ở "Ngoài phạm vi"). Card style khớp `bg-surface border-line rounded-card shadow-card p-6` như các section khác.

**`dashboard/components/OverviewMetricsSection.tsx`** (mới) — grid 4 `KpiCard` (Buzz Volume, Topics Trending, Audience Scale, Sentiment Score) + `DonutChart` cạnh nhau, đặt trước `HotTopicsSection` trên Overview. `sentimentScore === null` → card hiện "—" thay vì số.

**`dashboard/components/DonutChart.tsx`** (mới) — adapt từ ver1 (SVG donut thuần, không thư viện chart), nhận `DonutSegment[]` đã có `pct`, tự lấy `color` từ `CATEGORIES` (`lib/categories.ts`) theo `category` field — không cần donut tự nhận `color` prop riêng (khác ver1, nơi màu được truyền sẵn — ver2 có sẵn nguồn màu chuẩn ở `categories.ts` nên dùng thẳng, tránh trùng lặp nguồn màu).

### 7. Error handling

Cùng nguyên tắc sub-project 3: lỗi load metrics/donut **không hiện banner đỏ** — degrade về `null`/rỗng, `console.error` để debug. Nếu lỗi, `OverviewMetricsSection` không render gì cả (không phải nội dung chính của trang).

### 8. Testing

Theo đúng convention: pure logic (`overview-metrics.ts`) có test đầy đủ với fixture data; orchestration (`get-overview-metrics.ts`) có test dùng fake reader (tái dùng fake đã có từ sub-project 3, thêm 1 fake mới cho `ArticlesReader.getForDate`); component JSX không test.
