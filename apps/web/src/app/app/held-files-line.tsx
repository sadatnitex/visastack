import { type Db, countHeldFiles } from '@visastack/services';
import Link from 'next/link';
import { openOwnerGate } from '../../lib/owner-gate';

/** The one line's words: "1 File Needs a Person", "3 Files Need a Person". */
export function heldFilesLabel(count: number): string {
  return `${count} ${count === 1 ? 'File Needs' : 'Files Need'} a Person`;
}

/**
 * UMPE G4: how many family files wait for Which Person?, read through the owner gate for one of
 * the account's own people (the files belong to the account, so any of its people opens the same
 * list). Never throws: a refused or failed read counts none, and the line is simply not shown.
 */
export async function readHeldFileCount(
  db: Db,
  accountId: string,
  applicantId: string | undefined,
): Promise<number> {
  if (!applicantId) return 0;
  try {
    const gate = await openOwnerGate(db, accountId, applicantId);
    return gate ? await countHeldFiles(gate) : 0;
  } catch {
    return 0;
  }
}

/**
 * UMPE G4: one line on Home and on a traveller's Home while family files wait for Which Person?,
 * linking to the decision list. Nothing when there are none.
 */
export function HeldFilesLine({
  applicantId,
  count,
}: {
  readonly applicantId: string | undefined;
  readonly count: number;
}) {
  if (!applicantId || !(count > 0)) return null;
  return (
    <p className="umpe-g4-held-line">
      <Link href={`/app/applicant/${applicantId}/documents#needs-decision`}>
        {heldFilesLabel(count)}
      </Link>
    </p>
  );
}
