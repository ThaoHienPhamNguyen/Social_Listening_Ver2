import { describe, it, expect } from 'vitest';
import { decodeHtmlEntities } from '../src/lib/decode-html-entities';

describe('decodeHtmlEntities', () => {
  it('decodes named HTML entities used for Vietnamese diacritics', () => {
    const result = decodeHtmlEntities('Kh&ocirc;i c&ocirc;ng khu c&#259;n h&#7897;');
    expect(result).toBe('Khôi công khu căn hộ');
  });

  it('decodes standard XML entities', () => {
    const result = decodeHtmlEntities('Deadpool &amp; Wolverine &quot;test&quot; &#039;quote&#039;');
    expect(result).toBe(`Deadpool & Wolverine "test" 'quote'`);
  });

  it('leaves plain text without entities unchanged', () => {
    const result = decodeHtmlEntities('Giá vàng tăng mạnh');
    expect(result).toBe('Giá vàng tăng mạnh');
  });
});
