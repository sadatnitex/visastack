import { Fragment, type ReactNode } from 'react';
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

/**
 * A message with `{name}` tokens (a count, a country), worded in the visitor's language. The English
 * is the text with the tokens filled, exactly as the page built it before; Bengali comes from the
 * drafted message when it is live, with Bengali digits for numeric tokens.
 */
export function publicFormat(
  text: string,
  params: Readonly<Record<string, string | number>>,
  pageLang: string,
  locale: string = pageLang,
): ReactNode {
  const bn = locale === 'bn' ? publicBnByEnglish(text) : undefined;
  const template = bn ?? text;
  const numbers = new Intl.NumberFormat(bn === undefined ? 'en' : 'bn-BD', { useGrouping: false });
  const filled = template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name];
    if (value === undefined) return whole;
    return typeof value === 'number' ? numbers.format(value) : value;
  });
  if (bn === undefined) return pageLang === 'en' ? filled : <span lang="en">{filled}</span>;
  return pageLang === 'bn' ? filled : <span lang="bn">{filled}</span>;
}

/** A drafted message (`i18n/*-messages.ts`) in the visitor's language: its Bengali when live, else its English, marked. */
type Drafted = { readonly en: string; readonly bn: string; readonly live: boolean };

function fill(template: string, params: Readonly<Record<string, string | number>>, tag: string) {
  const numbers = new Intl.NumberFormat(tag, { useGrouping: false });
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name];
    if (value === undefined) return whole;
    return typeof value === 'number' ? numbers.format(value) : value;
  });
}

/** Which language this message is shown in for this visitor. */
const shownIn = (message: Drafted, locale: string): 'en' | 'bn' =>
  locale === 'bn' && message.live ? 'bn' : 'en';

/**
 * A message with tokens, worded by its own record rather than by its English text, so typography in
 * the English can never break the lookup. English output is the English text with the tokens filled.
 */
export function publicMessage(
  message: Drafted,
  pageLang: string,
  locale: string = pageLang,
  params: Readonly<Record<string, string | number>> = {},
): ReactNode {
  const lang = shownIn(message, locale);
  const text = fill(
    lang === 'bn' ? message.bn : message.en,
    params,
    lang === 'bn' ? 'bn-BD' : 'en',
  );
  return lang === pageLang ? text : <span lang={lang}>{text}</span>;
}

/**
 * A sentence with links or other parts inside it: `{name}` tokens are replaced by the given nodes, in
 * the order of the language shown. A part that is in a different language from the sentence names
 * its own language itself (the caller marks it); the sentence is wrapped once when it differs from
 * the page's.
 */
export function publicSentence(
  message: Drafted,
  parts: Readonly<Record<string, ReactNode>>,
  pageLang: string,
  locale: string = pageLang,
  params: Readonly<Record<string, string | number>> = {},
): ReactNode {
  const lang = shownIn(message, locale);
  const text = fill(
    lang === 'bn' ? message.bn : message.en,
    params,
    lang === 'bn' ? 'bn-BD' : 'en',
  );
  const pieces = text.split(/(\{\w+\})/g).map((piece) => {
    const name = /^\{(\w+)\}$/.exec(piece)?.[1];
    return name !== undefined && name in parts ? (
      <Fragment key={name}>{parts[name]}</Fragment>
    ) : (
      piece
    );
  });
  return lang === pageLang ? <>{pieces}</> : <span lang={lang}>{pieces}</span>;
}

/** The language a message is shown in (for marking a part that sits inside a sentence of another language). */
export const messageLang = shownIn;
