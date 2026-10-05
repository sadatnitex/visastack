import { type Locale, type MessageParams, fill, splitRich } from '@visastack/i18n/client';
import { Fragment, type ReactNode } from 'react';

/**
 * A message that carries a little emphasis or a link, written once in the catalog
 * with `<b>...</b>` and `<link>...</link>` so each language can put them where its
 * own word order needs them. The message is split into pieces first and each
 * piece is filled afterwards, so a value a person typed is shown as text and never
 * read as a tag. Emphasis becomes `<strong>`; a link needs the caller to say what
 * the link is (`link={(text) => <a href="...">{text}</a>}`), otherwise it is plain text.
 */
export function Rich({
  template,
  locale,
  params,
  link,
}: {
  readonly template: string;
  readonly locale: Locale;
  readonly params?: MessageParams;
  readonly link?: (text: string) => ReactNode;
}) {
  const seen = new Map<string, number>();
  return (
    <>
      {splitRich(template).map((piece) => {
        const text = fill(piece.text, params, locale);
        const label = `${piece.tag ?? 'text'}:${piece.text}`;
        const occurrence = (seen.get(label) ?? 0) + 1;
        seen.set(label, occurrence);
        const id = `${label}#${occurrence}`;
        if (piece.tag === 'b') return <strong key={id}>{text}</strong>;
        if (piece.tag === 'link' && link) return <Fragment key={id}>{link(text)}</Fragment>;
        return <Fragment key={id}>{text}</Fragment>;
      })}
    </>
  );
}
