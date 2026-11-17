import { describe, expect, it } from 'vitest';
import { previewEntryUrl } from '../previewPath.js';

describe('previewEntryUrl', () => {
  it('maps a nested active HTML document under the workspace root', () => {
    expect(previewEntryUrl('http://127.0.0.1:60451/', 'C:\\Work\\Amit Portfolio', 'C:\\Work\\Amit Portfolio\\portfolio\\index.html'))
      .toBe('http://127.0.0.1:60451/portfolio/index.html');
  });

  it('encodes spaces but preserves URL path separators', () => {
    expect(previewEntryUrl('http://127.0.0.1:60451/', 'C:\\Work\\Amit Portfolio', 'C:\\Work\\Amit Portfolio\\portfolio\\thankyou.html'))
      .toBe('http://127.0.0.1:60451/portfolio/thankyou.html');
  });

  it('keeps the server root for files outside the authorized root or non-HTML files', () => {
    const base = 'http://127.0.0.1:60451/';
    expect(previewEntryUrl(base, 'C:\\Work\\Project', 'C:\\Other\\index.html')).toBe(base);
    expect(previewEntryUrl(base, 'C:\\Work\\Project', 'C:\\Work\\Project\\main.css')).toBe(base);
  });

  it('does not append an already-resolved root or nested document twice', () => {
    expect(previewEntryUrl('http://127.0.0.1:60451/index.html', 'C:\\Work\\Project', 'C:\\Work\\Project\\index.html'))
      .toBe('http://127.0.0.1:60451/index.html');
    expect(previewEntryUrl('http://127.0.0.1:60451/portfolio/index.html', 'C:\\Work\\Project', 'C:\\Work\\Project\\portfolio\\index.html'))
      .toBe('http://127.0.0.1:60451/portfolio/index.html');
  });
});
