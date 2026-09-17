import { and, count, eq, inArray, isNotNull } from 'drizzle-orm';
import { appendAuditEvent } from './audit';
import { type Db, first, schema } from './db';
import type { KeyManagementPort } from './ports';
import { type FieldSensitivity, buildFactVersionAad, protectValue } from './protected-fields';

/**
 * Retroactive protected-field encryption (Commercial V1 SEC-03) — an
 * admin/script-triggered sweep that finds `fact_versions` still holding a
 * plaintext `value` for a field now classified SENSITIVE/RESTRICTED (rows
 * written before protected-field encryption existed, or before a
 * KeyManagementPort was actually wired into the real save paths — see
 * AD-01/the requirements ledger's SEC-03 correction) and re-encrypts them in
 * place. `editFact` itself has always refused to WRITE a new plaintext
 * SENSITIVE/RESTRICTED value (fails closed with `encryption_unavailable`);
 * this module only ever touches pre-existing rows.
 *
 * Same shape as `reconciliation.ts`'s orphan sweep: bounded per call
 * (`limit`), a `dryRun` mode that only reports, one transaction per row so a
 * single bad row can't abort the batch, and safe to re-run repeatedly — a
 * row already encrypted no longer matches the plaintext scan, so calling
 * `backfillProtectedFields` again picks up wherever the last call left off
 * without any separate cursor/lease state.
 */

export interface PlaintextProtectedField {
  readonly factVersionId: string;
  readonly factId: string;
  readonly applicantId: string;
  readonly fieldKey: string;
  readonly sensitivity: FieldSensitivity;
}

export interface EncryptionBackfillReport {
  readonly dryRun: boolean;
  /** Rows already protected, for context alongside the plaintext backlog below. */
  readonly alreadyProtectedCount: number;
  /** This batch's plaintext findings (bounded by `limit`) — the reconciliation evidence. */
  readonly plaintextFound: readonly PlaintextProtectedField[];
  /** Actually re-encrypted this call. Always 0 in dry run. */
  readonly encrypted: number;
  readonly errors: readonly { readonly factVersionId: string; readonly message: string }[];
}

export interface BackfillProtectedFieldsInput {
  readonly actorAccountId: string;
  readonly dryRun: boolean;
  readonly limit?: number;
}

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;
const PROTECTED_SENSITIVITIES = ['SENSITIVE', 'RESTRICTED'] as const;

async function findPlaintextProtectedFieldVersions(
  db: Db,
  limit: number,
): Promise<PlaintextProtectedField[]> {
  return db
    .select({
      factVersionId: schema.factVersions.id,
      factId: schema.factVersions.factId,
      applicantId: schema.facts.applicantId,
      fieldKey: schema.fieldDefinitions.key,
      sensitivity: schema.fieldDefinitions.sensitivity,
    })
    .from(schema.factVersions)
    .innerJoin(schema.facts, eq(schema.facts.id, schema.factVersions.factId))
    .innerJoin(
      schema.fieldDefinitions,
      eq(schema.fieldDefinitions.id, schema.facts.fieldDefinitionId),
    )
    .where(
      and(
        isNotNull(schema.factVersions.value),
        inArray(schema.fieldDefinitions.sensitivity, PROTECTED_SENSITIVITIES),
      ),
    )
    .limit(limit);
}

/**
 * One bounded batch: finds up to `limit` plaintext SENSITIVE/RESTRICTED fact
 * versions and, outside dry run, re-encrypts each under `encryption`'s
 * current key version. Call repeatedly (e.g. from a script loop) until
 * `plaintextFound` comes back empty.
 */
export async function backfillProtectedFields(
  db: Db,
  encryption: KeyManagementPort,
  input: BackfillProtectedFieldsInput,
): Promise<EncryptionBackfillReport> {
  const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

  const [alreadyProtected, plaintextFound] = await Promise.all([
    db
      .select({ n: count() })
      .from(schema.factVersions)
      .where(isNotNull(schema.factVersions.protectedKeyVersion)),
    findPlaintextProtectedFieldVersions(db, limit),
  ]);
  const alreadyProtectedCount = alreadyProtected[0]?.n ?? 0;

  let encrypted = 0;
  const errors: { factVersionId: string; message: string }[] = [];
  if (!input.dryRun) {
    for (const row of plaintextFound) {
      try {
        await db.transaction(async (tx) => {
          // Re-check inside the transaction: a concurrent backfill run, or an
          // unrelated edit, may have already changed this exact row since
          // the scan above ran.
          const current = first(
            await tx
              .select({ value: schema.factVersions.value })
              .from(schema.factVersions)
              .where(eq(schema.factVersions.id, row.factVersionId))
              .limit(1)
              .for('update'),
          );
          if (!current || current.value === null) return;

          const aad = buildFactVersionAad({
            applicantId: row.applicantId,
            factId: row.factId,
            fieldKey: row.fieldKey,
            factVersionId: row.factVersionId,
          });
          const protectedValue = await protectValue(tx, encryption, current.value, aad);
          await tx
            .update(schema.factVersions)
            .set({
              value: null,
              valueCiphertext: Buffer.from(protectedValue.ciphertext),
              valueNonce: Buffer.from(protectedValue.nonce),
              protectedKeyVersion: protectedValue.keyVersion,
            })
            .where(eq(schema.factVersions.id, row.factVersionId));
          await appendAuditEvent(tx, {
            eventType: 'PROTECTED_FIELD_BACKFILLED',
            actorAccountId: input.actorAccountId,
            method: 'SYSTEM',
            result: 'ALLOWED',
            applicantId: row.applicantId,
            resourceType: 'fact_version',
            resourceId: row.factVersionId,
            reason: `retroactive encryption for ${row.sensitivity} field ${row.fieldKey}`,
          });
        });
        encrypted += 1;
      } catch (error) {
        errors.push({
          factVersionId: row.factVersionId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return { dryRun: input.dryRun, alreadyProtectedCount, plaintextFound, encrypted, errors };
}
