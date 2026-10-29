import { eq } from 'drizzle-orm';
import { getActiveAiProviderConfig, hasAnyAiProviderConfig } from './ai-provider-config';
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
 * - `active`: the one ACTIVE configuration, with whether its key is usable (stored and
 *   not revoked) and whether its provider data terms have been recorded
 *   (`ai_provider_config_terms`, the same "recorded" meaning as `loadAiProviderDataTerms`).
 * - `unreadable`: a table is missing or the read failed; the gate is then not satisfied.
 *
 * Never carries a key, a fingerprint, a provider name or a model: only these flags.
 */
export type AiProviderReadinessState =
  | { readonly kind: 'no_configuration' }
  | { readonly kind: 'none_active' }
  | { readonly kind: 'active'; readonly hasKey: boolean; readonly termsRecorded: boolean }
  | { readonly kind: 'unreadable' };

/**
 * Platform-internal read, the same trust level as `getActiveAiProviderConfig`: no applicant
 * data is touched. Plain reads only, no transaction, because the readiness probe uses the
 * stateless database client, which cannot open one; call it outside a transaction. Never
 * throws. Only the missing-table case is quiet.
 */
export async function loadAiProviderReadiness(db: Db): Promise<AiProviderReadinessState> {
  try {
    if (!(await hasAnyAiProviderConfig(db))) return { kind: 'no_configuration' };
    const config = await getActiveAiProviderConfig(db);
    if (!config) return { kind: 'none_active' };
    const terms = first(
      await db
        .select({ id: schema.aiProviderConfigTerms.id })
        .from(schema.aiProviderConfigTerms)
        .where(eq(schema.aiProviderConfigTerms.configId, config.id))
        .limit(1),
    );
    return {
      kind: 'active',
      hasKey: config.keyRevokedAt === null && config.apiKeyCiphertext.length > 0,
      termsRecorded: terms !== undefined,
    };
  } catch (error) {
    if (!isMissingRelationError(error)) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[ai-provider-readiness] AI settings could not be read: ${message}`);
    }
    return { kind: 'unreadable' };
  }
}
