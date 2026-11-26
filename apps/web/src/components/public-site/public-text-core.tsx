import type { ReactNode } from 'react';

/** Words in the visitor's language, given the drafted Bengali (when it is live) for these English words. */
export function renderPublic(
  text: string,
  bn: string | undefined,
  pageLang: string,
  locale: string,
): ReactNode {
  if (locale !== 'bn') return pageLang === 'en' ? text : <span lang="en">{text}</span>;
  if (bn === undefined) return pageLang === 'bn' ? <span lang="en">{text}</span> : text;
  return pageLang === 'bn' ? bn : <span lang="bn">{bn}</span>;
}
