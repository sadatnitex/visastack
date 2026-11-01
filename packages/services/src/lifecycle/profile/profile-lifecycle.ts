import { randomUUID } from 'node:crypto';
import { type Result, err, ok } from '@visastack/core';
import { MODULE_FIELDS, isKnownRecordGroupKey } from '@visastack/core/catalogue';
import { and, eq } from 'drizzle-orm';
import { AuthorizedApplicant } from '../../access/require-access';
import { appendAuditEvent } from '../../audit';
import { hasConsent } from '../../consent';
import { type Db, first, required, schema } from '../../db';
import { type ServiceError, serviceError } from '../../errors';
import { incrementMaterialRevision, missionsSelectingFact } from '../../material-revision';
import type { KeyManagementPort } from '../../ports';
import {
  buildFactVersionAad,
  protectValue,
  requiresProtection,
  revealValue,
} from '../../protected-fields';

/**
 * LC-G1: "No Longer Current" for one value and "Ended" for one entry in a list.
 *
 * Both follow the profile's one rule: a value is never overwritten. Each appends a new fact
 * version and re-points the fact at it in one transaction, so every earlier version stays in
 * History and a case snapshot taken before keeps the exact value it recorded.
 *
 * - No Longer Current appends, for one single (non-list) detail, a version with no value and
 *   status STALE. Case readiness already treats STALE as not answered (missions.ts
 *   `UNCONFIRMED_FACT_STATUSES`).
 * - Ended appends, for every detail of one list entry, a copy of its current value carrying
 *   `valid_until`. The entry stays on file as a past entry (an old address is still an address the
 *   person lived at); it is no longer the current one.
 *
 * Either is undone by saving a new value through `editFact`, which writes a confirmed version with
 * a value and no end date. Only the profile's owner may use them: a sharing grant, even one that
 * allows edits, is refused and the refusal is audited.
 */

/** Frozen audit event type (lifecycle PROGRAMME 3.5). Metadata holds keys and counts only. */
const AUDIT_EVENT = 'FACT_MARKED_NOT_CURRENT';
const DENIED_EVENT = 'FACT_EDIT_DENIED';
/** The furthest any time zone runs ahead of UTC (UTC+14), so "today" anywhere is never refused. */
const MAX_ZONE_AHEAD_MS = 14 * 60 * 60 * 1000;

type ProfileEditAccess = AuthorizedApplicant<'APPROVE_EDIT'>;

/** Thrown inside a transaction so a failure part way through rolls every write back. */
class MarkAborted extends Error {
  constructor(readonly serviceError: ServiceError) {
    super(serviceError.message);
  }
}

async function ownerOnly(
  access: ProfileEditAccess,
  metadata: Readonly<Record<string, string>>,
): Promise<Result<string, ServiceError>> {
  // A copied or hand-built proof is refused: only requireAccess can issue one.
  if (
    !AuthorizedApplicant.isGenuine(access, 'APPROVE_EDIT') ||
    access.resource.kind !== 'applicant'
  ) {
    return err(serviceError('forbidden', 'only the profile owner can change this'));
  }
  const ownerAccountId = access.applicant.ownerAccountId;
  if (access.actor.kind !== 'applicant_owner') {
    const actorAccountId = 'accountId' in access.actor ? access.actor.accountId : null;
    await access.tx.transaction(async (tx) => {
      await appendAuditEvent(tx, {
        eventType: DENIED_EVENT,
        actorAccountId,
        action: 'APPROVE_EDIT',
        result: 'DENIED',
        method: 'MANUAL',
        applicantId: access.applicant.id,
        resourceType: 'fact',
        reason: 'owner_only',
        metadata,
      });
    });
    return err(serviceError('forbidden', 'only the profile owner can change this'));
  }
  if (!(await hasConsent(access.tx, ownerAccountId, 'CORE_PROCESSING'))) {
    return err(
      serviceError('consent_required', 'Core processing consent is required to edit facts'),
    );
  }
  return ok(ownerAccountId);
}

interface CurrentFactRow {
  readonly factId: string;
  readonly fieldKey: string;
  readonly repeatingRecordKey: string | null;
  readonly sensitivity: (typeof schema.fieldDefinitions.$inferSelect)['sensitivity'];
  readonly version: typeof schema.factVersions.$inferSelect | null;
}

async function loadCurrentFacts(
  db: Db,
  applicantId: string,
  where: { readonly factId: string } | { readonly repeatingRecordKey: string },
): Promise<CurrentFactRow[]> {
  const rows = await db
    .select({
      factId: schema.facts.id,
      fieldKey: schema.fieldDefinitions.key,
      repeatingRecordKey: schema.facts.repeatingRecordKey,
      sensitivity: schema.fieldDefinitions.sensitivity,
      version: schema.factVersions,
    })
    .from(schema.facts)
    .innerJoin(
      schema.fieldDefinitions,
      eq(schema.fieldDefinitions.id, schema.facts.fieldDefinitionId),
    )
    .leftJoin(schema.factVersions, eq(schema.factVersions.id, schema.facts.currentVersionId))
    .where(
      and(
        eq(schema.facts.applicantId, applicantId),
        'factId' in where
          ? eq(schema.facts.id, where.factId)
          : eq(schema.facts.repeatingRecordKey, where.repeatingRecordKey),
      ),
    )
    .for('update', { of: schema.facts });
  return rows.map((row) => ({ ...row, version: row.version ?? null }));
}

/**
 * Re-point each fact at its new version, then bump every case that selected any of them once
 * (TRU-03), however many details of one entry it selected.
 */
async function approveVersions(
  tx: Db,
  approvals: readonly { readonly factId: string; readonly versionId: string }[],
): Promise<void> {
  const missions = new Set<string>();
  for (const { factId, versionId } of approvals) {
    await tx
      .update(schema.facts)
      .set({ currentVersionId: versionId, updatedAt: new Date() })
      .where(eq(schema.facts.id, factId));
    for (const missionId of await missionsSelectingFact(tx, factId)) missions.add(missionId);
  }
  for (const missionId of missions) await incrementMaterialRevision(tx, missionId);
}

export interface MarkFactNotCurrentResult {
  readonly factId: string;
  readonly versionId: string;
  /** False when the value was already marked and nothing new was written. */
  readonly changed: boolean;
}

/** Say one single detail is no longer current. Earlier versions stay in history. */
export async function markFactNotCurrent(
  access: ProfileEditAccess,
  input: { readonly factId: string },
): Promise<Result<MarkFactNotCurrentResult, ServiceError>> {
  const owner = await ownerOnly(access, { mark: 'NOT_CURRENT' });
  if (!owner.ok) return owner;
  const ownerAccountId = owner.value;
  const applicantId = access.applicant.id;

  return access.tx.transaction(async (tx) => {
    const fact = first(await loadCurrentFacts(tx, applicantId, { factId: input.factId }));
    if (!fact) return err(serviceError('not_found', 'detail not found'));
    // A list entry ends as a whole (markRecordEnded); one of its details alone is never cleared,
    // which would also quietly reopen an ended entry.
    if (fact.repeatingRecordKey !== null) {
      return err(serviceError('invalid', 'a detail of a list entry is ended with its entry'));
    }
    const current = fact.version;
    if (!current) return err(serviceError('invalid', 'there is no saved value to mark'));
    if (current.status === 'STALE' && current.value === null && current.valueCiphertext === null) {
      return ok({ factId: fact.factId, versionId: current.id, changed: false });
    }

    const version = required(
      first(
        await tx
          .insert(schema.factVersions)
          .values({
            id: randomUUID(),
            factId: fact.factId,
            // No value means nothing to encrypt: the protected columns stay empty together, as the
            // fact_versions_protection_exclusive check requires.
            value: null,
            status: 'STALE',
            method: 'MANUAL',
            actorAccountId: ownerAccountId,
            reason: 'No longer current',
            approvedAt: new Date(),
          })
          .returning(),
      ),
      'fact version',
    );
    await approveVersions(tx, [{ factId: fact.factId, versionId: version.id }]);
    await appendAuditEvent(tx, {
      eventType: AUDIT_EVENT,
      actorAccountId: ownerAccountId,
      action: 'APPROVE_EDIT',
      result: 'ALLOWED',
      method: 'MANUAL',
      applicantId,
      resourceType: 'fact',
      resourceId: fact.factId,
      metadata: { mark: 'NOT_CURRENT', fieldKey: fact.fieldKey },
    });
    return ok({ factId: fact.factId, versionId: version.id, changed: true });
  });
}

export interface MarkRecordEndedInput {
  /** The catalogue's repeating record (for example previous addresses). */
  readonly recordGroupKey: string;
  /** The one entry of that record. */
  readonly repeatingRecordKey: string;
  readonly endedOn: Date;
  /** Required when the entry holds a protected (sensitive or restricted) detail. */
  readonly encryption?: KeyManagementPort;
}

export interface MarkRecordEndedResult {
  readonly repeatingRecordKey: string;
  readonly versionsWritten: number;
}

/**
 * Whether `endedOn` is an allowed end date: a real date that is not after today anywhere in the
 * world. A day picked as "today" in the person's own time zone is accepted even while UTC is still
 * on the day before (Dhaka is UTC+6).
 */
export function isAllowedEndDate(endedOn: Date, now: Date = new Date()): boolean {
  if (Number.isNaN(endedOn.getTime())) return false;
  const latest = new Date(now.getTime() + MAX_ZONE_AHEAD_MS);
  latest.setUTCHours(23, 59, 59, 999);
  return endedOn.getTime() <= latest.getTime();
}

/** Say one entry in a list ended (an old address, a past job). Its details stay on file. */
export async function markRecordEnded(
  access: ProfileEditAccess,
  input: MarkRecordEndedInput,
): Promise<Result<MarkRecordEndedResult, ServiceError>> {
  if (!isKnownRecordGroupKey(input.recordGroupKey)) {
    return err(serviceError('invalid', `unknown record: ${input.recordGroupKey}`));
  }
  if (!isAllowedEndDate(input.endedOn)) {
    return err(serviceError('invalid', 'the end date must be a real date, not in the future'));
  }
  const owner = await ownerOnly(access, { mark: 'ENDED', recordGroupKey: input.recordGroupKey });
  if (!owner.ok) return owner;
  const ownerAccountId = owner.value;
  const applicantId = access.applicant.id;
  const groupFields = new Set(
    MODULE_FIELDS.filter((field) => field.group === input.recordGroupKey).flatMap((field) =>
      field.otherDetailKey ? [field.key, field.otherDetailKey] : [field.key],
    ),
  );

  try {
    return await access.tx.transaction(async (tx) => {
      // Only this record's own details: a key shared by another record's facts is never touched.
      const facts = (
        await loadCurrentFacts(tx, applicantId, { repeatingRecordKey: input.repeatingRecordKey })
      ).filter((fact) => fact.version !== null && groupFields.has(fact.fieldKey));
      if (facts.length === 0) return err(serviceError('not_found', 'entry not found'));
      if (facts.some((fact) => requiresProtection(fact.sensitivity)) && !input.encryption) {
        return err(
          serviceError(
            'encryption_unavailable',
            'this entry holds a protected detail; no key management port was supplied',
          ),
        );
      }

      const approvals: { factId: string; versionId: string }[] = [];
      for (const fact of facts) {
        const current = required(fact.version ?? undefined, 'current version');
        const versionId = randomUUID();
        const aadFor = (factVersionId: string) =>
          buildFactVersionAad({
            applicantId,
            factId: fact.factId,
            fieldKey: fact.fieldKey,
            factVersionId,
          });
        // The value carries forward unchanged. A protected value is read and sealed again under
        // the new version's own id, the same way editFact protects any value it writes.
        let plaintext: string | null = current.value;
        if (current.protectedKeyVersion !== null) {
          try {
            plaintext = await revealValue(tx, required(input.encryption, 'encryption port'), {
              ciphertext: required(current.valueCiphertext ?? undefined, 'ciphertext'),
              nonce: required(current.valueNonce ?? undefined, 'nonce'),
              keyVersion: current.protectedKeyVersion,
              aad: aadFor(current.id),
            });
          } catch {
            throw new MarkAborted(serviceError('invalid', 'failed to decrypt protected value'));
          }
        }
        const sealed =
          plaintext !== null && requiresProtection(fact.sensitivity)
            ? await protectValue(
                tx,
                required(input.encryption, 'encryption port'),
                plaintext,
                aadFor(versionId),
              )
            : undefined;
        await tx.insert(schema.factVersions).values({
          id: versionId,
          factId: fact.factId,
          value: sealed ? null : plaintext,
          valueCiphertext: sealed ? Buffer.from(sealed.ciphertext) : null,
          valueNonce: sealed ? Buffer.from(sealed.nonce) : null,
          protectedKeyVersion: sealed ? sealed.keyVersion : null,
          normalizedValue: sealed ? null : current.normalizedValue,
          status: current.status,
          method: 'MANUAL',
          actorAccountId: ownerAccountId,
          reason: 'Ended',
          sourceDocumentVersionId: current.sourceDocumentVersionId,
          effectiveFrom: current.effectiveFrom,
          validUntil: input.endedOn,
          approvedAt: new Date(),
        });
        approvals.push({ factId: fact.factId, versionId });
      }
      await approveVersions(tx, approvals);

      await appendAuditEvent(tx, {
        eventType: AUDIT_EVENT,
        actorAccountId: ownerAccountId,
        action: 'APPROVE_EDIT',
        result: 'ALLOWED',
        method: 'MANUAL',
        applicantId,
        resourceType: 'fact_record',
        resourceId: input.repeatingRecordKey,
        metadata: {
          mark: 'ENDED',
          recordGroupKey: input.recordGroupKey,
          factCount: facts.length,
        },
      });
      return ok({ repeatingRecordKey: input.repeatingRecordKey, versionsWritten: facts.length });
    });
  } catch (error) {
    if (error instanceof MarkAborted) return err(error.serviceError);
    throw error;
  }
}

/**
 * The entries of this profile that ended, as record key to end date (ISO). An entry counts as
 * ended only while every one of its details carries an end date, so saving a new value in any of
 * them makes the entry current again. Owner only; anyone else gets an empty map.
 */
export async function listEndedRecords(
  access: AuthorizedApplicant<'VIEW_METADATA'>,
): Promise<ReadonlyMap<string, string>> {
  const ended = new Map<string, string>();
  if (
    !AuthorizedApplicant.isGenuine(access, 'VIEW_METADATA') ||
    access.resource.kind !== 'applicant' ||
    access.actor.kind !== 'applicant_owner'
  ) {
    return ended;
  }
  const rows = await access.tx
    .select({
      repeatingRecordKey: schema.facts.repeatingRecordKey,
      validUntil: schema.factVersions.validUntil,
    })
    .from(schema.facts)
    .innerJoin(schema.factVersions, eq(schema.factVersions.id, schema.facts.currentVersionId))
    .where(eq(schema.facts.applicantId, access.applicant.id));
  const latest = new Map<string, Date>();
  const open = new Set<string>();
  for (const row of rows) {
    const key = row.repeatingRecordKey;
    if (key === null) continue;
    if (row.validUntil === null) {
      open.add(key);
      continue;
    }
    const seen = latest.get(key);
    if (!seen || row.validUntil.getTime() > seen.getTime()) latest.set(key, row.validUntil);
  }
  for (const [key, date] of latest) {
    if (!open.has(key)) ended.set(key, date.toISOString());
  }
  return ended;
}
