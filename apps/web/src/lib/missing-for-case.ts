import { resolveDocumentType } from '@visastack/core/catalogue';
import { fieldLabel } from './master-profile';
import type { MissingForCase, MissingRow, MissingState } from './request-picker-types';

/**
 * "Missing for This Case": the checklist items the traveller has not provided yet, as picker rows.
 * Built on the server from what the case page already loads (its readiness and its requests), so
 * it reads nothing new.
 *
 * - Only a required item that was never provided starts ticked ("ask").
 * - An optional item, a conflict, or an out-of-date copy is listed but starts unticked.
 * - An item with a request already waiting on the traveller shows "asked" and starts unticked.
 * - A group of alternatives is one obligation however many members it has: the agency may tick
 *   any one, and nothing is ticked for them.
 * - A checklist name the list does not have is shown as text and can never be sent.
 */

interface MissingReadiness {
  readonly missing: readonly {
    readonly kind: 'FIELD' | 'DOCUMENT';
    readonly key: string;
    readonly optional: boolean;
    readonly reason: 'not_provided' | 'unresolved_conflict' | 'stale_evidence';
    readonly alternatives?: readonly {
      readonly kind: 'FIELD' | 'DOCUMENT';
      readonly key: string;
    }[];
  }[];
}

interface OpenRequest {
  readonly kind: string;
  readonly status: string;
  readonly fieldKey: string | null;
  readonly docType: string | null;
}

type Index = ReadonlyMap<string, { readonly label: string; readonly hint: string }>;

/** The picker id for a checklist name, or null when the list does not have it. */
export function pickerIdFor(kind: 'FIELD' | 'DOCUMENT', key: string, index: Index): string | null {
  const id = kind === 'FIELD' ? `FIELD:${key}` : `DOCUMENT:${resolveDocumentType(key)?.key ?? ''}`;
  return index.has(id) ? id : null;
}

function rowFor(
  entry: { readonly kind: 'FIELD' | 'DOCUMENT'; readonly key: string },
  state: MissingState,
  index: Index,
): MissingRow {
  const id = pickerIdFor(entry.kind, entry.key, index);
  const found = id === null ? undefined : index.get(id);
  if (id === null || !found) {
    return {
      id: '',
      label: entry.kind === 'FIELD' ? (fieldLabel(entry.key) ?? entry.key) : entry.key,
      hint: '',
      state: 'unlisted',
    };
  }
  return { id, label: found.label, hint: found.hint, state };
}

export function buildMissingForCase(
  readiness: MissingReadiness | null,
  requests: readonly OpenRequest[],
  index: Index,
): MissingForCase | null {
  if (!readiness) return null;
  const waiting = new Set<string>();
  for (const request of requests) {
    if (request.status !== 'OPEN' && request.status !== 'NEEDS_REPLACEMENT') continue;
    const id =
      request.kind === 'FIELD' && request.fieldKey
        ? pickerIdFor('FIELD', request.fieldKey, index)
        : request.docType
          ? pickerIdFor('DOCUMENT', request.docType, index)
          : null;
    if (id) waiting.add(id);
  }

  const rows: MissingRow[] = [];
  const anyOf: MissingRow[][] = [];
  for (const entry of readiness.missing ?? []) {
    if (entry.alternatives && entry.alternatives.length > 0) {
      const members = entry.alternatives.map((member) => {
        const id = pickerIdFor(member.kind, member.key, index);
        return rowFor(member, id !== null && waiting.has(id) ? 'asked' : 'alternative', index);
      });
      anyOf.push(members);
      continue;
    }
    const id = pickerIdFor(entry.kind, entry.key, index);
    const state: MissingState =
      id !== null && waiting.has(id)
        ? 'asked'
        : entry.reason === 'unresolved_conflict'
          ? 'conflict'
          : entry.reason === 'stale_evidence'
            ? 'stale'
            : entry.optional
              ? 'optional'
              : 'ask';
    const row = rowFor(entry, state, index);
    // Two checklist lines can name the same item: it is listed, ticked and sent once.
    if (row.id !== '' && rows.some((existing) => existing.id === row.id)) continue;
    rows.push(row);
  }
  if (rows.length === 0 && anyOf.length === 0) return null;
  return { rows, anyOf };
}
