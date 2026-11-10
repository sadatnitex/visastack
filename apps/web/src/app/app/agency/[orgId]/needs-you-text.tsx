import Link from 'next/link';

/**
 * The "Needs you" sentence of a case. When the sentence holds a count of items to review and an
 * administrator can open the request that waits, exactly that count is the link (friction E4);
 * otherwise, or if the words are not found in the sentence, the sentence is plain text.
 */
export function NeedsYouText({
  text,
  review,
}: {
  readonly text: string;
  readonly review?: { readonly phrase: string; readonly href: string } | undefined;
}) {
  const at = review ? text.indexOf(review.phrase) : -1;
  if (!review || at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <Link href={review.href}>{review.phrase}</Link>
      {text.slice(at + review.phrase.length)}
    </>
  );
}
