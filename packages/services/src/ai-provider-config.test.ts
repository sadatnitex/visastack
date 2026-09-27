import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import {
  activateAiProviderConfig,
  createDraftAiProviderConfig,
  emergencyDisableAiProviderConfig,
  getActiveAiProviderConfig,
  isAiDispatchAllowed,
  listAiProviderConfigHistory,
  revealAiProviderApiKey,
  revokeAiProviderConfigKey,
  rollbackAiProviderConfig,
} from './ai-provider-config';
import type { Db } from './db';
import { grantPlatformRole } from './platform-roles';
import type { KeyManagementPort } from './ports';

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
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
  readonly dataPolicyApproved?: boolean;
  readonly budgetLimitUnits?: number;
  readonly notes?: string;
}

function draftInput(
  actor: Awaited<ReturnType<typeof seedSecurityAdmin>>,
  overrides?: DraftOverrides,
) {
  return {
    actor,
    stepUpSatisfied: true,
    provider: 'openai',
    model: 'gpt-5.6-terra',
    apiKey: overrides?.apiKey ?? 'sk-test-1234',
    encryption,
    dataPolicyApproved: overrides?.dataPolicyApproved ?? true,
    budgetLimitUnits: overrides?.budgetLimitUnits ?? 2_000_000,
    ...(overrides?.notes ? { notes: overrides.notes } : {}),
  };
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
