import { createI18n } from '@visastack/i18n';
import { describe, expect, it } from 'vitest';
import { alertText } from './alert-text';
import { pickMessages } from './client-messages';
import { errorText } from './localize-error';
import { PRIMARY_NAV, applicantTabs, localizeLinks } from './navigation';

const en = createI18n('en');
const bn = createI18n('bn');

describe('errorText', () => {
  it('shows an English reader the service message exactly as before', () => {
    expect(errorText(en, { code: 'invalid', message: 'a display name is required' })).toBe(
      'a display name is required',
    );
  });

  it('shows a Bangla reader the message for the kind of failure, never the English', () => {
    const text = errorText(bn, { code: 'forbidden', message: 'not allowed' });
    expect(text).toBe('এটি করার অনুমতি আপনার নেই।');
    expect(text).not.toContain('not allowed');
  });

  it('covers every kind of failure with its own Bangla message', () => {
    const codes = [
      'forbidden',
      'step_up_required',
      'not_found',
      'consent_required',
      'unknown_field',
      'invalid',
      'upstream_error',
      'rate_limited',
      'encryption_unavailable',
      'stale',
    ] as const;
    for (const code of codes) {
      const text = errorText(bn, { code, message: 'raw english' });
      expect(text, code).not.toBe('raw english');
      expect(/[ঀ-৿]/.test(text), code).toBe(true);
    }
  });

  it('uses the failure-specific message in either language when the service named one', () => {
    const error = {
      code: 'invalid',
      message: 'an active legal hold blocks deletion',
      key: 'privacy.error.holdBlocks',
    } as const;
    expect(errorText(en, error)).toBe('An active legal hold blocks deletion.');
    expect(errorText(bn, error)).toBe('একটি সক্রিয় আইনি সংরক্ষণ আদেশের কারণে মুছে ফেলা আটকে আছে।');
  });
});

describe('alertText', () => {
  const stored = {
    subject: 'A document is expiring soon',
    summary: '"Passport" is expiring soon. Check whether it needs renewing.',
  };

  it('shows an alert in the readers language from the messages it was written from', () => {
    const alert = {
      ...stored,
      messages: {
        subject: 'alert.documentExpiry.subject',
        summary: 'alert.documentExpiry.summary',
        params: { name: 'পাসপোর্ট' },
      },
    } as const;
    expect(alertText(en, alert)).toEqual({
      subject: 'A document is expiring soon',
      summary: '"পাসপোর্ট" is expiring soon. Check whether it needs renewing.',
    });
    expect(alertText(bn, alert)).toEqual({
      subject: 'একটি নথির মেয়াদ শীঘ্রই শেষ হচ্ছে',
      summary: '"পাসপোর্ট" নথির মেয়াদ শীঘ্রই শেষ হচ্ছে। নবায়ন করা দরকার কি না দেখে নিন।',
    });
  });

  it('writes a number inside an alert in Bengali digits and a name exactly as stored', () => {
    const alert = {
      subject: 'x',
      summary: 'x',
      messages: {
        subject: 'alert.caseRetention.subject',
        summary: 'alert.caseRetention.summary',
        params: { months: 12 },
      },
    } as const;
    expect(alertText(bn, alert).summary).toContain('১২ মাস');
    expect(alertText(en, alert).summary).toContain('12 months');
  });

  it('keeps the stored English for an alert written before messages were recorded', () => {
    expect(alertText(bn, stored)).toEqual(stored);
  });

  it('keeps the stored English when the recorded message no longer exists', () => {
    const alert = {
      ...stored,
      messages: { subject: 'alert.removed.subject', summary: 'alert.removed.summary' },
    };
    // @ts-expect-error a key that is no longer in the catalog is exactly what this simulates
    expect(alertText(bn, alert)).toEqual(stored);
  });
});

describe('pickMessages', () => {
  it('gives a client component only the messages it asked for', () => {
    const picked = pickMessages('bn', ['consent.action.grant', 'consent.saving'] as const);
    expect(Object.keys(picked).sort()).toEqual(['consent.action.grant', 'consent.saving']);
    expect(picked['consent.action.grant']).toBe('প্রদান করুন');
  });

  it('returns the templates unfilled, for the browser to fill', () => {
    const picked = pickMessages('en', ['privacy.large.expires'] as const);
    expect(picked['privacy.large.expires']).toBe('expires {when}');
  });
});

describe('localizeLinks', () => {
  it('names the signed-in navigation in the readers language', () => {
    expect(localizeLinks(PRIMARY_NAV, bn.t).map((link) => link.label)).toEqual([
      'সারসংক্ষেপ',
      'আবেদনকারী',
      'আমার সাথে শেয়ার করা',
      'বিজ্ঞপ্তি',
      'গোপনীয়তা',
      'অ্যাকাউন্ট',
    ]);
    expect(localizeLinks(PRIMARY_NAV, en.t).map((link) => link.label)).toEqual(
      PRIMARY_NAV.map((link) => link.label),
    );
  });

  it('names every applicant tab in Bangla and keeps where each one goes', () => {
    const tabs = localizeLinks(applicantTabs('a1'), bn.t);
    expect(tabs.map((tab) => tab.label)).toEqual([
      'সারসংক্ষেপ',
      'প্রোফাইল',
      'নথি',
      'কেস',
      'শেয়ারিং',
      'প্রমাণ',
      'মেয়াদ',
      'ইতিহাস',
    ]);
    expect(tabs.map((tab) => tab.href)).toEqual(applicantTabs('a1').map((tab) => tab.href));
  });

  it('leaves a link with no message in English', () => {
    const [link] = localizeLinks([{ href: '/x', label: 'Only English' }], bn.t);
    expect(link?.label).toBe('Only English');
  });
});
