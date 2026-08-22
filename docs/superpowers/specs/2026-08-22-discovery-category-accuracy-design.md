# Discovery layer — gán category chính xác hơn (sửa sector page trống)

**Ngày:** 2026-08-22
**Trạng thái:** Approved trong brainstorm, chờ user review file này trước khi viết plan
**Phạm vi:** Sửa cơ chế gán `category_hint` cho `candidate_topics` (sub-project 2a, đang live production) và ngưỡng shortlist trong `rank-and-select.ts`. Không đụng schema Supabase (không cần migration mới — `category_hint`, `is_shortlisted` đã tồn tại từ migration `0003`).

## 1. Vấn đề cần giải quyết

Dashboard (sub-project 4, live từ 2026-08-22) hiện trang Overview đầy dữ liệu nhưng 3 trang sector (Tài chính/Giải trí/Du lịch) có thể trống hoàn toàn cùng ngày — xác nhận qua ảnh chụp production thật ngày 2026-08-22. Đây là gap đã được final review của sub-project 4 flag trước nhưng chưa kiểm chứng được lúc đó (không có credentials Supabase trong môi trường agent).

Nguyên nhân, lần theo code thật ([hot-topics.ts](../../../dashboard/lib/hot-topics.ts), [discovery-ingest.ts](../../../src/discovery-ingest.ts), [match-categories.ts](../../../src/lib/match-categories.ts)):

- Trang sector lọc `candidate_topics` theo `category_hint` chứa đúng category **trước**, rồi mới lọc `is_shortlisted = true`. Trang Overview không lọc category. → nếu không candidate nào shortlist hôm đó có `category_hint` chứa category X, trang X trống dù Overview đầy.
- `category_hint` được gán bởi `matchCategories(keyword)` — substring match tĩnh với 32 từ khoá trong `config/categories.config.ts`. Ba nguồn discovery (Google Trends, YouTube, RSS) đều fetch **trending chung chung**, không phân biệt sector, nên nhiều candidate không chứa nguyên văn từ khoá nào trong list → `category_hint = []`.

Hai kiểu candidate rơi vào category_hint rỗng, cần xử lý khác nhau:

1. **Trending thật sự ngoài phạm vi 3 sector** (thể thao, xổ số, giáo dục — vd "Arsenal", "xổ số miền nam" quan sát được ngày 2026-08-22). Không nên và không cần ép vào sector nào — đúng là nằm ngoài scope.
2. **Trending trong phạm vi nhưng là tên riêng** không chứa từ khoá category (vd tên ca sĩ, tên địa danh du lịch) — matchCategories() không nhận diện được vì cần ngữ cảnh, không phải chỉ thiếu từ vựng.

## 2. Phạm vi thay đổi

**Trong scope:**
- RSS: dùng category đã biết chính xác từ `articles.categories` thay vì đoán qua matchCategories().
- YouTube: thêm nguồn chủ động (`search.list` theo seed keyword/category) bên cạnh nguồn trending chung hiện có.
- Candidate còn category_hint rỗng sau các bước trên: phân loại bằng LLM (OpenAI, batch 1 lần/nguồn/run).
- `rank-and-select.ts`: thêm ngưỡng shortlist theo từng (nguồn, category), cộng thêm (không thay thế) ngưỡng top-10/nguồn hiện có.

**Ngoài scope (đã cân nhắc, quyết định không làm đợt này):**
- **Google Trends seed-driven query** — đã spike thật ngày 2026-08-22: `GoogleTrendsApi.explore()` có widget `RELATED_TOPICS`/`RELATED_QUERIES` đúng thứ cần, nhưng chỉ trả về metadata + 1 `token` (API nội bộ Google dạng 2 bước: lấy widget config → phải tự resolve token để lấy data thật). Thư viện `@alkalisummer/google-trends-js` không có method nào resolve token đó (đã kiểm hết method public: `autocomplete`, `dailyTrends`, `realTimeTrends`, `trendingArticles`, `interestOverTime`, `explore`, `interestByRegion`). `interestOverTime()` hoạt động nhưng chỉ cho điểm quan tâm của chính seed keyword theo thời gian — không phát hiện từ khoá mới, khác bản chất với YouTube/RSS. Kết luận: không khả thi với thư viện hiện tại, để lại cho 1 spec riêng sau nếu cần (có thể cần đổi thư viện).
- **Mở rộng `config/categories.config.ts` lên hàng trăm/nghìn từ khoá** (kể cả bằng LLM sinh) — cân nhắc và loại bỏ: không sửa được vấn đề tên riêng (danh sách tĩnh không thể liệt kê hết tên người/địa danh, lỗi thời ngay khi có tên mới), và làm tăng rủi ro match nhầm (list càng to càng nhiều từ nước đôi).
- Đổi logic `matchCategories()` chính nó — giữ nguyên, vẫn chạy song song với các nguồn category-biết-trước mới.

## 3. Kiến trúc

Xem sơ đồ trực quan đầy đủ (Artifact, không thay thế tài liệu này): "Hot Topic Funnel" — dựng trong phiên brainstorm 2026-08-22, sơ đồ 2 vẽ đúng luồng gộp category_hint mô tả ở mục 4 dưới đây.

Điểm gộp category vẫn là `discovery-ingest.ts` — không đổi vị trí, chỉ đổi input nó nhận được:

```
RawCandidate.knownCategories?: Category[]   // MỚI — category đã biết trước, không cần đoán
```

`discovery-ingest.ts` đổi:
```
category_hint = union(matchCategories(candidate.keyword), candidate.knownCategories ?? [])
```
rồi nếu vẫn rỗng, đánh dấu để bước classify LLM (mục 4.3) xử lý bổ sung trước khi ghi.

## 4. Chi tiết từng phần

### 4.1 RSS — dùng category thật, bỏ đoán mò

Ground truth đã tồn tại: mọi bài viết trong `articles` luôn có `categories` không rỗng (`categorize()` ở sub-project 1 luôn gán ít nhất category mặc định của feed nguồn). Chưa từng cần API/query mới — chỉ cần truyền thông tin đã có xuyên suốt.

Thay đổi interface (breaking, có kiểm soát):
- `ArticleRepository.getRecentTitles(days): Promise<string[]>` → `getRecentTitles(days): Promise<{ title: string; categories: string[] }[]>`. `SupabaseArticleRepository` thêm `categories` vào `.select()`. `FakeArticleRepository` (`tests/fakes/`) và test hiện có của nó cần cập nhật theo.
- `aggregateRssKeywords(titles: string[])` → `aggregateRssKeywords(articles: { title: string; categories: string[] }[])`: với mỗi bài, extract keyword từ title như cũ (`extractKeywords()` không đổi); với mỗi keyword extract được, cộng dồn `metric_value` (tần suất) như cũ, đồng thời gộp (union) `categories` của bài đó vào `knownCategories` của keyword đó. Một keyword xuất hiện trong bài thuộc nhiều category khác nhau → `knownCategories` là hợp của tất cả (giữ đúng tinh thần multi-category đã có từ sub-project 1).
- `RssTopicSource.fetchCandidates()` không đổi cấu trúc, chỉ truyền `RawCandidate[]` có `knownCategories` xuống.

### 4.2 YouTube — thêm nguồn chủ động theo seed keyword

Nguồn hiện có (`videos.list?chart=mostPopular`, không đổi) giữ nguyên. Thêm nguồn thứ hai, chủ động theo category:

**Seed list** — thêm trong `config/categories.config.ts` (cùng file với `categoryKeywords`, không tạo file riêng), curated tay, 2 seed/category:
```ts
export const youtubeSeedKeywords: Record<Category, string[]> = {
  tai_chinh: ['chứng khoán', 'tài chính'],
  giai_tri: ['showbiz', 'âm nhạc'],
  du_lich: ['du lịch', 'tour'],
};
```

**Fetch mỗi seed** — 2 lệnh gọi API/seed (YouTube search.list không trả `statistics` trong response, cần gọi tiếp videos.list lấy viewCount):
1. `search.list(q=<seed>, type=video, regionCode=VN, order=viewCount, publishedAfter=<now-2 ngày>, maxResults=25)` — 100 unit/call.
2. `videos.list(part=snippet,statistics, id=<25 id từ bước 1>)` — 1 unit/call (không tính theo số lượng id, tối đa 50 id/call, 25 luôn nằm trong giới hạn này).

Mỗi seed ≈ 101 unit. 6 seed × 101 × 3 lần chạy/ngày ≈ **1.818 unit/ngày**, ~18% quota mặc định 10.000 unit/ngày — an toàn, còn dư cho nguồn `mostPopular` hiện có (không đáng kể, 1 unit/lần) và biến động tương lai.

**Gộp kết quả**: kết quả bước 2 (item có `snippet`+`statistics`) đưa qua `aggregateYouTubeKeywords()` hiện có (không đổi hàm này) để ra `RawCandidate[]`, sau đó gắn `knownCategories = [category]` cho toàn bộ candidate ra từ seed của category đó. Candidate từ nguồn `mostPopular` (không seed) không có `knownCategories`. Hai tập hợp merge theo keyword trước khi cap: `metric_value` cộng dồn nếu keyword trùng giữa 2 nguồn, `knownCategories` là hợp. Cap `MAX_CANDIDATES = 200` áp dụng sau merge, không đổi giá trị cap.

### 4.3 LLM classification cho phần còn sót

Sau bước 4.1/4.2 + `matchCategories()` hiện có, candidate nào `category_hint` **vẫn rỗng** mới qua bước này — không phải toàn bộ candidate.

- **Model:** `gpt-5-nano` (OpenAI) — rẻ nhất phù hợp cho tác vụ phân loại đơn giản, đã tính chi phí thật: ~279 candidate/lần chạy (theo data production 2026-08-21: `google_trends` fetched=79, `youtube` fetched=200) × 3 lần/ngày, gộp batch 1 request/lần chạy (không gọi riêng từng candidate) → **~$0,07–0,35/tháng** tuỳ mức dùng thật, không đáng kể.
- **Input:** danh sách keyword còn rỗng category_hint trong 1 lần chạy, gộp 1 prompt duy nhất (không phải 1 request/keyword).
- **Output:** cho mỗi keyword, 1 trong 4 nhãn: `tai_chinh` / `giai_tri` / `du_lich` / `none` (không thuộc sector nào — hợp lệ, không ép).
- **Lỗi/timeout:** nếu OpenAI call thất bại (mạng, quota, timeout) → candidate đó giữ `category_hint = []` như hành vi hiện tại (không chặn phần còn lại của discovery-ingest, cùng nguyên tắc cô lập lỗi per-source/per-batch đã áp dụng cho 3 nguồn hiện có).
- **Secret mới:** `OPENAI_API_KEY`, thêm vào GitHub repo secrets giống cách `YOUTUBE_API_KEY` đã thêm cho sub-project 2a.
- **Vị trí trong pipeline:** chạy trong `discovery-ingest.ts`, sau khi tính `category_hint` ban đầu cho toàn bộ batch của 1 nguồn, trước khi gọi `upsertCandidates()`.

### 4.4 `rank-and-select.ts` — sàn shortlist riêng theo category

Logic hiện tại ([rank-and-select.ts:57-63](../../../src/rank-and-select.ts#L57-L63)): group candidate theo `source`, lấy top `DEFAULT_TOP_PER_SOURCE = 10` theo `growth_rate` mỗi group, gộp keyword vào 1 `Set<string>` rồi đánh dấu `is_shortlisted` cho mọi candidate có keyword nằm trong set đó (kể cả candidate ở nguồn khác trùng keyword — hành vi hiện có, không đổi).

Thêm bước thứ hai, **cộng thêm** bước trên (không thay thế): với mỗi cặp (source, category) trong 3 category × 3 nguồn, lọc candidate có `category_hint` chứa category đó, lấy top 10 theo `growth_rate` (cùng `DEFAULT_TOP_PER_SOURCE = 10`, theo quyết định giữ nguyên số), gộp keyword vào cùng `Set<string>` ở trên trước khi đánh dấu `is_shortlisted`.

Kết quả: candidate lọt top-10 chung của nguồn (như cũ, phục vụ Overview) **hoặc** lọt top-10 trong đúng category của nó (mới, đảm bảo sàn cho sector page) đều được `is_shortlisted = true`. Candidate không match category nào (Arsenal, xổ số...) chỉ còn đường duy nhất là top-10 chung — đúng, vì nó thật sự không thuộc sector nào.

## 5. Data model

Không có migration Supabase mới. Thay đổi duy nhất ở tầng ứng dụng:

```ts
// src/types.ts
export interface RawCandidate {
  keyword: string;
  metric_value: number;
  growth_rate: number | null;
  knownCategories?: Category[];   // MỚI
}
```

`CandidateTopic.category_hint: string[]` (đã có từ migration `0003`) — không đổi shape, chỉ đổi cách nó được tính trước khi ghi.

## 6. Testing

Theo TDD như các sub-project trước:
- `FakeArticleRepository.getRecentTitles` cập nhật shape trả về, test hiện có (`tests/fake-article-repository.test.ts` nếu còn dùng titles kiểu cũ) cập nhật theo.
- `aggregateRssKeywords` — test mới: keyword xuất hiện trong bài thuộc 2 category khác nhau → `knownCategories` là hợp của cả 2.
- YouTube seed fetch — cần 1 `interface YouTubeSearchClient` (hoặc tương tự) tách biệt I/O thật khỏi logic gộp, theo đúng pattern `FeedFetcher`/`ContentExtractor`/`DiscoverySource` đã dùng — test logic gộp/merge/cap qua fake, không test network thật (giống cách `RssParserFetcher`/`DefaultContentExtractor` được ghi chú "verified manually", không unit test).
- LLM classification — cần 1 `interface CandidateClassifier { classify(keywords: string[]): Promise<Record<string, Category | 'none'>> }` để test logic gộp category_hint qua fake, không gọi OpenAI thật trong test.
- `rank-and-select.ts` — test mới: candidate đúng category nhưng growth_rate thấp hơn top-10 chung của nguồn vẫn được `is_shortlisted = true` nếu lọt top-10 trong category riêng của nó.

## 7. Thông số đã chốt

| Thông số | Giá trị |
|---|---|
| Model LLM classification | `gpt-5-nano` (OpenAI) |
| Chi phí LLM ước tính | ~$0,07–0,35/tháng |
| Seed keyword/category (YouTube) | 2 (curated tay, xem mục 4.2) |
| Quota YouTube seed-driven | ~1.818 unit/ngày (~18% quota 10.000/ngày) |
| Top-N sàn per-category (`rank-and-select.ts`) | 10 — giữ nguyên bằng `DEFAULT_TOP_PER_SOURCE` hiện có |
| Google Trends trong scope này | Không — đã spike, không khả thi với thư viện hiện tại |
| Migration Supabase mới | Không cần |
| Secret mới | `OPENAI_API_KEY` |

## 8. Self-review

- **Placeholder scan:** không còn TBD — 2 tham số từng treo (top-N, số seed) đã chốt ở mục 7.
- **Nhất quán nội bộ:** `RawCandidate.knownCategories` (mục 3, 5) khớp cách dùng ở mục 4.1/4.2; `category_hint` vẫn giữ nguyên shape `string[]` xuyên suốt, không xung đột với schema `0003` hiện có.
- **Phạm vi:** đủ nhỏ cho 1 implementation plan — không đụng RSS ingestion (sub-project 1) hay dashboard (sub-project 4), chỉ sửa bên trong discovery layer (2a) đang live.
- **Rủi ro production:** cả 4.1–4.4 đều là thay đổi cộng thêm (additive) trên pipeline đang chạy — không đường nào làm giảm số candidate/shortlist hiện có, chỉ tăng độ chính xác category và thêm sàn category. Rollback nếu cần: revert riêng từng phần độc lập (RSS/YouTube/LLM/shortlist không phụ thuộc chéo nhau).
