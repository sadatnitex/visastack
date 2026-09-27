import { randomUUID } from 'node:crypto';
import { type Result, err, ok } from '@visastack/core';
import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { appendAuditEvent } from './audit';
import { type Db, first, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';
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
 * `createAiExtractor`/`runExtraction`'s kill-switch recheck to actually
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

export interface CreateDraftAiProviderConfigInput {
  readonly actor: PlatformAuthInput;
  readonly stepUpSatisfied: boolean;
  readonly provider: string;
  readonly model: string;
  readonly apiKey: string;
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
  if (input.apiKey.trim().length === 0) {
    return err(serviceError('invalid', 'an API key is required'));
  }
  if (!(input.budgetLimitUnits > 0)) {
    return err(serviceError('invalid', 'a positive budget limit is required'));
  }

  return db.transaction(async (tx) => {
    // Generated client-side (rather than left to the database default) so
    // the protected API key's AAD can bind the exact row id it will be
    // stored under, before that row exists to read the id back from --
    // mirrors profile.ts's editFact's identical reason for the same thing.
    const id = randomUUID();
    const protectedKey = await protectValue(
      tx,
      input.encryption,
      input.apiKey.trim(),
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
            apiKeyFingerprint: fingerprintApiKey(input.apiKey),
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
      metadata: { provider: config.provider, model: config.model },
    });
    return ok(config);
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
}

/**
 * Part 8 §6 ("revocation"). One-way: a revoked key permanently disqualifies
 * this specific version from ever being activated or rolled back to again
 * (Part 8 §5 "cannot resurrect: revoked key"). If this version is the one
 * currently ACTIVE, it is disabled in the same transaction -- a revoked key
 * must never remain the platform's live credential for even a moment, so
 * this never waits on a separate emergency-disable call.
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
    if (target.keyRevokedAt !== null) return ok(target);

    const now = new Date();
    const wasActive = target.status === 'ACTIVE';
    const revoked = required(
      first(
        await tx
          .update(schema.aiProviderConfigs)
          .set({
            keyRevokedAt: now,
            ...(wasActive ? { status: 'DISABLED', disabledAt: now } : {}),
          })
          .where(eq(schema.aiProviderConfigs.id, target.id))
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
      metadata: { wasActive },
    });
    return ok(revoked);
  });
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
  const anyConfigured = first(
    await db.select({ id: schema.aiProviderConfigs.id }).from(schema.aiProviderConfigs).limit(1),
  );
  if (!anyConfigured) return true;
  return (await getActiveAiProviderConfig(db)) !== undefined;
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
