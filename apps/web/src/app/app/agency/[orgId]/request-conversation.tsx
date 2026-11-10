import { evidenceRequestTriageGroup } from '@visastack/services';
import { RequestThread } from '../../../../components/request-thread/request-thread';
import { buildThread } from '../../../../components/request-thread/thread-model';
import type { EvidenceRequestRow } from './console-data';
import type { EvidenceCopies as EvidenceCopiesData } from './evidence-copies-data';

/**
 * One request as the agency reads it: the same conversation the traveller sees, from the agency's
 * side (its own words on the right), folded under the request so the list stays rows. It reads
 * nothing new: the sends come from the exact copies already read for the copies card, and when
 * those could not be read the thread says so instead of guessing.
 */
export function RequestConversation({
  req,
  copies,
  hasCopies,
}: {
  readonly req: EvidenceRequestRow;
  /** The sent copies read for this request; undefined when they could not be read (or none apply). */
  readonly copies: EvidenceCopiesData | undefined;
  /** A sent copy exists to show for this request (a document request with an answer). */
  readonly hasCopies: boolean;
}) {
  const group = evidenceRequestTriageGroup(req, req.respondingDocumentState);
  const thread = buildThread({
    viewer: 'agency',
    travellerName: req.applicantName,
    request: {
      kind: req.kind,
      status: req.status,
      message: req.message,
      createdAt: req.createdAt,
      respondedAt: req.respondedAt,
    },
    group,
    decisions: { state: 'none' },
    sends: copies
      ? {
          state: 'read',
          value: {
            available: copies.list.available,
            submissions: copies.list.submissions.map((s) => ({
              id: s.id,
              title: s.title,
              sentAt: s.sentAt,
              state: s.state,
              decidedAt: s.decidedAt,
              reason: s.reason,
            })),
          },
        }
      : hasCopies
        ? { state: 'unread' }
        : { state: 'none' },
  });
  return (
    <details className="request-conversation">
      <summary>Conversation</summary>
      <RequestThread thread={thread} viewer="agency" timeZone={null} showHeading={false} />
    </details>
  );
}
