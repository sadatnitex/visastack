import { type Result, err, ok } from '@visastack/core';
import { and, eq } from 'drizzle-orm';
import { AuthorizedApplicant } from './access/require-access';
import { listPendingAppSuggestions } from './ai-suggestions';
import { appendAuditEvent } from './audit';
import { type Db, first, schema } from './db';
import { documentAuditActor } from './document-access';
import { type ServiceError, serviceError } from './errors';
import { isUuid } from './invoice-ledger';
import type { KeyManagementPort } from './ports';
import { isProtectedPlaceholder } from './profile';
import { buildFactVersionAad, revealValue } from './protected-fields';
import { checkRateLimit } from './rate-limit';

/**
 * ESS1: the profile page no longer carries protected values. When the owner chooses Show or Edit,
 * the page asks for one value here. Every answer is audited as PROFILE_VALUE_ACCESS: ALLOWED with
 * the field key, or DENIED with the reason. The value itself is never written to the event, a log
 * or an error.
 */
export const PROFILE_VALUE_ACCESS = 'PROFILE_VALUE_ACCESS';

type Refusal = 'not_owner' | 'not_found' | 'no_key' | 'unreadable' | 'lost' | 'rate_limited';

const NOT_SHOWN: ServiceError = serviceError('not_found', 'This detail could not be shown.');
const SLOW_DOWN: ServiceError = serviceError('rate_limited', 'Try again in a little while.');

const HOUR_MS = 60 * 60 * 1000;
/** Reveals per account per hour; beyond it nothing is opened and no row is written per call. */
export const PROFILE_VALUE_REVEALS_PER_HOUR = { limit: 120, windowMs: HOUR_MS } as const;
/** One DENIED rate_limited row per account per hour, so the audit trail says it happened. */
const PROFILE_VALUE_REVEALS_CAPPED = { limit: 1, windowMs: HOUR_MS } as const;

async function audit(
  db: Db,
  proof: AuthorizedApplicant<'VIEW_METADATA'>,
  input: {
    readonly allowed: boolean;
    readonly resourceType: 'profile_fact' | 'ai_suggestion';
    readonly resourceId: string;
    readonly fieldKey: string | null;
    readonly reason: Refusal | null;
  },
): Promise<void> {
  const who = documentAuditActor(proof);
  await db.transaction(async (tx) => {
    await appendAuditEvent(tx, {
      eventType: PROFILE_VALUE_ACCESS,
      // As DOCUMENT_ACCESS: the owner is named by role and record; anyone else by account id.
      actorAccountId: who.actorAccountId,
      actorRole: who.actorRole,
      action: 'VIEW_METADATA',
      result: input.allowed ? 'ALLOWED' : 'DENIED',
      method: 'API',
      applicantId: proof.applicant.id,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      reason: input.reason,
      metadata: input.fieldKey ? { fieldKey: input.fieldKey } : {},
    });
  });
}

/**
 * The owner's hourly budget of reveals. Past it, one DENIED rate_limited row per hour and nothing
 * opened, so a loop cannot grow the audit chain without bound.
 */
async function withinBudget(
  proof: AuthorizedApplicant<'VIEW_METADATA'>,
  resourceType: 'profile_fact' | 'ai_suggestion',
  resourceId: string,
): Promise<boolean> {
  const subjectId = proof.applicant.ownerAccountId;
  const budget = await checkRateLimit(
    proof.tx,
    { subjectId, action: 'profile_value.reveal' },
    PROFILE_VALUE_REVEALS_PER_HOUR,
  );
  if (budget.allowed) return true;
  const marker = await checkRateLimit(
    proof.tx,
    { subjectId, action: 'profile_value.reveal_capped' },
    PROFILE_VALUE_REVEALS_CAPPED,
  );
  if (marker.allowed) {
    await audit(proof.tx, proof, {
      allowed: false,
      resourceType,
      resourceId: resourceId.slice(0, 100),
      fieldKey: null,
      reason: 'rate_limited',
    });
  }
  return false;
}

function isOwnerProof(proof: AuthorizedApplicant<'VIEW_METADATA'>): boolean {
  return (
    AuthorizedApplicant.isGenuine(proof, 'VIEW_METADATA') && proof.actor.kind === 'applicant_owner'
  );
}

/**
 * The current value of one saved detail of the owner's own record, opened alone: only this fact's
 * current version is read and, when it is encrypted, decrypted (never the rest of the profile).
 * A value saved before encryption needs no key and is returned as main showed it. Owner only; a
 * shared viewer, a fact of another record, a value that will not open or one that was lost all get
 * the same `not_found`.
 */
export async function openOwnProfileValue(
  proof: AuthorizedApplicant<'VIEW_METADATA'>,
  input: { readonly factId: string; readonly encryption?: KeyManagementPort | undefined },
): Promise<Result<{ readonly value: string; readonly fieldKey: string }, ServiceError>> {
  if (!isOwnerProof(proof)) {
    if (AuthorizedApplicant.isGenuine(proof, 'VIEW_METADATA')) {
      await audit(proof.tx, proof, {
        allowed: false,
        resourceType: 'profile_fact',
        resourceId: input.factId.slice(0, 100),
        fieldKey: null,
        reason: 'not_owner',
      });
    }
    return err(NOT_SHOWN);
  }
  if (!(await withinBudget(proof, 'profile_fact', input.factId))) return err(SLOW_DOWN);
  const tx = proof.tx;
  const applicantId = proof.applicant.id;
  const refuse = async (reason: Refusal, fieldKey: string | null) => {
    await audit(tx, proof, {
      allowed: false,
      resourceType: 'profile_fact',
      resourceId: input.factId.slice(0, 100),
      fieldKey,
      reason,
    });
    return err(NOT_SHOWN);
  };
  if (!isUuid(input.factId)) return refuse('not_found', null);
  const row = first(
    await tx
      .select({
        factId: schema.facts.id,
        fieldKey: schema.fieldDefinitions.key,
        factVersionId: schema.factVersions.id,
        value: schema.factVersions.value,
        valueCiphertext: schema.factVersions.valueCiphertext,
        valueNonce: schema.factVersions.valueNonce,
        protectedKeyVersion: schema.factVersions.protectedKeyVersion,
      })
      .from(schema.facts)
      .innerJoin(
        schema.fieldDefinitions,
        eq(schema.facts.fieldDefinitionId, schema.fieldDefinitions.id),
      )
      .innerJoin(schema.factVersions, eq(schema.facts.currentVersionId, schema.factVersions.id))
      .where(and(eq(schema.facts.id, input.factId), eq(schema.facts.applicantId, applicantId)))
      .limit(1),
  );
  if (!row) return refuse('not_found', null);
  let value: string | null = row.value;
  if (row.protectedKeyVersion !== null) {
    if (!input.encryption) return refuse('no_key', row.fieldKey);
    if (!row.valueCiphertext || !row.valueNonce) return refuse('unreadable', row.fieldKey);
    try {
      value = await revealValue(tx, input.encryption, {
        ciphertext: row.valueCiphertext,
        nonce: row.valueNonce,
        keyVersion: row.protectedKeyVersion,
        aad: buildFactVersionAad({
          applicantId,
          factId: row.factId,
          fieldKey: row.fieldKey,
          factVersionId: row.factVersionId,
        }),
      });
    } catch {
      return refuse('unreadable', row.fieldKey);
    }
  }
  if (value === null || value === '') return refuse('not_found', row.fieldKey);
  if (isProtectedPlaceholder(value)) return refuse('lost', row.fieldKey);
  await audit(tx, proof, {
    allowed: true,
    resourceType: 'profile_fact',
    resourceId: row.factId,
    fieldKey: row.fieldKey,
    reason: null,
  });
  return ok({ value, fieldKey: row.fieldKey });
}

/**
 * The words of one pending AI app suggestion about a protected detail (its value, the app's reason
 * and the quoted phrases), which the profile page leaves out until the owner chooses Show. Owner
 * only, audited like a saved value.
 */
export async function openPendingSuggestionValue(
  proof: AuthorizedApplicant<'VIEW_METADATA'>,
  input: { readonly proposalId: string },
): Promise<
  Result<
    {
      readonly value: string | null;
      readonly rationale: string | null;
      readonly snippets: readonly string[];
      readonly fieldKey: string | null;
    },
    ServiceError
  >
> {
  if (!isOwnerProof(proof)) {
    if (AuthorizedApplicant.isGenuine(proof, 'VIEW_METADATA')) {
      await audit(proof.tx, proof, {
        allowed: false,
        resourceType: 'ai_suggestion',
        resourceId: input.proposalId.slice(0, 100),
        fieldKey: null,
        reason: 'not_owner',
      });
    }
    return err(NOT_SHOWN);
  }
  if (!(await withinBudget(proof, 'ai_suggestion', input.proposalId))) return err(SLOW_DOWN);
  const pending = await listPendingAppSuggestions(proof);
  const found = pending.find((item) => item.proposal.id === input.proposalId);
  if (!found) {
    await audit(proof.tx, proof, {
      allowed: false,
      resourceType: 'ai_suggestion',
      resourceId: input.proposalId.slice(0, 100),
      fieldKey: null,
      reason: 'not_found',
    });
    return err(NOT_SHOWN);
  }
  await audit(proof.tx, proof, {
    allowed: true,
    resourceType: 'ai_suggestion',
    resourceId: found.proposal.id,
    fieldKey: found.proposal.fieldKey ?? null,
    reason: null,
  });
  return ok({
    value: found.proposal.value ?? null,
    rationale: found.proposal.rationale ?? null,
    snippets: found.evidence.map((e) => e.snippet),
    fieldKey: found.proposal.fieldKey ?? null,
  });
}
