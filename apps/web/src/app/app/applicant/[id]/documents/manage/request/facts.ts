import 'server-only';
import {
  type AuthorizedApplicant,
  type Db,
  documentBlockedByLegalHold,
  hasActiveLegalHold,
  pendingRemovalRequests,
} from '@visastack/services';
import { documentRemovalRequestsOn } from '../../../../../../../lib/env';

/** The facts lane D owns for `availableDocumentActions` (PROGRAMME 3.2), for one document. */
export interface RemovalRequestFacts {
  readonly pendingRequest: boolean;
  readonly legalHold: boolean;
  readonly requestsSwitchOn: boolean;
}

/**
 * Whether each document has a waiting removal request, whether a legal hold covers it, and
 * whether removal requests are switched on, through the owner's own proof. With the switch off
 * no hold is read (it only decides whether a request is offered) and a waiting request still
 * shows, so it can be cancelled. Most records have no hold at all, so one applicant-wide check
 * comes first and the per-document check runs only when a hold exists.
 */
export async function removalRequestFacts(
  db: Db,
  access: AuthorizedApplicant<'VIEW_METADATA'>,
  applicantId: string,
  documentIds: readonly string[],
): Promise<ReadonlyMap<string, RemovalRequestFacts>> {
  const requestsSwitchOn = documentRemovalRequestsOn();
  const pending = await pendingRemovalRequests(access, documentIds);
  const anyHold = requestsSwitchOn && (await hasActiveLegalHold(db, applicantId));
  const facts = new Map<string, RemovalRequestFacts>();
  for (const documentId of documentIds) {
    const legalHold = anyHold
      ? await documentBlockedByLegalHold(db, { applicantId, documentId })
      : false;
    facts.set(documentId, {
      pendingRequest: pending.has(documentId.toLowerCase()),
      legalHold,
      requestsSwitchOn,
    });
  }
  return facts;
}
