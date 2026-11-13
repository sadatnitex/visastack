// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../../../components/i18n-provider';
import { evidenceAnswerCatalog } from '../../../../../../i18n/evidence-answer';
import {
  bengaliWithoutLanguageMark,
  expectEveryLiveMessageRendered,
} from '../../bn-coverage.test-support';
import type { AnswerCopyView, AnswerItemView, AnswerReviewView } from './answer-view';

/**
 * The review form of Answer from Your Records under Bengali: every sentence the form can show is
 * rendered on the real form, in Bengali for a Bengali reader and in the exact English otherwise,
 * and each Bengali part says which language it is in (the page itself is still marked English).
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@visastack/i18n', async (original) =>
  (await import('../../bn-coverage.test-support')).trackBengali(await original()),
);
const mocks = vi.hoisted(() => ({ confirmAnswersAction: vi.fn(), replace: vi.fn() }));
vi.mock('./actions', () => ({ confirmAnswersAction: mocks.confirmAnswersAction }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace, refresh: vi.fn(), push: vi.fn(), back: vi.fn() }),
}));

const { AnswerSetForm } = await import('./answer-set-form');

const AGENCY = 'TEST Agency Unrelated';
const BENGALI = /[ঀ-৿]/;

const copy = (id: string, over: Partial<AnswerCopyView> = {}): AnswerCopyView => ({
  documentId: `doc-${id}`,
  versionId: `ver-${id}`,
  name: `${id}.pdf`,
  versionNumber: 2,
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

/** One review that reaches every group, every kind of copy line and every "not in this step" kind. */
const REVIEW: AnswerReviewView = {
  ready: [
    item(
      'Passport',
      'READY',
      [
        copy('passport', {
          expiresLabel: '12 Mar 2031',
          documentDateLabel: '1 Mar 2021',
          acceptedBefore: { byAgency: 'TEST Agency North' },
        }),
      ],
      { referenceCode: 'R-7K2Q9M' },
    ),
    item('Bank Statement', 'READY', [copy('bank', { acceptedBefore: { byAgency: null } })]),
  ],
  choose: [
    item('Photo', 'CHOOSE', [copy('photo-a'), copy('photo-b')]),
    item('Utility Bill', 'CHECK_DATE', [copy('bill', { uncertainty: { kind: 'age', days: 90 } })], {
      optional: true,
    }),
    item('Visa', 'CHECK_DATE', [copy('visa', { uncertainty: { kind: 'disagree' } })]),
  ],
  other: [
    item('National Id', 'OUTDATED'),
    item('Employment Letter', 'MISSING'),
    item('Passport Number', 'OWN_STEP'),
    item('Portrait', 'NEEDS_NEW_COPY'),
    item('Tax Return', 'NOT_CHECKED'),
    item('Old Request', 'NO_ACCESS'),
  ],
};
const many = (n: number): AnswerReviewView => ({
  ready: Array.from({ length: n }, (_unused, i) => item(`Doc ${i}`, 'READY', [copy(`c${i}`)])),
  choose: [],
  other: [],
});

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

function mount(locale: 'en' | 'bn', review: AnswerReviewView = REVIEW) {
  act(() =>
    root.render(
      <I18nProvider locale={locale} pageLang="en">
        <AnswerSetForm
          applicantId="a1"
          organizationId="org-1"
          agencyName={AGENCY}
          confirmationKey="k9Qm2x_T7vLw4Rz0Hc8Yb1Nd"
          planKey="plan-1"
          review={review}
          waitingTotal={3}
          timeZone="Asia/Dhaka"
        />
      </I18nProvider>,
    ),
  );
}
const text = () => container.textContent ?? '';
const button = () => container.querySelector('button[type="submit"]') as HTMLButtonElement;
const click = (el: HTMLElement) =>
  act(() => {
    el.click();
  });
const boxes = () => [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];

describe('the review form for a Bengali reader', () => {
  it('words the groups, each copy and the send button in Bengali, with Bengali digits', () => {
    mount('bn');
    const shown = text();
    expect(shown).toContain('পাঠানোর জন্য প্রস্তুত');
    expect(shown).toContain('আপনাকে বেছে নিতে হবে');
    expect(shown).toContain('এই ধাপে নেই');
    expect(shown).toContain('কপি ২');
    expect(shown).toContain('যোগ করা হয়েছে 12 Nov 2026, 10:00 GMT+6');
    expect(shown).toContain('মেয়াদ শেষ হবে 12 Mar 2031');
    expect(shown).toContain('মেয়াদ শেষের কোনো তারিখ সংরক্ষিত নেই');
    expect(shown).toContain('তারিখ 1 Mar 2021');
    expect(shown).toContain('রেফারেন্স R-7K2Q9M');
    expect(shown).toContain('চেকলিস্টে ঐচ্ছিক');
    expect(shown).toContain('এখন পাঠাবেন না');
    expect(button().textContent).toBe(`${AGENCY}-কে ২টি উত্তর পাঠান`);
    // The names a person typed, and the agency's own name, are never translated.
    expect(shown).toContain('Document: Passport');
    expect(shown).toContain('passport.pdf');
  });

  it('says why a copy needs a look, and who accepted it before, without saying the new agency accepted', () => {
    mount('bn');
    const shown = text();
    expect(shown).toContain(
      'চেকলিস্টে গত ৯০ দিনের মধ্যের একটি ডকুমেন্ট চাওয়া হয়েছে। এই কপির কোনো তারিখ সংরক্ষিত নেই, তাই পাঠানোর আগে এটি দেখে নিন।',
    );
    expect(shown).toContain(
      'এই কপির জন্য সংরক্ষিত মেয়াদ শেষের দুটি তারিখ মিলছে না। পাঠানোর আগে এটি দেখে নিন।',
    );
    expect(shown).toContain(
      'আগে TEST Agency North এটি গ্রহণ করেছিল। প্রতিটি এজেন্সি নিজেই সিদ্ধান্ত নেয়।',
    );
    expect(shown).toContain('আগে একটি এজেন্সি এটি গ্রহণ করেছিল। প্রতিটি এজেন্সি নিজেই সিদ্ধান্ত নেয়।');
    expect(shown).not.toContain(`${AGENCY} এটি গ্রহণ`);
  });

  it('gives each request outside this step its plain line, its fuller line and its links', () => {
    mount('bn');
    const shown = text();
    for (const line of [
      'সংরক্ষিত কপিটি পুরোনো হয়ে গেছে।',
      'এই ধরনের কিছু সংরক্ষিত নেই।',
      'এর উত্তর নিজস্ব পাতায় দেওয়া হয়।',
      'ফেরত পাঠানো হয়েছে। আরও স্পষ্ট একটি কপি যোগ করুন।',
      'এই ডকুমেন্টটি এখনো পাঠানো যাচ্ছে না।',
      'এজেন্সির আর অ্যাক্সেস নেই।',
      'এই আইটেমগুলো সম্পর্কে',
      'এই এজেন্সির আর আপনার রেকর্ডে অ্যাক্সেস নেই, তাই এই অনুরোধের জন্য কিছু পাঠানো যাবে না।',
      'এই অনুরোধটি খুলুন',
      'ডকুমেন্ট যোগ করুন',
    ])
      expect(shown).toContain(line);
  });

  it('keeps the short consent line by the button and the fuller words under the fold', () => {
    mount('bn');
    const shown = text();
    expect(shown).toContain(`অ্যাক্সেস থাকা অবস্থায় ${AGENCY} এই হুবহু কপিগুলো ডাউনলোড করতে পারবে।`);
    expect(shown).toContain('পাঠানো সম্পর্কে');
    expect(shown).toContain('আপনি যেকোনো সময় শেয়ারিং থেকে অ্যাক্সেস বন্ধ করতে পারেন।');
  });

  it('says in words why the button is not available with nothing chosen', () => {
    mount('bn');
    for (const box of boxes().filter((b) => b.checked)) click(box);
    expect(button().textContent).toBe(`${AGENCY}-কে উত্তর পাঠান`);
    expect(text()).toContain('পাঠানোর জন্য অন্তত একটি উত্তরে টিক দিন।');
  });

  it('says the most one step can send, in Bengali digits', () => {
    mount('bn', many(26));
    expect(button().disabled).toBe(true);
    expect(text()).toContain(
      'এক ধাপে সর্বোচ্চ ২৫টি উত্তর পাঠানো যায়। কয়েকটির টিক তুলে দিয়ে পাঠান, তারপর বাকিগুলো পাঠান।',
    );
  });

  it('marks every Bengali part as Bengali, because the page itself is still marked English', () => {
    mount('bn');
    expect(bengaliWithoutLanguageMark(container)).toEqual([]);
    expect(container.querySelectorAll('[lang="bn"]').length).toBeGreaterThan(20);
  });
});

describe('the review form for an English reader is unchanged', () => {
  it('shows the exact English and no language marks', () => {
    mount('en');
    const shown = text();
    expect(shown).toContain('Ready to Send');
    expect(shown).toContain('Version 2');
    expect(shown).toContain('Added 12 Nov 2026, 10:00 GMT+6');
    expect(shown).toContain(
      'Accepted before by TEST Agency North. Each agency decides for itself.',
    );
    expect(shown).toContain(`${AGENCY} can download these exact copies while it has access.`);
    expect(button().textContent).toBe(`Send 2 Answers to ${AGENCY}`);
    expect(BENGALI.test(shown)).toBe(false);
    expect(container.querySelectorAll('[lang]').length).toBe(0);
  });

  it('keeps the English limit sentence, with Latin digits', () => {
    mount('en', many(26));
    expect(text()).toContain(
      'One step sends up to 25 answers. Untick some, send, then send the rest.',
    );
  });
});

describe('coverage', () => {
  it('rendered every Bengali sentence the form has', () => {
    // The tests above ran first in this file: each form sentence was shown to a Bengali reader.
    expectEveryLiveMessageRendered(evidenceAnswerCatalog, 'evidenceAnswer.form.');
  });
});
