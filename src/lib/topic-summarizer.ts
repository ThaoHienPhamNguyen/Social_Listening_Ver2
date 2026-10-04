export interface TopicSummaryInput {
  keyword: string;
  texts: string[];
}

export interface TopicSummarizer {
  summarizeTopics(inputs: TopicSummaryInput[]): Promise<(string | null)[]>;
}

const FETCH_TIMEOUT_MS = 60000;
const MODEL = 'gpt-5-nano';
const MAX_TEXTS_PER_TOPIC = 5;
const MAX_CHARS_PER_TEXT = 500;

// Same two-tier failure model as parseTopicsResponse (topic-extractor.ts):
// the WHOLE response being unusable (empty/unparseable, no usable index)
// throws so the caller can skip the whole chunk with a loud log line;
// a single index's value being the wrong shape degrades to null for that
// topic only.
export function parseSummaryResponse(content: string, topicCount: number): (string | null)[] {
  if (!content) {
    throw new Error('Topic summarization returned empty content');
  }

  const parsed = JSON.parse(content) as Record<string, unknown>;

  const hasUsableEntry = Array.from({ length: topicCount }, (_, i) => String(i)).some(
    (key) => key in parsed
  );
  if (!hasUsableEntry) {
    throw new Error('Topic summarization response had no usable entries for any topic');
  }

  // A key that's a non-negative integer but falls outside [0, topicCount) is
  // a strong signal the model 1-indexed its response (e.g. keys "1".."10"
  // for 10 topics) instead of 0-indexing as instructed. In that case
  // hasUsableEntry above is still true (the overlapping "1".."9" keys exist
  // in the expected range), so without this check every topic's summary
  // would be silently shifted by one position — topic index i would read
  // key String(i), which under 1-indexing holds the value meant for the
  // model's "topic i", i.e. OUR topic index i-1's content. A confidently
  // wrong summary attributed to the wrong topic is worse than no summary,
  // so treat a shape this wrong as a whole-response failure (same tier as
  // empty/unparseable content or no usable entries at all), not a
  // per-topic null.
  const hasOutOfRangeKey = Object.keys(parsed).some((key) => {
    const n = Number(key);
    return Number.isInteger(n) && n >= 0 && n >= topicCount;
  });
  if (hasOutOfRangeKey) {
    throw new Error('Topic summarization response had an out-of-range index key');
  }

  return Array.from({ length: topicCount }, (_, i) => {
    const value = parsed[String(i)];
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  });
}

// Real adapter over OpenAI's Chat Completions API, called via native fetch —
// same convention as OpenAiCandidateClassifier/OpenAiTopicExtractor (no
// `openai` npm dependency). Reads a batch of topics, each with up to
// MAX_TEXTS_PER_TOPIC real source texts (article titles+snippets, or Threads
// posts) already truncated to MAX_CHARS_PER_TEXT, and asks for a 1-2
// sentence Vietnamese summary of what's actually being said about each.
// Not unit-tested — verified manually against the live API once deployed,
// same convention as every other real-network adapter in this codebase.
export class OpenAiTopicSummarizer implements TopicSummarizer {
  constructor(private apiKey: string) {}

  async summarizeTopics(inputs: TopicSummaryInput[]): Promise<(string | null)[]> {
    if (inputs.length === 0) return [];

    const numbered = inputs
      .map((input, i) => {
        const texts = input.texts.slice(0, MAX_TEXTS_PER_TOPIC).map((t) => t.slice(0, MAX_CHARS_PER_TEXT));
        return `${i}. Chủ đề "${input.keyword}":\n${texts.map((t) => `- "${t}"`).join('\n')}`;
      })
      .join('\n\n');

    const prompt =
      'Dưới đây là một số chủ đề đang được quan tâm (đánh số), mỗi chủ đề kèm các đoạn trích ' +
      'từ bài báo/bài đăng mạng xã hội thật đã nói về nó. Với mỗi chủ đề, viết 1-2 câu tiếng ' +
      'Việt tóm tắt NỘI DUNG THẬT đang được nói đến (không phải định nghĩa chung về cụm từ đó). ' +
      'Chỉ dựa trên các đoạn trích được cung cấp — không suy diễn thêm.\n\n' +
      'Trả lời bằng đúng 1 JSON object, key là số thứ tự (dạng chuỗi "0", "1", ...), value là ' +
      'một chuỗi tóm tắt. Không thêm giải thích.\n\n' +
      `${numbered}`;

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
      return parseSummaryResponse(content ?? '', inputs.length);
    } finally {
      clearTimeout(timeout);
    }
  }
}
