import { accountPrincipal, listOwnCollectionResponses, requireAccess } from '@visastack/services';
import Link from 'next/link';
import { Suspense } from 'react';
import { reportServerError } from '../../../lib/server-error';
import { withSession } from '../../../lib/session';

/**
 * One line on a person's Sharing page (UMPE P7): how many live answers to agency requests were
 * sent from this record, with the way to see or withdraw them. Shows nothing when there are none,
 * and nothing (never an error) when the answers cannot be read.
 */
export function CollectionAnswersSharingLine({ applicantId }: { readonly applicantId: string }) {
  // Its own boundary: the Sharing page never waits for, or fails with, this one line.
  return (
    <Suspense fallback={null}>
      <AnswersLine applicantId={applicantId} />
    </Suspense>
  );
}

async function AnswersLine({ applicantId }: { readonly applicantId: string }) {
  let live = 0;
  try {
    live = await withSession(async ({ db, accountId }) => {
      const proof = await requireAccess(
        db,
        accountPrincipal(accountId),
        'VIEW_METADATA',
        { applicantId },
        { purpose: 'collection_response' },
      );
      if (!proof.ok || proof.value.actor.kind !== 'applicant_owner') return 0;
      const answers = await listOwnCollectionResponses(db, proof.value);
      return answers.ok ? answers.value.filter((a) => a.withdrawnAt === null).length : 0;
    });
  } catch (error) {
    reportServerError('collectionAnswersSharingLine', error, { step: 'read failed' });
    return null;
  }
  if (live === 0) return null;
  return (
    <p className="card-body u-fs-085">
      {live === 1
        ? 'One answer to an agency request is shared from this record.'
        : `${live} answers to agency requests are shared from this record.`}{' '}
      <Link href="/collect/account/answers">See or Withdraw Answers</Link>
    </p>
  );
}
