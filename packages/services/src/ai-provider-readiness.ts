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
 * - `active`: the one ACTIVE configuration: whether its key is usable (stored and not revoked)
 *   and whether its provider data terms have been recorded (`ai_provider_config_terms`, the same
 *   "recorded" meaning as `loadAiProviderDataTerms`). `fallback` matches what the web gateway's
 *   `resolveFallbackExtractor` would really send documents to: it is set only when the fallback
 *   is switched on AND its target would be used (it exists, is a different provider the app can
 *   call, has an approved data policy and a usable key), and then says whether that target's
 *   terms are recorded. A fallback the gateway would treat as absent is null: nothing is sent
 *   there, so it cannot fail the gate.
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
      readonly fallback: { readonly termsRecorded: boolean } | null;
    }
  | { readonly kind: 'unreadable' };

/**
 * Platform-internal read, the same trust level as `getActiveAiProviderConfig`: no applicant
 * data is touched, and only the columns the answer needs are selected (never the key itself:
 * its stored length is enough). Plain reads only, no transaction, because the readiness probe
 * uses the stateless database client, which cannot open one; call it outside a transaction.
 * Never throws. Only the missing-table case is quiet.
 */
export async function loadAiProviderReadiness(
  db: Db,
  options: {
    /** Providers the web gateway can call (`IMPLEMENTED_PROVIDERS` in apps/web/src/lib/ai.ts). */
    readonly implementedProviders: ReadonlySet<string>;
  },
): Promise<AiProviderReadinessState> {
  try {
    const configs = schema.aiProviderConfigs;
    const anyConfig = first(await db.select({ id: configs.id }).from(configs).limit(1));
    if (!anyConfig) return { kind: 'no_configuration' };
    const columns = {
      id: configs.id,
      provider: configs.provider,
      dataPolicyApproved: configs.dataPolicyApproved,
      keyUsable: sql<boolean>`(${configs.keyRevokedAt} is null and octet_length(${configs.apiKeyCiphertext}) > 0)`,
      fallbackEnabled: configs.fallbackEnabled,
      fallbackId: configs.fallbackProviderConfigId,
    };
    const active = first(
      await db.select(columns).from(configs).where(eq(configs.status, 'ACTIVE')).limit(1),
    );
    if (!active) return { kind: 'none_active' };
    const target =
      active.fallbackEnabled && active.fallbackId
        ? first(
            await db
              .select(columns)
              .from(configs)
              .where(eq(configs.id, active.fallbackId))
              .limit(1),
          )
        : undefined;
    // The same eligibility `resolveFallbackExtractor` checks before it would dispatch. Its last
    // check, the optional "do not train on inputs" rule, is not applied here: a usable fallback
    // without recorded terms fails the gate whether or not that rule is on.
    const fallback =
      target &&
      target.provider !== active.provider &&
      target.dataPolicyApproved &&
      target.keyUsable === true &&
      options.implementedProviders.has(target.provider)
        ? target
        : undefined;
    const ids = fallback ? [active.id, fallback.id] : [active.id];
    const withTerms = new Set(
      (
        await db
          .selectDistinct({ configId: schema.aiProviderConfigTerms.configId })
          .from(schema.aiProviderConfigTerms)
          .where(inArray(schema.aiProviderConfigTerms.configId, ids))
      ).map((row) => row.configId),
    );
    return {
      kind: 'active',
      primary: { hasKey: active.keyUsable === true, termsRecorded: withTerms.has(active.id) },
      fallback: fallback ? { termsRecorded: withTerms.has(fallback.id) } : null,
    };
  } catch (error) {
    if (!isMissingRelationError(error)) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[ai-provider-readiness] AI settings could not be read: ${message}`);
    }
    return { kind: 'unreadable' };
  }
}
