import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAiProviderReadiness } from './ai-provider-readiness';
import type { Db } from './db';

/**
 * The database half of the commercial readiness AI provider gate (S27): which configuration is
 * ACTIVE, whether its key is usable and whether its provider data terms were recorded. A missing
 * table reads as unreadable, quietly, and the gate then fails closed.
 */

let db: Db;

beforeEach(async () => {
  const client = await createMigratedPglite();
  db = drizzle(client, { schema }) as unknown as Db;
});

async function seedConfig(
  status: 'DRAFT' | 'ACTIVE',
  options: { revoked?: boolean } = {},
): Promise<string> {
  const [row] = await db
    .insert(schema.aiProviderConfigs)
    .values({
      status,
      provider: 'gemini',
      model: 'gemini-test',
      apiKeyCiphertext: new Uint8Array([1, 2, 3, 4]),
      apiKeyNonce: new Uint8Array(12),
      apiKeyVersion: 'v1',
      apiKeyFingerprint: '...1234',
      dataPolicyApproved: true,
      budgetLimitUnits: 1000,
      ...(status === 'ACTIVE' ? { activatedAt: new Date() } : {}),
      ...(options.revoked ? { keyRevokedAt: new Date() } : {}),
    })
    .returning({ id: schema.aiProviderConfigs.id });
  if (!row) throw new Error('seed config');
  return row.id;
}

async function recordTerms(configId: string): Promise<void> {
  await db.insert(schema.aiProviderConfigTerms).values({
    configId,
    tier: 'PAID',
    trainsOnInputs: 'NO',
    termsUrl: 'https://provider.example.test/terms',
    checkedOn: '2026-10-20',
  });
}

describe('loadAiProviderReadiness', () => {
  it('reports a fresh install, where the environment decides, when nothing was ever saved', async () => {
    expect(await loadAiProviderReadiness(db)).toEqual({ kind: 'no_configuration' });
  });

  it('reports dispatch off when configurations exist but none is active', async () => {
    const draft = await seedConfig('DRAFT');
    await recordTerms(draft);
    expect(await loadAiProviderReadiness(db)).toEqual({ kind: 'none_active' });
  });

  it('reports an active configuration with a key and recorded terms', async () => {
    await recordTerms(await seedConfig('ACTIVE'));
    expect(await loadAiProviderReadiness(db)).toEqual({
      kind: 'active',
      hasKey: true,
      termsRecorded: true,
    });
  });

  it('reports a key without terms', async () => {
    const active = await seedConfig('ACTIVE');
    // Terms recorded for another configuration do not count for the active one.
    await recordTerms(await seedConfig('DRAFT'));
    expect(await loadAiProviderReadiness(db)).toEqual({
      kind: 'active',
      hasKey: true,
      termsRecorded: false,
    });
    await recordTerms(active);
    expect(await loadAiProviderReadiness(db)).toMatchObject({ termsRecorded: true });
  });

  it('reports terms without a usable key once the key is revoked', async () => {
    await recordTerms(await seedConfig('ACTIVE', { revoked: true }));
    expect(await loadAiProviderReadiness(db)).toEqual({
      kind: 'active',
      hasKey: false,
      termsRecorded: true,
    });
  });

  it('reads as unreadable, quietly, while the terms table is missing', async () => {
    await seedConfig('ACTIVE');
    await db.execute(sql`drop table ai_provider_config_terms`);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await loadAiProviderReadiness(db)).toEqual({ kind: 'unreadable' });
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('reads as unreadable, quietly, while the configuration table is missing', async () => {
    await db.execute(sql`drop table ai_provider_configs cascade`);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await loadAiProviderReadiness(db)).toEqual({ kind: 'unreadable' });
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('reports any other read failure, without a value, and still answers unreadable', async () => {
    const broken = {
      select: () => {
        throw new Error('connection reset');
      },
    } as unknown as Db;
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await loadAiProviderReadiness(broken)).toEqual({ kind: 'unreadable' });
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it('never returns key material, a provider name or a model', async () => {
    await recordTerms(await seedConfig('ACTIVE'));
    const text = JSON.stringify(await loadAiProviderReadiness(db));
    expect(text).not.toContain('gemini');
    expect(text).not.toContain('1234');
    const [config] = await db
      .select({ id: schema.aiProviderConfigs.id })
      .from(schema.aiProviderConfigs)
      .where(eq(schema.aiProviderConfigs.status, 'ACTIVE'));
    expect(config && text.includes(config.id)).toBe(false);
  });
});
