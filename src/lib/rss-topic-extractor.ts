export interface RssTopicExtractor {
  extractTopics(titles: string[]): Promise<string[][]>;
}

const FETCH_TIMEOUT_MS = 60000;
const MODEL = 'gpt-5-nano';

// Real adapter over OpenAI's Chat Completions API, called via native fetch —
// same convention as OpenAiCandidateClassifier (no `openai` npm dependency).
// Reads a batch of RSS headlines and asks the model for 1-3 specific topic
// phrases per headline, avoiding what the sliding-window bigram extractor in
// keyword-extractor.ts structurally cannot: telling a real 3+-word phrase
// ("doanh nghiệp nhỏ") apart from its own overlapping 2-word fragments
// ("doanh nghiệp", "nghiệp nhỏ"). Not unit-tested — verified manually against
// the live API once a key exists, same convention as every other real-network
// adapter in this codebase (see candidate-classifier.ts, apify-threads-client.ts).
export class OpenAiRssTopicExtractor implements RssTopicExtractor {
  constructor(private apiKey: string) {}

  async extractTopics(titles: string[]): Promise<string[][]> {
    if (titles.length === 0) return [];

    const numbered = titles.map((t, i) => `${i}. "${t}"`).join('\n');
    const prompt =
      'Đọc các tiêu đề tin tức tiếng Việt sau (đánh số). Với mỗi tiêu đề, trích 1-3 cụm ' +
      'từ thể hiện đúng CHỦ ĐỀ CỤ THỂ của tiêu đề đó (tên riêng, sự kiện, con số cụ thể ' +
      '— KHÔNG phải từ chung chung như "kinh doanh", "tài sản", "thị trường" đứng một ' +
      'mình). Giữ nguyên chính tả gốc, viết thường. Nếu 1 tiêu đề không có chủ đề nào ' +
      'đủ cụ thể, trả về mảng rỗng cho tiêu đề đó.\n\n' +
      'Trả lời bằng đúng 1 JSON object, key là số thứ tự (dạng chuỗi "0", "1", ...), ' +
      'value là mảng chuỗi. Không thêm giải thích.\n\n' +
      `Tiêu đề:\n${numbered}`;

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
      if (!content) return titles.map(() => []);
      const parsed = JSON.parse(content) as Record<string, string[]>;
      return titles.map((_, i) => parsed[String(i)] ?? []);
    } finally {
      clearTimeout(timeout);
    }
  }
}
