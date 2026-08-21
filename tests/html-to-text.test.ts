import { describe, it, expect } from 'vitest';
import { htmlToText } from '../src/lib/html-to-text';

describe('htmlToText', () => {
  it('strips HTML tags and returns plain text', () => {
    const result = htmlToText('<p>Xin chào <strong>thế giới</strong></p>');
    expect(result).toBe('Xin chào thế giới');
  });

  it('removes script and style content entirely, not just the tags', () => {
    const result = htmlToText('<p>Nội dung</p><script>alert("x")</script><style>.a{color:red}</style>');
    expect(result).toBe('Nội dung');
  });

  it('collapses content from multiple block elements with whitespace between them', () => {
    const result = htmlToText('<div>Đoạn một</div><div>Đoạn hai</div>');
    expect(result).toContain('Đoạn một');
    expect(result).toContain('Đoạn hai');
  });
});
