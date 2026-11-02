/**
 * UMPE P11: the publish hook. Kept apart from umpe-rule-impact-service.ts so packs.ts can call it
 * without an import cycle (the service reads pack differences from packs.ts).
 */
import type { Db } from './db';
import { schema } from './db';
import { ruleImpactTablesPresent } from './umpe-correction-tables';

/**
 * Records, inside the publish transaction, that a newly published version needs its impact
 * assessed. Reads and writes no person data, so publishing stays exactly as fast and as safe as
 * before; before the migration runs it does nothing. Publishing the same version again (it cannot
 * be, but a retry could) records nothing new.
 */
export async function queueRuleImpact(
  tx: Db,
  input: { readonly packId: string; readonly packVersionId: string },
): Promise<void> {
  if (!(await ruleImpactTablesPresent(tx))) return;
  await tx
    .insert(schema.umpeRuleImpactRuns)
    .values({ packId: input.packId, packVersionId: input.packVersionId })
    .onConflictDoNothing({ target: schema.umpeRuleImpactRuns.packVersionId });
}
