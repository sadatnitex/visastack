import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { latinWords, textOf } from '../../../lib/next-mocks.test-support';
import { DELETION_PANEL_KEYS } from './deletion-panel.messages';

vi.mock('./actions', () => ({
  requestDeletionAction: vi.fn(),
  cancelDeletionAction: vi.fn(),
  requestLargeExportAction: vi.fn(),
}));

const { DeletionPanel } = await import('./deletion-panel');
const { pickMessages: pick } = await import('../../../lib/client-messages');

const impact = {
  applicants: [
    { id: 'a1', displayName: 'রহিম উদ্দিন' },
    { id: 'a2', displayName: 'Karim' },
  ],
  missionCount: 1,
  documentCount: 12,
  activePlatformRoleCount: 0,
  authoredMissionNoteCount: 3,
};

const hold = {
  id: 'h1',
  applicantDisplayName: 'রহিম উদ্দিন',
  reason: 'Court order 14/2026',
  placedLabel: '5 Oct 2026',
  reviewLabel: null,
  accessibleTo: ['Acme Visa Services'],
  scope: { kind: 'mission', missionTitle: 'UK Standard Visitor' } as const,
};

function render(locale: 'en' | 'bn', props: Partial<Parameters<typeof DeletionPanel>[0]> = {}) {
  return renderToStaticMarkup(
    <DeletionPanel
      scheduledLabel={null}
      impact={impact}
      holds={[]}
      messages={pick(locale, DELETION_PANEL_KEYS)}
      locale={locale}
      {...props}
    />,
  );
}

describe('DeletionPanel in English', () => {
  it('lists what deletion takes with the right plurals', () => {
    const text = textOf(render('en'));
    expect(text).toContain('This deletes your entire account.');
    expect(text).toContain('2 applicants (রহিম উদ্দিন, Karim)');
    expect(text).toContain('1 case');
    expect(text).not.toContain('1 cases');
    expect(text).toContain('12 documents');
    expect(text).toContain('3 notes you left on other cases (kept, author cleared)');
    expect(text).toContain('Request account deletion');
  });

  it('names a single applicant and a single document in the singular', () => {
    const text = textOf(
      render('en', {
        impact: { ...impact, applicants: [{ id: 'a1', displayName: 'A' }], documentCount: 1 },
      }),
    );
    expect(text).toContain('1 applicant (A)');
    expect(text).toContain('1 document');
    expect(text).not.toContain('1 documents');
  });

  it('shows a pending deletion with its date and a way to cancel', () => {
    const html = render('en', { scheduledLabel: '12 October 2026' });
    expect(html).toContain('<strong>Deletion pending.</strong>');
    expect(textOf(html)).toContain('permanent deletion on 12 October 2026');
    expect(textOf(html)).toContain('Cancel deletion');
  });

  it('explains a blocking legal hold with its real detail, in the singular', () => {
    const text = textOf(render('en', { holds: [hold] }));
    expect(text).toContain('Deletion is blocked.');
    expect(text).toContain('The following applicant record has an active legal hold');
    expect(text).toContain(
      'রহিম উদ্দিন - Court order 14/2026, scoped to case "UK Standard Visitor" only (placed 5 Oct 2026, next review not yet scheduled, accessible to Acme Visa Services)',
    );
  });

  it('uses the plural heading for more than one record', () => {
    expect(textOf(render('en', { holds: [hold, { ...hold, id: 'h2' }] }))).toContain(
      'The following applicant records have an active legal hold',
    );
  });
});

describe('DeletionPanel in Bangla', () => {
  it('is in Bangla, with digits, and names and reasons exactly as stored', () => {
    const text = textOf(render('bn'));
    expect(text).toContain('এতে আপনার পুরো অ্যাকাউন্ট মুছে যাবে।');
    expect(text).toContain('২জন আবেদনকারী (রহিম উদ্দিন, Karim)');
    expect(text).toContain('১টি কেস');
    expect(text).toContain('১২টি নথি');
    expect(text).toContain('অন্য কেসে আপনার রেখে যাওয়া ৩টি নোট');
    expect(text).toContain('অ্যাকাউন্ট মুছে ফেলার অনুরোধ করুন');
    expect([...new Set(latinWords(text))]).toEqual(['Karim']);
  });

  it('puts the export link where the Bangla sentence needs it', () => {
    const html = render('bn');
    expect(html).toContain('<a href="/app/privacy/export" download="">আপনার এক্সপোর্ট ডাউনলোড করুন</a>');
  });

  it('shows a pending deletion with its date', () => {
    const html = render('bn', { scheduledLabel: '১২ অক্টোবর, ২০২৬' });
    expect(html).toContain('<strong>মুছে ফেলা অপেক্ষমাণ।</strong>');
    expect(textOf(html)).toContain('১২ অক্টোবর, ২০২৬ তারিখে স্থায়ীভাবে মুছে ফেলার জন্য নির্ধারিত');
    expect(textOf(html)).toContain('মুছে ফেলা বাতিল করুন');
  });

  it('explains a blocking legal hold in Bangla with every detail kept', () => {
    const text = textOf(render('bn', { holds: [hold] }));
    expect(text).toContain('মুছে ফেলা আটকে আছে।');
    expect(text).toContain('আইনি সংরক্ষণ আদেশ');
    expect(text).toContain(
      'রহিম উদ্দিন - Court order 14/2026; পরিসর: শুধু "UK Standard Visitor" কেস (আরোপ: 5 Oct 2026, পরবর্তী পর্যালোচনা: এখনও নির্ধারিত হয়নি, প্রবেশাধিকার আছে: Acme Visa Services)',
    );
  });
});
