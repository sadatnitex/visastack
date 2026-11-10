/**
 * The shared "does this text hold something that could identify a person or leave the product?"
 * check: a link, an email address (written or spelled out), an id, or a long number. It is used by
 * the agency follow-up message, the calendar text and the WhatsApp message builder, so the three
 * never disagree. No imports, so it is safe in the browser as well as on the server.
 */

// Every check runs on the NFKC form of the text, so full-width letters, digits, dots and the
// full-width at sign are judged like their plain forms. Digits are matched as any decimal digit
// (\p{Nd}), so Bangla and full-width numbers count too.
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const LINK =
  /(?:[a-z][a-z0-9+.-]*:\/\/|\bwww\.|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:[/?#:]|\b))/i;
/** A domain hidden behind a bracketed dot: evil[.]com, evil(.)com, evil{dot}com, evil [dot] com. */
const BRACKETED_DOT_LINK = /[\p{L}\p{N}-]\s*[([{]\s*(?:\.|dot)\s*[)\]}]\s*\p{L}{2,}/iu;
/**
 * A domain spelled with a spaced dot or the word dot: "evil . com", "evil .com", "evil dot com".
 * Only common web endings that are not everyday words count here, and a full stop followed by a
 * space ("form. In") never does, so ordinary sentences and "dot every i" still pass.
 */
const SPACED_DOT_LINK =
  /[\p{L}\p{N}-](?:\s+\.\s*|\s+dot\s+)(?:com|org|net|edu|gov|info|biz|io|xyz|app|dev|bd|uk|test)\b/iu;
/** Any at sign, including the full-width and small forms. */
const AT_SIGN = /[@\uFF20\uFE6B]/u;
/** An email address spelled out: "name at gmail dot com", "name(at)gmail(dot)com", "name [at] mail [dot] org". */
const SPELLED_EMAIL =
  /[\p{L}\p{N}._%+-]+\s*[([{<]?\s*\bat\b\s*[)\]}>]?\s*[\p{L}\p{N}-]+\s*[([{<]?\s*\bdot\b\s*[)\]}>]?\s*\p{L}{2,}/iu;
/** Six or more digits in a row: account, phone and most document numbers. */
const DIGIT_RUN = /\p{Nd}{6,}/u;
/**
 * Eight or more digits close together, split by spaces, slashes, underscores, dots, hyphens,
 * plus signs or brackets (at most three of those between digits): phone numbers such as
 * (017) 1234 5678, account numbers in groups, and numbers written as 0123/4567.
 */
const SPLIT_DIGITS = /(?:\p{Nd}[\s/_.()[\]{}+-]{0,3}){7}\p{Nd}/u;
/** A code mixing letters and at least five digits, such as a passport number (A1234567). */
const MIXED_CODE =
  /(?<![\p{L}\p{N}])(?=[\p{L}\p{N}]*\p{L})(?=(?:\p{L}*\p{Nd}){5})[\p{L}\p{N}]{6,}(?![\p{L}\p{N}])/u;
/** A capital-letter prefix followed by five or more digits, even when split: A0123 4567, BX 012345. */
const SPLIT_CODE = /(?<![\p{L}\p{N}])\p{Lu}{1,3}[\s/_.-]?(?:\p{Nd}[\s/_.-]?){5,}/u;

/** True when the text holds a link, an email address (written or spelled out), an id or a long number. */
export function containsUnsafeDetail(text: string): boolean {
  const plain = text.normalize('NFKC');
  return [
    AT_SIGN,
    SPELLED_EMAIL,
    UUID,
    LINK,
    BRACKETED_DOT_LINK,
    SPACED_DOT_LINK,
    DIGIT_RUN,
    SPLIT_DIGITS,
    MIXED_CODE,
    SPLIT_CODE,
  ].some((pattern) => pattern.test(plain));
}
