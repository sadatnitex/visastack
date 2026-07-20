import { type Result, err, ok } from '@visastack/core';
import { eq, inArray } from 'drizzle-orm';
import { appendAuditEvent } from './audit';
import { getConsents } from './consent';
import { type Db, schema } from './db';
import { type ServiceError, serviceError } from './errors';

/**
 * Account data export (Build Spec §13; PRD §2 — data portability).
 *
 * Assembles a complete, structured, JSON-serializable snapshot of everything
 * the account owns: identity, consents, applicant subjects, their Master
 * Profile facts (current value + full immutable history), Document Vault
 * metadata, and the audit trail. Self-service only; the export itself is
 * audited.
 */

export interface AccountExport {
  readonly account: typeof schema.accounts.$inferSelect;
  readonly consents: Awaited<ReturnType<typeof getConsents>>;
  readonly applicants: ReadonlyArray<{
    readonly applicant: typeof schema.applicants.$inferSelect;
    readonly facts: ReadonlyArray<{
      readonly fact: typeof schema.facts.$inferSelect;
      readonly versions: ReadonlyArray<typeof schema.factVersions.$inferSelect>;
    }>;
    readonly documents: ReadonlyArray<{
      readonly document: typeof schema.documents.$inferSelect;
      readonly versions: ReadonlyArray<typeof schema.documentVersions.$inferSelect>;
    }>;
  }>;
  readonly auditEvents: ReadonlyArray<typeof schema.auditEvents.$inferSelect>;
  readonly exportedAt: string;
}

export async function exportAccount(
  db: Db,
  input: { readonly actorAccountId: string; readonly accountId: string },
): Promise<Result<AccountExport, ServiceError>> {
  if (input.actorAccountId !== input.accountId) {
    return err(serviceError('forbidden', 'an account may only export its own data'));
  }
  const account = (
    await db.select().from(schema.accounts).where(eq(schema.accounts.id, input.accountId)).limit(1)
  )[0];
  if (!account) return err(serviceError('not_found', 'account not found'));

  const applicantRows = await db
    .select()
    .from(schema.applicants)
    .where(eq(schema.applicants.ownerAccountId, input.accountId));
  const applicantIds = applicantRows.map((a) => a.id);

  const applicants = await Promise.all(
    applicantRows.map(async (applicant) => {
      const factRows = await db
        .select()
        .from(schema.facts)
        .where(eq(schema.facts.applicantId, applicant.id));
      const facts = await Promise.all(
        factRows.map(async (fact) => ({
          fact,
          versions: await db
            .select()
            .from(schema.factVersions)
            .where(eq(schema.factVersions.factId, fact.id)),
        })),
      );
      const docRows = await db
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.applicantId, applicant.id));
      const documents = await Promise.all(
        docRows.map(async (document) => ({
          document,
          versions: await db
            .select()
            .from(schema.documentVersions)
            .where(eq(schema.documentVersions.documentId, document.id)),
        })),
      );
      return { applicant, facts, documents };
    }),
  );

  const auditEvents =
    applicantIds.length > 0
      ? await db
          .select()
          .from(schema.auditEvents)
          .where(inArray(schema.auditEvents.applicantId, applicantIds))
      : [];

  await db.transaction(async (tx) => {
    await appendAuditEvent(tx, {
      eventType: 'ACCOUNT_EXPORTED',
      actorAccountId: input.accountId,
      action: 'EXPORT_PROFILE',
      result: 'ALLOWED',
      method: 'API',
      resourceType: 'account',
      resourceId: input.accountId,
    });
  });

  return ok({
    account,
    consents: await getConsents(db, input.accountId),
    applicants,
    auditEvents,
    exportedAt: new Date().toISOString(),
  });
}
