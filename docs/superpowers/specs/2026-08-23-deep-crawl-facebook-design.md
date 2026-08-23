# Deep-crawl Facebook — sub-project 2c

**Ngày:** 2026-08-23
**Trạng thái:** Đã implement — 8/8 task hoàn thành, chờ merge
**Thuộc:** lớp deep-crawl trong [2026-08-20-social-listening-architecture-design.md](./2026-08-20-social-listening-architecture-design.md) §2/§4 — phần "Apify / social media crawl ingestion" của sub-project 2, sau [discovery layer (2a)](./2026-08-21-discovery-layer-design.md) và [Threads deep-crawl (2b)](./2026-08-23-deep-crawl-threads-design.md).

## 1. Phạm vi

Chỉ **Facebook**, dùng actor `apify/facebook-posts-scraper` — đã verify hoạt động ở spike đo giá của 2b (2026-08-23), giá ~$0.005-$0.026/bài tùy tier.

Facebook phá vỡ giả định cốt lõi mà 2b dùng cho Threads: actor **không hỗ trợ search theo từ khóa**, chỉ nhận URL Page/Group cụ thể (`startUrls`). Do đó không thể tái dùng mô hình "shortlist → search" — cần mô hình seed-list riêng, và dữ liệu crawl về không tự nhiên gắn với 1 `keyword` trending nào.

Spike 2b cũng đo được **độ tin cậy per-page thấp**: thử 3 trang public lớn (VnExpress, Tuổi Trẻ, VTV), chỉ Tuổi Trẻ thành công, 2 trang còn lại fail (`not_available`/`no_items`). Thiết kế này coi tỷ lệ fail cao là baseline cần sống chung, không phải bug cần chờ fix.

## 2. Data model: gắn theo category, bảng riêng

Vì không có keyword, bài viết Facebook được gắn với **category** (tai_chinh/giai_tri/du_lich) — category gán sẵn cho từng Page khi curate seed list, không suy ra từ `candidate_topics`.

Bảng mới `facebook_page_data`, **tách khỏi `topic_social_data`** (bảng đó centric quanh `keyword`, ép Facebook vào sẽ để `keyword` null/giả — sai bản chất dữ liệu):

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | uuid, PK | |
| `page_url` | text | URL Page nguồn, khớp seed list |
| `category` | text | check `in ('tai_chinh','giai_tri','du_lich')` |
| `date` | text | ngày deep-crawl chạy |
| `post_url` | text | |
| `text_content` | text | |
| `like_count`, `comment_count`, `share_count` | integer, nullable | engagement thô — tên cột generic, map từ field thật của actor lúc implement (actor có thể trả `reactions_count`/`likes` khác tên, xác nhận qua dataset mẫu ở Task đầu implement) |
| `posted_at` | timestamptz | |
| `fetched_at` | timestamptz, default now() | |

Unique `(page_url, post_url)`. Migration `0005_add_facebook_page_data.sql`, index theo `date`, RLS bật không policy — đúng convention các bảng khác trong project.

## 3. Seed list: hard-code, dư để chịu lỗi

`src/lib/facebook-seed-pages.ts` — mảng hard-code `{ url: string; category: Category }[]`, sửa = sửa code + commit (giống cách RSS feeds đang liệt kê). Không cần bảng Supabase quản trị riêng — quy mô nhỏ, chưa cần UI.

**2 page/category × 3 category = 6 page**, cố ý dư so với mức cần (dựa spike: kỳ vọng thực tế chỉ 1-2/category ra dữ liệu). Danh sách cụ thể (VnExpress, Tuổi Trẻ, VTV đã test + các trang khác cần chọn) chốt ở bước viết plan/implement, không chốt ở spec này.

## 4. Xử lý lỗi: cô lập per-page, không retry

Mỗi lần gọi actor cho 1 page bọc try/catch riêng — lỗi 1 page không chặn các page còn lại (đúng pattern cô lập lỗi xuyên suốt project: RSS ingestion, discovery-ingest, deep-crawl Threads).

**Không retry khi lỗi** — spike chưa xác định được lỗi là transient (actor tạm thời không đọc được trang) hay vĩnh viễn (actor không hỗ trợ cấu trúc trang đó). Retry mù trong lúc chưa rõ nguyên nhân chỉ tốn thêm chi phí/thời gian mà không chắc tăng tỷ lệ thành công. Nếu dữ liệu thật cho thấy lỗi có vẻ transient, đó là điều chỉnh cho lần sau, không phải v1.

## 5. Ngân sách: thăm dò nhỏ trước, có đường scale sau

Không chốt ngân sách cứng như 2b (đã đo giá thật $0.195/topic) — vì chưa biết tỷ lệ fail/giá thật ở seed-list model này. Thay vào đó **khởi động nhỏ, đo giá thật ở lần chạy live đầu, rồi mới quyết mở rộng**:

- `MAX_POSTS_PER_PAGE = 15` (const, dễ chỉnh sau)
- 6 page × 1 lần/ngày
- `maxTotalChargeUsd` per-call an toàn cứng (ví dụ $0.3/page-call) — cùng pattern 2b, chặn runaway cost nếu actor lỗi mà không chặn vận hành bình thường
- Trần lý thuyết nếu **cả 6 page đều thành công**: 6 × 15 = 90 bài/ngày × giá cao nhất đo được ($0.026/bài) ≈ $2.34/ngày ≈ **$70/tháng worst-case** — nhưng vì spike cho thấy ~2/3 page fail, chi phí thực tế nhiều khả năng thấp hơn đáng kể. Con số thật sẽ đo ở lần `workflow_dispatch` verify đầu tiên, giống cách 2b làm.

**Đường mở rộng sau này (không cần redesign):** nếu tỷ lệ fail thấp hơn dự đoán, tăng `MAX_POSTS_PER_PAGE` hoặc thêm page vào seed list — thay đổi hằng số/mảng, không đổi kiến trúc. Nếu fail nhiều như dự đoán, có thể thêm page dự phòng cho category đang thiếu dữ liệu.

## 6. Job & lịch chạy

Job riêng trong `discovery-ingestion.yml`. Khác 2b: **không phụ thuộc `candidate_topics`** (seed list tĩnh, không suy ra từ shortlist hôm đó) — không cần `needs: [discovery-ingest, rank-and-select]`, có thể chạy song song hoặc độc lập.

**Idempotency guard** giống 2b: đầu job check `facebook_page_data` đã có dòng nào cho `date` hôm nay chưa — có thì skip, exit 0. Lý do giữ nguyên: an toàn với `workflow_dispatch` chạy tay nhiều lần cùng ngày, không phụ thuộc lịch cron cụ thể.

## 7. Gọi Apify

Client mới `src/lib/apify-facebook-client.ts` (native `fetch`, cùng phong cách `apify-threads-client.ts`), gọi actor `apify/facebook-posts-scraper` qua `run-sync-get-dataset-items`:

```
POST https://api.apify.com/v2/acts/apify~facebook-posts-scraper/run-sync-get-dataset-items?token=...&maxTotalChargeUsd=0.3
Body: { startUrls: [{ url: pageUrl }], resultsLimit: 15, maxTotalChargeUsd: 0.3 }
```

(Tên field input thật của actor — `startUrls`/`resultsLimit` — xác nhận lại ở implement qua Apify Console/docs, có thể khác tên; giữ đúng cấu trúc query-param + body cho `maxTotalChargeUsd` như 2b đã học được — bài học từ 2b: chỉ để trong body có thể bị actor bỏ qua.)

`FETCH_TIMEOUT_MS = 300000` — cùng lý do 2b (Apify server-side cutoff cho run-sync-* endpoint).

**Secret dùng chung `APIFY_TOKEN`** đã có sẵn từ 2b — không cần thêm secret mới.

## 8. Cấu trúc code

Theo đúng pattern 2b (pure logic tách khỏi entrypoint I/O thật, TDD được):

- `src/lib/apify-facebook-client.ts` — wrapper gọi Apify (I/O thuần, không unit test trực tiếp).
- `src/lib/facebook-seed-pages.ts` — seed list hard-code.
- `src/lib/facebook-page-data-repository.ts` — interface + `SupabaseFacebookPageDataRepository` + `FakeFacebookPageDataRepository` (test double).
- `src/deep-crawl-facebook.ts` — logic thuần: loop seed list, gọi client, cô lập lỗi per-page, map kết quả → rows (gắn category từ seed list), upsert.
- `src/run-deep-crawl-facebook.ts` — entrypoint thật, script `npm run deep-crawl-facebook`.
- Migration `supabase/migrations/0005_add_facebook_page_data.sql`.

## 9. Ngoài phạm vi (deliberately deferred)

- **Dashboard hiển thị `facebook_page_data`**: cần 1 vòng thiết kế riêng (sub-project 4 hiện chỉ đọc `candidate_topics`/`articles`).
- **Sentiment / trend-compute**: sub-project 3, chưa brainstorm.
- **TikTok deep-crawl**: chưa đo giá/reliability thật.
- **Bảng quản trị seed list qua Supabase/UI**: v1 hard-code trong code, đủ dùng ở quy mô 6 page.
- **Retry logic**: v1 không retry, xem §4.
