import { and, eq } from 'drizzle-orm';
import { type Db, first, schema } from './db';
import { lifecycleTablesPresent, presentDocumentCondition } from './lifecycle/foundation';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * True when this file version belongs to this applicant's own documents. The one rule the AI
 * reading entry points use to bind a version id they were handed to the applicant they act for
 * (S2, M12): a version of anyone else's, one that does not exist, and an id that is not even an
 * id all answer the same, so a refusal never says which.
 */
export async function documentVersionBelongsToApplicant(
  db: Db,
  documentVersionId: string,
  applicantId: string,
): Promise<boolean> {
  if (!UUID.test(documentVersionId) || !UUID.test(applicantId)) return false;
  const lifecycle = await lifecycleTablesPresent(db);
  const row = first(
    await db
      .select({ id: schema.documentVersions.id })
      .from(schema.documentVersions)
      .innerJoin(schema.documents, eq(schema.documents.id, schema.documentVersions.documentId))
      .where(
        and(
          eq(schema.documentVersions.id, documentVersionId),
          eq(schema.documents.applicantId, applicantId),
          // Processing a version the caller names: presentDocumentCondition (deleted answers as missing).
          lifecycle ? presentDocumentCondition() : undefined,
        ),
      )
      .limit(1),
  );
  return row !== undefined;
}
