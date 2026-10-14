import { type ApplicantId, type Result, err, ok } from '@visastack/core';
import {
  CATALOGUE_MODULES,
  isKnownFieldKey,
  isKnownRecordGroupKey,
  isOpenableModuleKey,
} from '@visastack/core/catalogue';
import { authorize } from '@visastack/policy';
import { and, eq } from 'drizzle-orm';
import { getApplicant } from './applicants';
import { appendAuditEvent } from './audit';
import { hasConsent } from './consent';
import { type Db, schema } from './db';
import { type ServiceError, serviceError } from './errors';

/**
 * Opened sections and "does not apply" marks for one profile (Master Profile enrichment).
 *
 * Only the person's own choices are stored. The default-open sections, and any section that already
 * holds a saved value, are worked out from the catalogue when the profile is read, so nothing here
 * goes stale as the catalogue grows. Every name is checked against the catalogue before it is saved.
 * Writes follow the same rules as editing a fact: the owner only, consent in place, denials audited.
 */

export interface ProfileSectionState {
  /** Sections the person opened on purpose. */
  readonly activated: ReadonlySet<string>;
  /** Field keys the person marked "does not apply". */
  readonly notApplicable: ReadonlySet<string>;
  /** Repeating records the person marked "none". */
  readonly noneDeclared: ReadonlySet<string>;
}

const DEFAULT_OPEN: ReadonlySet<string> = new Set(
  CATALOGUE_MODULES.filter((module) => module.defaultOpen).map((module) => module.key),
);

export async function getProfileSectionState(
  db: Db,
  applicantId: string,
): Promise<ProfileSectionState> {
  const [sections, exemptions] = await Promise.all([
    db
      .select()
      .from(schema.profileSectionStates)
      .where(eq(schema.profileSectionStates.applicantId, applicantId)),
    db
      .select()
      .from(schema.profileFieldExemptions)
      .where(eq(schema.profileFieldExemptions.applicantId, applicantId)),
  ]);
  return {
    activated: new Set(sections.filter((row) => row.isOpen).map((row) => row.sectionKey)),
    notApplicable: new Set(
      exemptions.filter((row) => row.kind === 'FIELD_NOT_APPLICABLE').map((row) => row.targetKey),
    ),
    noneDeclared: new Set(
      exemptions.filter((row) => row.kind === 'RECORD_NONE').map((row) => row.targetKey),
    ),
  };
}

interface Actor {
  readonly actorAccountId: string;
  readonly applicantId: string;
}

/** Owner only, consent in place. Denials are audited, as for any profile edit. */
async function authorizeOwner(
  db: Db,
  input: Actor,
  eventType: string,
  metadata: Readonly<Record<string, unknown>>,
): Promise<Result<true, ServiceError>> {
  const applicant = await getApplicant(db, input.applicantId);
  if (!applicant) return err(serviceError('not_found', 'applicant not found'));

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
    await db.transaction(async (tx) => {
      await appendAuditEvent(tx, {
        eventType: `${eventType}_DENIED`,
        actorAccountId: input.actorAccountId,
        action: 'APPROVE_EDIT',
        result: 'DENIED',
        method: 'MANUAL',
        applicantId: applicant.id,
        resourceType: 'profile_section',
        reason: decision.reason,
        metadata,
      });
    });
    return err(
      serviceError('forbidden', `not authorized to change this profile (${decision.reason})`),
    );
  }
  if (!(await hasConsent(db, applicant.ownerAccountId, 'CORE_PROCESSING'))) {
    return err(
      serviceError('consent_required', 'Core processing consent is required to change a profile'),
    );
  }
  return ok(true);
}

export interface SetSectionOpenInput extends Actor {
  readonly sectionKey: string;
  readonly open: boolean;
}

/** Open or close one section. Default-open sections cannot be closed: they are always counted. */
export async function setSectionOpen(
  db: Db,
  input: SetSectionOpenInput,
): Promise<Result<{ sectionKey: string; open: boolean }, ServiceError>> {
  if (!isOpenableModuleKey(input.sectionKey)) {
    return err(serviceError('invalid', `unknown section: ${input.sectionKey}`));
  }
  if (!input.open && DEFAULT_OPEN.has(input.sectionKey)) {
    return err(serviceError('invalid', 'this section is always open and cannot be closed'));
  }
  const allowed = await authorizeOwner(db, input, 'PROFILE_SECTION_CHANGE', {
    sectionKey: input.sectionKey,
    open: input.open,
  });
  if (!allowed.ok) return allowed;

  await db.transaction(async (tx) => {
    await tx
      .insert(schema.profileSectionStates)
      .values({
        applicantId: input.applicantId,
        sectionKey: input.sectionKey,
        isOpen: input.open,
        updatedByAccountId: input.actorAccountId,
      })
      .onConflictDoUpdate({
        target: [schema.profileSectionStates.applicantId, schema.profileSectionStates.sectionKey],
        set: {
          isOpen: input.open,
          updatedByAccountId: input.actorAccountId,
          updatedAt: new Date(),
        },
      });
    await appendAuditEvent(tx, {
      eventType: input.open ? 'PROFILE_SECTION_OPENED' : 'PROFILE_SECTION_CLOSED',
      actorAccountId: input.actorAccountId,
      action: 'APPROVE_EDIT',
      result: 'ALLOWED',
      method: 'MANUAL',
      applicantId: input.applicantId,
      resourceType: 'profile_section',
      resourceId: input.sectionKey,
    });
  });
  return ok({ sectionKey: input.sectionKey, open: input.open });
}

export interface SetExemptionInput extends Actor {
  /** FIELD_NOT_APPLICABLE targets a field key; RECORD_NONE targets a repeating record. */
  readonly kind: 'FIELD_NOT_APPLICABLE' | 'RECORD_NONE';
  readonly targetKey: string;
  readonly on: boolean;
}

/** Mark a field "does not apply", or a repeating record "none", and undo either. */
export async function setExemption(
  db: Db,
  input: SetExemptionInput,
): Promise<Result<{ kind: string; targetKey: string; on: boolean }, ServiceError>> {
  const known =
    input.kind === 'FIELD_NOT_APPLICABLE'
      ? isKnownFieldKey(input.targetKey)
      : isKnownRecordGroupKey(input.targetKey);
  if (!known) {
    return err(
      serviceError(
        input.kind === 'FIELD_NOT_APPLICABLE' ? 'unknown_field' : 'invalid',
        `unknown ${input.kind === 'FIELD_NOT_APPLICABLE' ? 'field' : 'record'}: ${input.targetKey}`,
      ),
    );
  }
  const allowed = await authorizeOwner(db, input, 'PROFILE_EXEMPTION_CHANGE', {
    kind: input.kind,
    targetKey: input.targetKey,
    on: input.on,
  });
  if (!allowed.ok) return allowed;

  await db.transaction(async (tx) => {
    if (input.on) {
      await tx
        .insert(schema.profileFieldExemptions)
        .values({
          applicantId: input.applicantId,
          kind: input.kind,
          targetKey: input.targetKey,
          createdByAccountId: input.actorAccountId,
        })
        .onConflictDoNothing();
    } else {
      await tx
        .delete(schema.profileFieldExemptions)
        .where(
          and(
            eq(schema.profileFieldExemptions.applicantId, input.applicantId),
            eq(schema.profileFieldExemptions.kind, input.kind),
            eq(schema.profileFieldExemptions.targetKey, input.targetKey),
          ),
        );
    }
    await appendAuditEvent(tx, {
      eventType: input.on ? 'PROFILE_EXEMPTION_SET' : 'PROFILE_EXEMPTION_CLEARED',
      actorAccountId: input.actorAccountId,
      action: 'APPROVE_EDIT',
      result: 'ALLOWED',
      method: 'MANUAL',
      applicantId: input.applicantId,
      resourceType: 'profile_exemption',
      resourceId: `${input.kind}:${input.targetKey}`,
    });
  });
  return ok({ kind: input.kind, targetKey: input.targetKey, on: input.on });
}
