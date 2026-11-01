import { and, eq, inArray } from 'drizzle-orm';
import { type Db, schema } from '../../db';
import { type LifecycleAccess, lifecycleScope } from './access';
import type { DocumentLifecycleState } from './actions';
import { isUuid } from './ids';
import { lifecycleTablesPresent } from './presence';

export interface DocumentLifecycle {
  readonly state: DocumentLifecycleState;
  /** A newer document replaced this one (Replace With a Newer Document). */
  readonly replaced: boolean;
  readonly archivedAt: Date | null;
  readonly deletedAt: Date | null;
  /** When Recently Deleted ends and removal starts; the deletion time itself for a support removal. */
  readonly purgeAfter: Date | null;
  readonly deletePath: 'DUPLICATE' | 'REQUEST' | null;
}

const CURRENT: Omit<DocumentLifecycle, 'replaced'> = Object.freeze({
  state: 'CURRENT',
  archivedAt: null,
  deletedAt: null,
  purgeAfter: null,
  deletePath: null,
});

function stateOf(
  row: {
    readonly archivedAt: Date | null;
    readonly deletedAt: Date | null;
    readonly deletePath: 'DUPLICATE' | 'REQUEST' | null;
    readonly purgeAfter: Date | null;
  },
  now: Date,
): DocumentLifecycleState {
  if (row.deletedAt) {
    // A support-approved removal goes at once; a deleted duplicate once its 30 days are over.
    if (row.deletePath === 'REQUEST') return 'REMOVING';
    return row.purgeAfter && row.purgeAfter.getTime() <= now.getTime()
      ? 'REMOVING'
      : 'RECENTLY_DELETED';
  }
  return row.archivedAt ? 'ARCHIVED' : 'CURRENT';
}

/**
 * The lifecycle of each document, in one query, keyed by document id. A document the access does
 * not cover, or that does not exist, is absent from the map. While migration 0113 has not run,
 * every document reads Current (nothing can be archived or deleted yet).
 */
export async function getDocumentLifecycles(
  db: Db,
  documentIds: readonly string[],
  access: LifecycleAccess,
  options: { readonly now?: Date } = {},
): Promise<ReadonlyMap<string, DocumentLifecycle>> {
  const scope = lifecycleScope(access);
  const ids = [...new Set(documentIds)].filter(isUuid);
  if (scope === undefined || ids.length === 0) return new Map();
  const now = options.now ?? new Date();
  const documents = schema.documents;
  const where = and(
    inArray(documents.id, ids),
    scope === null ? undefined : eq(documents.applicantId, scope),
  );
  if (!(await lifecycleTablesPresent(db))) {
    const rows = await db
      .select({ id: documents.id, supersededBy: documents.supersededByDocumentId })
      .from(documents)
      .where(where);
    return new Map(
      rows.map((row) => [row.id, { ...CURRENT, replaced: row.supersededBy !== null }] as const),
    );
  }
  const lifecycle = schema.documentLifecycle;
  const rows = await db
    .select({
      id: documents.id,
      supersededBy: documents.supersededByDocumentId,
      archivedAt: lifecycle.archivedAt,
      deletedAt: lifecycle.deletedAt,
      deletePath: lifecycle.deletePath,
      purgeAfter: lifecycle.purgeAfter,
    })
    .from(documents)
    .leftJoin(lifecycle, eq(lifecycle.documentId, documents.id))
    .where(where);
  return new Map(
    rows.map(
      (row) =>
        [
          row.id,
          {
            state: stateOf(row, now),
            replaced: row.supersededBy !== null,
            archivedAt: row.archivedAt,
            deletedAt: row.deletedAt,
            purgeAfter: row.purgeAfter,
            deletePath: row.deletePath,
          },
        ] as const,
    ),
  );
}

/** `getDocumentLifecycles` for one document; null when it does not exist or is not covered. */
export async function getDocumentLifecycle(
  db: Db,
  documentId: string,
  access: LifecycleAccess,
  options: { readonly now?: Date } = {},
): Promise<DocumentLifecycle | null> {
  return (await getDocumentLifecycles(db, [documentId], access, options)).get(documentId) ?? null;
}
