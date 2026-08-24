# Buzz Trend Chart + Topic Movers (Gainers/Losers) — Design Spec (ver1-parity, phần B)

**Ngày:** 2026-08-24
**Trạng thái:** Design approved, chưa implement.

## Bối cảnh

Thứ 2 trong 5 mảnh hướng tới ver1 dashboard parity: (A) KPI cards + Donut chart (xong) → **(B) Buzz Trend chart + Gainers/Losers (spec này)** → (C) Trang Trending Now + Topic detail → (D) Trang Help + Tooltip → (E) Dark mode.

Ver1 có trang `/analytics` riêng với: KPI row (Buzz Volume+delta, Sentiment Index, Share of Voice), Buzz Trend theo lĩnh vực (7 ngày), Sentiment Trend, period toggle 7d/30d, Gainers/Losers theo topic. Spec này chỉ lấy phần **Buzz Trend + Gainers/Losers** — phần còn lại đã có ở A (KPI/donut) hoặc để dành cho D (tooltip).

**Khác biệt kiến trúc quan trọng với ver1:** ver1 có `Topic` là entity bền vững, mỗi `BuzzSnapshot` gắn `topicId` nên buzz tổng hợp (article+social) tính được theo topic. Ver2 không có entity "Topic" bền vững — chỉ `candidate_topics.keyword` (rediscover mỗi ngày) là identity gần nhất. Trong 3 nguồn buzz của ver2, **chỉ Threads (`threads_engagement_daily.keyword`) gắn trực tiếp với keyword** — Facebook (`facebook_engagement_daily`) và Articles (`articles.categories`) chỉ gắn category, không gắn keyword. Vì vậy Gainers/Losers ở ver2 **chỉ dùng engagement Threads** (đã chốt với user), không phải buzz tổng hợp 3 nguồn như ver1.

## Mục tiêu

Trang mới `/analytics`:
1. **Buzz Trend chart** — buzz theo 3 lĩnh vực, 7 ngày gần nhất (đường, giống donut nhưng theo thời gian).
2. **Gainers / Losers** — top 5 keyword tăng/giảm engagement Threads mạnh nhất, so 7 ngày gần nhất vs 7 ngày trước đó.

## Ngoài phạm vi

- Không có period toggle 7d/30d (chỉ 7 ngày cố định) — tránh phình spec, ver2 lịch sử mới tích lũy từ 2026-08-21 nên 30d chưa có nhiều ý nghĩa.
- Không có Sentiment Trend chart, không có Share of Voice bar (trùng donut của A).
- Không có tooltip giải thích chỉ số (dành cho sub-project D).
- Gainers/Losers không link sang trang topic detail (chưa tồn tại — dành cho C) — link sang trang lĩnh vực (`/${category.slug}`), giống ver1 khi topic detail không sẵn có ngữ cảnh phù hợp.
- Buzz Trend **không** gồm Facebook per-keyword hay Threads-only breakdown riêng — dùng đúng công thức trọng số Buzz Volume/donut đã có ở A (3 nguồn cộng theo category), chỉ khác là theo ngày thay vì 1 ngày.

## Kiến trúc

### 1. Data layer — thêm range-query vào reader đã có

Mỗi reader hiện có `getForDate(date)` (sub-project A) — thêm method mới, không đổi method cũ:

```typescript
// dashboard/lib/articles-reader.ts — interface ArticlesReader
getForDateRange(startDate: string, endDateExclusive: string): Promise<{ id: string; categories: string[]; date: string }[]>
```
(`date` là ngày UTC của `published_at`, dạng `YYYY-MM-DD`, cần để group theo ngày ở logic thuần — khác `getForDate` không cần trả `date` vì caller đã biết ngày đó.)

```typescript
// dashboard/lib/threads-engagement-reader.ts — interface ThreadsEngagementReader
getForDateRange(startDate: string, endDateExclusive: string): Promise<ThreadsEngagementDaily[]>
// dashboard/lib/facebook-engagement-reader.ts — interface FacebookEngagementReader
getForDateRange(startDate: string, endDateExclusive: string): Promise<FacebookEngagementDaily[]>
```
(row type đã có field `date` sẵn — không cần đổi type.)

Supabase impl dùng `.gte('date', startDate).lt('date', endDateExclusive)` thay vì `.eq('date', date)`. Cap 5000 rows giữ nguyên như `getForDate`, kèm `console.warn` nếu chạm cap (đồng nhất với Task đã làm ở A cho `ArticlesReader`).

**Anchor "hôm nay":** `candidateReader.getLatestDate()` — giống cách `app/page.tsx` đang resolve `date` cho Overview, để Analytics và Overview cùng một "hôm nay". Gọi `getForDateRange` **1 lần cho toàn bộ 14 ngày** `[latest-13, latest]` (không gọi 2 lần current/previous) — tách current/previous ở logic thuần bằng so sánh `date >= latest-6`.

**Fake reader:** `FakeArticlesReader`, `FakeThreadsEngagementReader`, `FakeFacebookEngagementReader` (đã có từ sub-project 3/A) — mỗi cái thêm `getForDateRange` filter in-memory theo range, tái dùng data đã seed.

### 2. Pure logic — 2 file mới

**`dashboard/lib/buzz-trend.ts`:**
```typescript
export interface BuzzTrendPoint {
  date: string;              // YYYY-MM-DD
  [categoryValue: string]: number | string; // 'tai_chinh' | 'giai_tri' | 'du_lich' -> weighted buzz
}

export function computeBuzzTrend(
  articles: { categories: string[]; date: string }[],
  threadsRows: ThreadsEngagementDaily[],
  facebookRows: FacebookEngagementDaily[],
  dates: string[]  // 7 ngày, thứ tự cũ->mới, caller truyền vào (không tự suy ra từ data — ngày không có dữ liệu vẫn phải xuất hiện với giá trị 0)
): BuzzTrendPoint[];
```
Với mỗi ngày trong `dates`, lọc 3 mảng theo `date` rồi áp đúng công thức trọng số của `computeDonutSegments` (A): article 1 lĩnh vực → 1 điểm, N lĩnh vực → 1/N mỗi lĩnh vực, rỗng → loại; threads full nếu `category` non-null; facebook full (luôn có category). Kết quả là **giá trị tuyệt đối** (không phải %, khác donut) — refactor nhỏ: tách phần "gán trọng số 1 record vào Map<category, number>" từ `computeDonutSegments` thành hàm nội bộ dùng chung `accumulateCategoryWeights(articles, threadsRows, facebookRows): Map<string, number>`, cả `computeDonutSegments` (đổi sang gọi hàm này rồi mới tính %) và `computeBuzzTrend` (gọi theo từng ngày) cùng dùng — tránh trùng công thức ở 2 nơi.

**`dashboard/lib/topic-movers.ts`:**
```typescript
export interface TopicMover {
  keyword: string;
  category: string;   // 'tai_chinh' | 'giai_tri' | 'du_lich' — lấy từ record mới nhất còn category non-null trong kỳ hiện tại; loại khỏi kết quả nếu không có record nào có category
  buzz: number;        // tổng threadsEngagementTotal kỳ hiện tại (7 ngày)
  deltaPct: number;     // (curr-prev)/prev*100; prev=0 && curr>0 -> 100; prev=0 && curr=0 -> loại khỏi kết quả (không mover)
}

export function computeTopicMovers(
  currentRows: ThreadsEngagementDaily[],  // 7 ngày gần nhất
  previousRows: ThreadsEngagementDaily[]  // 7 ngày trước đó
): { gainers: TopicMover[]; losers: TopicMover[]; hasRealLosers: boolean };
```
Group `currentRows`/`previousRows` theo `keyword`, `buzz`/`prevBuzz` = tổng `threadsEngagementTotal` (export sẵn từ A) các row cùng keyword. `deltaPct` như ver1. `gainers` = sort `deltaPct` desc, top 5. `truelosers` = `deltaPct < 0`, sort asc; `losers` = `truelosers` nếu có, else top 5 tăng chậm nhất trong toàn bộ movers (kể cả gainers) — `hasRealLosers = truelosers.length > 0` để UI đổi label/icon giống ver1 ("Top Losers" vs "Tăng trưởng chậm nhất").

### 3. Orchestration — 2 file mới

```typescript
// dashboard/lib/get-buzz-trend.ts
export async function getBuzzTrend(
  articlesReader: ArticlesReader,
  threadsEngagementReader: ThreadsEngagementReader,
  facebookEngagementReader: FacebookEngagementReader,
  latestDate: string
): Promise<BuzzTrendPoint[]>;
// tự tính 7 ngày [latestDate-6, latestDate], gọi 3 reader.getForDateRange song song, group qua computeBuzzTrend

// dashboard/lib/get-topic-movers.ts
export async function getTopicMovers(
  threadsEngagementReader: ThreadsEngagementReader,
  latestDate: string
): Promise<{ gainers: TopicMover[]; losers: TopicMover[]; hasRealLosers: boolean }>;
// gọi getForDateRange 1 lần cho [latestDate-13, latestDate], tách current ([latestDate-6,latestDate]) / previous ([latestDate-13,latestDate-6)) bằng so sánh date, rồi gọi computeTopicMovers
```

### 4. UI

- **`dashboard/components/BuzzTrendChart.tsx`** — adapt `SectorLineChart` (ver1): SVG line chart 3 series (dùng `CATEGORIES` cho màu/label thay vì hardcode), `aria-hidden` trên `<svg>`, legend `text-ink-3` (đã trung tính, không cần né WCAG riêng). Nhận `BuzzTrendPoint[]`.
- **`dashboard/components/TopicMoversSection.tsx`** — 2 cột Gainers | Losers, mỗi item: rank số, `keyword`, badge category (dùng đúng cặp màu nền nhạt/chữ đã kiểm WCAG ở sentiment badge sub-project 3 phần 2 — background nhạt từ `CATEGORIES[].color` + `18` hex alpha như ver1 NHƯNG text màu phải qua kiểm tra contrast thực tế lúc implement, không copy y nguyên màu category gốc nếu không đạt AA — theo đúng pattern đã lặp lại 3 lần trong dự án), `▲/▼ {deltaPct}%` (màu `text-success`/`text-danger`), buzz value, `<Link href={`/${categorySlug}`}>`. Rỗng (0 movers) → `text-ink-3` "Chưa có dữ liệu.", giống ver1.
- **`dashboard/app/analytics/page.tsx`** — Server Component, gọi `getLatestDate()` rồi `getBuzzTrend`+`getTopicMovers` song song (giống pattern `page.tsx` hiện tại), header "Analytics" + subtitle "Xu hướng & biến động — 7 ngày qua", `BuzzTrendChart` trong card, `TopicMoversSection` dưới. Nếu `getLatestDate()` trả `null` (chưa có dữ liệu) → hiện "Chưa có dữ liệu." toàn trang, không query tiếp (giống page.tsx hiện tại xử lý khi `candidate_topics` rỗng).
- **`dashboard/components/layout/Sidebar.tsx`** — thêm mục nav trong group "Tổng quan", ngay sau Overview:
  ```tsx
  <Link href="/analytics" ...>
    <svg ...><path d="M18 20V10M12 20V4M6 20v-6" /></svg>
    Analytics
  </Link>
  ```
  (icon + label y hệt ver1, giữ tiếng Anh như "Overview" đã có — nhất quán với quyết định giữ nhãn tiếng Anh ở A).

### 5. Error handling

Cùng nguyên tắc A/3: lỗi ở `getBuzzTrend`/`getTopicMovers` → `console.error`, section tương ứng không render (không banner đỏ). Lỗi 1 section không chặn section kia (2 lời gọi độc lập, mỗi cái tự try/catch trong `page.tsx`).

### 6. Testing

- `buzz-trend.ts`, `topic-movers.ts`: test đầy đủ với fixture nhiều ngày/keyword — cần test riêng cho: ngày không có data (giá trị 0, không bị bỏ qua khỏi mảng kết quả), keyword category null bị loại, `hasRealLosers=false` fallback, `deltaPct` khi `prevBuzz=0`.
- `get-buzz-trend.ts`, `get-topic-movers.ts`: test bằng fake reader, xác nhận đúng khoảng ngày được truyền vào `getForDateRange` (current 7 ngày, movers 14 ngày) và kết quả group current/previous đúng ranh giới `latestDate-6`.
- Component JSX không test (đúng convention dự án).
