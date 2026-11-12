import type {
  AnswerAgencyGroup,
  AnswerCopy,
  AnswerItem,
  DocumentSummary,
} from '@visastack/services';
import { AnswerSetForm } from '../../src/app/app/applicant/[id]/evidence/answer/answer-set-form';
import { buildAnswerReview } from '../../src/app/app/applicant/[id]/evidence/answer/answer-view';
import { requestName } from '../../src/app/app/applicant/[id]/evidence/request-name';
import { buildDocumentChoices } from '../../src/app/app/applicant/[id]/evidence/response-choices';
import { SubmitResponseForm } from '../../src/app/app/applicant/[id]/evidence/submit-response-form';
import { GroupedList, ListRow, ListWithPane } from '../../src/components/list-pattern';
import { PageHeader } from '../../src/components/ui';
import { FIELD_MARK, documentMark } from '../../src/lib/item-icons';

/**
 * Tier 1a measurement of one journey on the Requests screens: "send the three answers that can be
 * sent" (passport, bank statement and one photo) when a second, unrelated agency asks for six
 * things. Two views over the SAME made-up scenario:
 *
 * - `before`: the page as it is today for those six requests. The list is the real list pattern
 *   (`GroupedList`, `ListRow`, `ListWithPane`) and every panel holds the real `SubmitResponseForm`
 *   with choices from the real `buildDocumentChoices`. The page's own `RequestsList` and the panel
 *   builder `request-panes.tsx` pull server code into the browser bundle (`@visastack/services`,
 *   `node:crypto`), which cannot be bundled here, so the list rows and the panel are composed from
 *   the same client components, with the same names, chips and classes the real ones use.
 * - `after`: the real `AnswerSetForm`, fed by `buildAnswerReview` from plan data written by hand
 *   here, shaped exactly as `planEvidenceAnswers` returns it.
 *
 * Server work is a stand-in (the harness's `standInServerActions`): pressing Send answers "nothing
 * was changed", so a journey ends at the press. Everything here is made up; nothing is a real
 * person, agency or document.
 */
export interface AnswerJourneyProps {
  readonly view: 'before' | 'after';
}

const APPLICANT = 'synthetic';
const ORG = '11111111-1111-4111-8111-111111111111';
const AGENCY = 'TEST Agency Unrelated';
const NORTH = 'TEST Agency North';
const TIME_ZONE = 'Asia/Dhaka';
const NOW = new Date('2026-11-12T09:00:00.000Z');

interface Scenario {
  readonly id: string;
  readonly kind: 'DOCUMENT' | 'FIELD';
  readonly docType: string | null;
  readonly fieldKey: string | null;
  /** The copies the traveller holds for this request, newest first. */
  readonly files: readonly {
    readonly id: string;
    readonly name: string;
    readonly expiresAt: string | null;
    readonly createdAt: string;
    readonly acceptedBefore?: boolean;
  }[];
}

/** The six requests of the scenario, in the order the agency asked. */
const SCENARIO: readonly Scenario[] = [
  {
    id: 'req-passport',
    kind: 'DOCUMENT',
    docType: 'PASSPORT',
    fieldKey: null,
    files: [
      {
        id: 'doc-passport',
        name: 'Passport Scan.pdf',
        expiresAt: '2031-03-12T00:00:00.000Z',
        createdAt: '2026-10-02T10:00:00.000Z',
        acceptedBefore: true,
      },
    ],
  },
  {
    id: 'req-bank',
    kind: 'DOCUMENT',
    docType: 'BANK_STATEMENT',
    fieldKey: null,
    files: [
      {
        id: 'doc-bank',
        name: 'Bank Statement October.pdf',
        expiresAt: null,
        createdAt: '2026-11-01T10:00:00.000Z',
      },
    ],
  },
  {
    id: 'req-photo',
    kind: 'DOCUMENT',
    docType: 'PHOTO',
    fieldKey: null,
    files: [
      {
        id: 'doc-photo-new',
        name: 'Photo New.jpg',
        expiresAt: null,
        createdAt: '2026-11-05T10:00:00.000Z',
      },
      {
        id: 'doc-photo-old',
        name: 'Photo Old.jpg',
        expiresAt: null,
        createdAt: '2026-09-05T10:00:00.000Z',
      },
    ],
  },
  {
    id: 'req-national-id',
    kind: 'DOCUMENT',
    docType: 'NATIONAL_ID',
    fieldKey: null,
    files: [
      {
        id: 'doc-national-id',
        name: 'National Identity Card.pdf',
        expiresAt: '2025-06-30T00:00:00.000Z',
        createdAt: '2026-08-02T10:00:00.000Z',
      },
    ],
  },
  {
    id: 'req-letter',
    kind: 'DOCUMENT',
    docType: 'EMPLOYMENT_LETTER',
    fieldKey: null,
    files: [],
  },
  {
    id: 'req-passport-number',
    kind: 'FIELD',
    docType: null,
    fieldKey: 'passport_number',
    files: [],
  },
];

// ---------------------------------------------------------------------------------------------
// The "before" view.
// ---------------------------------------------------------------------------------------------

const documents: readonly DocumentSummary[] = SCENARIO.flatMap((request) =>
  request.files.map(
    (file): DocumentSummary => ({
      id: file.id,
      originalName: file.name,
      approvedName: null,
      docType: request.docType,
      subject: null,
      latestVersionId: `ver-${file.id}`,
      safetyStatus: 'CLEAN',
      processingStatus: 'AWAITING_REVIEW',
      createdAt: file.createdAt,
      documentDate: null,
      expiresAt: file.expiresAt,
      pendingNameVersion: null,
      classification: null,
    }),
  ),
);

function choicesFor(request: Scenario) {
  return buildDocumentChoices(
    {
      documents,
      docType: request.docType,
      everyday: new Set(documents.map((doc) => doc.id.toLowerCase())),
      scan: new Map(),
      timeZone: TIME_ZONE,
      sentBackDocumentId: null,
    },
    NOW,
  );
}

function Pane({ request }: { readonly request: Scenario }) {
  const name = requestName(request);
  return (
    <div className="lp-pane-content rt-pane">
      <h3 className="lp-pane-title">{name}</h3>
      <p className="case-row-meta">
        Next: send a document from your wallet, or add a new one first. Only documents that have
        finished their safety checks can be sent.
      </p>
      <SubmitResponseForm
        applicantId={APPLICANT}
        requestId={request.id}
        kind={request.kind}
        awaiting
        timeZone={TIME_ZONE}
        itemLabel={name}
        idempotencyKey={`fixture-key-${request.id}`.padEnd(24, '0')}
        exactCopies
        documentsRead
        candidateFacts={
          request.kind === 'FIELD' ? [{ factId: 'fact-passport-number', value: 'A1234567' }] : []
        }
        documentChoices={choicesFor(request)}
      />
    </div>
  );
}

function Before() {
  return (
    <>
      <PageHeader eyebrow="TEST Rahim Synthetic" title="Requests from Agencies" />
      <div className="req-grid">
        <ListWithPane
          panes={SCENARIO.map((request) => ({
            id: request.id,
            title: requestName(request),
            content: <Pane request={request} />,
          }))}
          param="item"
          paneLabel="Request Details"
          backLabel="Back to Requests"
          backHref={`/app/applicant/${APPLICANT}/evidence`}
        >
          <div className="req-list lc-empty-host">
            <div className="req-groups" data-pattern="request-list">
              <GroupedList
                level={2}
                groups={[
                  {
                    id: 'evidence-requests-waiting',
                    heading: 'Waiting for You',
                    count: SCENARIO.length,
                    tone: 'warning',
                    open: true,
                    children: SCENARIO.map((request) => (
                      <ListRow
                        key={request.id}
                        id={request.id}
                        name={requestName(request)}
                        tone="warning"
                        status="Missing"
                        mark={request.kind === 'FIELD' ? FIELD_MARK : documentMark(request.docType)}
                        openHref={`/app/applicant/${APPLICANT}/evidence?item=${request.id}#request-${request.id}`}
                        domId={`request-${request.id}`}
                      />
                    )),
                  },
                ]}
              />
            </div>
          </div>
        </ListWithPane>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// The "after" view: the plan, exactly as `planEvidenceAnswers` returns it for this scenario.
// ---------------------------------------------------------------------------------------------

function planCopy(
  file: Scenario['files'][number],
  index: number,
  over: Partial<AnswerCopy> = {},
): AnswerCopy {
  const expiresOn = file.expiresAt ? file.expiresAt.slice(0, 10) : null;
  const expired = expiresOn !== null && expiresOn <= NOW.toISOString().slice(0, 10);
  return {
    documentId: file.id,
    versionId: `ver-${file.id}`,
    versionNumber: index + 1,
    name: file.name,
    addedAt: new Date(file.createdAt),
    expiresOn,
    documentDate: null,
    ageDays: null,
    state: expired ? 'EXPIRED' : 'OK',
    sendable: !expired,
    acceptedBefore: file.acceptedBefore
      ? { times: 1, lastAt: new Date('2026-10-20T10:00:00.000Z'), lastByAgency: NORTH }
      : null,
    ...over,
  };
}

function planItem(request: Scenario, readiness: AnswerItem['readiness']): AnswerItem {
  return {
    requestId: request.id,
    referenceCode: null,
    kind: request.kind,
    docType: request.docType,
    fieldKey: request.fieldKey,
    status: 'OPEN',
    missionId: null,
    dueDate: null,
    rule: null,
    readiness,
    copies: request.files.map((file, index) => planCopy(file, index)),
  };
}

const READINESS: Readonly<Record<string, AnswerItem['readiness']>> = {
  'req-passport': 'READY',
  'req-bank': 'READY',
  'req-photo': 'CHOOSE',
  'req-national-id': 'OUTDATED',
  'req-letter': 'MISSING',
  'req-passport-number': 'OWN_STEP',
};

const GROUP: AnswerAgencyGroup = {
  organizationId: ORG,
  organizationName: AGENCY,
  canReceive: true,
  items: SCENARIO.map((request) => planItem(request, READINESS[request.id] ?? 'MISSING')),
};

function After() {
  return (
    <>
      <PageHeader eyebrow="TEST Rahim Synthetic" title="Answer from Your Records" />
      <article className="card">
        <h2 className="card-title">{`${AGENCY}: ${GROUP.items.length} requests waiting`}</h2>
        <AnswerSetForm
          applicantId={APPLICANT}
          organizationId={ORG}
          agencyName={AGENCY}
          confirmationKey="fixtureConfirmationKey0"
          review={buildAnswerReview(GROUP, { timeZone: TIME_ZONE, locale: 'en' })}
          timeZone={TIME_ZONE}
        />
      </article>
    </>
  );
}

export default function AnswerJourney({ view }: AnswerJourneyProps) {
  return view === 'before' ? <Before /> : <After />;
}
