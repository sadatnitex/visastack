import 'server-only';
import { type Db, getMissionForOwner } from '@visastack/services';
import { isRecordId } from './record-id';

/** The case a page belongs to and the traveller who owns it, as the workspace frame needs them. */
export interface CaseSubject {
  readonly route: string;
  readonly applicantId: string;
}

const CASE_PATH = /^\/app\/mission\/([^/]+)(?:\/|$)/;

/**
 * The traveller behind a case page, for the first paint of the workspace sidebar.
 *
 * The address only chooses which record to check; it never grants anything. The same owner-scoped
 * read the case layout makes decides, so a case that is not this account's gives `null` exactly as
 * a missing case does (the neutral case frame, with no traveller's name or links), and an address
 * that is not a case, or whose id is not a record id (for example "start"), is not looked up at
 * all. Any failure also gives `null`: this only improves the first paint, and the case pages keep
 * their own checks.
 */
export async function caseSubjectFor(
  pathname: string | null | undefined,
  db: Db,
  accountId: string,
): Promise<CaseSubject | null> {
  const id = pathname ? CASE_PATH.exec(pathname)?.[1] : undefined;
  if (!id || !isRecordId(id)) return null;
  try {
    const mission = await getMissionForOwner(db, accountId, id);
    return mission.ok
      ? { route: `/app/mission/${id}`, applicantId: mission.value.applicantId }
      : null;
  } catch {
    return null;
  }
}
