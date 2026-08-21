import sanitizeHtml from 'sanitize-html';

/** Strips all HTML markup (including script/style content), leaving plain text. */
export function htmlToText(html: string): string {
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }).trim();
}
