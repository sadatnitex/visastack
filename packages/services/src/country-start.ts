import { destinationByIso2 } from '@visastack/core/destinations';
import type { Db } from './db';
import { recordProductEvent } from './product-events';

/**
 * First run's country step (Growth G2). A signed-in person confirmed the country they want a
 * checklist for. This writes one product event and nothing else: the label is the country's
 * two-letter code (a closed list, see `product-events.ts`), there is no name, no free text and no
 * other detail, and it happens at most once per account however often the step is confirmed.
 *
 * Only a signed-in account reaches this. A visitor who has not signed up is never recorded.
 *
 * Returns whether the code names a country we hold (false records nothing).
 */
export async function recordCountryChecklistStarted(
  db: Db,
  input: { readonly accountId: string; readonly iso2: string },
): Promise<boolean> {
  const destination = destinationByIso2(input.iso2);
  if (!destination) return false;
  await recordProductEvent(db, {
    eventType: 'COUNTRY_CHECKLIST_STARTED',
    accountId: input.accountId,
    dimension: destination.iso2,
    onceFor: input.accountId,
  });
  return true;
}
