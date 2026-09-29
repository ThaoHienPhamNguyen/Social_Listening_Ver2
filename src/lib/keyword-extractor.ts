const STOP_WORDS = new Set([
  'là', 'và', 'của', 'có', 'cho', 'các', 'một', 'những', 'trong', 'này',
  'với', 'được', 'không', 'để', 'khi', 'đã', 'sẽ', 'về', 'từ', 'như',
  'tại', 'theo', 'sau', 'trên', 'đến', 'ra', 'vào', 'thì', 'lại', 'nên',
]);

// Clause boundaries within a headline or post — a capitalized word right
// after one of these is capitalized by sentence-position convention, not
// because it's a proper noun (see extractEntityPhrases). Includes newline:
// social posts (Threads) routinely start a new sentence on a new line
// without any punctuation before it — without this, a capitalized word that
// only opens the next line/thought gets treated as still inside the
// previous line's entity run and wrongly merged onto it (a real production
// case: "...là\n\"Mai Quốc Khánh\"\nSinh ngày 3.9..." merged "Sinh" from the
// next line into the name, producing "mai quốc khánh sinh").
const CLAUSE_BREAK = /[.!?:;\n]/;

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

function isDroppable(word: string): boolean {
  return word.length <= 2 || STOP_WORDS.has(word);
}

// These are real, correctly-adjacent Vietnamese words — not the fabricated-
// adjacency bug above — just too broad to stand for a topic on their own:
// "kinh doanh" (business) turns up in dozens of unrelated finance headlines
// a day. Kept separate from categories.config.ts's classification keywords,
// which serve a different purpose (tagging category, not judging
// specificity). Hand-curated; add more here as they show up in production,
// same maintenance model as categories.config.ts.
const GENERIC_PHRASES = new Set(['kinh doanh', 'tài sản']);

export function extractKeywords(text: string): string[] {
  const entityPhrases = extractEntityPhrases(text);

  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0);

  // Only 2-word phrases are kept — standalone single words are almost always
  // too generic (pronouns, filler, foreign-language slang not covered by
  // STOP_WORDS) to be a meaningful topic on their own, and were drowning out
  // multi-word candidates by raw frequency in production. Entity phrases
  // above are exempt from this: a single proper noun ("Apple", "Jack") is
  // specific, not generic, so it's kept even at 1 word.
  //
  // The droppable check runs on each PAIR, not on `words` up front: dropping
  // a short/stop word from the array before pairing makes its two neighbors
  // adjacent in the array even though they never were in the actual text —
  // "lợi nhuận gấp 3 lần" was producing "gấp lần" this way, once "3" (length
  // 1) got removed. Checking per-pair instead means a dropped word simply
  // blocks the pair(s) that would have to skip over it.
  const bigrams: string[] = [];
  for (let i = 0; i < words.length - 1; i++) {
    if (isDroppable(words[i]) || isDroppable(words[i + 1])) continue;
    const phrase = `${words[i]} ${words[i + 1]}`;
    if (!GENERIC_PHRASES.has(phrase)) {
      bigrams.push(phrase);
      continue;
    }
    // Too generic alone — only worth keeping stretched out with a real
    // neighboring word for context ("novaland kinh doanh", "tài sản
    // chung"). Drop it entirely rather than let the bare, context-free form
    // back in when neither neighbor is usable.
    const before = words[i - 1];
    const after = words[i + 2];
    if (before !== undefined && !isDroppable(before)) bigrams.push(`${before} ${phrase}`);
    if (after !== undefined && !isDroppable(after)) bigrams.push(`${phrase} ${after}`);
  }
  return [...entityPhrases, ...bigrams];
}
