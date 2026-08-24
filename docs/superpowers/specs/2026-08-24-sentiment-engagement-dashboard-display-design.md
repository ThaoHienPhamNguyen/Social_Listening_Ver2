# Sentiment + Engagement Dashboard Display — Design Spec (Sub-project 3, phần 2)

**Ngày:** 2026-08-24
**Trạng thái:** Design approved, chưa implement.

## Bối cảnh

Sub-project 3 phần 1 ([spec](./2026-08-23-sentiment-engagement-metrics-design.md), [schema](./2026-08-23-sentiment-engagement-metrics-database-schema.md)) đã build xong data layer: cột `sentiment` trên `topic_social_data`/`facebook_page_data`, 2 bảng `threads_engagement_daily`/`facebook_engagement_daily`. Live-verified 2026-08-24, nhưng **chưa hiển thị ở đâu cả** — dashboard hiện chỉ show hot topics (discovery layer) + bài báo RSS.

Việc này bị tạm dừng giữa chừng brainstorm ban đầu để làm trước sub-project [Dashboard visual redesign](./2026-08-24-dashboard-visual-redesign-design.md) (port design token + Sidebar/Topbar từ ver1), tránh giao diện chắp vá. Redesign đó đã merge — phần 2 này build trên nền token đã có sẵn (`bg-surface`, `border-line`, `rounded-card`, `shadow-card`, `text-ink`/`text-ink-2`/`text-ink-3`, `bg-muted`, `text-brand`).

## Mục tiêu

Bổ sung context sentiment + engagement vào **hot topics đang hiển thị** (không phải section/trang riêng biệt):
- Threads: gắn engagement + sentiment vào từng hàng hot topic (theo `keyword`, khi có data deep-crawl).
- Facebook: hiển thị dạng tóm tắt đầu trang lĩnh vực (vì Facebook chỉ có data theo `category`, không theo từng topic).

## Ngoài phạm vi

- Không đụng backend/migration/GitHub Actions job nào — thuần đọc dữ liệu đã có sẵn từ phần 1.
- Không có trang/section riêng cho sentiment — chỉ bổ sung vào chỗ đã có (đã chốt ở lần brainstorm trước).
- Không port `KpiCard`/`DonutChart`/chart SVG phức tạp — dùng progress bar CSS thuần (kiểu `SentimentBreakdown.tsx` của ver1), giống mức độ trực quan đã áp dụng cho redesign vừa xong.
- Overview page **không có** Facebook summary (không đại diện 1 category cụ thể — đã chốt).

## Kiến trúc

### 1. Data layer — 4 reader mới (Approach A: dashboard tự tính, không pre-aggregate backend)

Theo đúng pattern hiện có (1 reader = 1 bảng, interface + Supabase impl, nhận qua tham số không tự tạo client):

**`dashboard/lib/threads-engagement-reader.ts`**
```typescript
export interface ThreadsEngagementReader {
  getForDate(date: string): Promise<ThreadsEngagementDaily[]>;
}
export class SupabaseThreadsEngagementReader implements ThreadsEngagementReader { ... }
```
Đọc `threads_engagement_daily` (tất cả cột) filter `date = date`.

**`dashboard/lib/threads-sentiment-reader.ts`**
```typescript
export interface ThreadsSentimentReader {
  getForDate(date: string): Promise<{ keyword: string; sentiment: SentimentLabel | null }[]>;
}
export class SupabaseThreadsSentimentReader implements ThreadsSentimentReader { ... }
```
Đọc `topic_social_data`, chỉ 2 cột `keyword, sentiment`, filter `date = date`, `limit(5000)`.

**`dashboard/lib/facebook-engagement-reader.ts`** — tương tự, đọc `facebook_engagement_daily`.

**`dashboard/lib/facebook-sentiment-reader.ts`**
```typescript
export interface FacebookSentimentReader {
  getForDate(date: string): Promise<{ category: string; sentiment: SentimentLabel | null }[]>;
}
```
Đọc `facebook_page_data`, chỉ 2 cột `category, sentiment`, filter `date = date`, `limit(5000)`.

**Types mới trong `dashboard/lib/types.ts`** (mirror rút gọn từ root project's `src/types.ts`, đúng convention comment đầu file đã ghi):
```typescript
export type SentimentLabel = 'positive' | 'negative' | 'neutral';

export interface ThreadsEngagementDaily {
  date: string;
  keyword: string;
  category: string | null;
  total_like_count: number;
  total_reply_count: number;
  total_repost_count: number;
  total_quote_count: number;
  total_share_count: number;
  total_view_count: number;
  post_count: number;
}

export interface FacebookEngagementDaily {
  date: string;
  category: string;
  total_like_count: number;
  total_comment_count: number;
  total_share_count: number;
  post_count: number;
}
```

**Ngày dùng để query:** dùng chung `hotTopics.date` đã có sẵn từ `getHotTopics()` (không tự query "latest date" riêng cho 4 bảng mới) — vì các job aggregate/classify chạy cùng workflow với discovery layer nên date luôn khớp. Không có dòng khớp ngày đó → coi là "chưa có data", không phải lỗi (đã chốt lần trước).

### 2. Pure logic

**`dashboard/lib/topic-engagement.ts`** (mới):
```typescript
export interface SentimentCounts {
  positive: number;
  negative: number;
  neutral: number;
}

export interface TopicEngagement {
  totalEngagement: number;   // like+reply+repost+quote+share, KHÔNG gồm view_count
  postCount: number;
  sentiment: SentimentCounts;
  sentimentIndex: number | null;  // round((positive-negative)/total*100), null nếu total=0
}

export interface EnrichedHotTopicRow extends HotTopicRow {
  engagement: TopicEngagement | null;  // null = topic này không nằm trong data Threads hôm nay
}

export function groupSentimentCounts(
  rows: { key: string; sentiment: SentimentLabel | null }[]
): Map<string, SentimentCounts>;

// Adapt trực tiếp từ ver1's lib/sentiment-index.ts, đổi input từ % trung bình
// nhiều bản ghi/ngày sang đếm số bài thật trong 1 ngày — tương đương toán học
// khi mọi bài có trọng số bằng nhau.
export function computeSentimentIndex(counts: SentimentCounts): number | null;

export function attachEngagement(
  rows: HotTopicRow[],
  engagementByKeyword: Map<string, ThreadsEngagementDaily>,
  sentimentByKeyword: Map<string, SentimentCounts>
): EnrichedHotTopicRow[];
```
`sentiment` label không nằm trong tập `('positive'|'negative'|'neutral')` (dữ liệu bẩn) hoặc `null` (chưa classify) đều bị loại khỏi `groupSentimentCounts` — không tính vào `neutral`.

**`dashboard/lib/facebook-summary.ts`** (mới):
```typescript
export interface FacebookSummary {
  totalEngagement: number;   // like+comment+share
  postCount: number;
  sentiment: SentimentCounts;
  sentimentIndex: number | null;
}

export function buildFacebookSummary(
  category: string,
  engagementRows: FacebookEngagementDaily[],
  sentimentByCategory: Map<string, SentimentCounts>
): FacebookSummary | null;   // null nếu không có dòng engagement khớp category
```

**Orchestration** (nhận reader qua tham số, giống hệt cách `get-hot-topics.ts` đang làm):

**`dashboard/lib/get-topic-engagement.ts`**
```typescript
export async function enrichHotTopicsWithThreadsData(
  bySource: Record<CandidateTopic['source'], HotTopicRow[]>,
  engagementReader: ThreadsEngagementReader,
  sentimentReader: ThreadsSentimentReader,
  date: string
): Promise<Record<CandidateTopic['source'], EnrichedHotTopicRow[]>>;
```

**`dashboard/lib/get-facebook-summary.ts`**
```typescript
export async function getFacebookSummary(
  category: string,
  engagementReader: FacebookEngagementReader,
  sentimentReader: FacebookSentimentReader,
  date: string
): Promise<FacebookSummary | null>;
```

### 3. Token mới (có consumer thật, hợp lệ theo YAGNI — khác với redesign trước không thêm vì chưa ai dùng)

Thêm vào `dashboard/app/globals.css`'s `@theme` block (lấy đúng giá trị từ ver1's design-system.md §1.4 Semantic/Status):
```css
--color-success: #16a34a;
--color-success-bg: #f0fdf4;
--color-danger: #dc2626;
--color-danger-bg: #fff1f2;
```

### 4. UI

**`HotTopicsSection.tsx`** (sửa) — nhận `EnrichedHotTopicRow[]` thay vì `HotTopicRow[]`. Với row có `engagement !== null`, thêm 1 dòng phụ nhỏ dưới dòng hiện tại:
```
bitcoin                          12.3% · 8.5%
  💬 245 tương tác  [Sentiment +49]
```
`[Sentiment +49]` là badge nhỏ (`text-xs`, `rounded-full`, `px-2`), 3 trường hợp rõ ràng theo `sentimentIndex`:
- `> 0` → `bg-success-bg text-success`, text "Sentiment +N"
- `< 0` → `bg-danger-bg text-danger`, text "Sentiment -N"
- `=== 0` → `bg-muted text-ink-3`, text "Sentiment 0" (trung lập tuyệt đối, vẫn hiện badge)
- `=== null` → **không hiện badge sentiment** (chỉ hiện số tương tác) — nghĩa là có data engagement nhưng chưa bài nào được classify sentiment hôm đó (hiếm, có thể do job `classify-sentiment` lỗi riêng ngày đó, xem known gap trong schema doc phần 1)

Row không có `engagement` (topic không nằm trong 8 keyword deep-crawl hôm đó, tức `engagement === null` ở cấp `EnrichedHotTopicRow`) giữ nguyên 1 dòng như hiện tại — không có dòng phụ, không thay đổi gì so với UI hiện tại.

**`FacebookSummarySection.tsx`** (mới) — chỉ render ở sector page, đặt ngay dưới `<Topbar>`, trước `<HotTopicsSection>`:
```tsx
export function FacebookSummarySection({ summary }: { summary: FacebookSummary | null }) {
  // Card style: bg-surface border-line rounded-card shadow-card p-6,
  // giống HotTopicsSection/ArticlesSection đã restyle.
  // summary === null → "Chưa có dữ liệu Facebook hôm nay." (text-sm text-ink-3),
  // cùng pattern empty-state với HotTopicsSection hiện có.
  // summary !== null → header "Facebook hôm nay: {postCount} bài · {totalEngagement} tương tác",
  // 3 progress bar rows (Tích cực/Trung lập/Tiêu cực) — bar nền bg-muted,
  // fill color: success/ink-3(xám)/danger theo tỉ lệ %, giống SentimentBreakdown.tsx của ver1.
}
```

**Page wiring:**
- `app/page.tsx`: sau `getHotTopics`, gọi thêm `enrichHotTopicsWithThreadsData` (Threads reader/sentiment reader), truyền kết quả vào `HotTopicsSection`. Không có `FacebookSummarySection`.
- `app/[slug]/page.tsx`: gọi thêm `enrichHotTopicsWithThreadsData` VÀ `getFacebookSummary`, render `<FacebookSummarySection summary={...} />` trước `<HotTopicsSection>`.

### 5. Error handling

Mỗi load mới (`loadThreadsEngagement`, `loadFacebookSummary`) bọc try/catch riêng ở page level, giống `loadHotTopics`/`loadArticles` hiện có — lỗi ở phần engagement/sentiment không làm sập phần hot topics/articles đang chạy tốt. Khác với 2 phần kia: lỗi ở đây **không hiện thông báo đỏ** — vì đây là data bổ sung, không phải nội dung chính; lỗi thì coi như "không có data" (engagement = null / summary = null), chỉ `console.error` để debug, không hiện gì cho người dùng thấy khác biệt so với "chưa có data hôm nay".

### 6. Testing

Theo đúng convention dashboard hiện có (Fake reader implement interface + test riêng, xem `tests/fakes/fake-candidate-topics-reader.ts` + `tests/get-hot-topics.test.ts`):
- `tests/fakes/fake-threads-engagement-reader.ts`, `fake-threads-sentiment-reader.ts`, `fake-facebook-engagement-reader.ts`, `fake-facebook-sentiment-reader.ts`
- `tests/topic-engagement.test.ts` (test `groupSentimentCounts`, `computeSentimentIndex`, `attachEngagement`)
- `tests/get-topic-engagement.test.ts` (test orchestration với fake reader)
- `tests/facebook-summary.test.ts` + `tests/get-facebook-summary.test.ts`

Component JSX (`HotTopicsSection`, `FacebookSummarySection`) không có test riêng — đúng quy ước hiện có của dự án (không có `@testing-library/react`).

## Nguồn tham khảo

Công thức `computeSentimentIndex` adapt từ `C:\Users\user\Social Listening\lib\sentiment-index.ts`. Visual pattern bar breakdown tham khảo `C:\Users\user\Social Listening\components\dashboard\SentimentBreakdown.tsx` (không copy code, build lại bằng token của ver2).
