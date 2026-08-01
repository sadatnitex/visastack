import { type ApplicantId, type FactStatus, type Result, err, ok } from '@visastack/core';
import { authorize } from '@visastack/policy';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { getApplicant } from './applicants';
import { appendAuditEvent } from './audit';
import { hasConsent } from './consent';
import { type Db, first, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';

/**
 * Master Profile — the manual (no-AI) editing path (Build Spec §4.1, §8, §9;
 * PRD §2).
 *
 * A fact is a field instance for an applicant; its value is a POINTER to an
 * immutable `factVersion`. A manual edit NEVER overwrites a value: it appends a
 * new immutable version and, in the same transaction, atomically re-points the
 * fact at it and records the approval in the audit chain. History and
 * provenance are preserved forever ("no silent mutation").
 *
 * Fields cannot be invented — every edit must reference a key that exists in
 * the canonical field-definition registry.
 */

export type FieldDefinition = typeof schema.fieldDefinitions.$inferSelect;
export type Fact = typeof schema.facts.$inferSelect;
export type FactVersion = typeof schema.factVersions.$inferSelect;

export interface RegisterFieldInput {
  readonly key: string;
  readonly dataType: string;
  readonly sensitivity?: FieldDefinition['sensitivity'];
  readonly repeating?: boolean;
  readonly packId?: string | null;
}

/**
 * Register (or return the existing) canonical field definition. This is the
 * registry the manual and AI paths both draw from; idempotent by key.
 */
export async function registerFieldDefinition(
  db: Db,
  input: RegisterFieldInput,
): Promise<FieldDefinition> {
  const existing = first(
    await db
      .select()
      .from(schema.fieldDefinitions)
      .where(eq(schema.fieldDefinitions.key, input.key))
      .limit(1),
  );
  if (existing) return existing;
  return required(
    first(
      await db
        .insert(schema.fieldDefinitions)
        .values({
          key: input.key,
          dataType: input.dataType,
          sensitivity: input.sensitivity ?? 'STANDARD',
          repeating: input.repeating ?? false,
          packId: input.packId ?? null,
        })
        .returning(),
    ),
    'field definition',
  );
}

export interface EditFactInput {
  readonly actorAccountId: string;
  readonly applicantId: string;
  /** Canonical field key — must exist in the registry. */
  readonly fieldKey: string;
  readonly value: string;
  /**
   * The evidentiary status of this manual entry. Defaults to
   * APPLICANT_CONFIRMED (the person asserting their own data). Generic
   * "verified" is intentionally not a status (Build Spec §9).
   */
  readonly status?: FactStatus;
  readonly reason?: string;
  /** Groups a repeating record (e.g. a specific passport). */
  readonly repeatingRecordKey?: string;
  /**
   * Provenance (Build Spec §9). Defaults to a MANUAL edit. The AI approval
   * path sets method DOCUMENT with the source version and model/prompt tags —
   * an approved AI proposal is still a human-authorized, immutable version.
   */
  readonly method?: 'MANUAL' | 'DOCUMENT' | 'API' | 'SYSTEM';
  readonly sourceDocumentVersionId?: string;
  readonly modelVersion?: string;
  readonly promptVersion?: string;
  /**
   * When this value became (or becomes) true — distinct from `createdAt`,
   * which is when the version was recorded. Defaults to now: most edits
   * describe the applicant's current reality, not a backdated or
   * future-dated one. Master directive §7 "PR 8" — every fact must support
   * an effective date; the schema column existed but nothing wrote to it
   * before this.
   */
  readonly effectiveFrom?: Date;
}

export interface EditFactResult {
  readonly fact: Fact;
  readonly version: FactVersion;
}

async function findFieldByKey(db: Db, key: string): Promise<FieldDefinition | undefined> {
  return first(
    await db
      .select()
      .from(schema.fieldDefinitions)
      .where(eq(schema.fieldDefinitions.key, key))
      .limit(1),
  );
}

/**
 * Manually set a profile fact. Authorized by the policy engine (default-deny),
 * consent-gated, and written as an immutable version with an atomic approval.
 */
export async function editFact(
  db: Db,
  input: EditFactInput,
): Promise<Result<EditFactResult, ServiceError>> {
  const applicant = await getApplicant(db, input.applicantId);
  if (!applicant) {
    return err(serviceError('not_found', 'applicant not found'));
  }

  // Authorization is the policy engine's decision, not this service's. Only the
  // owning account is a valid actor for a manual edit in this phase (sharing is
  // Phase 4); a non-owner has no grant and is denied.
  const owns = applicant.ownerAccountId === input.actorAccountId;
  const decision = owns
    ? authorize({
        actor: { kind: 'applicant_owner', applicantId: applicant.id as ApplicantId },
        action: 'APPROVE_EDIT',
        resource: { applicantId: applicant.id as ApplicantId },
        context: { now: new Date(), purpose: 'profile_edit', stepUpSatisfied: false, grants: [] },
      })
    : ({ allowed: false, reason: 'default_deny' } as const);

  if (!decision.allowed) {
    // Denials are audited too (fail-closed observability).
    await db.transaction(async (tx) => {
      await appendAuditEvent(tx, {
        eventType: 'FACT_EDIT_DENIED',
        actorAccountId: input.actorAccountId,
        action: 'APPROVE_EDIT',
        result: 'DENIED',
        method: 'MANUAL',
        applicantId: applicant.id,
        resourceType: 'fact',
        reason: decision.reason,
        metadata: { fieldKey: input.fieldKey },
      });
    });
    return err(
      serviceError('forbidden', `not authorized to edit this profile (${decision.reason})`),
    );
  }

  if (!(await hasConsent(db, applicant.ownerAccountId, 'CORE_PROCESSING'))) {
    return err(
      serviceError('consent_required', 'CORE_PROCESSING consent is required to edit facts'),
    );
  }

  const fieldDef = await findFieldByKey(db, input.fieldKey);
  if (!fieldDef) {
    return err(serviceError('unknown_field', `unknown field: ${input.fieldKey}`));
  }
  const repeatingRecordKey = input.repeatingRecordKey ?? null;
  if (!fieldDef.repeating && repeatingRecordKey !== null) {
    return err(
      serviceError(
        'invalid',
        `field ${input.fieldKey} is not repeating; a record key is not allowed`,
      ),
    );
  }

  return db.transaction(async (tx) => {
    // Find the existing fact for this (applicant, field, repeating record), or
    // create it. currentVersionId is set below on approval.
    const fact =
      first(
        await tx
          .select()
          .from(schema.facts)
          .where(
            and(
              eq(schema.facts.applicantId, input.applicantId),
              eq(schema.facts.fieldDefinitionId, fieldDef.id),
              repeatingRecordKey === null
                ? isNull(schema.facts.repeatingRecordKey)
                : eq(schema.facts.repeatingRecordKey, repeatingRecordKey),
            ),
          )
          .limit(1),
      ) ??
      required(
        first(
          await tx
            .insert(schema.facts)
            .values({
              applicantId: input.applicantId,
              fieldDefinitionId: fieldDef.id,
              repeatingRecordKey,
            })
            .returning(),
        ),
        'fact',
      );

    // Append the immutable version (never an UPDATE of a prior value).
    const version = required(
      first(
        await tx
          .insert(schema.factVersions)
          .values({
            factId: fact.id,
            value: input.value,
            status: input.status ?? 'APPLICANT_CONFIRMED',
            method: input.method ?? 'MANUAL',
            actorAccountId: input.actorAccountId,
            reason: input.reason ?? null,
            sourceDocumentVersionId: input.sourceDocumentVersionId ?? null,
            modelVersion: input.modelVersion ?? null,
            promptVersion: input.promptVersion ?? null,
            effectiveFrom: input.effectiveFrom ?? new Date(),
            approvedAt: new Date(),
          })
          .returning(),
      ),
      'fact version',
    );

    // Atomic approval: point the fact at the new version.
    const updatedFact = required(
      first(
        await tx
          .update(schema.facts)
          .set({ currentVersionId: version.id, updatedAt: new Date() })
          .where(eq(schema.facts.id, fact.id))
          .returning(),
      ),
      'updated fact',
    );

    await appendAuditEvent(tx, {
      eventType: 'FACT_APPROVED',
      actorAccountId: input.actorAccountId,
      action: 'APPROVE_EDIT',
      result: 'ALLOWED',
      method: 'MANUAL',
      applicantId: input.applicantId,
      resourceType: 'fact',
      resourceId: fact.id,
      metadata: { fieldKey: input.fieldKey, status: version.status },
    });

    return ok({ fact: updatedFact, version });
  });
}

/** The current (approved) version of a fact, or undefined if none is set. */
export async function getCurrentFactVersion(
  db: Db,
  factId: string,
): Promise<FactVersion | undefined> {
  const fact = first(
    await db.select().from(schema.facts).where(eq(schema.facts.id, factId)).limit(1),
  );
  if (!fact || fact.currentVersionId === null) return undefined;
  return first(
    await db
      .select()
      .from(schema.factVersions)
      .where(eq(schema.factVersions.id, fact.currentVersionId))
      .limit(1),
  );
}

/** Full, ordered version history for a fact (oldest first) — provenance trail. */
export async function listFactHistory(db: Db, factId: string): Promise<FactVersion[]> {
  return db
    .select()
    .from(schema.factVersions)
    .where(eq(schema.factVersions.factId, factId))
    .orderBy(asc(schema.factVersions.createdAt));
}

/** A profile fact resolved to its current value, for read/display. */
export interface ProfileEntry {
  readonly factId: string;
  readonly fieldKey: string;
  readonly repeatingRecordKey: string | null;
  readonly value: string | null;
  readonly status: FactStatus | null;
  readonly method: string | null;
  readonly updatedAt: string | null;
  readonly effectiveFrom: string | null;
}

/**
 * Every fact for an applicant, resolved to its current (approved) value and
 * ordered by field key. A read projection over the fact/version pointer graph —
 * the shape the Master Profile editor renders.
 */
export async function listApplicantProfile(db: Db, applicantId: string): Promise<ProfileEntry[]> {
  const rows = await db
    .select({
      factId: schema.facts.id,
      fieldKey: schema.fieldDefinitions.key,
      repeatingRecordKey: schema.facts.repeatingRecordKey,
      value: schema.factVersions.value,
      status: schema.factVersions.status,
      method: schema.factVersions.method,
      updatedAt: schema.factVersions.createdAt,
      effectiveFrom: schema.factVersions.effectiveFrom,
    })
    .from(schema.facts)
    .innerJoin(
      schema.fieldDefinitions,
      eq(schema.facts.fieldDefinitionId, schema.fieldDefinitions.id),
    )
    .leftJoin(schema.factVersions, eq(schema.facts.currentVersionId, schema.factVersions.id))
    .where(eq(schema.facts.applicantId, applicantId))
    .orderBy(asc(schema.fieldDefinitions.key));

  return rows.map((row) => ({
    factId: row.factId,
    fieldKey: row.fieldKey,
    repeatingRecordKey: row.repeatingRecordKey,
    value: row.value,
    status: row.status,
    method: row.method,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
    effectiveFrom: row.effectiveFrom ? row.effectiveFrom.toISOString() : null,
  }));
}
