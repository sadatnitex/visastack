import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderServer } from '../../../../lib/next-mocks.test-support';
import { missingBengali } from '../agency-bn.test-support';
import { drawBn } from '../agency-bn.test-support';

// The language switch is off in the product, so the locale is set here directly.
const current = vi.hoisted(() => ({ locale: 'en' as 'en' | 'bn', holder: null as unknown }));
vi.mock('../../../../lib/locale', () => ({ getLocale: async () => current.locale }));
// Outside the server runtime React's cache remembers nothing; stand in for one request per render.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: (build: () => unknown) => () => {
    current.holder ??= build();
    return current.holder;
  },
}));
vi.mock('server-only', () => ({}));
vi.mock('./evidence-copy-actions', () => ({ downloadEvidenceCopyAction: async () => undefined }));
vi.mock('./collection/collection-response-actions', () => ({
  downloadResponseFileAction: async () => undefined,
}));
vi.mock('./collection/collection-review-actions', () => ({
  reviewAnswerAction: async () => ({ ok: true, message: '' }),
  guestHoldAction: async () => ({ ok: true, message: '' }),
}));

import { primeLocale } from '../../../../lib/i18n-server';

const { EvidenceCopies } = await import('./evidence-copies');
const { CollectionResponsesPanel } = await import('./collection/collection-response-panel');
const { ListPager } = await import('./cases/list-pager');

afterEach(() => {
  current.locale = 'en';
});

async function inBengali(node: () => Promise<string> | string): Promise<string> {
  current.holder = null;
  current.locale = 'bn';
  await primeLocale();
  return node();
}

describe('the copies on a request card under Bengali', () => {
  type Props = Parameters<typeof EvidenceCopies>[0];
  type List = NonNullable<Props['copies']>['list'];
  type Sent = List['submissions'][number];
  const sent = (over: Partial<Sent> = {}): Sent => ({
    id: 's1',
    roundNo: 1,
    documentId: 'd1',
    documentVersionId: 'v1',
    versionNumber: 1,
    docType: 'BANK_STATEMENT',
    title: 'march-statement.pdf',
    sizeBytes: 2_400_000,
    checksumFingerprint: 'a1b2c3d4e5f6',
    sentAt: new Date('2026-11-03T08:00:00Z'),
    state: 'AWAITING_DECISION',
    decidedAt: null,
    reason: null,
    fileAvailable: true,
    safetyStatus: 'CLEAN',
    ...over,
  });
  const draw = (list: List, status = 'RECEIVED') =>
    inBengali(() =>
      renderServer(
        <EvidenceCopies
          organizationId="o1"
          requestId="r1"
          status={status}
          copies={{
            list,
            scan: new Map([['v1', { kind: 'FORMAT_CHECKED', scannedAt: null }]]) as never,
          }}
        />,
      ),
    );

  it('says Received is not Accepted in Bengali for the copy waiting for a decision', async () => {
    const html = await draw({ available: true, submissions: [sent()], legacy: [] });
    expect(html).not.toMatch(/appAgency\./);
    expect(missingBengali(html, ['appAgencyOrgidEvidenceCopies.receivedIsNotAccepted'])).toEqual(
      [],
    );
  });

  it('titles an accepted copy in Bengali, with the earlier sends folded below', async () => {
    const html = await draw(
      {
        available: true,
        submissions: [
          sent({
            id: 's2',
            roundNo: 2,
            state: 'ACCEPTED',
            decidedAt: new Date('2026-11-04T08:00:00Z'),
          }),
          sent({
            id: 's1',
            state: 'NEEDS_REPLACEMENT',
            decidedAt: new Date('2026-11-03T20:00:00Z'),
          }),
        ],
        legacy: [],
      },
      'ACCEPTED',
    );
    expect(html).not.toMatch(/appAgency\./);
    expect(
      missingBengali(html, [
        'appAgencyOrgidEvidenceCopies.acceptedCopy',
        'appAgencyOrgidEvidenceCopies.earlierSendsEarliercount',
      ]),
    ).toEqual([]);
  });

  it('says a send made before exact copies were kept has no exact copy, in Bengali', async () => {
    const html = await draw({
      available: false,
      submissions: [],
      legacy: [
        {
          label: 'Sent before exact versions were kept' as const,
          documentId: 'd9',
          sentAt: new Date('2026-10-20T08:00:00Z'),
          state: 'AWAITING_DECISION' as const,
          decidedAt: null,
        },
      ],
    });
    expect(html).not.toMatch(/appAgency\./);
    expect(
      missingBengali(html, [
        'appAgencyOrgidEvidenceCopies.receivedIsNotAccepted',
        'appAgencyOrgidEvidenceCopies.thisSendHasNoExactCopy',
      ]),
    ).toEqual([]);
  });
});

describe('the Answers panel under Bengali', () => {
  const ITEM = {
    id: 'item-1',
    label: 'Passport',
    kind: 'DOCUMENT' as const,
    fieldKey: null,
    docType: 'passport',
    necessity: 'MANDATORY' as const,
    provenance: 'OFFICIAL' as const,
    groupKey: null,
    note: null,
    order: 0,
    source: 'r1',
    citation: 'Synthetic rule',
  };
  const account = (intact: boolean) => ({
    id: 'resp-1',
    status: 'SUBMITTED_TO_AGENCY' as const,
    personName: 'Synthetic Traveller',
    revisionNo: 1,
    submittedAt: new Date('2026-12-02T00:00:00Z'),
    consentVersion: 'umpe-p7-consent-1',
    intact,
    hasProtectedDetails: false,
    lines: intact
      ? [
          {
            itemId: ITEM.id,
            item: ITEM,
            source: 'account' as const,
            versions: [
              {
                kind: 'DOCUMENT' as const,
                documentVersionId: 'v1',
                title: 'Passport',
                versionNumber: 2,
              },
            ],
            missing: false,
          },
        ]
      : [],
  });
  const guest = (intact: boolean) => ({
    id: 'gs-1',
    source: 'guest' as const,
    status: 'SUBMITTED_TO_AGENCY' as const,
    submissionNo: 1,
    revisionNo: 1,
    submittedAt: new Date('2026-12-03T00:00:00Z'),
    retentionDays: 30,
    consentVersion: 'guest-submit-2026-11-02',
    guestNo: 1,
    intact,
    lines: [],
  });
  const draw = (intact: boolean, withGuest: boolean) =>
    inBengali(() =>
      renderServer(
        <CollectionResponsesPanel
          organizationId="o1"
          requestId="q1"
          fileUnavailable={false}
          responses={[account(intact)]}
          {...(withGuest
            ? { extras: { guest: [guest(intact)], reviews: new Map(), hold: null } }
            : {})}
        />,
      ),
    );

  it('names the chosen version of a file in Bengali (answer that still matches)', async () => {
    const html = await draw(true, false);
    expect(html).not.toMatch(/appAgency\./);
    expect(
      missingBengali(html, [
        'appAgencyOrgidCollectionCollectionResponsePanel.titleVersionVersionnumber',
      ]),
    ).toEqual([]);
  });

  it('says in Bengali that an answer or a submission changed since it was sent', async () => {
    const html = await draw(false, true);
    expect(html).not.toMatch(/appAgency\./);
    expect(
      missingBengali(html, [
        'appAgencyOrgidCollectionCollectionResponsePanel.thisAnswerHasChangedSinceIt',
        'appAgencyOrgidCollectionCollectionResponsePanel.thisSubmissionNoLongerMatchesWhat',
      ]),
    ).toEqual([]);
  });
});

describe('the list pager under Bengali', () => {
  it('offers Show Older Entries in Bengali on a page of older entries', () => {
    const html = drawBn(
      <ListPager
        id="more"
        landOn="list"
        pathname="/app/agency/o1/cases"
        query={{}}
        keys={{ show: 'show', before: 'before', from: 'from' }}
        sizes={{ step: 15, max: 15 }}
        window={{ limit: 15, before: 'cursor-0', from: 16 }}
        shown={15}
        total={40}
        nextCursor="cursor-1"
        noun={{ one: 'case', other: 'cases' }}
        newestLabel="Back to the Newest Cases"
      />,
    );
    expect(html).not.toMatch(/appAgency\./);
    expect(missingBengali(html, ['appAgencyOrgidCasesListPager.showOlderEntries'])).toEqual([]);
  });
});
