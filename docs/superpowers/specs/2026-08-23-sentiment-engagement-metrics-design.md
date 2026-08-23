# Sentiment + Engagement Metrics — sub-project 3 (phần 1: data layer)

**Ngày:** 2026-08-23
**Trạng thái:** Approved, chờ viết plan
**Thuộc:** [2026-08-20-social-listening-architecture-design.md](./2026-08-20-social-listening-architecture-design.md) §2 — sub-project 3 ("Trend / share-of-voice computation"), phần còn lại sau khi 2 công thức trending score/share of voice đã được giải quyết trong [2026-08-21-dashboard-design.md](./2026-08-21-dashboard-design.md) §Công thức. Tiếp nối sau [Threads deep-crawl (2b)](./2026-08-23-deep-crawl-threads-design.md) và [Facebook deep-crawl (2c)](./2026-08-23-deep-crawl-facebook-design.md) — cả 2 đã live, cung cấp dữ liệu social thật (`topic_social_data`, `facebook_page_data`) mà spec này xử lý.

## 1. Phạm vi

**Chỉ tầng tính toán + lưu DB** — sentiment classification và engagement aggregation. **Không đụng dashboard UI** — hiển thị (card/badge sentiment, biểu đồ engagement) để dành 1 vòng brainstorm riêng sau, đúng cách 2b/2c đã tách "backend trước, hiển thị sau" (dashboard hiện chỉ đọc `candidate_topics`/`articles`, chưa đọc bất kỳ bảng social nào).

Không định nghĩa công thức "buzz score"/trend tổng hợp mới ở bước này — chỉ tổng hợp số liệu thô (SUM/COUNT). Công thức thật (nếu cần) để dành cho vòng brainstorm dashboard tiếp theo, đúng nguyên tắc YAGNI đã áp dụng cho trending score/share of voice (2 công thức đó cũng cố tình không lưu DB, tính lúc render).

## 2. Sentiment classification

### 2.1 Schema

Thêm cột `sentiment` (nullable) vào cả 2 bảng deep-crawl hiện có:

```sql
alter table topic_social_data
  add column sentiment text check (sentiment in ('positive', 'negative', 'neutral'));

alter table facebook_page_data
  add column sentiment text check (sentiment in ('positive', 'negative', 'neutral'));
```

`NULL` = chưa phân loại (bài mới crawl, hoặc job phân loại lỗi/bỏ qua). Không có nhãn `'none'`/`'unknown'` riêng — khác với `category_hint` (vốn có thể hợp lệ là "không thuộc category nào"), sentiment luôn có 1 trong 3 giá trị khi đã phân loại, hoặc `NULL` khi chưa.

### 2.2 Client: `src/lib/openai-sentiment-classifier.ts`

Tái dùng nguyên pattern `src/lib/candidate-classifier.ts` (native `fetch`, `gpt-5-nano`, `response_format: json_object`, `AbortController` + timeout) — khác ở chỗ input là **nội dung bài viết** thay vì từ khoá đơn lẻ:

```typescript
export type SentimentLabel = 'positive' | 'negative' | 'neutral';

export interface SentimentClassifier {
  classify(posts: { id: string; text: string }[]): Promise<Record<string, SentimentLabel>>;
}
```

- Input là `{id, text}[]` (id = uuid của dòng trong `topic_social_data`/`facebook_page_data`, không phải `post_url` — uuid ngắn gọn, không cần escape).
- Text gửi lên LLM **cắt còn tối đa 500 ký tự đầu** trước khi đưa vào prompt — sentiment không cần toàn bộ caption dài, và giữ kích thước prompt/chi phí dễ dự đoán khi 1 chunk gồm nhiều bài.
- Output parse giống `candidate-classifier.ts`: JSON object `{id: label}`, validate `label` nằm trong `SentimentLabel` trước khi áp dụng — không tin tưởng LLM trả đúng luôn (bài học đã ghi ở `candidate-classifier.ts`/`discovery-ingest.ts`: "label từ JSON.parse là type annotation, không phải runtime guarantee").
- Không cần `FakeSentimentClassifier` riêng biệt về code — interface giống hệt hình dạng `CandidateClassifier`, implementer viết theo pattern test double đã có sẵn cho `CandidateClassifier` trong `tests/fakes/`.

### 2.3 Job: `classify-sentiment.ts`

Logic thuần (tách khỏi entrypoint I/O, TDD được — đúng pattern toàn project):

1. Đọc tất cả dòng `sentiment IS NULL` từ `topic_social_data` **và** `facebook_page_data` (không giới hạn theo `date` — nếu 1 lần chạy lỡ bỏ sót bài nào, lần sau vẫn nhặt lại được, tự nhiên idempotent vì query luôn chỉ lấy phần chưa xử lý).
2. Gộp cả 2 nguồn thành 1 danh sách `{id, text}`, giữ riêng biệt biết dòng nào thuộc bảng nào để update đúng bảng.
3. Chunk **20 bài/lần gọi** — nhỏ hơn `CLASSIFY_CHUNK_SIZE=50` của category classifier (`discovery-ingest.ts`) vì mỗi bài text dài hơn nhiều 1 từ khoá đơn, tránh lặp lại đúng lỗi timeout đã gặp thật ở production ngày 2026-08-22 (single-batch quá lớn → "This operation was aborted" trên `gpt-5-nano`).
4. Mỗi chunk bọc try/catch riêng — 1 chunk lỗi không chặn các chunk khác (đúng pattern cô lập lỗi xuyên suốt project).
5. Update `sentiment` cho từng dòng theo bảng gốc của nó.

### 2.4 Xử lý thiếu `OPENAI_API_KEY`

Theo đúng convention đã có ở `run-discovery-ingest.ts` (đọc trực tiếp `process.env.OPENAI_API_KEY`, không dùng `getRequiredEnv` bắt buộc): nếu biến này không set, log cảnh báo và **skip toàn bộ job**, không throw — không nên chặn các job khác trong cùng workflow chỉ vì thiếu 1 secret optional.

## 3. Engagement aggregation

### 3.1 Schema — 2 bảng riêng biệt

Không gộp chung 1 bảng — đúng lý do 2c đã tách khỏi `topic_social_data` (Threads centric quanh `keyword`, Facebook centric quanh `category`, ép chung 1 shape sẽ để cột null/giả sai bản chất):

```sql
create table if not exists threads_engagement_daily (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  keyword text not null,
  category text, -- nullable: null nếu candidate_topics không có category_hint cho (keyword, date) này ngày đó
  total_like_count integer not null default 0,
  total_reply_count integer not null default 0,
  total_repost_count integer not null default 0,
  total_quote_count integer not null default 0,
  total_share_count integer not null default 0,
  total_view_count integer not null default 0,
  post_count integer not null default 0,
  computed_at timestamptz not null default now(),
  unique (date, keyword)
);

create table if not exists facebook_engagement_daily (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  category text not null check (category in ('tai_chinh', 'giai_tri', 'du_lich')),
  total_like_count integer not null default 0,
  total_comment_count integer not null default 0,
  total_share_count integer not null default 0,
  post_count integer not null default 0,
  computed_at timestamptz not null default now(),
  unique (date, category)
);
```

`category` ở `threads_engagement_daily` **nullable** — join ngược qua `candidate_topics(keyword, date)` để lấy `category_hint[0]` (keyword có thể thuộc nhiều category; lấy phần tử đầu, đúng simplification "full trọng số" đã chấp nhận ở dashboard spec cho share of voice — không chia nhỏ theo từng category). Nếu không tìm thấy dòng `candidate_topics` khớp (hiếm, nhưng có thể xảy ra nếu dữ liệu bị dọn/archive khác lịch), `category = NULL` thay vì lỗi — giải quyết đúng known gap đã ghi ở [schema doc 2b](./2026-08-23-deep-crawl-threads-database-schema.md#known-gaps--limitations): *"Không có cột category_hint copy từ candidate_topics — nếu sub-project 3 cần lọc topic_social_data theo category, sẽ phải join ngược qua (keyword, date) sang candidate_topics."*

`facebook_engagement_daily.category` **not null** — Facebook đã có category natively từ seed list, không cần join.

### 3.2 Script: `aggregate-engagement.ts`

SQL aggregate thuần (`SELECT ... GROUP BY`), không cần LLM:

1. **Threads**: `GROUP BY keyword` trên `topic_social_data WHERE date = hôm nay`, `SUM` 6 cột engagement + `COUNT(*)`. Join `candidate_topics WHERE keyword = ... AND date = hôm nay` lấy `category_hint[0]`.
2. **Facebook**: `GROUP BY category` trên `facebook_page_data WHERE date = hôm nay`, `SUM` 3 cột engagement + `COUNT(*)`.
3. Upsert vào 2 bảng tương ứng, `onConflict: 'date,keyword'` / `onConflict: 'date,category'`.

### 3.3 Idempotency guard

Khác sentiment (tự nhiên idempotent nhờ `WHERE sentiment IS NULL`), engagement **tính lại từ đầu mỗi lần chạy** (không phải "chỉ tính 1 lần") — vì tổng engagement của 1 ngày có thể tăng nếu `deep-crawl`/`deep-crawl-facebook` chạy lại (dù hiếm, do idempotency guard riêng của chúng). Guard ở đây khác: **upsert đè** (không phải skip) — mỗi lần `aggregate-engagement.ts` chạy, tính lại tổng mới nhất từ dữ liệu hiện có và ghi đè, không cộng dồn. An toàn để chạy nhiều lần/ngày.

## 4. Job & lịch chạy

2 job mới trong `discovery-ingestion.yml`, cả 2 đều `needs: [deep-crawl, deep-crawl-facebook]` (cần dữ liệu mới nhất từ cả 2 nguồn deep-crawl), `if: ${{ !cancelled() }}` — đúng pattern các job khác trong workflow này.

Không cần secret mới cho engagement (chỉ Supabase). Sentiment tái dùng `OPENAI_API_KEY` đã có từ sub-project 2a.

## 5. Cấu trúc code

- `src/lib/openai-sentiment-classifier.ts` — client LLM (I/O thuần, không unit test trực tiếp, giống `candidate-classifier.ts`).
- `src/lib/topic-social-data-repository.ts`, `src/lib/facebook-page-data-repository.ts` — mở rộng thêm method đọc dòng `sentiment IS NULL` + method update sentiment (chi tiết chữ ký ở bước viết plan).
- `src/classify-sentiment.ts` — logic thuần (chunk, cô lập lỗi, gọi classifier, update).
- `src/run-classify-sentiment.ts` — entrypoint thật.
- `src/lib/threads-engagement-repository.ts`, `src/lib/facebook-engagement-repository.ts` — interface + Supabase impl + fake, giống pattern repository đã dùng xuyên suốt project.
- `src/aggregate-engagement.ts` — logic thuần (2 query GROUP BY, map → rows, upsert).
- `src/run-aggregate-engagement.ts` — entrypoint thật.
- Migration `supabase/migrations/0006_add_sentiment_columns.sql`.
- Migration `supabase/migrations/0007_add_engagement_daily_tables.sql`.

## 6. Xử lý lỗi

- 1 chunk sentiment lỗi không chặn chunk khác (đã nêu ở §2.3).
- 1 nguồn (Threads hoặc Facebook) lỗi khi aggregate engagement không chặn nguồn còn lại — try/catch riêng từng nguồn trong `aggregate-engagement.ts`.
- Thiếu `OPENAI_API_KEY` → skip sentiment job hoàn toàn, không lỗi (§2.4).
- Không có dòng nào cần xử lý (0 dòng `sentiment IS NULL`, hoặc 0 dòng social data hôm nay để aggregate) → không lỗi, log "0 xử lý" rồi thoát.

## 7. Testing

Theo đúng convention TDD của project: unit test cho `classify-sentiment.ts` (chunk, cô lập lỗi, mapping id→sentiment→đúng bảng) và `aggregate-engagement.ts` (group-by đúng, join category đúng/thiếu, upsert đè) dùng fake repository/classifier — không gọi API thật. Không test trực tiếp `openai-sentiment-classifier.ts` (I/O thuần, giống `candidate-classifier.ts`).

## 8. Ngoài phạm vi (deliberately deferred)

- **Hiển thị dashboard** (badge sentiment, chart engagement) — vòng brainstorm riêng sau, khi có dữ liệu đủ vài ngày để hiển thị có ý nghĩa.
- **"Buzz score"/công thức trend tổng hợp** kết hợp sentiment + engagement + growth_rate — chưa cần thiết cho tới khi có yêu cầu hiển thị cụ thể (§1).
- **Sentiment cho `articles`** (RSS) — spec này chỉ xử lý dữ liệu social (`topic_social_data`/`facebook_page_data`); tin tức RSS không có khái niệm "sentiment của tác giả" theo cùng nghĩa với bài đăng social, cần cách tiếp cận khác nếu sau này cần.
- **Re-classify khi model/prompt thay đổi** — không có cơ chế "đánh dấu lại NULL để phân loại lại"; nếu cần cải thiện chất lượng sentiment sau này, đó là 1 quyết định riêng (migration đặt lại `sentiment = NULL` có chọn lọc), không tự động.
