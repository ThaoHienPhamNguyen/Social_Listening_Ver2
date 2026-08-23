import { decodeHTML } from 'entities';

/**
 * Decodes HTML/XML character entities (named, e.g. &ecirc;, and numeric,
 * e.g. &#7897;) into their literal characters. Some publisher RSS feeds
 * (e.g. Thanh Niên) encode Vietnamese diacritics as named HTML entities
 * that rss-parser's XML parser does not resolve (they aren't valid XML
 * entities), leaving them as literal text that later pollutes keyword
 * extraction with fragments like "ecirc"/"igrave".
 */
export function decodeHtmlEntities(text: string): string {
  return decodeHTML(text);
}
