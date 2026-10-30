import { randomBytes } from 'node:crypto';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { desc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { type StaffScope, staffPrincipal } from './access/principal';
import { provisionAccount } from './accounts';
import {
  activateAiProviderConfig,
  createDraftAiProviderConfig,
  deleteDraftAiProviderConfig,
  emergencyDisableAiProviderConfig,
  getActiveAiProviderConfig,
  getAiProviderConfigById,
  getAiProviderConfigForFallback,
  isAiDispatchAllowed,
  listAiProviderConfigHistory,
  recordAiProviderConfigEvaluation,
  recordAiProviderConfigTest,
  revealAiProviderApiKey,
  revokeAiProviderConfigKey,
  rollbackAiProviderConfig,
  updateDraftAiProviderConfig,
} from './ai-provider-config';
import type { Db } from './db';
import { grantPlatformRole } from './platform-roles';
import type { KeyManagementPort } from './ports';

async function freshDb(): Promise<Db> {
  const client = await createMigratedPglite();
  const db = drizzle(client, { schema });
  return db as unknown as Db;
}

/** A deterministic, fixed-key test double, matching protected-fields.test.ts's/ai.test.ts's own fixture. */
function fakeKeyManagementPort(keyVersion = 'test-v1'): KeyManagementPort {
  const masterKey = Buffer.alloc(32, 7);
  return {
    currentKeyVersion: () => keyVersion,
    async generateDataKey() {
      return { keyVersion, plaintextDataKey: randomBytes(32), wrappedDataKey: masterKey };
    },
    async unwrapDataKey(version) {
      if (version !== keyVersion) throw new Error(`unknown key version ${version}`);
      return masterKey;
    },
  };
}

/** Bootstraps a PLATFORM_OWNER, then has it grant a fresh account SECURITY_ADMIN. */
async function seedSecurityAdmin(db: Db) {
  const owner = await provisionAccount(db, { email: 'ai-config-bootstrap@example.com' });
  if (!isOk(owner)) throw new Error('provision');
  const ownerAuth = {
    accountId: owner.value.id,
    email: 'ai-config-bootstrap@example.com',
    bootstrapEmails: ['ai-config-bootstrap@example.com'],
  };
  await grantPlatformRole(db, {
    actor: ownerAuth,
    targetAccountId: owner.value.id,
    role: 'PLATFORM_OWNER',
    reason: 'bootstrap',
    stepUpSatisfied: true,
  });
  const admin = await provisionAccount(db, { email: 'ai-security-admin@example.com' });
  if (!isOk(admin)) throw new Error('provision');
  const granted = await grantPlatformRole(db, {
    actor: ownerAuth,
    targetAccountId: admin.value.id,
    role: 'SECURITY_ADMIN',
    reason: 'AI settings owner',
    stepUpSatisfied: true,
  });
  if (!isOk(granted)) throw new Error('grant');
  return { accountId: admin.value.id, email: 'ai-security-admin@example.com', bootstrapEmails: [] };
}

async function seedStranger(db: Db) {
  const account = await provisionAccount(db, { email: 'ai-config-stranger@example.com' });
  if (!isOk(account)) throw new Error('provision');
  return {
    accountId: account.value.id,
    email: 'ai-config-stranger@example.com',
    bootstrapEmails: [],
  };
}

const encryption = fakeKeyManagementPort();

interface DraftOverrides {
  readonly apiKey?: string;
  readonly provider?: string;
  readonly dataPolicyApproved?: boolean;
  readonly budgetLimitUnits?: number;
  readonly notes?: string;
  readonly fallbackEnabled?: boolean;
  readonly fallbackProviderConfigId?: string;
}

const MODEL_FOR: Readonly<Record<string, string>> = {
  openai: 'gpt-5.6-terra',
  anthropic: 'claude-opus-5-5',
  gemini: 'gemini-3.8-flash',
};

function draftInput(
  actor: Awaited<ReturnType<typeof seedSecurityAdmin>>,
  overrides?: DraftOverrides,
) {
  return {
    actor,
    stepUpSatisfied: true,
    provider: overrides?.provider ?? 'openai',
    // A model of the provider's own family, as the service requires.
    model: MODEL_FOR[overrides?.provider ?? 'openai'] ?? 'gpt-5.6-terra',
    apiKey: overrides?.apiKey ?? 'sk-test-1234',
    encryption,
    dataPolicyApproved: overrides?.dataPolicyApproved ?? true,
    budgetLimitUnits: overrides?.budgetLimitUnits ?? 2_000_000,
    ...(overrides?.notes ? { notes: overrides.notes } : {}),
    ...(overrides?.fallbackEnabled ? { fallbackEnabled: true } : {}),
    ...(overrides?.fallbackProviderConfigId
      ? { fallbackProviderConfigId: overrides.fallbackProviderConfigId }
      : {}),
  };
}

/** Every audit row, newest first: tests read the trail directly, as no staff scope is in play. */
async function recentAuditEvents(db: Db) {
  return db.select().from(schema.auditEvents).orderBy(desc(schema.auditEvents.seq));
}

describe('AI provider configuration — draft creation (Part 8 §5)', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('creates a DRAFT with the API key envelope-encrypted, fingerprinted, and never stored in plaintext', async () => {
    const actor = await seedSecurityAdmin(db);
    const created = await createDraftAiProviderConfig(
      db,
      draftInput(actor, { apiKey: 'sk-super-secret-9999' }),
    );
    expect(isOk(created)).toBe(true);
    if (!isOk(created)) return;
    expect(created.value.status).toBe('DRAFT');
    expect(created.value.apiKeyFingerprint).toBe('...9999');

    const raw = await db
      .select()
      .from(schema.aiProviderConfigs)
      .where(eq(schema.aiProviderConfigs.id, created.value.id));
    const stored = Buffer.from(raw[0]?.apiKeyCiphertext ?? new Uint8Array());
    expect(stored.includes('sk-super-secret-9999')).toBe(false);

    const revealed = await revealAiProviderApiKey(db, encryption, created.value);
    expect(revealed).toBe('sk-super-secret-9999');

    const events = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'AI_PROVIDER_CONFIG_CREATED'));
    expect(events).toHaveLength(1);
  });

  it('refuses without SECURITY_ADMIN permission', async () => {
    const stranger = await seedStranger(db);
    const result = await createDraftAiProviderConfig(db, draftInput(stranger));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('forbidden');
  });

  it('refuses without step-up', async () => {
    const actor = await seedSecurityAdmin(db);
    const result = await createDraftAiProviderConfig(db, {
      ...draftInput(actor),
      stepUpSatisfied: false,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('step_up_required');
  });

  it('refuses an empty API key and a non-positive budget', async () => {
    const actor = await seedSecurityAdmin(db);
    const noKey = await createDraftAiProviderConfig(db, draftInput(actor, { apiKey: '   ' }));
    expect(isErr(noKey)).toBe(true);
    if (isErr(noKey)) expect(noKey.error.code).toBe('invalid');

    const zeroBudget = await createDraftAiProviderConfig(
      db,
      draftInput(actor, { budgetLimitUnits: 0 }),
    );
    expect(isErr(zeroBudget)).toBe(true);
    if (isErr(zeroBudget)) expect(zeroBudget.error.code).toBe('invalid');
  });
});

describe('AI provider configuration — activation (Part 8 §5)', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('activates a DRAFT, and getActiveAiProviderConfig sees it', async () => {
    const actor = await seedSecurityAdmin(db);
    expect(await getActiveAiProviderConfig(db)).toBeUndefined();

    const draft = await createDraftAiProviderConfig(db, draftInput(actor));
    if (!isOk(draft)) throw new Error('draft failed');
    const activated = await activateAiProviderConfig(db, {
      actor,
      stepUpSatisfied: true,
      configId: draft.value.id,
    });
    expect(isOk(activated)).toBe(true);
    if (!isOk(activated)) return;
    expect(activated.value.status).toBe('ACTIVE');
    expect(activated.value.activatedAt).not.toBeNull();

    const active = await getActiveAiProviderConfig(db);
    expect(active?.id).toBe(draft.value.id);
  });

  it('atomically supersedes the prior ACTIVE version when activating a new one -- never two ACTIVE at once', async () => {
    const actor = await seedSecurityAdmin(db);
    const first = await createDraftAiProviderConfig(db, draftInput(actor));
    if (!isOk(first)) throw new Error('draft failed');
    await activateAiProviderConfig(db, { actor, stepUpSatisfied: true, configId: first.value.id });

    const second = await createDraftAiProviderConfig(
      db,
      draftInput(actor, { apiKey: 'sk-second-key' }),
    );
    if (!isOk(second)) throw new Error('draft failed');
    const activatedSecond = await activateAiProviderConfig(db, {
      actor,
      stepUpSatisfied: true,
      configId: second.value.id,
    });
    expect(isOk(activatedSecond)).toBe(true);

    const rows = await db.select().from(schema.aiProviderConfigs);
    const activeRows = rows.filter((r) => r.status === 'ACTIVE');
    expect(activeRows).toHaveLength(1);
    expect(activeRows[0]?.id).toBe(second.value.id);
    const firstRow = rows.find((r) => r.id === first.value.id);
    expect(firstRow?.status).toBe('SUPERSEDED');
    expect(firstRow?.supersededAt).not.toBeNull();
  });

  it('refuses to activate a config whose data policy is not approved', async () => {
    const actor = await seedSecurityAdmin(db);
    const draft = await createDraftAiProviderConfig(
      db,
      draftInput(actor, { dataPolicyApproved: false }),
    );
    if (!isOk(draft)) throw new Error('draft failed');
    const result = await activateAiProviderConfig(db, {
      actor,
      stepUpSatisfied: true,
      configId: draft.value.id,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('invalid');
  });

  it('refuses to activate a config that is not a DRAFT (e.g. already ACTIVE)', async () => {
    const actor = await seedSecurityAdmin(db);
    const draft = await createDraftAiProviderConfig(db, draftInput(actor));
    if (!isOk(draft)) throw new Error('draft failed');
    await activateAiProviderConfig(db, { actor, stepUpSatisfied: true, configId: draft.value.id });

    const second = await activateAiProviderConfig(db, {
      actor,
      stepUpSatisfied: true,
      configId: draft.value.id,
    });
    expect(isErr(second)).toBe(true);
    if (isErr(second)) expect(second.error.code).toBe('invalid');
  });

  it('refuses without SECURITY_ADMIN permission or without step-up', async () => {
    const actor = await seedSecurityAdmin(db);
    const stranger = await seedStranger(db);
    const draft = await createDraftAiProviderConfig(db, draftInput(actor));
    if (!isOk(draft)) throw new Error('draft failed');

    const byStranger = await activateAiProviderConfig(db, {
      actor: stranger,
      stepUpSatisfied: true,
      configId: draft.value.id,
    });
    expect(isErr(byStranger)).toBe(true);
    if (isErr(byStranger)) expect(byStranger.error.code).toBe('forbidden');

    const withoutStepUp = await activateAiProviderConfig(db, {
      actor,
      stepUpSatisfied: false,
      configId: draft.value.id,
    });
    expect(isErr(withoutStepUp)).toBe(true);
    if (isErr(withoutStepUp)) expect(withoutStepUp.error.code).toBe('step_up_required');
  });
});

describe('AI provider configuration - cross-provider fallback designation (Part 8 §13)', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('defaults to fallback disabled and no target when not specified', async () => {
    const actor = await seedSecurityAdmin(db);
    const draft = await createDraftAiProviderConfig(db, draftInput(actor));
    if (!isOk(draft)) throw new Error('draft failed');
    expect(draft.value.fallbackEnabled).toBe(false);
    expect(draft.value.fallbackProviderConfigId).toBeNull();
  });

  it('persists fallbackEnabled and fallbackProviderConfigId when given', async () => {
    const actor = await seedSecurityAdmin(db);
    const target = await createDraftAiProviderConfig(db, draftInput(actor, { provider: 'gemini' }));
    if (!isOk(target)) throw new Error('draft failed');
    const draft = await createDraftAiProviderConfig(
      db,
      draftInput(actor, { fallbackEnabled: true, fallbackProviderConfigId: target.value.id }),
    );
    expect(isOk(draft)).toBe(true);
    if (!isOk(draft)) return;
    expect(draft.value.fallbackEnabled).toBe(true);
    expect(draft.value.fallbackProviderConfigId).toBe(target.value.id);
  });

  it('refuses to create a DRAFT with fallback enabled but no fallback target selected', async () => {
    const actor = await seedSecurityAdmin(db);
    const draft = await createDraftAiProviderConfig(
      db,
      draftInput(actor, { fallbackEnabled: true }),
    );
    expect(isErr(draft)).toBe(true);
    if (isErr(draft)) expect(draft.error.code).toBe('invalid');
  });

  it('activates fine with a fallback target that is SUPERSEDED, not ACTIVE -- the single-winner invariant means the target can never itself be the current ACTIVE row', async () => {
    const actor = await seedSecurityAdmin(db);
    const openaiDraft = await createDraftAiProviderConfig(
      db,
      draftInput(actor, { provider: 'openai' }),
    );
    if (!isOk(openaiDraft)) throw new Error('draft failed');
    await activateAiProviderConfig(db, {
      actor,
      stepUpSatisfied: true,
      configId: openaiDraft.value.id,
    });
    const anthropicDraft = await createDraftAiProviderConfig(
      db,
      draftInput(actor, { provider: 'anthropic', apiKey: 'sk-ant-second' }),
    );
    if (!isOk(anthropicDraft)) throw new Error('draft failed');
    await activateAiProviderConfig(db, {
      actor,
      stepUpSatisfied: true,
      configId: anthropicDraft.value.id,
    });
    // openaiDraft is now SUPERSEDED (anthropicDraft superseded it above).
    const [supersededRow] = await db
      .select()
      .from(schema.aiProviderConfigs)
      .where(eq(schema.aiProviderConfigs.id, openaiDraft.value.id));
    expect(supersededRow?.status).toBe('SUPERSEDED');

    const geminiDraft = await createDraftAiProviderConfig(
      db,
      draftInput(actor, {
        provider: 'gemini',
        apiKey: 'sk-gem-third',
        fallbackEnabled: true,
        fallbackProviderConfigId: openaiDraft.value.id,
      }),
    );
    if (!isOk(geminiDraft)) throw new Error('draft failed');
    const activated = await activateAiProviderConfig(db, {
      actor,
      stepUpSatisfied: true,
      configId: geminiDraft.value.id,
    });
    expect(isOk(activated)).toBe(true);
    if (!isOk(activated)) return;
    expect(activated.value.fallbackProviderConfigId).toBe(openaiDraft.value.id);
  });

  it('refuses to activate when the fallback target uses the same provider as the config itself', async () => {
    const actor = await seedSecurityAdmin(db);
    const target = await createDraftAiProviderConfig(db, draftInput(actor, { provider: 'openai' }));
    if (!isOk(target)) throw new Error('draft failed');
    const draft = await createDraftAiProviderConfig(
      db,
      draftInput(actor, {
        provider: 'openai',
        apiKey: 'sk-second-openai',
        fallbackEnabled: true,
        fallbackProviderConfigId: target.value.id,
      }),
    );
    if (!isOk(draft)) throw new Error('draft failed');
    const result = await activateAiProviderConfig(db, {
      actor,
      stepUpSatisfied: true,
      configId: draft.value.id,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('invalid');
  });

  it("refuses to activate when the fallback target's data policy is not approved", async () => {
    const actor = await seedSecurityAdmin(db);
    const target = await createDraftAiProviderConfig(
      db,
      draftInput(actor, { provider: 'anthropic', dataPolicyApproved: false }),
    );
    if (!isOk(target)) throw new Error('draft failed');
    const draft = await createDraftAiProviderConfig(
      db,
      draftInput(actor, {
        provider: 'openai',
        fallbackEnabled: true,
        fallbackProviderConfigId: target.value.id,
      }),
    );
    if (!isOk(draft)) throw new Error('draft failed');
    const result = await activateAiProviderConfig(db, {
      actor,
      stepUpSatisfied: true,
      configId: draft.value.id,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('invalid');
  });

  it("refuses to activate when the fallback target's key has been revoked", async () => {
    const actor = await seedSecurityAdmin(db);
    const target = await createDraftAiProviderConfig(
      db,
      draftInput(actor, { provider: 'anthropic' }),
    );
    if (!isOk(target)) throw new Error('draft failed');
    const revoked = await revokeAiProviderConfigKey(db, {
      actor,
      stepUpSatisfied: true,
      configId: target.value.id,
    });
    expect(isOk(revoked)).toBe(true);

    const draft = await createDraftAiProviderConfig(
      db,
      draftInput(actor, {
        provider: 'openai',
        fallbackEnabled: true,
        fallbackProviderConfigId: target.value.id,
      }),
    );
    if (!isOk(draft)) throw new Error('draft failed');
    const result = await activateAiProviderConfig(db, {
      actor,
      stepUpSatisfied: true,
      configId: draft.value.id,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('invalid');
  });

  it('refuses to activate when the fallback target no longer exists', async () => {
    const actor = await seedSecurityAdmin(db);
    const draft = await createDraftAiProviderConfig(
      db,
      draftInput(actor, {
        provider: 'openai',
        fallbackEnabled: true,
        fallbackProviderConfigId: '00000000-0000-0000-0000-000000000000',
      }),
    );
    if (!isOk(draft)) throw new Error('draft failed');
    const result = await activateAiProviderConfig(db, {
      actor,
      stepUpSatisfied: true,
      configId: draft.value.id,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('invalid');
  });

  it('refuses to activate a row with fallback enabled but no target, even if that inconsistent state was reached by direct write rather than createDraftAiProviderConfig (defense in depth)', async () => {
    const actor = await seedSecurityAdmin(db);
    const draft = await createDraftAiProviderConfig(db, draftInput(actor, { provider: 'openai' }));
    if (!isOk(draft)) throw new Error('draft failed');
    await db
      .update(schema.aiProviderConfigs)
      .set({ fallbackEnabled: true })
      .where(eq(schema.aiProviderConfigs.id, draft.value.id));

    const result = await activateAiProviderConfig(db, {
      actor,
      stepUpSatisfied: true,
      configId: draft.value.id,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('invalid');
  });
});

describe('AI provider configuration — rollback (Part 8 §5: "last eligible known-good only")', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  async function activateFreshDraft(
    actor: Awaited<ReturnType<typeof seedSecurityAdmin>>,
    apiKey: string,
  ) {
    const draft = await createDraftAiProviderConfig(db, draftInput(actor, { apiKey }));
    if (!isOk(draft)) throw new Error('draft failed');
    const activated = await activateAiProviderConfig(db, {
      actor,
      stepUpSatisfied: true,
      configId: draft.value.id,
    });
    if (!isOk(activated)) throw new Error('activate failed');
    return activated.value;
  }

  it('rolls back to the immediately prior SUPERSEDED version', async () => {
    const actor = await seedSecurityAdmin(db);
    const first = await activateFreshDraft(actor, 'sk-v1');
    const second = await activateFreshDraft(actor, 'sk-v2');
    expect((await getActiveAiProviderConfig(db))?.id).toBe(second.id);

    const rolledBack = await rollbackAiProviderConfig(db, { actor, stepUpSatisfied: true });
    expect(isOk(rolledBack)).toBe(true);
    if (!isOk(rolledBack)) return;
    expect(rolledBack.value.id).toBe(first.id);
    expect(rolledBack.value.status).toBe('ACTIVE');

    const rows = await db.select().from(schema.aiProviderConfigs);
    expect(rows.find((r) => r.id === second.id)?.status).toBe('SUPERSEDED');
  });

  it('skips a SUPERSEDED version whose key has since been revoked, resurrecting the next eligible one instead', async () => {
    const actor = await seedSecurityAdmin(db);
    const first = await activateFreshDraft(actor, 'sk-v1');
    await activateFreshDraft(actor, 'sk-v2'); // supersedes `first`
    await activateFreshDraft(actor, 'sk-v3'); // supersedes v2, now ACTIVE

    // `first` (v1) is a real candidate two steps back -- revoke it so it can
    // never be resurrected (Part 8 §5: "cannot resurrect: revoked key"),
    // even though it would otherwise be perfectly eligible.
    await revokeAiProviderConfigKey(db, { actor, stepUpSatisfied: true, configId: first.id });

    const rolledBack = await rollbackAiProviderConfig(db, { actor, stepUpSatisfied: true });
    expect(isOk(rolledBack)).toBe(true);
    // Rolls back to v2 (the next eligible one back), never to the revoked v1.
    if (isOk(rolledBack)) expect(rolledBack.value.id).not.toBe(first.id);
  });

  it('skips a SUPERSEDED version whose data policy is no longer approved', async () => {
    const actor = await seedSecurityAdmin(db);
    // A DRAFT can be activated with an approved policy, then have it
    // withdrawn later -- simulated here with a direct row update, since no
    // "un-approve" service function exists yet (out of this chunk's scope).
    const first = await activateFreshDraft(actor, 'sk-v1');
    await db
      .update(schema.aiProviderConfigs)
      .set({ dataPolicyApproved: false })
      .where(eq(schema.aiProviderConfigs.id, first.id));
    await activateFreshDraft(actor, 'sk-v2');

    const rolledBack = await rollbackAiProviderConfig(db, { actor, stepUpSatisfied: true });
    expect(isErr(rolledBack)).toBe(true);
    if (isErr(rolledBack)) expect(rolledBack.error.code).toBe('invalid');
  });

  it('refuses when there is no eligible configuration at all to roll back to', async () => {
    const actor = await seedSecurityAdmin(db);
    const result = await rollbackAiProviderConfig(db, { actor, stepUpSatisfied: true });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('invalid');
  });

  it('recovers from an emergency-disable directly -- nothing needs to be currently ACTIVE for rollback to work', async () => {
    const actor = await seedSecurityAdmin(db);
    const draft = await createDraftAiProviderConfig(db, draftInput(actor));
    if (!isOk(draft)) throw new Error('draft failed');
    await activateAiProviderConfig(db, { actor, stepUpSatisfied: true, configId: draft.value.id });
    await emergencyDisableAiProviderConfig(db, { actor, stepUpSatisfied: true });
    expect(await getActiveAiProviderConfig(db)).toBeUndefined();

    const rolledBack = await rollbackAiProviderConfig(db, { actor, stepUpSatisfied: true });
    expect(isOk(rolledBack)).toBe(true);
    if (isOk(rolledBack)) {
      expect(rolledBack.value.id).toBe(draft.value.id);
      expect(rolledBack.value.status).toBe('ACTIVE');
    }
  });
});

describe('AI provider configuration — emergency disable and key revocation (Part 8 §5/§6)', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('disables the current ACTIVE configuration, with nothing auto-promoted', async () => {
    const actor = await seedSecurityAdmin(db);
    const draft = await createDraftAiProviderConfig(db, draftInput(actor));
    if (!isOk(draft)) throw new Error('draft failed');
    await activateAiProviderConfig(db, { actor, stepUpSatisfied: true, configId: draft.value.id });

    const disabled = await emergencyDisableAiProviderConfig(db, { actor, stepUpSatisfied: true });
    expect(isOk(disabled)).toBe(true);
    if (isOk(disabled)) expect(disabled.value.status).toBe('DISABLED');
    expect(await getActiveAiProviderConfig(db)).toBeUndefined();
  });

  it('refuses to disable when nothing is active', async () => {
    const actor = await seedSecurityAdmin(db);
    const result = await emergencyDisableAiProviderConfig(db, { actor, stepUpSatisfied: true });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('invalid');
  });

  it('revoking the ACTIVE configuration key immediately disables it too', async () => {
    const actor = await seedSecurityAdmin(db);
    const draft = await createDraftAiProviderConfig(db, draftInput(actor));
    if (!isOk(draft)) throw new Error('draft failed');
    await activateAiProviderConfig(db, { actor, stepUpSatisfied: true, configId: draft.value.id });

    const revoked = await revokeAiProviderConfigKey(db, {
      actor,
      stepUpSatisfied: true,
      configId: draft.value.id,
    });
    expect(isOk(revoked)).toBe(true);
    if (isOk(revoked)) {
      expect(revoked.value.keyRevokedAt).not.toBeNull();
      expect(revoked.value.status).toBe('DISABLED');
    }
    expect(await getActiveAiProviderConfig(db)).toBeUndefined();
  });

  it('revoking a non-active configuration key leaves its status untouched', async () => {
    const actor = await seedSecurityAdmin(db);
    const draft = await createDraftAiProviderConfig(db, draftInput(actor));
    if (!isOk(draft)) throw new Error('draft failed');

    const revoked = await revokeAiProviderConfigKey(db, {
      actor,
      stepUpSatisfied: true,
      configId: draft.value.id,
    });
    expect(isOk(revoked)).toBe(true);
    if (isOk(revoked)) {
      expect(revoked.value.status).toBe('DRAFT');
      expect(revoked.value.keyRevokedAt).not.toBeNull();
    }
  });

  it('revoking an already-revoked key is idempotent, not an error', async () => {
    const actor = await seedSecurityAdmin(db);
    const draft = await createDraftAiProviderConfig(db, draftInput(actor));
    if (!isOk(draft)) throw new Error('draft failed');
    await revokeAiProviderConfigKey(db, { actor, stepUpSatisfied: true, configId: draft.value.id });
    const second = await revokeAiProviderConfigKey(db, {
      actor,
      stepUpSatisfied: true,
      configId: draft.value.id,
    });
    expect(isOk(second)).toBe(true);
  });
});

describe('AI provider configuration — history (Part 8 §5)', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('lists every version newest first, and refuses without SECURITY_ADMIN permission', async () => {
    const actor = await seedSecurityAdmin(db);
    await createDraftAiProviderConfig(db, draftInput(actor, { apiKey: 'sk-a' }));
    await createDraftAiProviderConfig(db, draftInput(actor, { apiKey: 'sk-b' }));

    const history = await listAiProviderConfigHistory(db, actor);
    expect(isOk(history)).toBe(true);
    if (isOk(history)) {
      expect(history.value).toHaveLength(2);
      expect(history.value[0]?.createdAt.getTime()).toBeGreaterThanOrEqual(
        history.value[1]?.createdAt.getTime() ?? 0,
      );
    }

    const stranger = await seedStranger(db);
    const refused = await listAiProviderConfigHistory(db, stranger);
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) expect(refused.error.code).toBe('forbidden');
  });
});

describe('isAiDispatchAllowed -- the kill switch itself (Part 8 §5)', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('is permissive on a fresh install where no admin has ever touched AI settings', async () => {
    expect(await isAiDispatchAllowed(db)).toBe(true);
  });

  it('is true once a configuration is ACTIVE', async () => {
    const actor = await seedSecurityAdmin(db);
    const draft = await createDraftAiProviderConfig(db, draftInput(actor));
    if (!isOk(draft)) throw new Error('draft failed');
    await activateAiProviderConfig(db, { actor, stepUpSatisfied: true, configId: draft.value.id });
    expect(await isAiDispatchAllowed(db)).toBe(true);
  });

  it('becomes authoritative (no longer permissive by default) the instant any row exists, even just a DRAFT', async () => {
    const actor = await seedSecurityAdmin(db);
    await createDraftAiProviderConfig(db, draftInput(actor));
    // A DRAFT alone never affects dispatch -- but the table now has a row,
    // so "nothing is ACTIVE" is a real refusal, not the fresh-install default.
    expect(await isAiDispatchAllowed(db)).toBe(false);
  });

  it('is false after an emergency-disable -- the kill switch actually stops dispatch', async () => {
    const actor = await seedSecurityAdmin(db);
    const draft = await createDraftAiProviderConfig(db, draftInput(actor));
    if (!isOk(draft)) throw new Error('draft failed');
    await activateAiProviderConfig(db, { actor, stepUpSatisfied: true, configId: draft.value.id });
    expect(await isAiDispatchAllowed(db)).toBe(true);

    await emergencyDisableAiProviderConfig(db, { actor, stepUpSatisfied: true });
    expect(await isAiDispatchAllowed(db)).toBe(false);
  });

  it('is true again after a rollback restores a prior eligible ACTIVE version', async () => {
    const actor = await seedSecurityAdmin(db);
    const first = await createDraftAiProviderConfig(db, draftInput(actor, { apiKey: 'sk-v1' }));
    if (!isOk(first)) throw new Error('draft failed');
    await activateAiProviderConfig(db, { actor, stepUpSatisfied: true, configId: first.value.id });
    const second = await createDraftAiProviderConfig(db, draftInput(actor, { apiKey: 'sk-v2' }));
    if (!isOk(second)) throw new Error('draft failed');
    await activateAiProviderConfig(db, { actor, stepUpSatisfied: true, configId: second.value.id });

    await emergencyDisableAiProviderConfig(db, { actor, stepUpSatisfied: true });
    expect(await isAiDispatchAllowed(db)).toBe(false);

    const rolledBack = await rollbackAiProviderConfig(db, { actor, stepUpSatisfied: true });
    expect(isOk(rolledBack)).toBe(true);
    expect(await isAiDispatchAllowed(db)).toBe(true);
  });
});

describe('getAiProviderConfigById (Part 8 §5 -- the admin "test connection" journey)', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('returns a DRAFT config by id for a SECURITY_ADMIN, before it is ever activated', async () => {
    const actor = await seedSecurityAdmin(db);
    const created = await createDraftAiProviderConfig(
      db,
      draftInput(actor, { apiKey: 'sk-draft' }),
    );
    if (!isOk(created)) throw new Error('draft failed');

    const found = await getAiProviderConfigById(db, actor, created.value.id);
    expect(isOk(found)).toBe(true);
    if (isOk(found)) {
      expect(found.value.id).toBe(created.value.id);
      expect(found.value.status).toBe('DRAFT');
    }
  });

  it('refuses a stranger without SECURITY_ADMIN permission', async () => {
    const actor = await seedSecurityAdmin(db);
    const created = await createDraftAiProviderConfig(db, draftInput(actor));
    if (!isOk(created)) throw new Error('draft failed');

    const stranger = await seedStranger(db);
    const refused = await getAiProviderConfigById(db, stranger, created.value.id);
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) expect(refused.error.code).toBe('forbidden');
  });

  it('returns not_found for a nonexistent id', async () => {
    const actor = await seedSecurityAdmin(db);
    const missing = await getAiProviderConfigById(
      db,
      actor,
      '00000000-0000-0000-0000-000000000000',
    );
    expect(isErr(missing)).toBe(true);
    if (isErr(missing)) expect(missing.error.code).toBe('not_found');
  });
});

describe('recordAiProviderConfigTest (Part 8 §16 -- audit external test calls without sensitive content)', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('records a successful synthetic connection test as an ALLOWED audit event', async () => {
    const actor = await seedSecurityAdmin(db);
    const created = await createDraftAiProviderConfig(db, draftInput(actor));
    if (!isOk(created)) throw new Error('draft failed');

    await recordAiProviderConfigTest(db, {
      actor,
      configId: created.value.id,
      ok: true,
      message: 'connection succeeded',
    });

    const events = await recentAuditEvents(db);
    const event = events.find((entry) => entry.eventType === 'AI_PROVIDER_CONFIG_TESTED');
    expect(event).toBeDefined();
    expect(event?.result).toBe('ALLOWED');
    expect(event?.actorAccountId).toBe(actor.accountId);
    expect(event?.resourceType).toBe('ai_provider_config');
    expect(event?.resourceId).toBe(created.value.id);
    expect(event?.metadata).toEqual({ ok: true, message: 'connection succeeded' });
  });

  it('still records ALLOWED (the authorization outcome) even when the test itself failed', async () => {
    const actor = await seedSecurityAdmin(db);
    const created = await createDraftAiProviderConfig(db, draftInput(actor));
    if (!isOk(created)) throw new Error('draft failed');

    await recordAiProviderConfigTest(db, {
      actor,
      configId: created.value.id,
      ok: false,
      message: 'upstream_error: 500',
    });

    const events = await recentAuditEvents(db);
    const event = events.find((entry) => entry.eventType === 'AI_PROVIDER_CONFIG_TESTED');
    expect(event).toBeDefined();
    expect(event?.result).toBe('ALLOWED');
    expect(event?.metadata).toEqual({ ok: false, message: 'upstream_error: 500' });
  });
});

describe('recordAiProviderConfigEvaluation (Part 8 §5 -- the admin "run task evaluation" journey step)', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  function evaluationInput(
    actor: Awaited<ReturnType<typeof seedSecurityAdmin>>,
    configId: string,
    overrides?: Partial<{ passed: boolean; anyCaseErrored: boolean }>,
  ) {
    return {
      actor,
      configId,
      passed: overrides?.passed ?? true,
      caseCount: 13,
      precision: 0.92,
      recall: 0.81,
      hallucinationRate: 0.02,
      evidenceAccuracy: 0.95,
      promptInjectionResisted: true,
      anyCaseErrored: overrides?.anyCaseErrored ?? false,
      totalCostUnits: 39,
    };
  }

  it('records a passing task evaluation as an ALLOWED audit event carrying the full aggregate report', async () => {
    const actor = await seedSecurityAdmin(db);
    const created = await createDraftAiProviderConfig(db, draftInput(actor));
    if (!isOk(created)) throw new Error('draft failed');

    await recordAiProviderConfigEvaluation(db, evaluationInput(actor, created.value.id));

    const events = await recentAuditEvents(db);
    const event = events.find((entry) => entry.eventType === 'AI_PROVIDER_CONFIG_EVALUATED');
    expect(event).toBeDefined();
    expect(event?.result).toBe('ALLOWED');
    expect(event?.actorAccountId).toBe(actor.accountId);
    expect(event?.resourceType).toBe('ai_provider_config');
    expect(event?.resourceId).toBe(created.value.id);
    expect(event?.metadata).toEqual({
      passed: true,
      caseCount: 13,
      precision: 0.92,
      recall: 0.81,
      hallucinationRate: 0.02,
      evidenceAccuracy: 0.95,
      promptInjectionResisted: true,
      anyCaseErrored: false,
      totalCostUnits: 39,
    });
  });

  it('still records ALLOWED (the authorization outcome) even when the evaluation itself failed thresholds', async () => {
    const actor = await seedSecurityAdmin(db);
    const created = await createDraftAiProviderConfig(db, draftInput(actor));
    if (!isOk(created)) throw new Error('draft failed');

    await recordAiProviderConfigEvaluation(
      db,
      evaluationInput(actor, created.value.id, { passed: false, anyCaseErrored: true }),
    );

    const events = await recentAuditEvents(db);
    const event = events.find((entry) => entry.eventType === 'AI_PROVIDER_CONFIG_EVALUATED');
    expect(event).toBeDefined();
    expect(event?.result).toBe('ALLOWED');
    expect(event?.metadata).toMatchObject({ passed: false, anyCaseErrored: true });
  });
});

describe('getAiProviderConfigForFallback (Part 8 §13 -- an unauthenticated, platform-internal read)', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('returns a config by id with no actor/permission check, unlike getAiProviderConfigById', async () => {
    const actor = await seedSecurityAdmin(db);
    const draft = await createDraftAiProviderConfig(
      db,
      draftInput(actor, { provider: 'anthropic' }),
    );
    if (!isOk(draft)) throw new Error('draft failed');

    const found = await getAiProviderConfigForFallback(db, draft.value.id);
    expect(found?.id).toBe(draft.value.id);
    expect(found?.provider).toBe('anthropic');
  });

  it('returns undefined for a non-existent id', async () => {
    const found = await getAiProviderConfigForFallback(db, '00000000-0000-0000-0000-000000000000');
    expect(found).toBeUndefined();
  });
});

async function scope(
  db: Db,
  actor: Awaited<ReturnType<typeof seedSecurityAdmin>>,
): Promise<StaffScope<'AI_SETTINGS_MANAGE'>> {
  const staff = await staffPrincipal(db, actor, 'AI_SETTINGS_MANAGE');
  if (!staff.ok) throw new Error('staff scope');
  return staff.value;
}

/** What a caller without the role would have to pass: not a genuine scope. */
const NOT_A_SCOPE = {
  kind: 'staff',
  accountId: 'x',
} as unknown as StaffScope<'AI_SETTINGS_MANAGE'>;

/** Edits a draft as the security admin: the scope is fetched for each call. */
async function editDraft(
  db: Db,
  actor: Awaited<ReturnType<typeof seedSecurityAdmin>>,
  input: Parameters<typeof updateDraftAiProviderConfig>[2],
) {
  return updateDraftAiProviderConfig(db, await scope(db, actor), input);
}

async function deleteDraft(
  db: Db,
  actor: Awaited<ReturnType<typeof seedSecurityAdmin>>,
  input: Parameters<typeof deleteDraftAiProviderConfig>[2],
) {
  return deleteDraftAiProviderConfig(db, await scope(db, actor), input);
}

/** The edit form sends the whole configuration; this is a full edit of a draft from `draftInput`. */
function editInput(
  configId: string,
  overrides: Partial<Parameters<typeof updateDraftAiProviderConfig>[2]> = {},
): Parameters<typeof updateDraftAiProviderConfig>[2] {
  return {
    stepUpSatisfied: true,
    configId,
    encryption,
    model: 'gpt-5.7-edited',
    dataPolicyApproved: true,
    budgetLimitUnits: 3_000_000,
    ...overrides,
  };
}

/** The audit metadata fields these tests read. */
interface AuditMetadata {
  readonly changed?: unknown;
  readonly keyReplaced?: unknown;
  readonly keyCopiedFromConfigId?: unknown;
  readonly termsCleared?: unknown;
  readonly sameKeyAsConfigId?: unknown;
}

async function auditOf(db: Db, eventType: string) {
  return db.select().from(schema.auditEvents).where(eq(schema.auditEvents.eventType, eventType));
}

describe('AI provider configuration -- editing a draft in place', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('changes the settings, keeps the saved key when none is entered, and audits what changed without values', async () => {
    const actor = await seedSecurityAdmin(db);
    const draft = await createDraftAiProviderConfig(
      db,
      draftInput(actor, { provider: 'anthropic', apiKey: 'sk-ant-keep-1111', notes: 'old' }),
    );
    if (!isOk(draft)) throw new Error('draft');

    const edited = await editDraft(
      db,
      actor,
      editInput(draft.value.id, {
        model: 'claude-sonnet-5-5',
        reasoningEffort: 'low',
        notes: 'new notes',
      }),
    );
    expect(isOk(edited)).toBe(true);
    if (!isOk(edited)) return;
    expect(edited.value.id).toBe(draft.value.id);
    expect(edited.value.status).toBe('DRAFT');
    expect(edited.value.provider).toBe('anthropic');
    expect(edited.value.model).toBe('claude-sonnet-5-5');
    expect(edited.value.reasoningEffort).toBe('low');
    expect(edited.value.budgetLimitUnits).toBe(3_000_000);
    expect(edited.value.notes).toBe('new notes');
    expect(edited.value.apiKeyFingerprint).toBe('...1111');
    expect(await revealAiProviderApiKey(db, encryption, edited.value)).toBe('sk-ant-keep-1111');

    const [event] = await auditOf(db, 'AI_PROVIDER_CONFIG_UPDATED');
    expect(event?.resourceId).toBe(draft.value.id);
    const metadata = event?.metadata as AuditMetadata;
    expect(metadata.keyReplaced).toBe(false);
    expect(metadata.changed).toEqual(
      expect.arrayContaining(['model', 'budgetLimitUnits', 'reasoningEffort', 'notes']),
    );
    expect(JSON.stringify(metadata)).not.toContain('sk-ant');
    expect(JSON.stringify(metadata)).not.toContain('new notes');
  });

  it('replaces the key when a new one is entered, encrypted for the same row', async () => {
    const actor = await seedSecurityAdmin(db);
    const draft = await createDraftAiProviderConfig(
      db,
      draftInput(actor, { apiKey: 'sk-old-1111' }),
    );
    if (!isOk(draft)) throw new Error('draft');

    const edited = await editDraft(
      db,
      actor,
      editInput(draft.value.id, { apiKey: ' sk-new-2222 ' }),
    );
    if (!isOk(edited)) throw new Error('edit');
    expect(edited.value.apiKeyFingerprint).toBe('...2222');
    expect(await revealAiProviderApiKey(db, encryption, edited.value)).toBe('sk-new-2222');
    const [event] = await auditOf(db, 'AI_PROVIDER_CONFIG_UPDATED');
    expect((event?.metadata as AuditMetadata).keyReplaced).toBe(true);
    expect(JSON.stringify(event?.metadata)).not.toContain('sk-new');
  });

  it('clears an optional setting left blank, since the form sends the whole configuration', async () => {
    const actor = await seedSecurityAdmin(db);
    const draft = await createDraftAiProviderConfig(db, {
      ...draftInput(actor, { notes: 'to clear' }),
      reasoningEffort: 'high',
      maxPagesPerDocument: 10,
    });
    if (!isOk(draft)) throw new Error('draft');
    const edited = await editDraft(db, actor, editInput(draft.value.id));
    if (!isOk(edited)) throw new Error('edit');
    expect(edited.value.reasoningEffort).toBeNull();
    expect(edited.value.maxPagesPerDocument).toBeNull();
    expect(edited.value.notes).toBeNull();
  });

  it('refuses to edit anything but a draft, leaving the record of what ran untouched', async () => {
    const actor = await seedSecurityAdmin(db);
    const draft = await createDraftAiProviderConfig(db, draftInput(actor));
    if (!isOk(draft)) throw new Error('draft');
    await activateAiProviderConfig(db, { actor, stepUpSatisfied: true, configId: draft.value.id });

    const edited = await editDraft(db, actor, editInput(draft.value.id));
    expect(isErr(edited) && edited.error.code).toBe('invalid');
    const after = await getAiProviderConfigById(db, actor, draft.value.id);
    expect(isOk(after) && after.value.model).toBe('gpt-5.6-terra');
    expect(await auditOf(db, 'AI_PROVIDER_CONFIG_UPDATED')).toHaveLength(0);
  });

  it('refuses a draft as its own fallback, a stranger, and a request without step-up', async () => {
    const actor = await seedSecurityAdmin(db);
    // A stranger cannot obtain the scope at all; a forged one is refused below.
    expect((await staffPrincipal(db, await seedStranger(db), 'AI_SETTINGS_MANAGE')).ok).toBe(false);
    const draft = await createDraftAiProviderConfig(db, draftInput(actor));
    if (!isOk(draft)) throw new Error('draft');

    const self = await editDraft(
      db,
      actor,
      editInput(draft.value.id, {
        fallbackEnabled: true,
        fallbackProviderConfigId: draft.value.id,
      }),
    );
    expect(isErr(self) && self.error.code).toBe('invalid');
    const denied = await updateDraftAiProviderConfig(db, NOT_A_SCOPE, editInput(draft.value.id));
    expect(isErr(denied) && denied.error.code).toBe('forbidden');
    const noStepUp = await editDraft(db, actor, {
      ...editInput(draft.value.id),
      stepUpSatisfied: false,
    });
    expect(isErr(noStepUp) && noStepUp.error.code).toBe('step_up_required');
  });
});

describe('AI provider configuration -- Edit as New Draft (reusing a saved key)', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('copies the key of an active configuration into a new draft, encrypted again for the new row', async () => {
    const actor = await seedSecurityAdmin(db);
    const source = await createDraftAiProviderConfig(
      db,
      draftInput(actor, { provider: 'anthropic', apiKey: 'sk-ant-copy-3333' }),
    );
    if (!isOk(source)) throw new Error('source');
    await activateAiProviderConfig(db, { actor, stepUpSatisfied: true, configId: source.value.id });

    const copy = await createDraftAiProviderConfig(db, {
      ...draftInput(actor, { provider: 'anthropic', apiKey: '' }),
      model: 'claude-opus-5-5',
      copyApiKeyFromConfigId: source.value.id,
    });
    expect(isOk(copy)).toBe(true);
    if (!isOk(copy)) return;
    expect(copy.value.id).not.toBe(source.value.id);
    expect(copy.value.status).toBe('DRAFT');
    expect(copy.value.apiKeyFingerprint).toBe('...3333');
    expect(await revealAiProviderApiKey(db, encryption, copy.value)).toBe('sk-ant-copy-3333');
    expect(
      Buffer.from(copy.value.apiKeyCiphertext).equals(Buffer.from(source.value.apiKeyCiphertext)),
    ).toBe(false);

    const events = await auditOf(db, 'AI_PROVIDER_CONFIG_CREATED');
    const copied = events.find((e) => e.resourceId === copy.value.id);
    expect((copied?.metadata as AuditMetadata).keyCopiedFromConfigId).toBe(source.value.id);
    // The source is part of the record and stays exactly as it was.
    const after = await getAiProviderConfigById(db, actor, source.value.id);
    expect(isOk(after) && after.value.status).toBe('ACTIVE');
  });

  it('refuses to reuse a revoked key or a key from another provider', async () => {
    const actor = await seedSecurityAdmin(db);
    const source = await createDraftAiProviderConfig(db, draftInput(actor, { provider: 'openai' }));
    if (!isOk(source)) throw new Error('source');

    const crossProvider = await createDraftAiProviderConfig(db, {
      ...draftInput(actor, { provider: 'anthropic', apiKey: '' }),
      copyApiKeyFromConfigId: source.value.id,
    });
    expect(isErr(crossProvider) && crossProvider.error.code).toBe('invalid');

    await revokeAiProviderConfigKey(db, {
      actor,
      stepUpSatisfied: true,
      configId: source.value.id,
    });
    const revoked = await createDraftAiProviderConfig(db, {
      ...draftInput(actor, { provider: 'openai', apiKey: '' }),
      copyApiKeyFromConfigId: source.value.id,
    });
    expect(isErr(revoked) && revoked.error.code).toBe('invalid');
    expect(await auditOf(db, 'AI_PROVIDER_CONFIG_CREATED')).toHaveLength(1);
  });
});

describe('AI provider configuration -- deleting a draft', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('deletes a draft with its key and data terms, and audits the deletion with nothing derived from the key', async () => {
    const actor = await seedSecurityAdmin(db);
    await createDraftAiProviderConfig(db, draftInput(actor, { apiKey: 'sk-kept-5555' }));
    const draft = await createDraftAiProviderConfig(
      db,
      draftInput(actor, { apiKey: 'sk-gone-4444' }),
    );
    if (!isOk(draft)) throw new Error('draft');
    await db.insert(schema.aiProviderConfigTerms).values({
      configId: draft.value.id,
      tier: 'PAID',
      trainsOnInputs: 'NO',
      termsUrl: 'https://example.com/terms',
      checkedOn: '2026-10-30',
    });

    const deleted = await deleteDraft(db, actor, {
      stepUpSatisfied: true,
      configId: draft.value.id,
    });
    expect(isOk(deleted)).toBe(true);
    const lookup = await getAiProviderConfigById(db, actor, draft.value.id);
    expect(isErr(lookup) && lookup.error.code).toBe('not_found');
    expect(await db.select().from(schema.aiProviderConfigTerms)).toHaveLength(0);

    const [event] = await auditOf(db, 'AI_PROVIDER_CONFIG_DELETED');
    expect(event?.resourceId).toBe(draft.value.id);
    expect(event?.metadata).toEqual({ provider: 'openai', model: 'gpt-5.6-terra' });
    expect(JSON.stringify(event?.metadata)).not.toContain('sk-gone');
  });

  it('refuses to delete anything but a draft', async () => {
    const actor = await seedSecurityAdmin(db);
    const draft = await createDraftAiProviderConfig(db, draftInput(actor));
    if (!isOk(draft)) throw new Error('draft');
    await activateAiProviderConfig(db, { actor, stepUpSatisfied: true, configId: draft.value.id });

    const deleted = await deleteDraft(db, actor, {
      stepUpSatisfied: true,
      configId: draft.value.id,
    });
    expect(isErr(deleted) && deleted.error.code).toBe('invalid');
    expect(isOk(await getAiProviderConfigById(db, actor, draft.value.id))).toBe(true);
  });

  it('refuses while another configuration names the draft as its fallback', async () => {
    const actor = await seedSecurityAdmin(db);
    const target = await createDraftAiProviderConfig(db, draftInput(actor, { provider: 'gemini' }));
    if (!isOk(target)) throw new Error('target');
    const user = await createDraftAiProviderConfig(
      db,
      draftInput(actor, { fallbackEnabled: true, fallbackProviderConfigId: target.value.id }),
    );
    if (!isOk(user)) throw new Error('user');

    const whileDraft = await deleteDraft(db, actor, {
      stepUpSatisfied: true,
      configId: target.value.id,
    });
    expect(isErr(whileDraft) && whileDraft.error.message).toContain(
      'change or delete that draft first',
    );

    // Once the version using it has run, it is history and can never be changed: say so.
    await activateAiProviderConfig(db, { actor, stepUpSatisfied: true, configId: user.value.id });
    const afterRun = await deleteDraft(db, actor, {
      stepUpSatisfied: true,
      configId: target.value.id,
    });
    expect(isErr(afterRun) && afterRun.error.message).toContain('stays in the history');
    expect(isOk(await getAiProviderConfigById(db, actor, target.value.id))).toBe(true);
  });

  it('refuses to delete the only saved configuration, which would hand reading back to the deployment settings', async () => {
    const actor = await seedSecurityAdmin(db);
    const only = await createDraftAiProviderConfig(db, draftInput(actor));
    if (!isOk(only)) throw new Error('draft');
    const deleted = await deleteDraft(db, actor, {
      stepUpSatisfied: true,
      configId: only.value.id,
    });
    expect(isErr(deleted) && deleted.error.message).toContain('only saved configuration');
    expect(await isAiDispatchAllowed(db)).toBe(false);
  });

  it('refuses a stranger and a request without step-up, and reports a missing draft', async () => {
    const actor = await seedSecurityAdmin(db);
    const stranger = await seedStranger(db);
    const draft = await createDraftAiProviderConfig(db, draftInput(actor));
    if (!isOk(draft)) throw new Error('draft');

    expect((await staffPrincipal(db, stranger, 'AI_SETTINGS_MANAGE')).ok).toBe(false);
    const denied = await deleteDraftAiProviderConfig(db, NOT_A_SCOPE, {
      stepUpSatisfied: true,
      configId: draft.value.id,
    });
    expect(isErr(denied) && denied.error.code).toBe('forbidden');
    const noStepUp = await deleteDraft(db, actor, {
      stepUpSatisfied: false,
      configId: draft.value.id,
    });
    expect(isErr(noStepUp) && noStepUp.error.code).toBe('step_up_required');
    const missing = await deleteDraft(db, actor, {
      stepUpSatisfied: true,
      configId: '00000000-0000-4000-8000-000000000000',
    });
    expect(isErr(missing) && missing.error.code).toBe('not_found');
  });
});

describe('AI provider configuration -- what editing and revoking protect', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('clears the draft data terms when its key is replaced, since a new key may be another account', async () => {
    const actor = await seedSecurityAdmin(db);
    const draft = await createDraftAiProviderConfig(db, draftInput(actor));
    if (!isOk(draft)) throw new Error('draft');
    await db.insert(schema.aiProviderConfigTerms).values({
      configId: draft.value.id,
      tier: 'PAID',
      trainsOnInputs: 'NO',
      termsUrl: 'https://example.com/terms',
      checkedOn: '2026-10-30',
    });

    await editDraft(db, actor, editInput(draft.value.id));
    expect(await db.select().from(schema.aiProviderConfigTerms)).toHaveLength(1);

    await editDraft(db, actor, editInput(draft.value.id, { apiKey: 'sk-other' }));
    expect(await db.select().from(schema.aiProviderConfigTerms)).toHaveLength(0);
    const events = await auditOf(db, 'AI_PROVIDER_CONFIG_UPDATED');
    const flags = events.map((e) => (e.metadata as AuditMetadata).termsCleared).sort();
    expect(flags).toEqual([false, true]);
  });

  it('refuses to edit a draft whose key was revoked', async () => {
    const actor = await seedSecurityAdmin(db);
    const draft = await createDraftAiProviderConfig(db, draftInput(actor));
    if (!isOk(draft)) throw new Error('draft');
    await revokeAiProviderConfigKey(db, { actor, stepUpSatisfied: true, configId: draft.value.id });
    const edited = await editDraft(db, actor, editInput(draft.value.id, { apiKey: 'sk-fresh' }));
    expect(isErr(edited) && edited.error.message).toContain('revoked');
  });

  it('refuses to edit a draft that a version which has run falls back to, but allows it while only drafts point at it', async () => {
    const actor = await seedSecurityAdmin(db);
    const fallback = await createDraftAiProviderConfig(
      db,
      draftInput(actor, { provider: 'anthropic' }),
    );
    if (!isOk(fallback)) throw new Error('fallback');
    const primary = await createDraftAiProviderConfig(
      db,
      draftInput(actor, { fallbackEnabled: true, fallbackProviderConfigId: fallback.value.id }),
    );
    if (!isOk(primary)) throw new Error('primary');

    expect(
      isOk(
        await editDraft(db, actor, editInput(fallback.value.id, { model: 'claude-sonnet-5-5' })),
      ),
    ).toBe(true);
    await activateAiProviderConfig(db, {
      actor,
      stepUpSatisfied: true,
      configId: primary.value.id,
    });
    const edited = await editDraft(
      db,
      actor,
      editInput(fallback.value.id, { model: 'claude-sonnet-5-5' }),
    );
    expect(isErr(edited) && edited.error.message).toContain('fallback');
  });

  it('revokes every copy of a key with it, disabling an active copy, and leaves other keys alone', async () => {
    const actor = await seedSecurityAdmin(db);
    const original = await createDraftAiProviderConfig(
      db,
      draftInput(actor, { provider: 'anthropic', apiKey: 'sk-ant-shared-7777' }),
    );
    if (!isOk(original)) throw new Error('original');
    const copy = await createDraftAiProviderConfig(db, {
      ...draftInput(actor, { provider: 'anthropic', apiKey: '' }),
      copyApiKeyFromConfigId: original.value.id,
    });
    if (!isOk(copy)) throw new Error('copy');
    // Same last four characters, different key: must not be revoked.
    const lookalike = await createDraftAiProviderConfig(
      db,
      draftInput(actor, { provider: 'anthropic', apiKey: 'sk-ant-other-7777' }),
    );
    if (!isOk(lookalike)) throw new Error('lookalike');
    await activateAiProviderConfig(db, { actor, stepUpSatisfied: true, configId: copy.value.id });

    const revoked = await revokeAiProviderConfigKey(db, {
      actor,
      stepUpSatisfied: true,
      configId: original.value.id,
      encryption,
    });
    expect(isOk(revoked)).toBe(true);
    const read = async (id: string) => {
      const row = await getAiProviderConfigById(db, actor, id);
      if (!isOk(row)) throw new Error('read');
      return row.value;
    };
    expect((await read(original.value.id)).keyRevokedAt).not.toBeNull();
    const copyAfter = await read(copy.value.id);
    expect(copyAfter.keyRevokedAt).not.toBeNull();
    expect(copyAfter.status).toBe('DISABLED');
    expect((await read(lookalike.value.id)).keyRevokedAt).toBeNull();

    const events = await auditOf(db, 'AI_PROVIDER_CONFIG_KEY_REVOKED');
    const forCopy = events.find((e) => e.resourceId === copy.value.id);
    expect((forCopy?.metadata as AuditMetadata).sameKeyAsConfigId).toBe(original.value.id);
  });

  it('asking again on an already-revoked key still catches a copy of it', async () => {
    const actor = await seedSecurityAdmin(db);
    const original = await createDraftAiProviderConfig(
      db,
      draftInput(actor, { apiKey: 'sk-x-8888' }),
    );
    if (!isOk(original)) throw new Error('original');
    const copy = await createDraftAiProviderConfig(db, {
      ...draftInput(actor, { apiKey: '' }),
      copyApiKeyFromConfigId: original.value.id,
    });
    if (!isOk(copy)) throw new Error('copy');
    // A revoke without the key service revokes only that row.
    await revokeAiProviderConfigKey(db, {
      actor,
      stepUpSatisfied: true,
      configId: original.value.id,
    });
    const before = await getAiProviderConfigById(db, actor, copy.value.id);
    expect(isOk(before) && before.value.keyRevokedAt).toBeNull();

    await revokeAiProviderConfigKey(db, {
      actor,
      stepUpSatisfied: true,
      configId: original.value.id,
      encryption,
    });
    const after = await getAiProviderConfigById(db, actor, copy.value.id);
    expect(isOk(after) && after.value.keyRevokedAt).not.toBeNull();
  });
});

describe('AI provider configuration -- the model must be an exact model ID of the provider', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('refuses a display name or anything that is not a model ID, on create and on edit', async () => {
    const actor = await seedSecurityAdmin(db);
    for (const model of ['Claude 5.5', 'claude opus', 'models/gpt', 'x'.repeat(101)]) {
      const created = await createDraftAiProviderConfig(db, { ...draftInput(actor), model });
      expect(isErr(created) && created.error.message).toContain('exact model ID');
    }
    const draft = await createDraftAiProviderConfig(db, draftInput(actor));
    if (!isOk(draft)) throw new Error('draft');
    const edited = await editDraft(db, actor, editInput(draft.value.id, { model: 'Claude 5.5' }));
    expect(isErr(edited) && edited.error.message).toContain('exact model ID');
  });

  it("accepts the provider's own IDs and unknown families, and refuses another provider's model", async () => {
    const actor = await seedSecurityAdmin(db);
    // draftInput is OpenAI: its own ID, a fine-tuned one, and a new family are saved.
    for (const model of ['gpt-5.6-terra', 'ft:gpt-5:org:x', 'o9-reasoner']) {
      expect(isOk(await createDraftAiProviderConfig(db, { ...draftInput(actor), model }))).toBe(
        true,
      );
    }
    const crossed = await createDraftAiProviderConfig(db, {
      ...draftInput(actor, { provider: 'gemini' }),
      model: 'claude-opus-5-5',
    });
    expect(isErr(crossed) && crossed.error.message).toContain('Anthropic model');
    // Gemini puts the ID in its request path, so no colon there.
    const colon = await createDraftAiProviderConfig(db, {
      ...draftInput(actor, { provider: 'gemini' }),
      model: 'gemini-3.5-flash:latest',
    });
    expect(isErr(colon) && colon.error.message).toContain('exact model ID');

    const draft = await createDraftAiProviderConfig(db, draftInput(actor));
    if (!isOk(draft)) throw new Error('draft');
    const crossedEdit = await editDraft(
      db,
      actor,
      editInput(draft.value.id, { model: 'gemini-3.8-flash' }),
    );
    expect(isErr(crossedEdit) && crossedEdit.error.message).toContain('Google Gemini model');
  });
});
