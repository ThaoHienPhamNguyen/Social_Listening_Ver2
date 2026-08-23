import type { SentimentLabel } from '../types';

export interface SentimentClassifier {
  classify(posts: { id: string; text: string }[]): Promise<Record<string, SentimentLabel>>;
}

// 60s timeout matches candidate-classifier.ts's FETCH_TIMEOUT_MS — this runs
// unattended in CI, not user-facing, so a generous ceiling is cheap and a
// spurious timeout isn't (same reasoning documented there).
const FETCH_TIMEOUT_MS = 60000;
const MODEL = 'gpt-5-nano';
// Sentiment doesn't need the full post — truncating keeps prompt size (and
// therefore cost/latency) predictable across chunks regardless of how long
// an individual caption/post is.
const MAX_TEXT_CHARS = 500;

// Real adapter over the OpenAI Chat Completions REST API, called via native
// fetch (no `openai` npm dependency) — same style as candidate-classifier.ts.
// Verified manually against the live API once a key exists, not by an
// automated unit test — same convention as every other real-network adapter
// in this codebase. classify-sentiment.ts's chunking/isolation logic is what's
// unit-tested, via this interface's fake.
export class OpenAiSentimentClassifier implements SentimentClassifier {
  constructor(private apiKey: string) {}

  async classify(posts: { id: string; text: string }[]): Promise<Record<string, SentimentLabel>> {
    if (posts.length === 0) return {};

    const truncated = posts.map((p) => ({ id: p.id, text: p.text.slice(0, MAX_TEXT_CHARS) }));

    const prompt =
      'Phân loại cảm xúc (sentiment) của mỗi bài đăng mạng xã hội tiếng Việt sau vào đúng 1 trong 3 nhãn: ' +
      '"positive" (tích cực), "negative" (tiêu cực), hoặc "neutral" (trung lập/không rõ). ' +
      'Trả lời bằng đúng 1 JSON object, key là id bài đăng (giữ nguyên), value là nhãn. ' +
      'Không thêm giải thích. ' +
      `Bài đăng: ${JSON.stringify(truncated)}`;

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
      if (!content) return {};
      return JSON.parse(content) as Record<string, SentimentLabel>;
    } finally {
      clearTimeout(timeout);
    }
  }
}
