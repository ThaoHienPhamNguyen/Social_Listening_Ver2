import type { Category } from '../types';

export type ClassificationLabel = Category | 'none';

export interface CandidateClassifier {
  classify(keywords: string[]): Promise<Record<string, ClassificationLabel>>;
}

const FETCH_TIMEOUT_MS = 20000;
const MODEL = 'gpt-5-nano';

// Real adapter over the OpenAI Chat Completions REST API, called via native
// fetch (no `openai` npm dependency, matching how this codebase calls
// YouTube/Google Trends directly). Verified manually against the live API
// once a key exists, not by an automated unit test — same convention as
// every other real-network adapter in this codebase. discovery-ingest.ts's
// classify-the-leftovers logic is what's unit-tested, via this interface's
// fake.
export class OpenAiCandidateClassifier implements CandidateClassifier {
  constructor(private apiKey: string) {}

  async classify(keywords: string[]): Promise<Record<string, ClassificationLabel>> {
    if (keywords.length === 0) return {};

    const prompt =
      'Phân loại mỗi từ khoá tiếng Việt sau vào đúng 1 trong 4 nhãn: ' +
      '"tai_chinh" (tài chính/kinh doanh), "giai_tri" (giải trí/showbiz), ' +
      '"du_lich" (du lịch), hoặc "none" nếu không thuộc nhãn nào ở trên. ' +
      'Trả lời bằng đúng 1 JSON object, key là từ khoá gốc (giữ nguyên chính ' +
      'tả), value là nhãn. Không thêm giải thích. ' +
      `Từ khoá: ${JSON.stringify(keywords)}`;

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
      return JSON.parse(content) as Record<string, ClassificationLabel>;
    } finally {
      clearTimeout(timeout);
    }
  }
}
