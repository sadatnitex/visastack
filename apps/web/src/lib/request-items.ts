import type { EvidenceRequestItem } from '@visastack/services';
import { MAX_ASK_ITEMS } from './request-picker-types';

/** One thing asked for in a send: a document type or a detail, by its catalogue key. */
export type AskItem = EvidenceRequestItem;

export type ParsedAskItems =
  | { readonly ok: true; readonly items: readonly AskItem[] }
  | { readonly ok: false; readonly message: string };

const NOT_KNOWN = 'One of the items is not one we know. Choose from the list.';

/**
 * The items of one send, from the picker's repeated `item` fields (`DOCUMENT:KEY` or
 * `FIELD:key`). The same item named twice is asked once. Whether the key is a real detail or
 * document type is checked by the service before anything is written; here only the shape and the
 * cap are, so a bad post is refused with a plain sentence.
 */
export function parseAskItems(values: readonly string[]): ParsedAskItems {
  const seen = new Set<string>();
  const items: AskItem[] = [];
  for (const raw of values) {
    const value = raw.trim();
    if (value === '') continue;
    const cut = value.indexOf(':');
    const kind = value.slice(0, cut);
    const key = value.slice(cut + 1).trim();
    if (cut < 1 || (kind !== 'FIELD' && kind !== 'DOCUMENT') || key === '') {
      return { ok: false, message: NOT_KNOWN };
    }
    const id = `${kind}:${key}`;
    if (seen.has(id)) continue;
    seen.add(id);
    items.push({ kind, key });
  }
  if (items.length === 0) return { ok: false, message: 'Choose at least one item.' };
  if (items.length > MAX_ASK_ITEMS) {
    return { ok: false, message: `You can ask for up to ${MAX_ASK_ITEMS} items in one send.` };
  }
  return { ok: true, items };
}
