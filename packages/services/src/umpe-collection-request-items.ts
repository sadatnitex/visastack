import { createHash, randomUUID } from 'node:crypto';
import {
  type RequirementNecessity,
  isRequirementNecessity,
  necessityCanBlock,
  requirementNecessity,
  requirementProvenance,
} from '@visastack/core';
import { CATALOGUE_FIELDS } from '@visastack/core/catalogue';
import { documentTypeName } from '@visastack/core/catalogue/documents';

/**
 * The checklist of an agency document request (UMPE P6), as plain data: the items, how a published
 * official pack becomes a proposal, how the operator may change a draft, and the canonical content
 * whose SHA-256 an issued revision carries. Pure: no database, so the rules are tested on their own.
 *
 * Necessity and provenance words come only from `@visastack/core` `requirement-necessity.ts`
 * (ADR 0026 D3). An official item keeps exactly what the pack says; the operator can add a note to
 * it, move it, and leave out one that never blocks. Only the agency's own items (`AGENCY_ADDED`)
 * take a necessity the operator chooses, and never Mandatory If It Applies (a condition is the
 * pack's to state).
 */

export type CollectionItemKind = 'FIELD' | 'DOCUMENT';
/**
 * Pack items are official, requested by the authority, or observed in VisaStack cases (UMPE G2,
 * S08: never official, never blocking); only `agency` items are the agency's own.
 */
export type CollectionItemProvenance =
  | 'OFFICIAL'
  | 'AUTHORITY_REQUESTED'
  | 'FIELD_OBSERVATION'
  | 'AGENCY_ADDED';

/** The pack provenances an item keeps as they are; anything else from a pack reads as official. */
const PACK_PROVENANCES_KEPT = new Set(['AUTHORITY_REQUESTED', 'FIELD_OBSERVATION']);

export interface CollectionItem {
  /** Stable within the request, so an edit names the item it changes. */
  readonly id: string;
  readonly label: string;
  readonly kind: CollectionItemKind;
  readonly fieldKey: string | null;
  readonly docType: string | null;
  readonly necessity: RequirementNecessity;
  readonly provenance: CollectionItemProvenance;
  /** Members of one alternatives group: any one of them satisfies it. */
  readonly groupKey: string | null;
  /** The agency's own note to the recipient. */
  readonly note: string | null;
  readonly order: number;
  /** The pack requirement it came from, or 'agency'. */
  readonly source: string;
  /** The official citation, for an official item. */
  readonly citation: string | null;
}

/** The necessities the operator may choose for the agency's own items. */
export const AGENCY_ITEM_NECESSITIES = ['MANDATORY', 'RECOMMENDED', 'OPTIONAL'] as const;
export type AgencyItemNecessity = (typeof AGENCY_ITEM_NECESSITIES)[number];

export const MAX_ITEMS = 120;
export const MAX_LABEL_LENGTH = 160;
export const MAX_NOTE_LENGTH = 500;

/** The parts of a stored pack requirement read here; newer columns are read only when present. */
export interface PackRequirementLike {
  readonly id: string;
  readonly kind: CollectionItemKind;
  readonly fieldKey: string | null;
  readonly docType: string | null;
  readonly citation: string;
  readonly optional: boolean;
}

const FIELD_LABELS: ReadonlyMap<string, string> = new Map(
  CATALOGUE_FIELDS.map((field) => [field.key, field.label] as const),
);

function humanize(key: string): string {
  return key
    .split(/[_\s]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function requirementLabel(row: PackRequirementLike): string {
  if (row.kind === 'DOCUMENT' && row.docType) {
    return documentTypeName(row.docType) ?? humanize(row.docType);
  }
  if (row.kind === 'FIELD' && row.fieldKey) {
    return FIELD_LABELS.get(row.fieldKey) ?? humanize(row.fieldKey);
  }
  return 'Requirement';
}

/** A column added by a later schema slot (ADR 0026 D3), read only when the row carries it. */
function optionalColumn(row: object, name: string): unknown {
  return Object.hasOwn(row, name) ? (row as Record<string, unknown>)[name] : null;
}

/**
 * A pack's requirements as a proposed checklist: blocking items first, then the rest, each group of
 * alternatives kept together, in label order. Every item is official; nothing is invented.
 */
export function proposeFromPack(rows: readonly PackRequirementLike[]): CollectionItem[] {
  const items = rows.map((row) => {
    const necessityValue = optionalColumn(row, 'necessity');
    const provenanceValue = optionalColumn(row, 'provenance');
    const groupValue = optionalColumn(row, 'groupKey');
    const source = {
      optional: row.optional,
      necessity: isRequirementNecessity(necessityValue) ? necessityValue : null,
      provenance:
        provenanceValue === 'AGENCY_ADDED' ||
        provenanceValue === 'AUTHORITY_REQUESTED' ||
        provenanceValue === 'FIELD_OBSERVATION'
          ? provenanceValue
          : null,
    } as const;
    const read = requirementProvenance(source);
    // A pack row is the pack's, never the agency's own, whatever a later column says.
    const provenance: CollectionItemProvenance = PACK_PROVENANCES_KEPT.has(read)
      ? (read as 'AUTHORITY_REQUESTED' | 'FIELD_OBSERVATION')
      : 'OFFICIAL';
    const necessity = requirementNecessity(source);
    return {
      row,
      label: requirementLabel(row),
      // A field observation never blocks, even if a stored row claims more (Pack Studio refuses it).
      necessity:
        provenance === 'FIELD_OBSERVATION' && necessityCanBlock(necessity)
          ? ('RECOMMENDED' as const)
          : necessity,
      provenance,
      groupKey: typeof groupValue === 'string' && groupValue.length > 0 ? groupValue : null,
    };
  });
  const rank: Readonly<Record<RequirementNecessity, number>> = {
    MANDATORY: 0,
    CONDITIONAL: 1,
    RECOMMENDED: 2,
    OPTIONAL: 3,
  };
  items.sort(
    (a, b) =>
      rank[a.necessity] - rank[b.necessity] ||
      (a.groupKey ?? '').localeCompare(b.groupKey ?? '', 'en') ||
      a.label.localeCompare(b.label, 'en') ||
      (a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0),
  );
  return items.map((item, order) => ({
    id: item.row.id,
    label: item.label,
    kind: item.row.kind,
    fieldKey: item.row.fieldKey,
    docType: item.row.docType,
    necessity: item.necessity,
    provenance: item.provenance,
    groupKey: item.groupKey,
    note: null,
    order,
    source: item.row.id,
    citation: item.row.citation,
  }));
}

export type DraftEdit =
  | {
      readonly type: 'add';
      readonly label: string;
      readonly necessity: string;
      readonly note?: string | null;
    }
  | { readonly type: 'remove'; readonly itemId: string }
  | { readonly type: 'move'; readonly itemId: string; readonly direction: 'up' | 'down' }
  | { readonly type: 'note'; readonly itemId: string; readonly note: string | null }
  | { readonly type: 'necessity'; readonly itemId: string; readonly necessity: string };

export function cleanText(
  value: string | null | undefined,
  max: number,
): string | null | 'too_long' {
  const text = (value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length === 0) return null;
  return text.length > max ? 'too_long' : text;
}

function renumber(items: readonly CollectionItem[]): CollectionItem[] {
  return items.map((item, order) => (item.order === order ? item : { ...item, order }));
}

/**
 * The draft after one edit, or a plain refusal. An official item's label, necessity, group and
 * source never change here, and an official item that can block is never left out.
 */
export function applyDraftEdit(
  items: readonly CollectionItem[],
  edit: DraftEdit,
):
  | { readonly ok: true; readonly items: CollectionItem[] }
  | { readonly ok: false; readonly message: string } {
  const sorted = [...items].sort((a, b) => a.order - b.order);
  if (edit.type === 'add') {
    if (sorted.length >= MAX_ITEMS) {
      return { ok: false, message: `A request can hold at most ${MAX_ITEMS} items.` };
    }
    const label = cleanText(edit.label, MAX_LABEL_LENGTH);
    if (label === null) return { ok: false, message: 'Enter what you need.' };
    if (label === 'too_long') {
      return { ok: false, message: `Keep the item to ${MAX_LABEL_LENGTH} characters.` };
    }
    if (!(AGENCY_ITEM_NECESSITIES as readonly string[]).includes(edit.necessity)) {
      return { ok: false, message: 'Choose Mandatory, Recommended or Optional.' };
    }
    const note = cleanText(edit.note, MAX_NOTE_LENGTH);
    if (note === 'too_long') {
      return { ok: false, message: `Keep the note to ${MAX_NOTE_LENGTH} characters.` };
    }
    const item: CollectionItem = {
      id: randomUUID(),
      label,
      kind: 'DOCUMENT',
      fieldKey: null,
      docType: null,
      necessity: edit.necessity as AgencyItemNecessity,
      provenance: 'AGENCY_ADDED',
      groupKey: null,
      note,
      order: sorted.length,
      source: 'agency',
      citation: null,
    };
    return { ok: true, items: renumber([...sorted, item]) };
  }

  const at = sorted.findIndex((item) => item.id === edit.itemId);
  const target = sorted[at];
  if (!target) return { ok: false, message: 'That item is no longer on the checklist.' };

  if (edit.type === 'remove') {
    if (target.provenance !== 'AGENCY_ADDED' && necessityCanBlock(target.necessity)) {
      return {
        ok: false,
        message: 'An official requirement that can block the application stays on the checklist.',
      };
    }
    return { ok: true, items: renumber(sorted.filter((item) => item.id !== target.id)) };
  }
  if (edit.type === 'move') {
    const to = edit.direction === 'up' ? at - 1 : at + 1;
    const other = sorted[to];
    if (!other) return { ok: true, items: renumber(sorted) };
    const next = [...sorted];
    next[to] = target;
    next[at] = other;
    return { ok: true, items: renumber(next) };
  }
  if (edit.type === 'note') {
    const note = cleanText(edit.note, MAX_NOTE_LENGTH);
    if (note === 'too_long') {
      return { ok: false, message: `Keep the note to ${MAX_NOTE_LENGTH} characters.` };
    }
    return {
      ok: true,
      items: renumber(sorted.map((item) => (item.id === target.id ? { ...item, note } : item))),
    };
  }
  // necessity
  if (target.provenance !== 'AGENCY_ADDED') {
    return {
      ok: false,
      message: 'An official requirement keeps the necessity its source gives it.',
    };
  }
  if (!(AGENCY_ITEM_NECESSITIES as readonly string[]).includes(edit.necessity)) {
    return { ok: false, message: 'Choose Mandatory, Recommended or Optional.' };
  }
  return {
    ok: true,
    items: renumber(
      sorted.map((item) =>
        item.id === target.id
          ? { ...item, necessity: edit.necessity as AgencyItemNecessity }
          : item,
      ),
    ),
  };
}

/** The draft with every official item replaced by a new pack's proposal; agency items stay after them. */
export function replaceOfficialItems(
  items: readonly CollectionItem[],
  proposal: readonly CollectionItem[],
): CollectionItem[] {
  const agency = [...items]
    .sort((a, b) => a.order - b.order)
    .filter((item) => item.provenance === 'AGENCY_ADDED');
  return renumber([...proposal, ...agency]);
}

const KINDS: ReadonlySet<string> = new Set(['FIELD', 'DOCUMENT']);

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

/**
 * Stored items read back with their shape checked: anything that is not exactly an item makes the
 * whole list unreadable (null), never silently repaired.
 */
export function parseItems(value: unknown): CollectionItem[] | null {
  if (!Array.isArray(value)) return null;
  const items: CollectionItem[] = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) return null;
    const r = raw as { readonly [K in keyof CollectionItem]?: unknown };
    if (
      typeof r.id !== 'string' ||
      typeof r.label !== 'string' ||
      typeof r.kind !== 'string' ||
      !KINDS.has(r.kind) ||
      !nullableString(r.fieldKey) ||
      !nullableString(r.docType) ||
      !isRequirementNecessity(r.necessity) ||
      (r.provenance !== 'OFFICIAL' &&
        r.provenance !== 'AUTHORITY_REQUESTED' &&
        r.provenance !== 'FIELD_OBSERVATION' &&
        r.provenance !== 'AGENCY_ADDED') ||
      !nullableString(r.groupKey) ||
      !nullableString(r.note) ||
      typeof r.order !== 'number' ||
      !Number.isInteger(r.order) ||
      typeof r.source !== 'string' ||
      !nullableString(r.citation)
    ) {
      return null;
    }
    // An agency item is never conditional and never claims a pack source.
    if (
      r.provenance === 'AGENCY_ADDED' &&
      (r.necessity === 'CONDITIONAL' || r.source !== 'agency')
    ) {
      return null;
    }
    if (r.provenance !== 'AGENCY_ADDED' && r.source === 'agency') return null;
    // A field observation is never a blocking item.
    if (r.provenance === 'FIELD_OBSERVATION' && necessityCanBlock(r.necessity)) return null;
    items.push({
      id: r.id,
      label: r.label,
      kind: r.kind as CollectionItemKind,
      fieldKey: r.fieldKey,
      docType: r.docType,
      necessity: r.necessity,
      provenance: r.provenance,
      groupKey: r.groupKey,
      note: r.note,
      order: r.order,
      source: r.source,
      citation: r.citation,
    });
  }
  return items.sort((a, b) => a.order - b.order);
}

/** Key-sorted JSON with no whitespace: the same content always gives the same bytes. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

export interface RevisionContent {
  readonly requestId: string;
  readonly revisionNo: number;
  readonly packVersionId: string | null;
  readonly packChecksum: string | null;
  readonly items: readonly CollectionItem[];
  readonly brandSnapshot: BrandSnapshot | null;
}

export interface BrandSnapshot {
  readonly name: string;
  readonly accentColor: string | null;
}

/** The SHA-256 (hex) of a revision's canonical content. Postgres reorders jsonb keys, so this never hashes stored text. */
export function revisionContentSha256(content: RevisionContent): string {
  return createHash('sha256')
    .update(
      canonicalJson({
        format: 1,
        requestId: content.requestId,
        revisionNo: content.revisionNo,
        packVersionId: content.packVersionId,
        packChecksum: content.packChecksum,
        items: content.items,
        brandSnapshot: content.brandSnapshot,
      }),
    )
    .digest('hex');
}

export function parseBrandSnapshot(value: unknown): BrandSnapshot | null | 'invalid' {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object') return 'invalid';
  const r = value as { readonly name?: unknown; readonly accentColor?: unknown };
  if (typeof r.name !== 'string' || !nullableString(r.accentColor)) return 'invalid';
  return { name: r.name, accentColor: r.accentColor };
}
