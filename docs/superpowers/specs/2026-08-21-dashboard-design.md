# Dashboard — Spec (sub-project 4, gộp một phần thu hẹp của sub-project 3)

**Ngày:** 2026-08-21
**Trạng thái:** Approved, chờ viết plan

## Vì sao gộp một phần sub-project 3 vào đây

Sub-project 3 ("Trend / share-of-voice computation") vốn cố tình để chưa định nghĩa công thức, chờ tự nó được brainstorm riêng. Spec này chỉ giải quyết **đúng 2 công thức dashboard cần hiển thị** — trending score và share of voice — dựa trên dữ liệu đã có sẵn từ sub-project 2a. Không xây một framework tính trend tổng quát, không đụng tới sentiment, không thêm job backend hay bảng mới. Phần nào nằm ngoài phạm vi này vẫn thuộc về 1 buổi brainstorm sub-project 3 đầy đủ hơn sau này, nếu thực sự cần.

## Tham khảo: ver 1

Một lần làm trước đó (repo khác, đã reset, memory còn giữ lại ở project cũ dưới tên `project-overview`/`apify-sources`) từng xây dashboard Next.js tương tự nhưng trên schema khác (Prisma/Postgres, model `Topic`/`Post`/`BuzzSnapshot`, nuôi bởi crawler tự viết). Bố cục trang và **hình dạng công thức** được tham khảo lại ở đây:

- `trendingScore = buzzVolume / avg7dBuzz × 100`, cap ở 999, mặc định 50 nếu chưa có lịch sử
- `shareOfVoice = topicBuzz / sectorTotalBuzz × 100` theo ngày
- Route theo sector: `/tai-chinh` (xanh lá `#16a34a`), `/giai-tri` (hồng `#af006e`), `/du-lich` (xanh dương `#3b82f6`)

Code fetch data, schema DB, model Prisma của ver 1 **không** tái sử dụng — schema ver 2 (`articles`, `candidate_topics`) khác cấu trúc hoàn toàn (không có entity `Topic` cố định; keyword được phát hiện lại mỗi ngày, không phải danh sách theo dõi định sẵn).

## Kiến trúc

- Project Next.js 15 (App Router) + Tailwind CSS mới, đặt tại `dashboard/` (root repo), có `package.json` riêng — tách khỏi các script ingestion ở root (chạy bằng `tsx`, `"type": "module"`) để tránh xung đột dependency/build.
- Deploy lên Vercel, Root Directory = `dashboard/`. Read-only: không cron, không crawl logic, đúng kiến trúc đã chốt ở `2026-08-20-social-listening-architecture-design.md`.
- Không dùng ORM. Fetch data bằng `@supabase/supabase-js` gọi thẳng, **chỉ trong Server Component**, xác thực bằng **service-role key** của Supabase, lưu ở biến môi trường Vercel, không bao giờ gửi ra trình duyệt.
- **Vì sao service-role chứ không phải anon key:** cả `articles` và `candidate_topics` đã bật RLS nhưng chưa có policy nào (migration `0001`, `0003`) — anon key hiện tại không đọc được bảng nào cả. Service-role bypass RLS theo thiết kế, nên dùng được ngay mà không cần mở lại quyết định hoãn RLS.

## Quyền truy cập

Public, không cần đăng nhập — dữ liệu hiển thị (tin tức/trend công khai đã tổng hợp) không nhạy cảm. Xem lại quyết định này nếu sau này có thay đổi.

## Các trang

4 route, theo đúng convention URL sector của ver 1:

- `/` — Overview: gộp cả 3 category
- `/tai-chinh`, `/giai-tri`, `/du-lich` — lọc theo 1 category

Mỗi trang có 2 phần:

1. **Hot topics** — `candidate_topics` đã shortlist (`is_shortlisted = true`) cho ngày gần nhất có dữ liệu, nhóm theo `source` (google_trends / youtube / rss), mỗi dòng hiển thị keyword, trending score, share of voice.
2. **Recent articles** — 20 bài `articles` mới nhất (theo `published_at desc`), lọc theo `categories` chứa category tương ứng ở trang sector, không lọc (mới nhất toàn bộ) ở trang Overview.

Lọc category dùng đúng giá trị snake_case đã có trong `config/sources.config.ts` (`tai_chinh`, `giai_tri`, `du_lich`) khớp với `candidate_topics.category_hint` và `articles.categories` (đều là `text[]`).

## Công thức

### Trending score — tái dùng `growth_rate` có sẵn

`candidate_topics.growth_rate` (tính trong `rank-and-select.ts`) vốn đã là: `(metric_value hôm nay − trung bình metric_value 7 ngày trước) / trung bình đó`, sentinel `999` cho keyword chưa có lịch sử tuần trước. Đã được chuẩn hoá cùng 1 đơn vị (tỷ lệ) trên cả 3 nguồn (`normalizeGrowthRate()` trong `google-trends-source.ts`). Dashboard hiển thị trực tiếp giá trị này (nhân `× 100` để ra dạng phần trăm) làm "Trending score" — **không tính lại, không sửa backend**.

### Share of voice — tính lúc render, không lưu vào DB

Vì đơn vị `metric_value` khác nhau giữa các nguồn (Google Trends = điểm traffic, YouTube = lượt xem, RSS = số bài báo chứa keyword), share of voice tính **riêng theo từng nguồn, trong phạm vi 1 category + 1 ngày** — không gộp giữa các nguồn:

```
share_of_voice(keyword) = metric_value(keyword)
  / Σ metric_value(tất cả candidate cùng nguồn + cùng category + cùng ngày)
  × 100
```

- Mẫu số là **toàn bộ candidate đã evaluate** cho nguồn/category/ngày đó (không chỉ top 10 đã shortlist) — giống cách `sectorTotalBuzz` của ver 1 là tổng thật, không phải tổng của top-N.
- Keyword gắn nhiều category (`category_hint` là mảng) tính **full trọng số** ở từng category nó thuộc về (không chia đều) — simplification, ghi rõ trong spec, chỉ xem lại nếu làm tổng của 1 category bị lệch rõ rệt.
- Tính ngay trong tầng data-fetching của dashboard, từ các dòng `candidate_topics` đã fetch cho trang đó — **không thêm cột Supabase mới, không sửa `rank-and-select.ts`**.
- Trang Overview (gộp category): share of voice hiển thị theo từng nguồn, dùng đúng phạm vi category mà keyword đó thuộc về làm mẫu số — không có 1 con số "share of voice toàn bộ" duy nhất, vì các category không phải phân vùng loại trừ lẫn nhau của 1 tổng chung. Với keyword chỉ thuộc **đúng 1 category**, con số này giống hệt con số sẽ hiện ở trang sector của keyword đó. Với keyword thuộc **nhiều category** (`category_hint` có &gt;1 phần tử) — không có "trang sector duy nhất" nào để khớp theo — Overview hiển thị **trung bình cộng** của các giá trị share of voice riêng theo từng category nó thuộc về (mỗi giá trị vẫn tính đúng công thức trên, riêng cho category đó). Đây là quyết định bổ sung được chốt sau khi final review của sub-project 4 chỉ ra câu chữ gốc ở trên không rõ với trường hợp nhiều category — implementation (`buildHotTopicsOverview` trong `dashboard/lib/hot-topics.ts`) đã làm đúng theo hướng trung bình cộng này từ đầu; đoạn này chỉ ghi lại quyết định cho khớp với spec. Keyword không có category nào (`category_hint` rỗng) → share of voice là `null` (hiển thị "—"), không phải 0.

## Xử lý lỗi

- Không có dòng `candidate_topics` nào cho ngày cần hiển thị (cron chưa chạy, hoặc vừa deploy trước lần chạy đầu) → hiện empty-state rõ ràng theo từng phần, không crash trang.
- Supabase query lỗi → bắt lỗi riêng theo từng phần, hiện trạng thái lỗi inline; 1 phần lỗi không kéo sập cả trang.

## Testing

Theo đúng convention TDD của project: viết vitest cho các hàm xử lý dữ liệu thuần (nhóm theo source, lọc theo category, tính share of voice) tách biệt khỏi phần wiring Next.js/Supabase. Không viết E2E cho bản MVP (YAGNI).

## Ngoài phạm vi spec này

- Sentiment analysis (chưa có nguồn dữ liệu — thuộc phạm vi Apify/2b)
- Biểu đồ lịch sử/theo thời gian (`/trending`, `/analytics`, trang chi tiết topic của ver 1) — xem lại khi có nhiều hơn vài ngày dữ liệu
- Bất kỳ framework tính trend tổng quát nào ngoài 2 công thức trên
- Đăng nhập/xác thực
- Apify deep-crawl (2b) — cố tình hoãn, làm sau khi dashboard này xong

## Simplification đã biết (giữ nguyên, không xử lý ở đây)

- "Full trọng số theo từng category" của share of voice có thể làm tổng của 1 category bị đội lên nếu keyword thuộc nhiều category — chấp nhận được cho MVP, xem lại nếu tổng hiển thị sai lệch rõ.
- Trending score hiển thị (`growth_rate × 100`) kế thừa toàn bộ lưu ý đã ghi ở `growth_rate` trong `2026-08-21-discovery-layer-database-schema.md` (recompute mỗi lần chạy với nguồn không phải Google Trends, đứng yên theo ngày với Google Trends, sentinel 999, date tính theo UTC chứ không phải ICT).
