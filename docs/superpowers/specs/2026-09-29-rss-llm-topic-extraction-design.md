# RSS discovery — trích chủ đề bằng LLM thay cho bigram/regex

**Ngày:** 2026-09-29
**Trạng thái:** Approved trong brainstorm, chờ user review file này trước khi viết plan
**Phạm vi:** Thay bước sinh candidate từ tiêu đề RSS (`src/lib/rss-topic-source.ts`, `src/lib/aggregate-rss-keywords.ts`) bằng 1 bước gọi LLM (`gpt-5-nano`, cùng model đã dùng cho phân loại category), có phương án dự phòng bằng bộ tách từ regex hiện có khi LLM lỗi. Không đụng Google Trends, YouTube, hay bước phân loại category (`matchCategories`/`OpenAiCandidateClassifier`) — 2 việc này giữ nguyên, chạy sau bước này như cũ.

## 1. Vấn đề cần giải quyết

`src/lib/keyword-extractor.ts` (sliding-window bigram + heuristic viết hoa) đã qua 4 vòng vá lỗi thật trong production (xác nhận qua ảnh chụp dashboard thật):

1. Ghép giả 2 từ không liền kề khi từ ở giữa bị lọc (đã sửa — lọc theo từng cặp thay vì lọc cả mảng trước).
2. Từ khóa phân loại category quá mơ hồ ("tour") gắn nhầm nội dung giải trí thành du lịch (đã sửa — cụ thể hóa thành "tour du lịch").
3. Cụm đúng ngữ pháp nhưng quá chung chung ("kinh doanh", "tài sản") đứng một mình vô nghĩa (đã sửa — kéo dài bằng từ liền kề, bỏ nếu không kéo được).
4. **Chưa sửa được:** cụm dài có nghĩa bị cắt vụn thành nhiều mảnh 2-từ chồng lấn (vd "doanh nghiệp nhỏ" → cả "doanh nghiệp" lẫn "nghiệp nhỏ" đều thành candidate riêng). Đây là giới hạn cố hữu của cách "lấy mọi cặp từ liền kề" — không sửa được bằng thêm luật, vì bản thân cách tiếp cận không biết ranh giới cụm từ thật sự ở đâu.

Google Trends không có vấn đề này (item của nó không qua `extractKeywords`, và đã kiểm chứng thật là bản thân Google cũng không có thêm ngữ cảnh nào để trích) nên **ngoài phạm vi thay đổi này**.

## 2. Phạm vi thay đổi

**Trong scope:**
- Thêm `RssTopicExtractor` (interface) + `OpenAiRssTopicExtractor` (adapter thật, gọi `gpt-5-nano`) — đọc nguyên tiêu đề bài báo, trả về 1-3 cụm chủ đề cụ thể mỗi tiêu đề.
- `RssTopicSource.fetchCandidates()`: dùng `RssTopicExtractor` thay vì gọi `extractKeywords()` trực tiếp; nếu 1 lô (chunk) gọi LLM lỗi, lô đó tự động rơi về dùng `extractKeywords()` (giữ nguyên, không xóa file này) cho đúng các tiêu đề trong lô lỗi.
- `aggregate-rss-keywords.ts`: đổi input từ "tự tách từ" sang "nhận sẵn danh sách chủ đề mỗi bài" — tách rời việc "lấy chủ đề từ đâu" khỏi việc "đếm/gộp thành candidate".
- `run-discovery-ingest.ts`: khởi tạo `OpenAiRssTopicExtractor` bằng `OPENAI_API_KEY` sẵn có (đã dùng cho phân loại category), truyền vào `RssTopicSource`.

**Ngoài scope (giữ nguyên, không đổi):**
- `keyword-extractor.ts` (bigram/entity/generic-phrase) — giữ nguyên 100%, dùng làm phương án dự phòng.
- `match-categories.ts`, `OpenAiCandidateClassifier`, bước gán `category_hint` trong `discovery-ingest.ts` — không đổi gì, vẫn nhận input là candidate keyword (giờ có thể đến từ LLM extractor hoặc từ fallback) và xử lý y hệt hôm nay.
- Google Trends, YouTube — không áp dụng LLM extraction (đã hỏi và chốt trong brainstorm: Google Trends không có thêm ngữ cảnh để trích; YouTube để lại cho 1 thay đổi riêng sau nếu cần, tránh mở rộng phạm vi rủi ro cho lần triển khai đầu).

## 3. Kiến trúc

```
RssTopicSource.fetchCandidates()
  1. repo.getRecentTitles(1) → { title, categories }[]  (không đổi)
  2. chia thành lô 20 tiêu đề/lô (CHUNK_SIZE, giống quy ước sentiment-classifier cũ)
  3. với mỗi lô:
       try: extractor.extractTopics(titles trong lô) → Map<title, string[]>
       catch: fallback — với mỗi title trong lô, topics = extractKeywords(title)
  4. gộp kết quả tất cả lô thành { title, categories, topics }[]
  5. aggregateRssKeywords(đầu vào mới) → RawCandidate[]  (đếm/gộp/cap 200 — không đổi logic)
```

Điểm mấu chốt: **lỗi ở 1 lô không lan sang lô khác, không làm mất toàn bộ candidate RSS ngày đó** — đúng nguyên tắc cô lập lỗi đã dùng xuyên suốt codebase này (`discovery-ingest.ts`, `deep-crawl.ts`).

## 4. Prompt & format response

```
Đọc các tiêu đề tin tức tiếng Việt sau (đánh số). Với mỗi tiêu đề, trích 1-3 cụm
từ thể hiện đúng CHỦ ĐỀ CỤ THỂ của tiêu đề đó (tên riêng, sự kiện, con số cụ thể
— KHÔNG phải từ chung chung như "kinh doanh", "tài sản", "thị trường" đứng một
mình). Giữ nguyên chính tả gốc, viết thường. Nếu 1 tiêu đề không có chủ đề nào
đủ cụ thể, trả về mảng rỗng cho tiêu đề đó.

Trả lời bằng đúng 1 JSON object, key là số thứ tự (dạng chuỗi "0", "1", ...),
value là mảng chuỗi. Không thêm giải thích.

Tiêu đề:
0. "Novaland chào bán cổ phiếu tỉ lệ 3:1 để trả nợ"
1. "Chung cư có thời hạn sử dụng theo niên hạn công trình"
...
```

Response mẫu:
```json
{
  "0": ["novaland", "chào bán cổ phiếu", "trả nợ"],
  "1": ["niên hạn công trình"]
}
```

Dùng **số thứ tự làm key**, không dùng nguyên văn tiêu đề — tránh lỗi escape JSON và tiêu đề trùng nhau collide. `OpenAiRssTopicExtractor.extractTopics(titles: string[])` tự map lại theo index sau khi parse.

## 5. Xử lý lỗi & timeout

Giống hệt quy ước đã có ở `candidate-classifier.ts`/`discovery-ingest.ts`:
- `AbortController` + timeout 60s/lô (cùng giá trị `FETCH_TIMEOUT_MS` đã dùng cho classifier — 20 tiêu đề/lô nhẹ hơn nhiều so với 50-100 từ khóa từng gây "aborted" trước đây, không cần timeout riêng).
- Lô lỗi (network, timeout, JSON không parse được, HTTP không phải 2xx) → bắt bằng try/catch tại `RssTopicSource`, ghi vào `result.errors` (theo đúng field `DiscoveryIngestResult.errors` đã có), rồi fallback `extractKeywords()` cho đúng các tiêu đề của lô đó.
- Không có `OPENAI_API_KEY` (dev local, hoặc CI thiếu secret) → `run-discovery-ingest.ts` không tạo `OpenAiRssTopicExtractor`, `RssTopicSource` nhận `extractor: undefined` → dùng `extractKeywords()` cho toàn bộ, y hệt hành vi hôm nay. Không có tình huống nào RSS mất trắng candidate vì thiếu AI.

## 6. Chi phí

Dựa trên số liệu thật đã đo cho bước phân loại category (spec `2026-08-22`): 279 candidate/lần × 3 lần/ngày ≈ **$0,07–0,35/tháng**.

Bước này khác: input là ~300 tiêu đề/ngày (chưa gộp, nhiều hơn 279 candidate đã gộp), chia lô 20 → 15 lô/ngày × 3 lần chạy = 45 lệnh gọi/ngày. Token mỗi lệnh gọi nhiều hơn (nguyên câu thay vì 1 từ khóa) nhưng cùng model rẻ nhất (`gpt-5-nano`). Ước tính theo cùng tỷ lệ giá đã đo: **dưới $1-2/tháng** — không đáng kể so với ngân sách Apify hiện tại ($20-30/tháng).

## 7. Testing

- `OpenAiRssTopicExtractor` (adapter gọi API thật): không unit test tự động — verify thủ công 1 lần khi có key thật, đúng quy ước đã áp dụng cho mọi adapter gọi mạng thật khác trong codebase này (`ApifyThreadsSearchClient`, `OpenAiCandidateClassifier`...).
- `RssTopicSource`: test bằng Fake extractor — case lô thành công (dùng topics từ extractor), case lô lỗi/throw (fallback đúng sang `extractKeywords()`), case extractor = undefined (fallback toàn bộ), case trộn lẫn nhiều lô (1 lô lỗi không ảnh hưởng lô khác).
- `aggregate-rss-keywords.ts`: cập nhật test theo shape input mới (`{title, categories, topics}[]`) — logic đếm/gộp/cap không đổi, chỉ đổi input.

## 8. Rủi ro & đã cân nhắc

- **LLM trả về chủ đề khác nhau giữa các lần chạy trong ngày** (không xác định/deterministic như regex) — chấp nhận được: `candidate_topics` unique key là `(source, keyword, date)`, mỗi lần chạy chỉ tạo thêm candidate mới nếu khác hẳn lần trước, không gây lỗi, chỉ có thể khiến vài candidate "biến mất rồi xuất hiện lại" giữa các lần chạy cùng ngày — không nghiêm trọng hơn hành vi ngẫu nhiên vốn có của Google Trends' tie-break đã chấp nhận trước đó.
- **LLM "ảo giác" trích chủ đề không có trong tiêu đề gốc** — chấp nhận rủi ro nhỏ, cùng mức tin cậy đã chấp nhận cho `OpenAiCandidateClassifier` (đang chạy production, chưa ghi nhận sự cố).
- **Không gộp chung với lệnh gọi phân loại category** — 2 việc xảy ra ở 2 giai đoạn khác nhau của pipeline (trích chủ đề xảy ra TRƯỚC khi gộp candidate; phân loại category xảy ra SAU khi gộp, trên danh sách candidate đã cap 200) — không gộp được thành 1 lệnh gọi mà không đảo lộn thứ tự pipeline hiện tại.
