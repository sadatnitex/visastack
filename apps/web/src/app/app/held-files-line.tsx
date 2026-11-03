import { countHeldFiles } from '@visastack/services';
import Link from 'next/link';
import { openOwnerGate } from '../../lib/owner-gate';
import { withSession } from '../../lib/session';

/** The one line's words: "1 File Needs a Person", "3 Files Need a Person". */
export function heldFilesLabel(count: number): string {
  return `${count} ${count === 1 ? 'File Needs' : 'Files Need'} a Person`;
}

/**
 * UMPE G4: one line on Home and on a traveller's Home while family files wait for Which Person?,
 * linking to the decision list. It reads its own count through the owner gate for the page's
 * person (the files belong to the account, so any of its own people opens the same list), and
 * shows nothing when there are none or the count cannot be read.
 */
export async function HeldFilesLine({ applicantId }: { readonly applicantId: string | undefined }) {
  if (!applicantId) return null;
  const count = await withSession(async ({ db, accountId }) => {
    const gate = await openOwnerGate(db, accountId, applicantId).catch(() => null);
    return gate ? countHeldFiles(gate).catch(() => 0) : 0;
  });
  if (count < 1) return null;
  return (
    <p className="umpe-g4-held-line">
      <Link href={`/app/applicant/${applicantId}/documents#needs-decision`}>
        {heldFilesLabel(count)}
      </Link>
    </p>
  );
}
