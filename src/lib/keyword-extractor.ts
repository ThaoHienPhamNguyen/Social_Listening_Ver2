const STOP_WORDS = new Set([
  'là', 'và', 'của', 'có', 'cho', 'các', 'một', 'những', 'trong', 'này',
  'với', 'được', 'không', 'để', 'khi', 'đã', 'sẽ', 'về', 'từ', 'như',
  'tại', 'theo', 'sau', 'trên', 'đến', 'ra', 'vào', 'thì', 'lại', 'nên',
]);

export function extractKeywords(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  const keywords: string[] = [];
  for (let i = 0; i < words.length; i++) {
    keywords.push(words[i]);
    if (i < words.length - 1) {
      keywords.push(`${words[i]} ${words[i + 1]}`);
    }
  }
  return keywords;
}
