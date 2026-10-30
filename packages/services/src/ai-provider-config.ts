import { randomUUID, timingSafeEqual } from 'node:crypto';
import { type Result, err, ok } from '@visastack/core';
import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { type StaffScope, staffScopeProblem } from './access/principal';
import { appendAuditEvent } from './audit';
import { type Db, first, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import { isMissingRelationError } from './missing-relation';
import { type PlatformAuthInput, canPerformPlatformAction } from './platform-roles';
import type { KeyManagementPort } from './ports';
import { protectValue, revealValue } from './protected-fields';

/**
 * Admin-configurable AI provider settings (Part 8 §5/§6, AI-02/AI-06).
 *
 * Every row is a full, immutable configuration snapshot; "activating" never
 * edits a row in place, it flips which row currently holds ACTIVE (moving
 * whatever held it before to SUPERSEDED), so the complete history of what the
 * platform actually ran under is always reconstructable -- see the schema's
 * own doc comment on `aiProviderConfigs`. At most one row is ever ACTIVE at a
 * time, enforced here under a fixed advisory lock, the same
 * fixed-key-lock-for-the-critical-section pattern `ai.ts`/`uploads.ts`
 * already use for an identical platform-wide-single-winner guarantee.
 *
 * The API key is envelope-encrypted with the existing
 * `protectValue`/`revealValue` primitive (`protected-fields.ts`) -- the same
 * AES-256-GCM mechanism already used for protected profile fields, never a
 * second encryption scheme invented for this table.
 *
 * Deliberately NOT in this chunk: wiring `apps/web/src/lib/ai.ts`'s
 * `runExtraction`'s kill-switch recheck to actually
 * consult `getActiveAiProviderConfig` at runtime (a separate, focused change
 * to the live extraction path); the admin UI; the synthetic connection test
 * and task-evaluation runner Part 8 §5 also names. Nothing here is called by
 * any existing code path yet, so shipping it changes no runtime behavior.
 */

export type AiProviderConfig = typeof schema.aiProviderConfigs.$inferSelect;

/** Binds a config's encrypted API key to this exact row -- a ciphertext copied onto a different config's id fails GCM authentication rather than silently decrypting. */
function buildAiProviderConfigAad(configId: string): string {
  return `visastack:ai_provider_config:v1:${configId}`;
}

/** Part 8 §6 "masked fingerprint" -- enough for an admin to recognize which key is configured, never enough to reconstruct it. */
function fingerprintApiKey(apiKey: string): string {
  return `...${apiKey.trim().slice(-4)}`;
}

const LOCK_SQL = sql`select pg_advisory_xact_lock(hashtext('visastack:ai-provider-config'))`;

/** The settings checks a draft must pass whether it is being created or edited. */
function draftSettingsProblem(input: {
  readonly model: string;
  readonly budgetLimitUnits: number;
  readonly fallbackEnabled?: boolean;
  readonly fallbackProviderConfigId?: string;
}): ServiceError | undefined {
  if (input.model.trim().length === 0) return serviceError('invalid', 'a model is required');
  if (!(input.budgetLimitUnits > 0)) {
    return serviceError('invalid', 'a positive budget limit is required');
  }
  if (input.fallbackEnabled && !input.fallbackProviderConfigId) {
    return serviceError('invalid', 'a fallback configuration must be selected to enable fallback');
  }
  return undefined;
}

export interface CreateDraftAiProviderConfigInput {
  readonly actor: PlatformAuthInput;
  readonly stepUpSatisfied: boolean;
  readonly provider: string;
  readonly model: string;
  /** Blank only with `copyApiKeyFromConfigId`, which then supplies the key. */
  readonly apiKey: string;
  /**
   * Reuse the key of an existing configuration of the same provider ("Edit as New Draft" on a
   * version that can no longer be edited in place). The key is decrypted and encrypted again
   * for the new row, never copied as ciphertext, since each row's key is bound to its own id.
   * A revoked key is never reused.
   */
  readonly copyApiKeyFromConfigId?: string;
  readonly encryption: KeyManagementPort;
  readonly reasoningEffort?: string;
  /** Part 8 §5 "set reviewed data policy" -- a hard prerequisite for activation, not descriptive metadata. */
  readonly dataPolicyApproved: boolean;
  readonly budgetLimitUnits: number;
  readonly perDocumentBudgetLimitUnits?: number;
  readonly maxAttemptsPerDocument?: number;
  readonly maxPagesPerDocument?: number;
  readonly cacheMaxAgeDays?: number;
  readonly maxConcurrentCalls?: number;
  /** Part 8 §13 ("cross-provider fallback... OFF by default"). Omitted/false unless the admin explicitly opts in. */
  readonly fallbackEnabled?: boolean;
  /** Required when `fallbackEnabled` is true; deeper eligibility (exists, different provider, still approved/not revoked) is checked at activation time, not here -- a DRAFT is inert either way. */
  readonly fallbackProviderConfigId?: string;
  readonly notes?: string;
}

/**
 * Part 8 §5 ("admin can... save DRAFT"). A DRAFT is inert -- it never affects
 * the live AI gateway until `activateAiProviderConfig` promotes it -- but the
 * same SECURITY_ADMIN + step-up posture as every other action here still
 * applies uniformly; the directive names no exception for "just saving a
 * draft."
 */
export async function createDraftAiProviderConfig(
  db: Db,
  input: CreateDraftAiProviderConfigInput,
): Promise<Result<AiProviderConfig, ServiceError>> {
  if (!(await canPerformPlatformAction(db, input.actor, 'AI_SETTINGS_MANAGE'))) {
    return err(serviceError('forbidden', 'security-admin permission is required'));
  }
  if (!input.stepUpSatisfied) {
    return err(
      serviceError('step_up_required', 'configuring AI settings requires reauthentication'),
    );
  }
  if (input.provider.trim().length === 0 || input.model.trim().length === 0) {
    return err(serviceError('invalid', 'provider and model are required'));
  }
  if (input.apiKey.trim().length === 0 && !input.copyApiKeyFromConfigId) {
    return err(serviceError('invalid', 'an API key is required'));
  }
  const problem = draftSettingsProblem(input);
  if (problem) return err(problem);

  return db.transaction(async (tx) => {
    // The same lock as revoke and delete, so a key is never copied from a row that is being
    // revoked, and a fallback is never pointed at a draft that is being deleted.
    await tx.execute(LOCK_SQL);
    let apiKey = input.apiKey.trim();
    const copiedFrom = apiKey.length === 0 ? input.copyApiKeyFromConfigId : undefined;
    if (copiedFrom) {
      const source = first(
        await tx
          .select()
          .from(schema.aiProviderConfigs)
          .where(eq(schema.aiProviderConfigs.id, copiedFrom))
          .limit(1),
      );
      if (!source) return err(serviceError('not_found', 'the configuration to copy was not found'));
      if (source.provider !== input.provider.trim()) {
        return err(
          serviceError(
            'invalid',
            'a key can only be reused for the same provider; enter a new key',
          ),
        );
      }
      if (source.keyRevokedAt !== null) {
        return err(
          serviceError('invalid', "that configuration's key has been revoked; enter a new key"),
        );
      }
      apiKey = await revealAiProviderApiKey(tx, input.encryption, source);
    }
    // Generated client-side (rather than left to the database default) so
    // the protected API key's AAD can bind the exact row id it will be
    // stored under, before that row exists to read the id back from --
    // mirrors profile.ts's editFact's identical reason for the same thing.
    const id = randomUUID();
    const protectedKey = await protectValue(
      tx,
      input.encryption,
      apiKey,
      buildAiProviderConfigAad(id),
    );
    const config = required(
      first(
        await tx
          .insert(schema.aiProviderConfigs)
          .values({
            id,
            status: 'DRAFT',
            provider: input.provider.trim(),
            model: input.model.trim(),
            ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
            apiKeyCiphertext: Buffer.from(protectedKey.ciphertext),
            apiKeyNonce: Buffer.from(protectedKey.nonce),
            apiKeyVersion: protectedKey.keyVersion,
            apiKeyFingerprint: fingerprintApiKey(apiKey),
            dataPolicyApproved: input.dataPolicyApproved,
            budgetLimitUnits: input.budgetLimitUnits,
            ...(input.perDocumentBudgetLimitUnits !== undefined
              ? { perDocumentBudgetLimitUnits: input.perDocumentBudgetLimitUnits }
              : {}),
            ...(input.maxAttemptsPerDocument !== undefined
              ? { maxAttemptsPerDocument: input.maxAttemptsPerDocument }
              : {}),
            ...(input.maxPagesPerDocument !== undefined
              ? { maxPagesPerDocument: input.maxPagesPerDocument }
              : {}),
            ...(input.cacheMaxAgeDays !== undefined
              ? { cacheMaxAgeDays: input.cacheMaxAgeDays }
              : {}),
            ...(input.maxConcurrentCalls !== undefined
              ? { maxConcurrentCalls: input.maxConcurrentCalls }
              : {}),
            ...(input.fallbackEnabled ? { fallbackEnabled: true } : {}),
            ...(input.fallbackProviderConfigId
              ? { fallbackProviderConfigId: input.fallbackProviderConfigId }
              : {}),
            ...(input.notes ? { notes: input.notes } : {}),
            createdByAccountId: input.actor.accountId,
          })
          .returning(),
      ),
      'ai provider config',
    );
    await appendAuditEvent(tx, {
      eventType: 'AI_PROVIDER_CONFIG_CREATED',
      actorAccountId: input.actor.accountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'ai_provider_config',
      resourceId: config.id,
      metadata: {
        provider: config.provider,
        model: config.model,
        ...(copiedFrom ? { keyCopiedFromConfigId: copiedFrom } : {}),
      },
    });
    return ok(config);
  });
}

export interface UpdateDraftAiProviderConfigInput
  extends Omit<
    CreateDraftAiProviderConfigInput,
    'actor' | 'provider' | 'apiKey' | 'copyApiKeyFromConfigId'
  > {
  readonly configId: string;
  /** A replacement key; blank or absent keeps the saved one. */
  readonly apiKey?: string;
}

/**
 * Edits a DRAFT in place. Only a draft: it has never run, so changing it rewrites no history.
 * Every other status is part of the record of what the platform ran under and stays as it is
 * ("Edit as New Draft" copies it instead, through `createDraftAiProviderConfig`). The form
 * sends the whole configuration, so a setting left blank is cleared. The provider cannot
 * change: the key and the recorded data terms belong to that provider's account (create a new
 * draft for another provider). A replacement key is encrypted for this same row; the data
 * terms are kept, so a key from a different account needs its terms recorded again.
 */
export async function updateDraftAiProviderConfig(
  db: Db,
  staff: StaffScope<'AI_SETTINGS_MANAGE'>,
  input: UpdateDraftAiProviderConfigInput,
): Promise<Result<AiProviderConfig, ServiceError>> {
  if (staffScopeProblem(staff, 'AI_SETTINGS_MANAGE')) {
    return err(serviceError('forbidden', 'security-admin permission is required'));
  }
  if (!input.stepUpSatisfied) {
    return err(
      serviceError('step_up_required', 'editing an AI configuration requires reauthentication'),
    );
  }
  const problem = draftSettingsProblem(input);
  if (problem) return err(problem);
  if (input.fallbackProviderConfigId === input.configId) {
    return err(serviceError('invalid', 'a configuration cannot be its own fallback'));
  }

  return db.transaction(async (tx) => {
    // The same lock as activation, so a draft is never edited while it is being activated.
    await tx.execute(LOCK_SQL);
    const target = first(
      await tx
        .select()
        .from(schema.aiProviderConfigs)
        .where(eq(schema.aiProviderConfigs.id, input.configId))
        .limit(1),
    );
    if (!target) return err(serviceError('not_found', 'configuration not found'));
    if (target.status !== 'DRAFT') {
      return err(
        serviceError('invalid', 'only a draft can be edited; use Edit as New Draft instead'),
      );
    }
    if (target.keyRevokedAt !== null) {
      return err(
        serviceError(
          'invalid',
          "this draft's key was revoked, so it can never be used; use Edit as New Draft with a new key",
        ),
      );
    }
    // A draft another version falls back to may already have answered for it, so it is part of
    // the record too, and changing it would change live fallback calls without an activation.
    const fallingBack = first(
      await tx
        .select({ id: schema.aiProviderConfigs.id })
        .from(schema.aiProviderConfigs)
        .where(
          and(
            eq(schema.aiProviderConfigs.fallbackProviderConfigId, target.id),
            eq(schema.aiProviderConfigs.fallbackEnabled, true),
            ne(schema.aiProviderConfigs.status, 'DRAFT'),
          ),
        )
        .limit(1),
    );
    if (fallingBack) {
      return err(
        serviceError(
          'invalid',
          'another configuration uses this draft as its fallback, so it stays as it is; use Edit as New Draft instead',
        ),
      );
    }

    const newKey = input.apiKey?.trim() ?? '';
    const protectedKey =
      newKey.length > 0
        ? await protectValue(tx, input.encryption, newKey, buildAiProviderConfigAad(target.id))
        : undefined;
    const settings = {
      model: input.model.trim(),
      dataPolicyApproved: input.dataPolicyApproved,
      budgetLimitUnits: input.budgetLimitUnits,
      fallbackEnabled: input.fallbackEnabled ?? false,
      reasoningEffort: input.reasoningEffort || null,
      perDocumentBudgetLimitUnits: input.perDocumentBudgetLimitUnits ?? null,
      maxAttemptsPerDocument: input.maxAttemptsPerDocument ?? null,
      maxPagesPerDocument: input.maxPagesPerDocument ?? null,
      cacheMaxAgeDays: input.cacheMaxAgeDays ?? null,
      maxConcurrentCalls: input.maxConcurrentCalls ?? null,
      fallbackProviderConfigId: input.fallbackProviderConfigId || null,
      notes: input.notes || null,
    };
    const changed = (Object.keys(settings) as (keyof typeof settings)[]).filter(
      (key) => settings[key] !== target[key],
    );
    const updated = required(
      first(
        await tx
          .update(schema.aiProviderConfigs)
          .set({
            ...settings,
            ...(protectedKey
              ? {
                  apiKeyCiphertext: Buffer.from(protectedKey.ciphertext),
                  apiKeyNonce: Buffer.from(protectedKey.nonce),
                  apiKeyVersion: protectedKey.keyVersion,
                  apiKeyFingerprint: fingerprintApiKey(newKey),
                }
              : {}),
          })
          .where(eq(schema.aiProviderConfigs.id, target.id))
          .returning(),
      ),
      'ai provider config',
    );
    // Recorded data terms describe the account of the key they were checked for. A new key may
    // belong to another account, so this draft's terms are cleared and read as unknown until
    // recorded again (refused while the do-not-train rule is on). The draft never ran, so no
    // record of what the platform ran under is lost.
    const termsCleared = protectedKey ? await clearDraftTerms(tx, target.id) : false;
    await appendAuditEvent(tx, {
      eventType: 'AI_PROVIDER_CONFIG_UPDATED',
      actorAccountId: staff.accountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'ai_provider_config',
      resourceId: updated.id,
      // Names of what changed, and the model, never the key or other values.
      metadata: {
        provider: updated.provider,
        model: updated.model,
        changed,
        keyReplaced: protectedKey !== undefined,
        termsCleared,
      },
    });
    return ok(updated);
  });
}

/** Removes a draft's recorded data terms, in a savepoint so a database without the terms table is unaffected. True when any were removed. */
async function clearDraftTerms(tx: Db, configId: string): Promise<boolean> {
  try {
    const removed = await tx.transaction(async (inner) =>
      inner
        .delete(schema.aiProviderConfigTerms)
        .where(eq(schema.aiProviderConfigTerms.configId, configId))
        .returning({ id: schema.aiProviderConfigTerms.id }),
    );
    return removed.length > 0;
  } catch (error) {
    if (isMissingRelationError(error)) return false;
    throw error;
  }
}

export interface DeleteDraftAiProviderConfigInput {
  readonly stepUpSatisfied: boolean;
  readonly configId: string;
}

/**
 * Deletes a DRAFT, its encrypted key and its recorded data terms. Only a draft: it never ran,
 * so nothing in the history of what the platform ran under refers to it. Every other status
 * stays as a record ("Revoke Key" retires its key for good instead). Refused while another
 * configuration names it as its fallback, so no pointer is left dangling. Refused too when it is
 * the only configuration left: an empty table hands document reading back to the deployment's
 * environment settings (`isAiDispatchAllowed`), which no admin chose. The audit trail keeps that
 * the draft existed and was deleted, with its provider and model; nothing derived from the key.
 */
export async function deleteDraftAiProviderConfig(
  db: Db,
  staff: StaffScope<'AI_SETTINGS_MANAGE'>,
  input: DeleteDraftAiProviderConfigInput,
): Promise<Result<{ readonly id: string }, ServiceError>> {
  if (staffScopeProblem(staff, 'AI_SETTINGS_MANAGE')) {
    return err(serviceError('forbidden', 'security-admin permission is required'));
  }
  if (!input.stepUpSatisfied) {
    return err(
      serviceError('step_up_required', 'deleting an AI configuration requires reauthentication'),
    );
  }

  return db.transaction(async (tx) => {
    await tx.execute(LOCK_SQL);
    const target = first(
      await tx
        .select()
        .from(schema.aiProviderConfigs)
        .where(eq(schema.aiProviderConfigs.id, input.configId))
        .limit(1),
    );
    if (!target) return err(serviceError('not_found', 'configuration not found'));
    if (target.status !== 'DRAFT') {
      return err(
        serviceError('invalid', 'only a draft can be deleted; revoke the key to retire this one'),
      );
    }
    const other = first(
      await tx
        .select({ id: schema.aiProviderConfigs.id })
        .from(schema.aiProviderConfigs)
        .where(ne(schema.aiProviderConfigs.id, target.id))
        .limit(1),
    );
    if (!other) {
      return err(
        serviceError(
          'invalid',
          'this is the only saved configuration; deleting it would hand document reading back to the deployment settings, so create another one first or keep this draft',
        ),
      );
    }
    const dependant = first(
      await tx
        .select()
        .from(schema.aiProviderConfigs)
        .where(eq(schema.aiProviderConfigs.fallbackProviderConfigId, target.id))
        .limit(1),
    );
    if (dependant) {
      const name = `${dependant.provider} / ${dependant.model}`;
      return err(
        serviceError(
          'invalid',
          dependant.status === 'DRAFT'
            ? `the draft ${name} uses this one as its fallback; change or delete that draft first`
            : `${name} uses this one as its fallback and stays in the history, so this draft is kept`,
        ),
      );
    }
    await tx.delete(schema.aiProviderConfigs).where(eq(schema.aiProviderConfigs.id, target.id));
    await appendAuditEvent(tx, {
      eventType: 'AI_PROVIDER_CONFIG_DELETED',
      actorAccountId: staff.accountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'ai_provider_config',
      resourceId: target.id,
      metadata: {
        provider: target.provider,
        model: target.model,
      },
    });
    return ok({ id: target.id });
  });
}

export interface ActivateAiProviderConfigInput {
  readonly actor: PlatformAuthInput;
  readonly stepUpSatisfied: boolean;
  readonly configId: string;
}

/**
 * Part 8 §5 ("activate... atomic task-config version switch"). Refuses a
 * config whose data policy isn't approved or whose key has already been
 * revoked -- the same eligibility bar `rollbackAiProviderConfig` enforces,
 * applied here too so activation and rollback can never disagree about what
 * counts as safe to run.
 *
 * When `fallbackEnabled`, also verifies the designated fallback target NOW
 * (Part 8 §13: "provider already passed same privacy/task/budget gates"),
 * not just that it looked eligible whenever it was picked -- the same
 * dataPolicyApproved/keyRevokedAt bar as the row being activated itself, and
 * a genuinely different provider (a same-provider "fallback" would share
 * whatever outage or key problem took the primary down, defeating the whole
 * point of a *cross-provider* fallback). This table's own single-winner
 * invariant means the fallback target can never itself be the current ACTIVE
 * row -- it is necessarily some other status (most naturally the config this
 * activation is about to supersede, or a still-DRAFT alternative kept on
 * hand), so status is deliberately not checked here, only eligibility.
 */
export async function activateAiProviderConfig(
  db: Db,
  input: ActivateAiProviderConfigInput,
): Promise<Result<AiProviderConfig, ServiceError>> {
  if (!(await canPerformPlatformAction(db, input.actor, 'AI_SETTINGS_MANAGE'))) {
    return err(serviceError('forbidden', 'security-admin permission is required'));
  }
  if (!input.stepUpSatisfied) {
    return err(
      serviceError('step_up_required', 'activating an AI configuration requires reauthentication'),
    );
  }

  return db.transaction(async (tx) => {
    // Serializes every activate/rollback/disable decision platform-wide --
    // without it, two concurrent activations could each read "no current
    // ACTIVE row" and both promote their own draft, leaving two ACTIVE rows.
    await tx.execute(LOCK_SQL);

    const target = first(
      await tx
        .select()
        .from(schema.aiProviderConfigs)
        .where(eq(schema.aiProviderConfigs.id, input.configId))
        .limit(1),
    );
    if (!target) return err(serviceError('not_found', 'configuration not found'));
    if (target.status !== 'DRAFT') {
      return err(serviceError('invalid', 'only a DRAFT configuration can be activated'));
    }
    if (!target.dataPolicyApproved) {
      return err(serviceError('invalid', 'the data policy must be approved before activation'));
    }
    if (target.keyRevokedAt !== null) {
      return err(serviceError('invalid', "this configuration's key has been revoked"));
    }
    if (target.fallbackEnabled) {
      if (!target.fallbackProviderConfigId) {
        return err(
          serviceError('invalid', 'a fallback configuration must be selected to enable fallback'),
        );
      }
      const fallbackTarget = first(
        await tx
          .select()
          .from(schema.aiProviderConfigs)
          .where(eq(schema.aiProviderConfigs.id, target.fallbackProviderConfigId))
          .limit(1),
      );
      if (!fallbackTarget) {
        return err(
          serviceError('invalid', 'the designated fallback configuration no longer exists'),
        );
      }
      if (fallbackTarget.provider === target.provider) {
        return err(
          serviceError('invalid', 'the fallback configuration must use a different provider'),
        );
      }
      if (!fallbackTarget.dataPolicyApproved) {
        return err(
          serviceError('invalid', "the fallback configuration's data policy must be approved"),
        );
      }
      if (fallbackTarget.keyRevokedAt !== null) {
        return err(serviceError('invalid', "the fallback configuration's key has been revoked"));
      }
    }

    const currentActive = first(
      await tx
        .select()
        .from(schema.aiProviderConfigs)
        .where(eq(schema.aiProviderConfigs.status, 'ACTIVE'))
        .limit(1),
    );
    const now = new Date();
    if (currentActive) {
      await tx
        .update(schema.aiProviderConfigs)
        .set({ status: 'SUPERSEDED', supersededAt: now })
        .where(eq(schema.aiProviderConfigs.id, currentActive.id));
    }
    const activated = required(
      first(
        await tx
          .update(schema.aiProviderConfigs)
          .set({ status: 'ACTIVE', activatedAt: now })
          .where(eq(schema.aiProviderConfigs.id, target.id))
          .returning(),
      ),
      'ai provider config',
    );
    await appendAuditEvent(tx, {
      eventType: 'AI_PROVIDER_CONFIG_ACTIVATED',
      actorAccountId: input.actor.accountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'ai_provider_config',
      resourceId: activated.id,
      metadata: {
        provider: activated.provider,
        model: activated.model,
        previouslyActiveConfigId: currentActive?.id ?? null,
      },
    });
    return ok(activated);
  });
}

export interface RollbackAiProviderConfigInput {
  readonly actor: PlatformAuthInput;
  readonly stepUpSatisfied: boolean;
}

/**
 * Part 8 §5 ("rollback: last eligible known-good only"). Takes no target id
 * -- the system finds it: walks history newest-first among prior versions
 * (SUPERSEDED *or* DISABLED -- deliberately not just SUPERSEDED, so this can
 * also recover from an `emergencyDisableAiProviderConfig` call, arguably
 * rollback's single most important use case), skipping any whose key has
 * since been revoked or whose data policy is no longer approved ("cannot
 * resurrect: revoked key; unapproved data policy"), and promotes the first
 * one that is still genuinely safe to run. Works whether or not anything is
 * currently ACTIVE: after an emergency-disable nothing is, and rollback must
 * still be able to recover without requiring a separate re-activation step.
 */
export async function rollbackAiProviderConfig(
  db: Db,
  input: RollbackAiProviderConfigInput,
): Promise<Result<AiProviderConfig, ServiceError>> {
  if (!(await canPerformPlatformAction(db, input.actor, 'AI_SETTINGS_MANAGE'))) {
    return err(serviceError('forbidden', 'security-admin permission is required'));
  }
  if (!input.stepUpSatisfied) {
    return err(
      serviceError(
        'step_up_required',
        'rolling back the AI configuration requires reauthentication',
      ),
    );
  }

  return db.transaction(async (tx) => {
    await tx.execute(LOCK_SQL);

    const currentActive = first(
      await tx
        .select()
        .from(schema.aiProviderConfigs)
        .where(eq(schema.aiProviderConfigs.status, 'ACTIVE'))
        .limit(1),
    );

    const eligibleConditions = [
      inArray(schema.aiProviderConfigs.status, ['SUPERSEDED', 'DISABLED']),
      isNull(schema.aiProviderConfigs.keyRevokedAt),
      eq(schema.aiProviderConfigs.dataPolicyApproved, true),
    ];
    if (currentActive) {
      eligibleConditions.push(ne(schema.aiProviderConfigs.id, currentActive.id));
    }
    const eligible = first(
      await tx
        .select()
        .from(schema.aiProviderConfigs)
        .where(and(...eligibleConditions))
        .orderBy(desc(schema.aiProviderConfigs.activatedAt))
        .limit(1),
    );
    if (!eligible) {
      return err(serviceError('invalid', 'no eligible prior configuration to roll back to'));
    }

    const now = new Date();
    if (currentActive) {
      await tx
        .update(schema.aiProviderConfigs)
        .set({ status: 'SUPERSEDED', supersededAt: now })
        .where(eq(schema.aiProviderConfigs.id, currentActive.id));
    }
    const restored = required(
      first(
        await tx
          .update(schema.aiProviderConfigs)
          .set({ status: 'ACTIVE', activatedAt: now })
          .where(eq(schema.aiProviderConfigs.id, eligible.id))
          .returning(),
      ),
      'ai provider config',
    );
    await appendAuditEvent(tx, {
      eventType: 'AI_PROVIDER_CONFIG_ROLLED_BACK',
      actorAccountId: input.actor.accountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'ai_provider_config',
      resourceId: restored.id,
      metadata: { rolledBackFromConfigId: currentActive?.id ?? null },
    });
    return ok(restored);
  });
}

export interface EmergencyDisableAiProviderConfigInput {
  readonly actor: PlatformAuthInput;
  readonly stepUpSatisfied: boolean;
}

/** Part 8 §5 ("emergency-disable"). Takes the current ACTIVE config out of service; no replacement is auto-promoted, so the platform runs no AI at all until an admin explicitly activates or rolls back to something. */
export async function emergencyDisableAiProviderConfig(
  db: Db,
  input: EmergencyDisableAiProviderConfigInput,
): Promise<Result<AiProviderConfig, ServiceError>> {
  if (!(await canPerformPlatformAction(db, input.actor, 'AI_SETTINGS_MANAGE'))) {
    return err(serviceError('forbidden', 'security-admin permission is required'));
  }
  if (!input.stepUpSatisfied) {
    return err(
      serviceError('step_up_required', 'disabling the AI configuration requires reauthentication'),
    );
  }

  return db.transaction(async (tx) => {
    await tx.execute(LOCK_SQL);
    const currentActive = first(
      await tx
        .select()
        .from(schema.aiProviderConfigs)
        .where(eq(schema.aiProviderConfigs.status, 'ACTIVE'))
        .limit(1),
    );
    if (!currentActive) {
      return err(serviceError('invalid', 'no active configuration to disable'));
    }
    const disabled = required(
      first(
        await tx
          .update(schema.aiProviderConfigs)
          .set({ status: 'DISABLED', disabledAt: new Date() })
          .where(eq(schema.aiProviderConfigs.id, currentActive.id))
          .returning(),
      ),
      'ai provider config',
    );
    await appendAuditEvent(tx, {
      eventType: 'AI_PROVIDER_CONFIG_DISABLED',
      actorAccountId: input.actor.accountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'ai_provider_config',
      resourceId: disabled.id,
      metadata: {},
    });
    return ok(disabled);
  });
}

export interface RevokeAiProviderConfigKeyInput {
  readonly actor: PlatformAuthInput;
  readonly stepUpSatisfied: boolean;
  readonly configId: string;
  /**
   * Lets the revoke find every other configuration holding the same key (a copy made with Edit
   * as New Draft, or the same key typed twice) and revoke those too. Without it only this row
   * is revoked.
   */
  readonly encryption?: KeyManagementPort;
}

/**
 * Part 8 §6 ("revocation"). One-way: a revoked key permanently disqualifies
 * this specific version from ever being activated or rolled back to again
 * (Part 8 §5 "cannot resurrect: revoked key"). If this version is the one
 * currently ACTIVE, it is disabled in the same transaction -- a revoked key
 * must never remain the platform's live credential for even a moment, so
 * this never waits on a separate emergency-disable call.
 *
 * A revoke is for the key, not just this row: with `encryption`, every other
 * unrevoked configuration of the same provider whose key is the same
 * (compared after decryption, in constant time, among rows with the same
 * fingerprint) is revoked in the same transaction, and disabled if ACTIVE.
 * Asking again on an already-revoked row repeats that sweep, so copies made
 * before this existed are caught too.
 */
export async function revokeAiProviderConfigKey(
  db: Db,
  input: RevokeAiProviderConfigKeyInput,
): Promise<Result<AiProviderConfig, ServiceError>> {
  if (!(await canPerformPlatformAction(db, input.actor, 'AI_SETTINGS_MANAGE'))) {
    return err(serviceError('forbidden', 'security-admin permission is required'));
  }
  if (!input.stepUpSatisfied) {
    return err(
      serviceError('step_up_required', 'revoking an AI provider key requires reauthentication'),
    );
  }

  return db.transaction(async (tx) => {
    await tx.execute(LOCK_SQL);
    const target = first(
      await tx
        .select()
        .from(schema.aiProviderConfigs)
        .where(eq(schema.aiProviderConfigs.id, input.configId))
        .limit(1),
    );
    if (!target) return err(serviceError('not_found', 'configuration not found'));

    const now = new Date();
    const copies = input.encryption ? await sameKeyConfigs(tx, input.encryption, target) : [];
    const revokeRow = async (row: AiProviderConfig, sameKeyAs?: string) => {
      const wasActive = row.status === 'ACTIVE';
      const revoked = required(
        first(
          await tx
            .update(schema.aiProviderConfigs)
            .set({
              keyRevokedAt: now,
              ...(wasActive ? { status: 'DISABLED', disabledAt: now } : {}),
            })
            .where(eq(schema.aiProviderConfigs.id, row.id))
            .returning(),
        ),
        'ai provider config',
      );
      await appendAuditEvent(tx, {
        eventType: 'AI_PROVIDER_CONFIG_KEY_REVOKED',
        actorAccountId: input.actor.accountId,
        method: 'MANUAL',
        result: 'ALLOWED',
        resourceType: 'ai_provider_config',
        resourceId: revoked.id,
        metadata: { wasActive, ...(sameKeyAs ? { sameKeyAsConfigId: sameKeyAs } : {}) },
      });
      return revoked;
    };
    const revoked = target.keyRevokedAt === null ? await revokeRow(target) : target;
    for (const copy of copies) await revokeRow(copy, target.id);
    return ok(revoked);
  });
}

/**
 * Every other unrevoked configuration of the target's provider that holds the very same key. Runs
 * in a savepoint and finds nothing if a key cannot be read, so the revoke of the target itself
 * never fails because of another row.
 */
async function sameKeyConfigs(
  tx: Db,
  encryption: KeyManagementPort,
  target: AiProviderConfig,
): Promise<AiProviderConfig[]> {
  try {
    return await tx.transaction((inner) => findSameKeyConfigs(inner, encryption, target));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[ai-provider-config] copies of a revoked key could not be checked: ${message}`);
    return [];
  }
}

async function findSameKeyConfigs(
  tx: Db,
  encryption: KeyManagementPort,
  target: AiProviderConfig,
): Promise<AiProviderConfig[]> {
  const candidates = await tx
    .select()
    .from(schema.aiProviderConfigs)
    .where(
      and(
        eq(schema.aiProviderConfigs.provider, target.provider),
        eq(schema.aiProviderConfigs.apiKeyFingerprint, target.apiKeyFingerprint),
        isNull(schema.aiProviderConfigs.keyRevokedAt),
        ne(schema.aiProviderConfigs.id, target.id),
      ),
    );
  if (candidates.length === 0) return [];
  const key = Buffer.from(await revealAiProviderApiKey(tx, encryption, target));
  const matches: AiProviderConfig[] = [];
  for (const candidate of candidates) {
    const other = Buffer.from(await revealAiProviderApiKey(tx, encryption, candidate));
    if (other.length === key.length && timingSafeEqual(other, key)) matches.push(candidate);
  }
  return matches;
}

/**
 * The one currently ACTIVE configuration, if any. No authorization check --
 * a platform-internal read the AI gateway itself consults at runtime (see
 * `isAiDispatchAllowed` below), the same trust level as `ai.ts`'s own
 * `totalAiCostUnits`. Choosing WHICH adapter/model/key to actually dispatch
 * with from this row remains deferred to a later chunk -- today only the
 * kill-switch question ("is dispatch allowed at all right now") consults it.
 */
export async function getActiveAiProviderConfig(db: Db): Promise<AiProviderConfig | undefined> {
  return first(
    await db
      .select()
      .from(schema.aiProviderConfigs)
      .where(eq(schema.aiProviderConfigs.status, 'ACTIVE'))
      .limit(1),
  );
}

/**
 * Part 8 §13 (cross-provider fallback): a single configuration by id, with
 * the SAME "no authorization check, platform-internal read" trust level as
 * `getActiveAiProviderConfig` just above -- consulted by `resolveAiExtractor`/
 * `resolveOcrAdapter` (apps/web) to re-verify a designated fallback target's
 * LIVE eligibility at the exact moment it might actually be dispatched to,
 * on behalf of whatever document-owner request is already otherwise
 * authorized, never a SECURITY_ADMIN action in its own right. Deliberately
 * separate from `getAiProviderConfigById` below, which stays actor-gated for
 * the admin UI's own "test a specific config" journey -- this one is
 * intentionally narrow (a fallback-target lookup only) rather than a
 * general-purpose escape hatch around that gate.
 */
export async function getAiProviderConfigForFallback(
  db: Db,
  configId: string,
): Promise<AiProviderConfig | undefined> {
  return first(
    await db
      .select()
      .from(schema.aiProviderConfigs)
      .where(eq(schema.aiProviderConfigs.id, configId))
      .limit(1),
  );
}

/**
 * Part 8 §5's kill switch, as a plain boolean: is AI extraction allowed to
 * dispatch right now? `ai.ts`'s `runExtraction` consults this fresh,
 * immediately before every outbound call (its own `killSwitchCheck`
 * parameter), never cached.
 *
 * Before any admin has ever touched AI settings, `ai_provider_configs` is
 * empty -- this stays permissive (today's 100%-env-var behavior, completely
 * unaffected) rather than refusing every extraction on a fresh install that
 * has never configured this table at all. The instant a first row exists
 * (DRAFT or otherwise), the table becomes authoritative: dispatch is allowed
 * only while a row is genuinely ACTIVE. Without this switch, `activate`
 * would look meaningful while `emergencyDisableAiProviderConfig`/
 * `rollbackAiProviderConfig` would silently do nothing at all once no ACTIVE
 * row existed -- dispatch would keep right on working from stale env vars,
 * defeating the entire point of an emergency disable.
 */
export async function isAiDispatchAllowed(db: Db): Promise<boolean> {
  if (!(await hasAnyAiProviderConfig(db))) return true;
  return (await getActiveAiProviderConfig(db)) !== undefined;
}

/**
 * Whether an admin has ever touched AI settings at all -- true the instant a
 * single row exists in `ai_provider_configs`, DRAFT or otherwise. Shared by
 * `isAiDispatchAllowed` above and by `apps/web/src/lib/ai.ts`'s
 * `resolveAiExtractor`, which both need the identical "has the DB config
 * system been engaged with at all, or is this still a fresh install" answer
 * before deciding whether the DB or the legacy env vars are authoritative.
 */
export async function hasAnyAiProviderConfig(db: Db): Promise<boolean> {
  const anyConfigured = first(
    await db.select({ id: schema.aiProviderConfigs.id }).from(schema.aiProviderConfigs).limit(1),
  );
  return anyConfigured !== undefined;
}

/**
 * Decrypt one config's API key. Only ever called server-side by the AI
 * gateway itself (wiring deferred to a later chunk) -- never exposed to any
 * client-facing read path.
 */
export async function revealAiProviderApiKey(
  db: Db,
  port: KeyManagementPort,
  config: AiProviderConfig,
): Promise<string> {
  return revealValue(db, port, {
    ciphertext: config.apiKeyCiphertext,
    nonce: config.apiKeyNonce,
    keyVersion: config.apiKeyVersion,
    aad: buildAiProviderConfigAad(config.id),
  });
}

/**
 * SECURITY_ADMIN-only: every configuration version ever created, newest
 * first (the admin history/rollback view). Returns full rows, encrypted key
 * material included -- worthless without the KMS to unwrap it, same as
 * `data_keys` generally; the caller decides what to project for display.
 */
export async function listAiProviderConfigHistory(
  db: Db,
  actor: PlatformAuthInput,
): Promise<Result<readonly AiProviderConfig[], ServiceError>> {
  if (!(await canPerformPlatformAction(db, actor, 'AI_SETTINGS_MANAGE'))) {
    return err(serviceError('forbidden', 'security-admin permission is required'));
  }
  const rows = await db.select().from(schema.aiProviderConfigs);
  return ok([...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()));
}

/**
 * SECURITY_ADMIN-only: a single configuration by id, for the admin UI's
 * "test connection" action (Part 8 §5 -- J15's own admin flow: "config
 * OpenAI; test; activate"). The gateway itself only ever needs the ACTIVE
 * row (`getActiveAiProviderConfig`); testing needs to reach a specific
 * DRAFT before it is ever activated, which that function can never return.
 */
export async function getAiProviderConfigById(
  db: Db,
  actor: PlatformAuthInput,
  configId: string,
): Promise<Result<AiProviderConfig, ServiceError>> {
  if (!(await canPerformPlatformAction(db, actor, 'AI_SETTINGS_MANAGE'))) {
    return err(serviceError('forbidden', 'security-admin permission is required'));
  }
  const config = first(
    await db
      .select()
      .from(schema.aiProviderConfigs)
      .where(eq(schema.aiProviderConfigs.id, configId))
      .limit(1),
  );
  if (!config) return err(serviceError('not_found', 'configuration not found'));
  return ok(config);
}

export interface RecordAiProviderConfigTestInput {
  readonly actor: PlatformAuthInput;
  readonly configId: string;
  readonly ok: boolean;
  readonly message: string;
}

/**
 * Records the outcome of an admin-triggered synthetic connection test as an
 * audit event (Part 8 §16: "record external API test request IDs without
 * sensitive content"). The real provider call this records happens in
 * `apps/web` (the composition root with adapter access, which this package
 * deliberately never depends on) -- this only logs what already happened,
 * it is never itself an authorization decision: the caller must already
 * have confirmed `AI_SETTINGS_MANAGE` + step-up (via `getAiProviderConfigById`
 * and its own step-up check) before ever making the real call this records,
 * so `result` here is always `ALLOWED` -- whether the TEST ITSELF succeeded
 * or failed lives in `metadata`, not `result` (which is reserved for the
 * authorization decision, not the operation's own outcome).
 */
export async function recordAiProviderConfigTest(
  db: Db,
  input: RecordAiProviderConfigTestInput,
): Promise<void> {
  await appendAuditEvent(db, {
    eventType: 'AI_PROVIDER_CONFIG_TESTED',
    actorAccountId: input.actor.accountId,
    method: 'MANUAL',
    result: 'ALLOWED',
    resourceType: 'ai_provider_config',
    resourceId: input.configId,
    metadata: { ok: input.ok, message: input.message },
  });
}

export interface RecordAiProviderConfigEvaluationInput {
  readonly actor: PlatformAuthInput;
  readonly configId: string;
  readonly passed: boolean;
  readonly caseCount: number;
  readonly precision: number;
  readonly recall: number;
  readonly hallucinationRate: number;
  readonly evidenceAccuracy: number;
  readonly promptInjectionResisted: boolean;
  readonly anyCaseErrored: boolean;
  readonly totalCostUnits: number;
}

/**
 * Records the outcome of an admin-triggered task evaluation as an audit
 * event (Part 8 §5: "run task evaluation" -- the admin journey's own named
 * step distinct from "run synthetic connection test," heavier-weight since
 * it runs the full eval harness dataset rather than one synthetic call).
 * Same audit-event shape and reasoning as `recordAiProviderConfigTest`
 * immediately above: the real evaluation run happens in `apps/web` (the
 * composition root with adapter and eval-harness access, which this package
 * deliberately never depends on) -- this only logs what already happened.
 * `result` is always `ALLOWED` for the identical reason `recordAiProviderConfigTest`
 * documents (the caller has already confirmed `AI_SETTINGS_MANAGE` + step-up
 * before ever running the real evaluation this records); whether the
 * evaluation itself PASSED lives in `metadata`, never in `result`.
 * `metadata` carries only the aggregate numeric report (never individual
 * case proposals or document text) -- the same "audit without sensitive
 * content" posture Part 8 §16 already established for the connection test.
 */
export async function recordAiProviderConfigEvaluation(
  db: Db,
  input: RecordAiProviderConfigEvaluationInput,
): Promise<void> {
  await appendAuditEvent(db, {
    eventType: 'AI_PROVIDER_CONFIG_EVALUATED',
    actorAccountId: input.actor.accountId,
    method: 'MANUAL',
    result: 'ALLOWED',
    resourceType: 'ai_provider_config',
    resourceId: input.configId,
    metadata: {
      passed: input.passed,
      caseCount: input.caseCount,
      precision: input.precision,
      recall: input.recall,
      hallucinationRate: input.hallucinationRate,
      evidenceAccuracy: input.evidenceAccuracy,
      promptInjectionResisted: input.promptInjectionResisted,
      anyCaseErrored: input.anyCaseErrored,
      totalCostUnits: input.totalCostUnits,
    },
  });
}
