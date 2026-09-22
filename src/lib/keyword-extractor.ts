const STOP_WORDS = new Set([
  'là', 'và', 'của', 'có', 'cho', 'các', 'một', 'những', 'trong', 'này',
  'với', 'được', 'không', 'để', 'khi', 'đã', 'sẽ', 'về', 'từ', 'như',
  'tại', 'theo', 'sau', 'trên', 'đến', 'ra', 'vào', 'thì', 'lại', 'nên',
]);

// Clause boundaries within a headline — a capitalized word right after one
// of these is capitalized by sentence-position convention, not because it's
// a proper noun (see extractEntityPhrases).
const CLAUSE_BREAK = /[.!?:;]/;

function isCapitalized(token: string): boolean {
  return /^\p{Lu}/u.test(token);
}

function isDigits(token: string): boolean {
  return /^\d+$/.test(token);
}

// Vietnamese news headlines use sentence case: only the first word of each
// clause is capitalized by convention, while proper nouns (companies,
// places, people, events — "Novaland", "Phú Quốc", "APEC 2027") stay
// capitalized wherever else they appear. Scanning for runs of capitalized
// words elsewhere in the clause finds those entities directly, instead of
// relying on the generic bigram pass below, which lowercases everything and
// so can't tell a name apart from two ordinary words that happen to sit
// next to each other.
//
// A clause's own first word is never eligible to start or extend a run:
// its capital is positional, not a signal. This is a deliberate, known
// miss for the (common) case where the headline's main entity IS the first
// word — e.g. "Novaland chào bán cổ phiếu..." won't yield "novaland" here,
// only via the bigram pass below ("novaland chào"). Telling that case apart
// from ordinary sentence-initial capitalization would need real NLP, not
// just a punctuation-based heuristic — not worth it for a first pass.
function extractEntityPhrases(text: string): string[] {
  const phrases: string[] = [];

  for (const clause of text.split(CLAUSE_BREAK)) {
    const tokens = clause.trim().split(/\s+/).filter(Boolean);
    let current: string[] = [];
    for (let i = 1; i < tokens.length; i++) {
      const token = tokens[i].replace(/[^\p{L}\p{N}]/gu, '');
      if (token.length === 0) continue;
      if (isCapitalized(token)) {
        current.push(token);
      } else if (isDigits(token) && current.length > 0) {
        // A digit can continue an already-started run ("APEC" + "2027")
        // but never start one on its own.
        current.push(token);
      } else if (current.length > 0) {
        phrases.push(current.join(' '));
        current = [];
      }
    }
    if (current.length > 0) phrases.push(current.join(' '));
  }

  return phrases.map((p) => p.toLowerCase());
}

export function extractKeywords(text: string): string[] {
  const entityPhrases = extractEntityPhrases(text);

  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  // Only 2-word phrases are kept — standalone single words are almost always
  // too generic (pronouns, filler, foreign-language slang not covered by
  // STOP_WORDS) to be a meaningful topic on their own, and were drowning out
  // multi-word candidates by raw frequency in production. Entity phrases
  // above are exempt from this: a single proper noun ("Apple", "Jack") is
  // specific, not generic, so it's kept even at 1 word.
  const bigrams: string[] = [];
  for (let i = 0; i < words.length - 1; i++) {
    bigrams.push(`${words[i]} ${words[i + 1]}`);
  }
  return [...entityPhrases, ...bigrams];
}
