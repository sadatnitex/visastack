import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./evidence-copy-actions', () => ({ downloadEvidenceCopyAction: async () => undefined }));

const { EvidenceCopies, FILE_UNAVAILABLE_NOTICE, NOT_KEPT_NOTICE, waitingCopy } = await import(
  './evidence-copies'
);

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

const render = (
  list: List | undefined,
  over: Partial<Props> & { scan?: Map<string, { kind: string; scannedAt: null }> } = {},
) => {
  const { scan, ...rest } = over;
  const html = renderToStaticMarkup(
    <EvidenceCopies
      organizationId="o1"
      requestId="r1"
      status="RECEIVED"
      copies={
        list
          ? {
              list,
              scan: (scan ??
                new Map([['v1', { kind: 'FORMAT_CHECKED', scannedAt: null }]])) as never,
            }
          : undefined
      }
      {...rest}
    />,
  );
  const page = new JSDOM(html).window.document;
  return { html, page, text: page.body.textContent ?? '' };
};

const list = (submissions: Sent[], over: Partial<List> = {}): List => ({
  available: true,
  submissions,
  legacy: [],
  ...over,
});

describe('the copy waiting for a decision', () => {
  it('shows exactly what was sent: name, kind, which send, when, size, fingerprint and checks', () => {
    const { text } = render(list([sent({ roundNo: 2 })]));
    expect(text).toContain('Copy Waiting for Your Decision');
    expect(text).toContain('march-statement.pdf');
    expect(text).toMatch(/Bank Statement · Send 2 · Sent 3 Nov 2026, \d\d:\d\d \S+/);
    expect(text).toContain('2.4 MB');
    expect(text).toContain('Fingerprint a1b2c3d4e5f6');
    expect(text).toContain('File type checked. Not scanned for viruses.');
  });

  it('says Received is not Accepted, and names the next step', () => {
    expect(render(list([sent()])).text).toContain(
      'Received is not Accepted. Accept it or send it back below.',
    );
  });

  it('says a virus scan happened only when a trusted scan is on record for this exact file', () => {
    const scanned = render(list([sent()]), {
      scan: new Map([['v1', { kind: 'VIRUS_SCANNED', scannedAt: null }]]),
    });
    expect(scanned.text).toContain('Checked for viruses.');
    expect(scanned.text).not.toContain('Not scanned for viruses');
    expect(render(list([sent()])).text).not.toContain('Checked for viruses.');
  });

  it('offers the original download as a POST with the three ids and nothing else', () => {
    const { page } = render(list([sent()]));
    const form = page.querySelector('form.evidence-copy-file');
    const names = [...(form?.querySelectorAll('input') ?? [])].map((i) => [i.name, i.value]);
    expect(names).toEqual([
      ['organizationId', 'o1'],
      ['requestId', 'r1'],
      ['submissionId', 's1'],
    ]);
    const button = form?.querySelector('button');
    expect(button?.textContent).toBe('Download Sent File: march-statement.pdf');
    expect(form?.textContent).toContain('Downloads the original. You confirm it is you first.');
    // No preview and no direct link to a file: a download button only.
    expect(page.querySelector('a[href*="blob"], iframe, embed, object, img')).toBeNull();
  });

  it('hides the file action, and says why, when the service does not offer the file', () => {
    const { page, text } = render(list([sent({ fileAvailable: false })]));
    expect(page.querySelector('form.evidence-copy-file')).toBeNull();
    expect(text).toContain('This copy cannot be opened from here right now.');
  });
});

describe('earlier sends', () => {
  const earlier = [
    sent({
      id: 's1',
      roundNo: 1,
      title: 'cut-off.pdf',
      state: 'NEEDS_REPLACEMENT',
      decidedAt: new Date('2026-11-01T09:00:00Z'),
      reason: 'The last page is cut off.',
      // Even if the service said yes for an older send, only the waiting copy is ever opened here.
      fileAvailable: true,
    }),
    sent({ id: 's2', roundNo: 2, documentVersionId: 'v2', title: 'clear.pdf' }),
  ];

  it('folds the older sends under a count, with their state, time and the reason that was given', () => {
    const { page, text } = render(list(earlier));
    const details = page.querySelector('details.evidence-earlier');
    expect(details?.querySelector('summary')?.textContent).toBe('Earlier Sends (1)');
    expect(details?.textContent).toContain('Send 1: cut-off.pdf');
    expect(details?.textContent).toContain('Sent Back for a Replacement');
    expect(details?.textContent).toMatch(/Decided 1 Nov 2026, \d\d:\d\d \S+/);
    expect(details?.textContent).toContain(
      'Your reason, shown to the traveller: The last page is cut off.',
    );
    // Only the copy waiting is shown in full.
    expect(text.match(/Copy Waiting for Your Decision/g)).toHaveLength(1);
    expect(page.querySelectorAll('form.evidence-copy-file')).toHaveLength(1);
  });

  it('opens no file for an earlier send', () => {
    const { page } = render(list(earlier));
    expect(page.querySelector('details.evidence-earlier form')).toBeNull();
    expect(page.querySelector('details.evidence-earlier button')).toBeNull();
  });

  it('shows a request sent back with its sends all folded and nothing waiting', () => {
    const { page, text } = render(list([earlier[0] as Sent]), { status: 'NEEDS_REPLACEMENT' });
    expect(text).not.toContain('Copy Waiting for Your Decision');
    expect(page.querySelector('details.evidence-earlier summary')?.textContent).toBe(
      'Earlier Sends (1)',
    );
  });

  it('shows the accepted copy in full once accepted, still openable', () => {
    const { page, text } = render(
      list([sent({ state: 'ACCEPTED', decidedAt: new Date('2026-11-04T08:00:00Z') })]),
      { status: 'ACCEPTED' },
    );
    expect(text).toContain('Accepted Copy');
    expect(page.querySelector('form.evidence-copy-file')).not.toBeNull();
    expect(text).not.toContain('Received is not Accepted');
  });
});

describe('sends made before exact copies were kept', () => {
  const legacy = {
    label: 'Sent before exact versions were kept' as const,
    documentId: 'd9',
    sentAt: new Date('2026-10-20T08:00:00Z'),
    state: 'AWAITING_DECISION' as const,
    decidedAt: null,
  };

  it('labels the waiting send plainly, with no file action and no claim of an exact copy', () => {
    const { page, text } = render(list([], { available: false, legacy: [legacy] }));
    expect(text).toContain('Sent before exact versions were kept');
    expect(text).toMatch(/Sent 20 Oct 2026, \d\d:\d\d \S+/);
    expect(text).toContain(NOT_KEPT_NOTICE);
    expect(page.querySelector('form')).toBeNull();
    expect(text).not.toContain('Fingerprint');
  });

  it('lists a decided older send among the earlier ones, with its date and state', () => {
    const { page } = render(
      list([], {
        available: true,
        legacy: [
          {
            ...legacy,
            sentAt: null,
            state: 'ACCEPTED' as const,
            decidedAt: new Date('2026-10-22T08:00:00Z'),
          },
        ],
      }),
      { status: 'ACCEPTED' },
    );
    const details = page.querySelector('details.evidence-earlier');
    expect(details?.textContent).toContain('Sent before exact versions were kept');
    expect(details?.textContent).toContain('Send time not kept');
    expect(details?.textContent).toContain('Accepted');
  });
});

describe('when the copy cannot be shown', () => {
  it('says so when the copies could not be read for this request', () => {
    const { page } = render(undefined);
    expect(page.querySelector('output')?.textContent).toBe(
      'The copy that was sent could not be shown here. Refresh to try again.',
    );
  });

  it('tells the person a file could not be opened, as a status, after the download came back here', () => {
    const { page } = render(list([sent()]), { fileUnavailable: true });
    expect(page.querySelector('output')?.textContent).toBe(FILE_UNAVAILABLE_NOTICE);
    expect(FILE_UNAVAILABLE_NOTICE).toContain('Refresh to see the copy now waiting.');
  });

  it('shows nothing at all for a request with nothing sent and nothing to say', () => {
    expect(render(list([])).html).toBe('');
  });
});

describe('which copy the decision buttons are about', () => {
  it('is the newest send, only while it is waiting and the request is Received or Under Review', () => {
    const older = sent({ id: 's1', roundNo: 1, state: 'NEEDS_REPLACEMENT' });
    const newest = sent({ id: 's2', roundNo: 2 });
    expect(waitingCopy(list([older, newest]), 'RECEIVED')?.id).toBe('s2');
    expect(waitingCopy(list([older, newest]), 'UNDER_REVIEW')?.id).toBe('s2');
    expect(waitingCopy(list([older, newest]), 'NEEDS_REPLACEMENT')).toBeUndefined();
    expect(waitingCopy(list([older, newest]), 'ACCEPTED')).toBeUndefined();
    expect(waitingCopy(list([older]), 'RECEIVED')).toBeUndefined();
  });

  it('is nothing before exact copies are kept, or when the copies could not be read', () => {
    expect(waitingCopy(list([sent()], { available: false }), 'RECEIVED')).toBeUndefined();
    expect(waitingCopy(undefined, 'RECEIVED')).toBeUndefined();
  });
});
