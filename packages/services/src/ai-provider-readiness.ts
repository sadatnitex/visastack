import { eq, inArray, sql } from 'drizzle-orm';
import { type Db, first, schema } from './db';
import { isMissingRelationError } from './missing-relation';

/**
 * What the database says about AI providers, for the commercial readiness gate
 * `productionAiProvider` (S27, M19). It answers only the database half; the web app
 * combines it with the environment switch that governs a fresh install.
 *
 * - `no_configuration`: no one has ever saved an AI configuration, so the environment
 *   decides whether AI runs (the fresh-install path in apps/web/src/lib/ai.ts).
 * - `none_active`: configurations exist but none is ACTIVE, so AI dispatch is off
 *   (the kill switch, `isAiDispatchAllowed`).
 * - `active`: the one ACTIVE configuration, and, when its fallback is switched on, the
 *   fallback configuration documents can also be sent to (`resolveFallbackExtractor` and
 *   `resolveOcrAdapter`). For each: whether its key is usable (stored and not revoked) and
 *   whether its provider data terms have been recorded (`ai_provider_config_terms`, the
 *   same "recorded" meaning as `loadAiProviderDataTerms`). `fallback` is null when the
 *   fallback is off and `missing` when it is on but names no configuration that exists.
 * - `unreadable`: a table is missing or the read failed; the gate is then not satisfied.
 *
 * Never carries a key, a fingerprint, a provider name, a model or an id: only these flags.
 */
export interface AiConfigReadiness {
  readonly hasKey: boolean;
  readonly termsRecorded: boolean;
}

export type AiProviderReadinessState =
  | { readonly kind: 'no_configuration' }
  | { readonly kind: 'none_active' }
  | {
      readonly kind: 'active';
      readonly primary: AiConfigReadiness;
      readonly fallback: AiConfigReadiness | 'missing' | null;
    }
  | { readonly kind: 'unreadable' };

/**
 * Platform-internal read, the same trust level as `getActiveAiProviderConfig`: no applicant
 * data is touched, and only the columns the answer needs are selected (never the key itself:
 * its stored length is enough). Plain reads only, no transaction, because the readiness probe
 * uses the stateless database client, which cannot open one; call it outside a transaction.
 * Never throws. Only the missing-table case is quiet.
 */
export async function loadAiProviderReadiness(db: Db): Promise<AiProviderReadinessState> {
  try {
    const configs = schema.aiProviderConfigs;
    const anyConfig = first(await db.select({ id: configs.id }).from(configs).limit(1));
    if (!anyConfig) return { kind: 'no_configuration' };
    const columns = {
      id: configs.id,
      keyUsable: sql<boolean>`(${configs.keyRevokedAt} is null and octet_length(${configs.apiKeyCiphertext}) > 0)`,
      fallbackEnabled: configs.fallbackEnabled,
      fallbackId: configs.fallbackProviderConfigId,
    };
    const active = first(
      await db.select(columns).from(configs).where(eq(configs.status, 'ACTIVE')).limit(1),
    );
    if (!active) return { kind: 'none_active' };
    const fallbackId = active.fallbackEnabled ? active.fallbackId : null;
    const fallback =
      fallbackId === null
        ? undefined
        : first(await db.select(columns).from(configs).where(eq(configs.id, fallbackId)).limit(1));
    const ids = fallback ? [active.id, fallback.id] : [active.id];
    const withTerms = new Set(
      (
        await db
          .selectDistinct({ configId: schema.aiProviderConfigTerms.configId })
          .from(schema.aiProviderConfigTerms)
          .where(inArray(schema.aiProviderConfigTerms.configId, ids))
      ).map((row) => row.configId),
    );
    const readinessOf = (row: { id: string; keyUsable: boolean }): AiConfigReadiness => ({
      hasKey: row.keyUsable === true,
      termsRecorded: withTerms.has(row.id),
    });
    return {
      kind: 'active',
      primary: readinessOf(active),
      fallback: fallbackId === null ? null : fallback ? readinessOf(fallback) : 'missing',
    };
  } catch (error) {
    if (!isMissingRelationError(error)) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[ai-provider-readiness] AI settings could not be read: ${message}`);
    }
    return { kind: 'unreadable' };
  }
}
