export interface TopicExtractor {
  extractTopics(texts: string[]): Promise<string[][]>;
}

const FETCH_TIMEOUT_MS = 60000;
const MODEL = 'gpt-5-nano';

// Parses and validates the LLM's raw JSON response into a positional
// string[][] (one entry per text, same order/length as `textCount`).
// Exported so it can be unit-tested directly without mocking the network.
//
// `content` is untrusted model output — a type annotation on JSON.parse's
// result is not a runtime guarantee (same convention as discovery-ingest.ts's
// classification-response handling). Two different failure classes here:
//   - The WHOLE response is unusable (empty content, unparseable JSON, or no
//     usable entry for ANY index) → throw, so the caller's fallback to
//     extractKeywords() for this chunk triggers instead of silently
//     contributing zero candidates.
//   - A SINGLE index's value is the wrong shape (not an array, or an array
//     with non-string/blank elements) → treat only that index as having no
//     topics; not the same failure class as the whole chunk being unusable.
export function parseTopicsResponse(content: string, textCount: number): string[][] {
  if (!content) {
    throw new Error('Topic extraction returned empty content');
  }

  const parsed = JSON.parse(content) as Record<string, unknown>;

  const hasUsableEntry = Array.from({ length: textCount }, (_, i) => String(i)).some(
    (key) => key in parsed
  );
  if (!hasUsableEntry) {
    throw new Error('Topic extraction response had no usable entries for any text');
  }

  return Array.from({ length: textCount }, (_, i) => {
    const value = parsed[String(i)];
    if (!Array.isArray(value)) return [];
    return value
      .filter((topic): topic is string => typeof topic === 'string')
      .map((topic) => topic.trim().toLowerCase())
      .filter((topic) => topic.length > 0);
  });
}

// Real adapter over OpenAI's Chat Completions API, called via native fetch —
// same convention as OpenAiCandidateClassifier (no `openai` npm dependency).
// Reads a batch of Vietnamese text passages (RSS headlines or Threads posts)
// and asks the model for 1-3 specific topic phrases per passage, avoiding
// what the sliding-window bigram extractor in keyword-extractor.ts
// structurally cannot: telling a real 3+-word phrase ("doanh nghiệp nhỏ")
// apart from its own overlapping 2-word fragments ("doanh nghiệp", "nghiệp
// nhỏ"), or a name spanning a line break from an unrelated next sentence.
// Not unit-tested — verified manually against the live API once a key
// exists, same convention as every other real-network adapter in this
// codebase (see candidate-classifier.ts, apify-threads-client.ts).
export class OpenAiTopicExtractor implements TopicExtractor {
  constructor(private apiKey: string) {}

  async extractTopics(texts: string[]): Promise<string[][]> {
    if (texts.length === 0) return [];

    const numbered = texts.map((t, i) => `${i}. "${t}"`).join('\n');
    const prompt =
      'Đọc các đoạn văn bản tiếng Việt sau (đánh số) — có thể là tiêu đề tin tức hoặc bài ' +
      'đăng mạng xã hội. Với mỗi đoạn, trích 1-3 cụm từ thể hiện đúng CHỦ ĐỀ CỤ THỂ của đoạn ' +
      'đó (tên riêng, sự kiện, con số cụ thể — KHÔNG phải từ chung chung như "kinh doanh", ' +
      '"tài sản", "thị trường" đứng một mình). Giữ nguyên chính tả gốc, viết thường. Nếu 1 ' +
      'đoạn không có chủ đề nào đủ cụ thể, trả về mảng rỗng cho đoạn đó.\n\n' +
      'Trả lời bằng đúng 1 JSON object, key là số thứ tự (dạng chuỗi "0", "1", ...), ' +
      'value là mảng chuỗi. Không thêm giải thích.\n\n' +
      `Đoạn văn bản:\n${numbered}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: MODEL,
          response_format: { type: 'json_object' },
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!response.ok) {
        throw new Error(`OpenAI API request failed: ${response.status}`);
      }
      const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const content = body.choices?.[0]?.message?.content;
      return parseTopicsResponse(content ?? '', texts.length);
    } finally {
      clearTimeout(timeout);
    }
  }
}
