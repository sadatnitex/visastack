import type { ReactNode } from 'react';
import { publicBnByEnglish } from '../../i18n/public-lookup';

/**
 * Words on the public site that are not in a message catalogue. Under English they are plain text.
 * Under Bengali they read as the drafted Bengali (`i18n/*-messages.ts`) when it is live, and as the
 * English, marked English (WCAG 3.1.2), when it is held or not drafted yet. `pageLang` is the page's
 * own language (`primePage().pageLang` or `usePageLanguage()`); `locale` is the visitor's choice and
 * defaults to it. They differ only on a route not yet marked Bengali, where Bengali words carry
 * their own mark and English stays plain.
 */
export function publicText(text: string, pageLang: string, locale: string = pageLang): ReactNode {
  if (locale !== 'bn') return pageLang === 'en' ? text : <span lang="en">{text}</span>;
  const bn = publicBnByEnglish(text);
  if (bn === undefined) return pageLang === 'bn' ? <span lang="en">{text}</span> : text;
  return pageLang === 'bn' ? bn : <span lang="bn">{bn}</span>;
}

/** The same words as a plain string for an attribute, and the language to mark when it differs from the page's. */
export function publicString(
  text: string,
  pageLang: string,
  locale: string = pageLang,
): { readonly text: string; readonly lang?: 'en' | 'bn' } {
  const bn = locale === 'bn' ? publicBnByEnglish(text) : undefined;
  const lang = bn === undefined ? 'en' : 'bn';
  const shown = bn ?? text;
  return lang === pageLang ? { text: shown } : { text: shown, lang };
}
