import type { ReactNode } from 'react';

/**
 * English words on the public site that have no Bangla translation yet. On a page marked Bangla
 * they are marked English (WCAG 3.1.2), the same way the message catalogue marks a fallback, so a
 * screen reader reads them in the right voice. On an English page they are plain text.
 * `pageLang` is the page's own language (`primePage().pageLang` or `usePageLanguage()`).
 */
export function publicText(text: string, pageLang: string): ReactNode {
  return pageLang === 'en' ? text : <span lang="en">{text}</span>;
}
