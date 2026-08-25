# Trending Now + Topic Detail — Design Spec (ver1-parity, phần C)

**Ngày:** 2026-08-25
**Trạng thái:** Design approved, chưa implement.

## Bối cảnh

Thứ 3 trong 5 mảnh hướng tới ver1 dashboard parity: (A) KPI cards + Donut chart (xong) → (B) Buzz Trend chart + Gainers/Losers (xong) → **(C) Trending Now + Topic detail (spec này)** → (D) Trang Help + Tooltip → (E) Dark mode.

Ver1's Topic detail page dựa trên entity `Topic` bền vững + bảng `Post` lưu từng bài viết thật (content/url/likeCount...). Ver2 không có cả hai: keyword được rediscover mỗi ngày (không có ID cố định), và không lưu từng post/article theo keyword — chỉ có số liệu **tổng hợp theo ngày** (`threads_engagement_daily`, `topic_social_data` cho sentiment, `candidate_topics` cho lịch sử discovery). **Quyết định đã chốt với user:** Topic detail ở ver2 chỉ hiển thị số liệu tổng hợp theo thời gian, KHÔNG có danh sách bài viết — trung thực với dữ liệu thực sự có.

## Mục tiêu

1. **`/trending`** — trang "Trending Now": bảng xếp hạng thống nhất tất cả candidate đang shortlist (mọi nguồn, mọi lĩnh vực), có tab lọc theo lĩnh vực.
2. **`/topic/[keyword]`** — trang chi tiết 1 keyword: lịch sử trending-score (7 ngày), timeline engagement Threads (7 ngày), timeline sentiment Threads (7 ngày), badge nguồn discovery + lĩnh vực.
3. Cập nhật `TopicMoversSection.tsx` (sub-project B) để link sang `/topic/[keyword]` thay vì trang lĩnh vực (như spec B đã ghi chú "để dành cho C").

## Ngoài phạm vi

- Không có danh sách bài viết/post thật trên Topic detail (đã chốt — ver2 không lưu dữ liệu này).
- Không có period toggle (7d/30d) — cố định 7 ngày, giống B.
- Không có `notFound()`/404 cứng khi keyword không tồn tại — hiện "Không tìm thấy topic này." đơn giản.
- Không đổi cách Trending Now/Topic detail tính trending score hay share-of-voice — tái dùng nguyên công thức đã có (`computeTrendingScore`, `computeShareOfVoice` từ `hot-topics.ts`).
- Facebook/Articles không xuất hiện trong Topic detail's timeline — chỉ Threads (keyword-scoped), giống lý do đã chốt ở B.

## Kiến trúc

### 1. Trending Now — tái dùng gần như toàn bộ data layer đã có

Không cần orchestration mới. Trang gọi lại đúng `getHotTopics(candidateReader, category)` + `enrichHotTopicsWithThreadsData(...)` (cả hai đã có từ sub-project 3, dùng y hệt cách `app/page.tsx`/`app/[slug]/page.tsx` đang gọi).

**Pure logic mới duy nhất — thêm vào `dashboard/lib/hot-topics.ts`:**
```typescript
export function flattenAndRankHotTopics(
  bySource: Record<CandidateTopic['source'], EnrichedHotTopicRow[]>
): EnrichedHotTopicRow[] {
  // Gộp 3 mảng theo source thành 1, sort theo trendingScore desc (null cuối cùng),
  // rồi theo metricValue desc khi trendingScore bằng nhau/đều null.
}
```
(`EnrichedHotTopicRow` từ `topic-engagement.ts` — đã có `keyword`, `source`, `metricValue`, `trendingScore`, `shareOfVoice`, `engagement`.)

Tab lọc lĩnh vực dùng `?category=` query param, trang gọi `getHotTopics(reader, category ?? null)` — category `null` = "Tất cả", đúng cách `app/[slug]/page.tsx` đã dùng category không null.

### 2. Topic Detail — data layer mới

**`CandidateTopicsReader` thêm method mới:**
```typescript
getHistoryForKeyword(keyword: string, startDate: string, endDateExclusive: string): Promise<CandidateTopic[]>
```
Supabase: `.eq('keyword', keyword).gte('date', startDate).lt('date', endDateExclusive).limit(1000)` (giới hạn nhỏ hơn các reader khác vì đã lọc theo 1 keyword cụ thể — tối đa 3 nguồn × 7 ngày = 21 dòng trong trường hợp bình thường, cap 1000 là biên an toàn rộng, kèm `console.warn` nếu chạm cap theo đúng convention).

**`ThreadsEngagementReader.getForDateRange`** (đã có từ B) — tái dùng nguyên vẹn, lọc theo `keyword` ở logic thuần thay vì thêm tham số keyword vào reader (tránh explosion số method reader, nhất quán với cách B đã làm — reader trả nguyên set theo ngày, lọc/group ở lib thuần).

**`ThreadsSentimentReader` thêm method mới** (bảng `topic_social_data` đã có cột `date`, mở rộng y hệt pattern B):
```typescript
getForDateRange(startDate: string, endDateExclusive: string): Promise<{ keyword: string; date: string; sentiment: SentimentLabel | null }[]>
```
Lưu ý: khác `getForDate` hiện tại (không trả `date` vì caller đã biết), bản range PHẢI trả `date` để group theo ngày ở logic thuần — giống cách `ArticlesReader.getForDateRange` đã làm ở B.

Anchor "hôm nay" = `candidateReader.getLatestDate()`, 7 ngày `[latestDate-6, latestDate]`, cùng cách tính `addDaysUTC` đã dùng ở B (chấp nhận trùng lặp helper nhỏ này lần nữa — đã có ruling ở B rằng 1 hàm 4 dòng không đáng tách file dùng chung).

### 3. Pure logic mới — `dashboard/lib/topic-detail.ts`

```typescript
export interface TopicDetailData {
  keyword: string;
  category: string | null;     // resolved order-independently, xem bên dưới
  sources: CandidateTopic['source'][]; // nguồn discovery xuất hiện trong 7 ngày, không trùng
  trendingScoreTimeline: { date: string; score: number | null }[]; // 7 điểm, null nếu ngày đó không có candidate nào
  engagementTimeline: { date: string; totalEngagement: number; postCount: number }[]; // 7 điểm, 0 nếu không có
  sentimentTimeline: { date: string; positive: number; negative: number; neutral: number }[]; // 7 điểm, đếm bằng 0 nếu không có
}

export function computeTopicDetail(
  keyword: string,
  candidateHistory: CandidateTopic[],
  threadsEngagementRows: ThreadsEngagementDaily[],
  threadsSentimentRows: { keyword: string; date: string; sentiment: SentimentLabel | null }[],
  dates: string[] // 7 ngày, cũ->mới, caller truyền vào giống computeBuzzTrend ở B
): TopicDetailData | null; // null nếu candidateHistory rỗng VÀ threadsEngagementRows rỗng (keyword không tồn tại trong khoảng này)
```

- **`category`**: resolve theo đúng thuật toán order-independent vừa sửa ở B (`categoryDate` tracking, không phụ thuộc thứ tự Supabase trả về) — áp dụng trên `candidateHistory` (dùng `category_hint[0]` của mỗi row làm ứng viên, bỏ qua row có `category_hint` rỗng). Nếu không row nào có category → `null`.
- **`sources`**: `[...new Set(candidateHistory.map(c => c.source))]`, giữ thứ tự xuất hiện lần đầu.
- **`trendingScoreTimeline`**: với mỗi ngày, lấy `computeTrendingScore` (từ `hot-topics.ts`, tái dùng nguyên) của candidate có `metric_value` cao nhất trong ngày đó (nếu nhiều nguồn cùng ngày) — `null` nếu ngày đó không có row nào.
- **`engagementTimeline`/`sentimentTimeline`**: group đúng ngày, dùng `threadsEngagementTotal` (đã export từ A) và đếm sentiment y hệt `groupSentimentCounts`'s logic (tái dùng, không viết lại).

### 4. Orchestration — `dashboard/lib/get-topic-detail.ts`

```typescript
export async function getTopicDetail(
  candidateReader: CandidateTopicsReader,
  threadsEngagementReader: ThreadsEngagementReader,
  threadsSentimentReader: ThreadsSentimentReader,
  keyword: string,
  latestDate: string
): Promise<TopicDetailData | null>;
```
Fetch 3 reader song song (`Promise.all`) trong range 7 ngày, lọc `threadsEngagementRows`/`threadsSentimentRows` theo `keyword` sau khi fetch (reader trả nguyên set theo ngày, không theo keyword — trừ `getHistoryForKeyword` đã lọc sẵn), rồi gọi `computeTopicDetail`.

### 5. UI

- **`dashboard/lib/hot-topic-format.ts`** (mới, tách từ `HotTopicsSection.tsx`) — di chuyển `formatTrendingScore`, `formatPercent`, `sentimentBadgeClass`, `formatSentimentBadge` vào đây để dùng chung giữa `HotTopicsSection.tsx` (sửa import) và `TrendingTable.tsx` (mới) — tránh copy-paste.
- **`dashboard/components/TrendingTable.tsx`** (mới) — 1 bảng responsive (grid, không cố định 7 cột như ver1 vì ver2 không có "tuần trước"/description) — cột: hạng, keyword, badge lĩnh vực (dùng `category_hint[0]`, dot-only màu theo pattern đã có), nguồn, trending score, engagement+sentiment (tái dùng format helpers). Mỗi hàng link `/topic/${encodeURIComponent(keyword)}`.
- **`dashboard/app/trending/page.tsx`** (mới) — tab lọc lĩnh vực (Link `?category=`, style giống ver1's `PeriodLink`/filter tabs nhưng dùng token màu hiện có), `TrendingTable`.
- **`dashboard/components/SingleLineChart.tsx`** (mới) — SVG line chart 1-biến dùng chung cho 3 timeline (trending score/engagement/sentiment mỗi cái 1 instance), API: `{ data: {date:string; value:number|null}[]; color: string; label: string }`, `null` điểm bị bỏ qua khi vẽ path (gap trong đường) thay vì render như 0 — tránh hiểu lầm như finding F6 đã parked ở B (ở đây rõ ràng hơn vì có `null` phân biệt được với 0 thật).
- **`dashboard/app/topic/[keyword]/page.tsx`** (mới) — header keyword + badge lĩnh vực + badge nguồn (danh sách `sources`), 3 `SingleLineChart` (trending score/engagement/sentiment — sentiment vẽ 3 đường hoặc 1 `%positive - %negative` gộp, chọn `%positive-negative` gộp thành 1 đường để tái dùng `SingleLineChart` mà không cần biến thể đa-đường mới).
- **`TopicMoversSection.tsx`** (sửa, sub-project B) — đổi `href={meta ? `/${meta.slug}` : '/'}` thành `href={`/topic/${encodeURIComponent(m.keyword)}`}` — bỏ luôn nhánh fallback `/` vì `/topic/[keyword]` luôn nhận được (kể cả khi không có dữ liệu, trang tự hiện "Không tìm thấy").

### 6. Error handling

- `/trending`: lỗi load → `console.error`, hiện "Không tải được dữ liệu trending, vui lòng thử lại sau." (đồng nhất với `app/page.tsx`'s `loadHotTopics` error message convention).
- `/topic/[keyword]`: lỗi load → `console.error`, hiện thông báo lỗi tương tự; keyword không tồn tại (data rỗng) → "Không tìm thấy topic này." (khác message, không phải lỗi).

### 7. Testing

- Pure logic (`flattenAndRankHotTopics` trong `hot-topics.ts`, `computeTopicDetail` trong `topic-detail.ts`) test đầy đủ, gồm case category-resolution order-independent (regression test kiểu đã thêm ở B).
- Orchestration (`get-topic-detail.ts`) test bằng fake reader (mở rộng `FakeCandidateTopicsReader` thêm `getHistoryForKeyword`, `FakeThreadsSentimentReader` thêm `getForDateRange`).
- Component/page không test (đúng convention).
