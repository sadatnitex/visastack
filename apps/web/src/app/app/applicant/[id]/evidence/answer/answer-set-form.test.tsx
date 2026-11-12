// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { countProse } from '../../../../../../lib/prose-budget.test-support';
import type { AnswerCopyView, AnswerItemView, AnswerReviewView } from './answer-view';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  confirmAnswersAction: vi.fn(),
  replace: vi.fn(),
}));
vi.mock('./actions', () => ({ confirmAnswersAction: mocks.confirmAnswersAction }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace, refresh: vi.fn(), push: vi.fn(), back: vi.fn() }),
}));

const { AnswerSetForm } = await import('./answer-set-form');

const KEY = 'k9Qm2x_T7vLw4Rz0Hc8Yb1Nd';
const AGENCY = 'TEST Agency Unrelated';

const copy = (id: string, over: Partial<AnswerCopyView> = {}): AnswerCopyView => ({
  documentId: `doc-${id}`,
  versionId: `ver-${id}`,
  name: `${id}.pdf`,
  versionNumber: 1,
  addedLabel: '12 Nov 2026, 10:00 GMT+6',
  expiresLabel: null,
  documentDateLabel: null,
  acceptedBefore: null,
  uncertainty: null,
  ...over,
});
const item = (
  id: string,
  readiness: AnswerItemView['readiness'],
  copies: AnswerCopyView[] = [],
  over: Partial<AnswerItemView> = {},
): AnswerItemView => ({
  requestId: `req-${id.replaceAll(' ', '-')}`,
  name: `Document: ${id}`,
  referenceCode: null,
  optional: false,
  readiness,
  copies,
  ...over,
});

const REVIEW: AnswerReviewView = {
  ready: [
    item('Passport', 'READY', [
      copy('passport', {
        expiresLabel: '12 Mar 2031',
        acceptedBefore: { byAgency: 'TEST Agency North' },
      }),
    ]),
    item('Bank Statement', 'READY', [copy('bank')], { referenceCode: 'R-7K2Q9M' }),
  ],
  choose: [
    item('Photo', 'CHOOSE', [copy('photo-a'), copy('photo-b')]),
    item('Utility Bill', 'CHECK_DATE', [copy('bill', { uncertainty: { kind: 'age', days: 90 } })], {
      optional: true,
    }),
  ],
  other: [
    item('National Id', 'OUTDATED'),
    item('Employment Letter', 'MISSING'),
    item('Passport Number', 'OWN_STEP'),
  ],
};

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.confirmAnswersAction.mockResolvedValue({ ok: true, message: '', sent: 0, changed: 0 });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function mount(review: AnswerReviewView = REVIEW) {
  act(() =>
    root.render(
      <AnswerSetForm
        applicantId="a1"
        organizationId="org-1"
        agencyName={AGENCY}
        confirmationKey={KEY}
        review={review}
        timeZone="Asia/Dhaka"
      />,
    ),
  );
}
const form = () => container.querySelector('form') as HTMLFormElement;
const button = () => container.querySelector('button[type="submit"]') as HTMLButtonElement;
const boxes = () => [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
const radios = () => [...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
const posted = () =>
  [...container.querySelectorAll<HTMLInputElement>('input[type="hidden"][name="answer"]')].map(
    (input) => input.value,
  );
const click = (el: HTMLElement) =>
  act(() => {
    el.click();
  });
const labelOf = (input: HTMLInputElement) => input.closest('label')?.textContent ?? '';
const boxFor = (name: string) =>
  boxes().find((box) =>
    (box.closest('label')?.textContent ?? '').includes(name),
  ) as HTMLInputElement;

describe('what is chosen at first', () => {
  it('ticks the ready answers, and only those, and counts them on the button', () => {
    mount();
    expect(boxFor('Document: Passport').checked).toBe(true);
    expect(boxFor('Document: Bank Statement').checked).toBe(true);
    expect(boxFor('Document: Utility Bill').checked).toBe(false);
    expect(button().textContent).toBe(`Send 2 Answers to ${AGENCY}`);
    expect(posted()).toEqual([
      'req-Passport|doc-passport|ver-passport',
      'req-Bank-Statement|doc-bank|ver-bank',
    ]);
  });

  it('starts every choice between copies on "Do Not Send Now"', () => {
    mount();
    const group = radios().filter(
      (radio) => radio.name === radios().find((r) => labelOf(r).includes('photo-a'))?.name,
    );
    expect(group.map((radio) => radio.checked)).toEqual([true, false, false]);
    expect(labelOf(group[0] as HTMLInputElement)).toContain('Do Not Send Now');
  });

  it('does not tick a copy whose date has to be checked, and says why in plain words', () => {
    mount();
    const bill = boxFor('Document: Utility Bill');
    expect(bill.checked).toBe(false);
    const text = bill.closest('label')?.textContent ?? '';
    expect(text).toContain(
      'The checklist asks for something dated within the last 90 days, and no date is saved for this copy.',
    );
    expect(text).toContain('Optional on the checklist');
  });

  it('says when two saved dates disagree', () => {
    mount({
      ready: [],
      choose: [item('Visa', 'CHECK_DATE', [copy('visa', { uncertainty: { kind: 'disagree' } })])],
      other: [],
    });
    expect(container.textContent).toContain('Two saved dates for this copy disagree.');
  });
});

describe('the one button follows the ticks', () => {
  it('names the agency and the count, and updates when a tick changes', () => {
    mount();
    click(boxFor('Document: Bank Statement'));
    expect(button().textContent).toBe(`Send 1 Answer to ${AGENCY}`);
    click(boxFor('Document: Utility Bill'));
    expect(button().textContent).toBe(`Send 2 Answers to ${AGENCY}`);
    const photoB = radios().find((radio) => labelOf(radio).includes('photo-b')) as HTMLInputElement;
    click(photoB);
    expect(button().textContent).toBe(`Send 3 Answers to ${AGENCY}`);
  });

  it('stays visible but unavailable with nothing chosen', () => {
    mount();
    click(boxFor('Document: Passport'));
    click(boxFor('Document: Bank Statement'));
    expect(button().disabled).toBe(true);
    expect(button().textContent).toBe(`Send Answers to ${AGENCY}`);
    expect(posted()).toEqual([]);
  });

  it('posts exactly the chosen request, document and version, for the one agency', async () => {
    mount();
    click(boxFor('Document: Bank Statement'));
    click(boxFor('Document: Utility Bill'));
    const photoB = radios().find((radio) => labelOf(radio).includes('photo-b')) as HTMLInputElement;
    click(photoB);
    await act(async () => {
      form().requestSubmit();
    });
    expect(mocks.confirmAnswersAction).toHaveBeenCalledTimes(1);
    const data = mocks.confirmAnswersAction.mock.calls[0]?.[1] as FormData;
    expect(data.getAll('answer')).toEqual([
      'req-Passport|doc-passport|ver-passport',
      'req-Photo|doc-photo-b|ver-photo-b',
      'req-Utility-Bill|doc-bill|ver-bill',
    ]);
    expect(data.get('applicantId')).toBe('a1');
    expect(data.get('organizationId')).toBe('org-1');
    expect(data.get('confirmationKey')).toBe(KEY);
  });

  it('keeps the confirmation key it was given, even if the page hands it a new one later', () => {
    mount();
    act(() =>
      root.render(
        <AnswerSetForm
          applicantId="a1"
          organizationId="org-1"
          agencyName={AGENCY}
          confirmationKey="zzzzzzzzzzzzzzzzzzzzzzzz"
          review={REVIEW}
          timeZone="Asia/Dhaka"
        />,
      ),
    );
    expect(container.querySelector<HTMLInputElement>('input[name="confirmationKey"]')?.value).toBe(
      KEY,
    );
  });
});

describe('after the server answers', () => {
  it('moves the address to the receipt for this confirmation when answers went', async () => {
    mocks.confirmAnswersAction.mockResolvedValue({
      ok: true,
      message: `2 answers were sent to ${AGENCY}.`,
      savedAt: '2026-11-12T08:30:00.000Z',
      sent: 2,
      changed: 0,
    });
    mount();
    await act(async () => {
      form().requestSubmit();
    });
    expect(mocks.replace).toHaveBeenCalledTimes(1);
    const [address, options] = mocks.replace.mock.calls[0] as [string, { scroll: boolean }];
    expect(address).toContain('agency=org-1');
    expect(address).toContain(`done=${KEY}`);
    expect(options).toEqual({ scroll: false });
    expect(container.textContent).toContain(`2 answers were sent to ${AGENCY}.`);
  });

  it('says nothing was sent and moves nowhere when the server refused', async () => {
    mocks.confirmAnswersAction.mockResolvedValue({
      ok: false,
      message: 'Nothing was sent. Your records changed after you opened this page.',
      sent: 0,
      changed: 2,
    });
    mount();
    await act(async () => {
      form().requestSubmit();
    });
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Not saved. Nothing was sent.');
    expect(button().textContent).toBe('Try Again');
  });
});

describe('the requests that are not part of this step', () => {
  it('gives each one plain line and a link to its own page, and adds one for a missing document', () => {
    mount();
    const section = container.querySelector('[aria-labelledby$="-other"]') as HTMLElement;
    const text = section.textContent ?? '';
    expect(text).toContain('Not in This Step');
    expect(text).toContain('Saved copy is out of date.');
    expect(text).toContain('Nothing of this kind is saved.');
    expect(text).toContain('Answered on its own page.');
    expect(text).not.toMatch(/cannot be sent/i);
    const hrefs = [...section.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toContain(
      '/app/applicant/a1/evidence?item=req-National-Id#request-req-National-Id',
    );
    expect(hrefs).toContain('/app/applicant/a1/documents/add');
    expect(hrefs.filter((href) => href?.includes('/evidence?item='))).toHaveLength(3);
    expect(hrefs.filter((href) => href === '/app/applicant/a1/documents/add')).toHaveLength(1);
  });

  it('leaves a group out when it has nothing in it', () => {
    mount({ ready: REVIEW.ready, choose: [], other: [] });
    const headings = [...container.querySelectorAll('h3')].map((h) => h.textContent);
    expect(headings).toEqual(['Ready to Send']);
  });
});

describe('what the agency is told, and what only the traveller sees', () => {
  it('shows the accepted-before line to the traveller and never says the new agency accepted', () => {
    mount();
    const text = boxFor('Document: Passport').closest('label')?.textContent ?? '';
    expect(text).toContain('Accepted before by TEST Agency North. Each agency decides for itself.');
    expect(text).not.toContain(`Accepted before by ${AGENCY}`);
    expect(text).toContain('Expires 12 Mar 2031');
    expect(text).toContain('Version 1');
  });

  it('says an agency when none is named, and "No expiry date saved" when there is no date', () => {
    mount({
      ready: [item('Passport', 'READY', [copy('p', { acceptedBefore: { byAgency: null } })])],
      choose: [],
      other: [],
    });
    expect(container.textContent).toContain(
      'Accepted before by an agency. Each agency decides for itself.',
    );
    expect(container.textContent).toContain('No expiry date saved');
  });

  it('keeps the short consent line beside the button and the fuller text under About Sending', () => {
    mount();
    expect(container.textContent).toContain(
      `${AGENCY} can download these exact copies while it has access.`,
    );
    const about = [...container.querySelectorAll('details')].find((d) =>
      d.querySelector('summary')?.textContent?.includes('About Sending'),
    );
    expect(about?.textContent).toContain('Later changes to a file are not sent.');
    expect(about?.textContent).toContain('under Sharing');
    expect(about?.textContent).toContain('Each agency reviews for itself.');
  });
});

describe('the 30-word rule (Owner, 5 Nov 2026)', () => {
  it('holds at most 30 words of running prose at first view, at every width, and the rest is one tap away', () => {
    mount();
    const html = `<main>${container.innerHTML}</main>`;
    for (const viewport of ['phone', 'desktop'] as const) {
      const report = countProse(html, { viewport });
      expect(report.problems).toEqual([]);
      expect(report.words, JSON.stringify(report.passages)).toBeLessThanOrEqual(30);
    }
    // The fuller words are still there, under About These Items and About Sending.
    const folded = [...container.querySelectorAll('details')].map((d) => d.textContent ?? '');
    expect(folded.join(' ')).toContain(
      'The saved copy is expired, or older than the checklist allows.',
    );
  });
});
