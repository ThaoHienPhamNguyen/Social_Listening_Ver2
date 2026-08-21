# Discovery Layer — Database Schema

**Ngày:** 2026-08-21
**Trạng thái:** Chưa deploy — migration 0003 chưa apply lên production
**Thuộc:** chi tiết hoá phần data model của [2026-08-21-discovery-layer-design.md](./2026-08-21-discovery-layer-design.md) §3, phản ánh đúng migration đã viết (`supabase/migrations/0003_create_candidate_topics_table.sql`), chưa phải bản đã chạy thật trên Supabase.

## Sơ đồ

Thêm 1 bảng mới — `candidate_topics` — bên cạnh `articles` đã có từ sub-project 1 (xem [2026-08-20-rss-ingestion-database-schema.md](./2026-08-20-rss-ingestion-database-schema.md)). `articles` không đổi schema ở sub-project này; `RssTopicSource` chỉ đọc từ nó, không ghi thêm cột.

```mermaid
erDiagram
    candidate_topics {
        uuid id PK
        text source
        text keyword
        date date
        numeric metric_value
        numeric growth_rate
        text_array category_hint
        boolean is_shortlisted
        timestamptz created_at
        timestamptz updated_at
    }
```

## Chi tiết cột

| Cột | Kiểu | Ràng buộc | Ghi chú |
|---|---|---|---|
| `id` | `uuid` | PK, `default gen_random_uuid()` | tự sinh, không truyền lúc insert |
| `source` | `text` | `not null`, `check (source in ('google_trends', 'youtube', 'rss'))` | đúng 3 nguồn discovery trong phạm vi sub-project 2a |
| `keyword` | `text` | `not null` | đã chuẩn hoá lowercase + trim ở tầng app (từng adapter tự làm việc này trước khi upsert) |
| `date` | `date` | `not null` | ngày ghi nhận tín hiệu, không phải timestamp — dùng để nhóm candidate theo ngày cho `getTodayCandidates`/`rankAndSelect` |
| `metric_value` | `numeric` | `not null default 0` | số liệu thô, **đơn vị khác nhau theo nguồn**: traffic (Google Trends), view count (YouTube), tần suất xuất hiện trong tiêu đề bài báo trong **cửa sổ rolling 24 giờ tính từ lúc job chạy** (RSS, `LOOKBACK_DAYS = 1` từ 2026-08-21 — không phải mốc 00:00 theo lịch, xem `ArticleRepository.getRecentTitles`) |
| `growth_rate` | `numeric` | nullable | tỷ lệ thay đổi so với baseline 7 ngày, **cùng đơn vị cho cả 3 nguồn** kể từ 2026-08-21 — Google Trends chuẩn hoá về tỷ lệ qua `normalizeGrowthRate()` (chia %/100) trước khi lưu và KHÔNG bao giờ bị `rank-and-select.ts` tính lại; YouTube/RSS luôn `null` lúc fetch, được `rank-and-select.ts` tính lại **mỗi lần chạy** (không chỉ lần đầu trong ngày, để luôn khớp với `metric_value` mới nhất — xem Known gaps về lý do). Giá trị sentinel **`999`** khi từ khoá chưa có lịch sử 7 ngày (mới xuất hiện) hoặc baseline trung bình bằng 0 — cố ý đặt cao hơn hẳn tỷ lệ tăng trưởng thực tế thông thường, để từ khoá hoàn toàn mới luôn được ưu tiên xét vào shortlist trước (`NEW_KEYWORD_GROWTH_RATE` trong `rank-and-select.ts`) |
| `category_hint` | `text[]` | `not null default '{}'` | category suy ra từ `matchCategories()`, dùng chung bộ từ khoá `categoryKeywords` với `categorize()` của sub-project 1 (không gọi trực tiếp hàm `categorize()` — 2 hàm implement logic matching riêng, xem Known gaps); có thể rỗng nếu từ khoá không match category nào |
| `is_shortlisted` | `boolean` | `not null default false` | job `rank-and-select` set `true` cho candidate lọt top-10/nguồn (mặc định `DEFAULT_TOP_PER_SOURCE = 10` từ 2026-08-21); xem mục Known gaps về việc cờ này không bao giờ bị reset |
| `created_at` | `timestamptz` | `not null default now()` | |
| `updated_at` | `timestamptz` | `not null default now()` | tự cập nhật qua trigger `candidate_topics_set_updated_at` (cùng migration `0003`, dùng lại function `set_updated_at()` đã tạo ở migration `0002`) |

Ràng buộc bổ sung: `unique (source, keyword, date)` — key dedup, `upsertCandidate` dùng `onConflict: 'source,keyword,date'` để ghi đè thay vì tạo bản trùng khi cùng 1 nguồn/từ khoá xuất hiện lại trong cùng ngày.

## Index

- `candidate_topics_date_idx` — btree trên `date`, phục vụ `getTodayCandidates(date)` (job `rank-and-select` đọc toàn bộ candidate của 1 ngày).
- `candidate_topics_shortlisted_idx` — btree trên `is_shortlisted`, phục vụ sub-project 2b (Apify deep-crawl) lọc `is_shortlisted = true`.
- Ràng buộc `unique (source, keyword, date)` đồng thời đóng vai trò index hỗ trợ `getRecentMetrics(source, keyword, sinceDate, beforeDate)` — query này lọc theo đúng 3 cột đầu của unique constraint (cộng thêm range trên `date`), nên tận dụng được index của constraint mà không cần thêm index riêng.

`getTodayCandidates` sắp theo `metric_value` giảm dần và giới hạn 5000 dòng (safety net theo giới hạn "Max rows" mặc định của PostgREST trên Supabase, không phải giá trị đã tune). Kể từ 2026-08-21, mỗi nguồn tự giới hạn tối đa 200 candidate trước khi ghi (`aggregate-rss-keywords.ts`/`aggregate-youtube-keywords.ts`), nên tổng số dòng/ngày thường dưới ~600 — giới hạn 5000 gần như không bao giờ bị chạm tới nữa trong vận hành bình thường, chỉ còn là lớp an toàn cuối cùng.

## Row Level Security

`alter table candidate_topics enable row level security;` — **bật nhưng chưa có policy nào**, cùng trạng thái với `articles` (xem [RSS ingestion schema doc](./2026-08-20-rss-ingestion-database-schema.md#row-level-security)). An toàn ở giai đoạn hiện tại vì toàn bộ ghi/đọc đều qua `service_role` key (bypass RLS) trong GitHub Actions; chặn hoàn toàn truy cập qua `anon`/`publishable` key cho tới khi có consumer thật (dashboard sub-project 4, hoặc sub-project 2b nếu đọc trực tiếp bằng key public) cần thêm policy.

## Known gaps / limitations

**Đã fix (2026-08-21, cùng ngày merge, theo yêu cầu người dùng xử lý các finding còn tồn đọng từ review cuối):**

- **Đơn vị `growth_rate` đã đồng nhất giữa 3 nguồn** — `GoogleTrendsSource` giờ chia `trafficGrowthRate` cho 100 (`normalizeGrowthRate()`) trước khi lưu, cùng đơn vị tỷ lệ với YouTube/RSS.
- **RSS `metric_value` đổi từ cửa sổ rolling 5 ngày sang cửa sổ rolling 24 giờ** (`RssTopicSource.LOOKBACK_DAYS` 5 → 1) — nhạy hơn hẳn cửa sổ 5 ngày cũ, đúng tinh thần spec §4 (tần suất "trong ngày"), dù về mặt kỹ thuật không phải mốc 00:00 theo lịch mà là 24h tính lùi từ lúc job chạy (`ArticleRepository.getRecentTitles` dùng `Date.now() - days*24h`). Baseline 7 ngày để tính `growth_rate` không đổi — vẫn tự đọc lịch sử `metric_value` từng ngày từ `candidate_topics`.
- **Giới hạn khối lượng từ khoá + gom ghi thành lô**: `aggregateRssKeywords`/`aggregateYouTubeKeywords` giờ chỉ giữ top 200 candidate/nguồn theo `metric_value` (`capCandidates()`, vì chỉ top-10/nguồn mới vào shortlist, giữ 200 là dư sức). `discovery-ingest.ts` ghi theo lô (`CandidateTopicRepository.upsertCandidates()`, tối đa 200 dòng/lần gọi) thay vì từng dòng một — giảm số round-trip DB từ hàng nghìn xuống còn 1 lần/nguồn trong vận hành bình thường.
- **Shortlist mở rộng từ top-5 lên top-10/nguồn** (`DEFAULT_TOP_PER_SOURCE` trong `rank-and-select.ts`) — quyết định của người dùng.
- **Sửa lỗi mất `growth_rate`/`is_shortlisted` khi cùng 1 từ khoá bị ingest lại trong ngày**: workflow chạy `discovery-ingest` → `rank-and-select` 3 lần/ngày, cùng ghi vào 1 `date`. Trước fix, mỗi lần `discovery-ingest` chạy lại đều ghi đè `growth_rate`/`is_shortlisted` về null/false vô điều kiện cho MỌI từ khoá — kể cả từ khoá đã được `rank-and-select` tính/gắn shortlist ở lần chạy trước đó cùng ngày. `discovery-ingest.ts` giờ chỉ đưa `growth_rate` vào payload khi nguồn tự cung cấp giá trị thật (Google Trends — luôn mới mỗi lần fetch, an toàn để ghi đè); YouTube/RSS (`growth_rate` luôn null lúc fetch) và `is_shortlisted` (chỉ `rank-and-select` được set) hoàn toàn không xuất hiện trong payload upsert — dựa vào cơ chế merge theo cột của Supabase/PostgREST khi conflict (cột vắng mặt trong payload thì không bị đụng tới), cùng cơ chế mà `upsertCandidate`/`upsertCandidates` đã dùng từ đầu (không set `ignoreDuplicates: true`). Batch upsert còn được tách theo tính đồng nhất của `growth_rate` trước khi gộp lô (PostgREST suy ra 1 danh sách cột chung từ toàn bộ hàng trong 1 lần gọi — trộn hàng có/không `growth_rate` trong cùng 1 batch sẽ khiến hàng thiếu bị ghi đè NULL thay vì giữ nguyên), và lệnh ghi được bọc try/catch để lỗi mạng không làm crash toàn bộ vòng lặp qua các nguồn còn lại.
- **Sửa lỗi `growth_rate` bị "đông cứng" cả ngày sau lần tính đầu tiên**: `rank-and-select.ts` trước đây chỉ tính lại `growth_rate` khi nó còn `null` (`if (growth_rate !== null) continue`) — sau fix "không reset" ở trên, `growth_rate` của YouTube/RSS không còn bị xoá về null giữa các lần chạy, nên điều kiện này khiến nó chỉ được tính **1 lần duy nhất trong ngày** (ở lần `rank-and-select` đầu tiên gặp từ khoá đó), dù `metric_value` vẫn tiếp tục cập nhật mới ở các lần `discovery-ingest` sau. Sửa: điều kiện bỏ qua tính lại đổi thành `source === 'google_trends'` (chỉ nguồn này có `growth_rate` do chính nguồn cung cấp) — YouTube/RSS giờ được tính lại **mỗi lần `rank-and-select` chạy**, luôn khớp với `metric_value` mới nhất.
- **`GoogleTrendsSource` giờ dedupe theo từ khoá đã chuẩn hoá** (`toRawCandidates()`, giữ mục có `traffic` cao hơn khi trùng) — trước đó không dedupe; nếu 2 mục trong response gốc trùng nhau sau khi hạ chữ thường + trim, cả batch upsert của Google Trends sẽ lỗi (Postgres từ chối `ON CONFLICT DO UPDATE` đụng cùng 1 dòng 2 lần trong 1 câu lệnh), làm mất toàn bộ candidate hôm đó của nguồn này, không chỉ mục trùng.

**Cố ý chưa xử lý:**

- **`is_shortlisted` chỉ được set `true`, không bao giờ reset lại `false` cho ngày cũ** — sub-project 2b (Apify deep-crawl) cần tự lọc theo `date`, không chỉ theo `is_shortlisted`.
- `rank-and-select.ts` vẫn đọc/ghi `growth_rate` từng dòng một (`getRecentMetrics`/`updateGrowthRate`), chưa gom lô — quyết định có chủ đích: sau khi giới hạn 200 candidate/nguồn, khối lượng tối đa còn lại (~400-600 dòng/ngày) đủ nhỏ để chấp nhận được mà không cần thêm 1 SQL function tùy chỉnh (Supabase client không hỗ trợ batch UPDATE theo giá trị khác nhau cho từng dòng).
- **`matchCategories()` (discovery layer) và `categorize()` (sub-project 1) là 2 hàm implement logic matching từ khoá riêng biệt**, dù cùng đọc chung `categoryKeywords` config — không có 1 hàm dùng chung. Quyết định có chủ đích từ lúc viết plan (không phải lỗi); rủi ro: nếu sau này đổi rule matching (word-boundary, chuẩn hoá dấu...) ở 1 trong 2 hàm mà quên đổi hàm kia, category của `articles` và `category_hint` của `candidate_topics` sẽ lệch nhau.
- **Cột `date` tính theo lịch UTC** (`now().toISOString().slice(0, 10)`, giống nhau ở cả `discovery-ingest.ts` và `rank-and-select.ts` nên 2 job luôn đồng bộ với nhau), không phải lịch giờ Việt Nam (ICT, UTC+7). An toàn với lịch cron hiện tại (`0 2,5,14 * * *` UTC — không lần nào gần mốc 00:00 UTC hay 00:00 ICT), nhưng nếu sau này đổi lịch chạy tới gần 1 trong 2 mốc nửa đêm đó, `date` có thể lệch 1 ngày so với ngày thực tế theo giờ Việt Nam.
- **`CandidateTopicRepository.upsertCandidate()` (số ít) không có trong bất kỳ đường gọi sản xuất nào** — `discovery-ingest.ts` chỉ dùng `upsertCandidates()` (số nhiều, theo lô) từ khi đổi sang batch. Hàm số ít vẫn nằm trong interface (dùng nội bộ bởi `FakeCandidateTopicRepository.upsertCandidates()` và test riêng của nó) nhưng KHÔNG có cơ chế bảo vệ "không reset growth_rate/is_shortlisted" mà `upsertCandidates()` có — nếu sau này có code mới gọi trực tiếp `upsertCandidate()`, sẽ tái lặp đúng lỗi mất `growth_rate`/`is_shortlisted` đã fix ở trên.
- **`extractKeywords()` sinh bigram kể cả khi 2 từ không thực sự đứng cạnh nhau trong câu gốc** — filter stop-word/từ ngắn chạy TRƯỚC bước ghép bigram, nên ví dụ `"vàng và bạc"` (sau khi bỏ từ dừng "và") sinh ra bigram giả `"vàng bạc"` dù 2 từ này không liền kề trong tiêu đề gốc. Ảnh hưởng: tăng nhẹ số lượng candidate không thực sự phản ánh cụm từ thật, góp phần vào khối lượng từ khoá (đã giảm bớt tác động nhờ giới hạn top-200/nguồn ở trên, nhưng bản thân lỗi logic này chưa fix).
