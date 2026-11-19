import type { AttentionItem } from '@visastack/services';
import { AttentionRow } from '../../src/app/app/(home)/attention-row';
import { PersonCard } from '../../src/app/app/(home)/home-cards';

/**
 * WAL10: Home's People cards and Needs Attention rows, the real components on the real
 * stylesheet. One of the two people carries the account photo (a small made-up picture served
 * from the same page, so nothing leaves the page); one item of every kind is listed, one with a
 * long name. Used by e2e/wallet/wal10-home.spec.ts. Every value is made up.
 */
export interface Wal10FixtureProps {
  /** The own card's photo address; a broken one proves the initials fallback. */
  readonly photo?: 'good' | 'broken' | 'none';
}

const base = {
  tier: 3,
  why: 'A step in this case is coming up. Open it to see what to do.',
  applicantId: 'p1',
  applicantName: 'Salma Rahman',
  caseId: 'c1',
  caseTitle: 'Synthetic Case',
  dueDate: '2030-01-20',
  dueState: 'due_soon',
  daysUntilDue: 5,
  sentBack: false,
  count: null,
  subject: null,
  createdAt: '2030-01-01T00:00:00.000Z',
} as const;

const ITEMS: readonly {
  readonly item: AttentionItem;
  readonly heading: string;
  readonly tier: string;
  readonly action: string;
  readonly when: string | null;
}[] = [
  {
    item: {
      ...base,
      key: 'task:1',
      kind: 'task',
      title: 'Task',
      tier: 1,
      dueState: 'overdue',
      daysUntilDue: -2,
      href: '/app/case/c1',
    },
    heading: 'Book the Visa Appointment',
    tier: 'Past Due',
    action: 'Open Case',
    when: 'Was due on 10 Jan 2030',
  },
  {
    item: {
      ...base,
      key: 'evidence_request:1',
      kind: 'evidence_request',
      title: 'Document Requested',
      tier: 2,
      sentBack: true,
      subject: {
        kind: 'request',
        requestKind: 'DOCUMENT',
        docType: 'BANK_STATEMENT',
        fieldKey: null,
      },
      href: '/app/applicant/p1/evidence',
    },
    heading: 'Bank Statement With a Very Long Name That Has to Wrap on a Narrow Phone Screen',
    tier: 'Sent Back for a Fix',
    action: 'Send a Replacement',
    when: 'Due on 20 Jan 2030',
  },
  {
    item: {
      ...base,
      key: 'case_changed:1',
      kind: 'case_changed',
      title: 'Changed Since You Confirmed It',
      tier: 4,
      dueState: 'none',
      dueDate: null,
      href: '/app/case/c1',
    },
    heading: 'Changed Since You Confirmed It',
    tier: 'Changed Since You Confirmed',
    action: 'Review Changes',
    when: null,
  },
  {
    item: {
      ...base,
      key: 'document_expiry:1',
      kind: 'document_expiry',
      title: 'Document Expiring',
      tier: 6,
      dueState: 'later',
      subject: { kind: 'document', docType: 'PASSPORT' },
      href: '/app/applicant/p1/documents',
    },
    heading: 'Passport',
    tier: 'Expiring or Expired',
    action: 'See Expiry Dates',
    when: 'Expires on 20 Jan 2030',
  },
  {
    item: {
      ...base,
      key: 'suggestions:1',
      kind: 'suggestions',
      title: 'Suggested Details Waiting for Your Decision',
      tier: 7,
      why: 'Details were read from a document. Nothing is added to the profile until you approve it.',
      count: 2,
      dueState: 'none',
      dueDate: null,
      href: '/app/applicant/p1/review',
    },
    heading: 'Suggested Details Waiting for Your Decision',
    tier: 'Waiting for Your Answer',
    action: 'Review Suggestions',
    when: null,
  },
  {
    item: {
      ...base,
      key: 'sharing_invitations:account',
      kind: 'sharing_invitations',
      title: 'Sharing Invitations Waiting for Your Answer',
      tier: 7,
      applicantId: null,
      applicantName: null,
      caseId: null,
      caseTitle: null,
      count: 1,
      dueState: 'none',
      dueDate: null,
      href: '/app/shared',
    },
    heading: 'Sharing Invitations Waiting for Your Answer',
    tier: 'Waiting for Your Answer',
    action: 'See Invitations',
    when: null,
  },
];

// A same-origin picture, as in the product (the page rules allow images from this site only).
const GOOD = '/icons/icon-192.png';

export default function Wal10Fixture({ photo = 'good' }: Wal10FixtureProps) {
  const url = photo === 'good' ? GOOD : photo === 'broken' ? '/missing-photo.jpg' : null;
  return (
    <div className="u-p-3" id="wal10-root">
      <section className="home-block u-mb-150" aria-labelledby="people-h">
        <h2 id="people-h" className="card-title">
          People
        </h2>
        <ul className="home-people">
          <PersonCard
            href="/app/applicant/p1"
            name="Nazmus Sadat"
            documents={7}
            cases={2}
            requests={0}
            actionNeeded={false}
            photoUrl={url}
          />
          <PersonCard
            href="/app/applicant/p2"
            name="Salma Rahman"
            documents={1}
            cases={0}
            requests={1}
            actionNeeded
          />
        </ul>
      </section>
      <section className="card u-mb-150" aria-labelledby="attention-h">
        <h2 className="card-title" id="attention-h">
          Needs Attention
        </h2>
        <ol className="do-next-list">
          {ITEMS.map((entry) => (
            <AttentionRow
              key={entry.item.key}
              item={entry.item}
              heading={entry.heading}
              context={
                entry.item.applicantName
                  ? `${entry.item.applicantName} · ${entry.item.caseTitle}`
                  : ''
              }
              when={entry.when}
              tierLabel={entry.tier}
              actionLabel={entry.action}
            />
          ))}
        </ol>
      </section>
    </div>
  );
}
