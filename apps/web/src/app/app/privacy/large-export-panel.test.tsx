import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { pickMessages } from '../../../lib/client-messages';
import { latinWords, textOf } from '../../../lib/next-mocks.test-support';
import { LARGE_EXPORT_KEYS } from './large-export-panel.messages';

vi.mock('./actions', () => ({ requestLargeExportAction: vi.fn() }));

const { LargeExportPanel } = await import('./large-export-panel');

const ready = {
  id: 'job1',
  status: 'READY' as const,
  createdAt: '2026-10-05T10:00:00Z',
  readyAt: '2026-10-05T10:05:00Z',
  expiresAt: '2026-10-06T10:05:00Z',
  expiresLabel: '6 Oct 2026, 10:05 UTC',
  lastError: null,
};

function render(locale: 'en' | 'bn', jobs: Parameters<typeof LargeExportPanel>[0]['jobs']) {
  return renderToStaticMarkup(
    <LargeExportPanel
      jobs={jobs}
      messages={pickMessages(locale, LARGE_EXPORT_KEYS)}
      locale={locale}
    />,
  );
}

describe('LargeExportPanel', () => {
  it('offers to request an export when none is in progress, in English', () => {
    const text = textOf(render('en', []));
    expect(text).toContain('Request large export (with files)');
    expect(text).toContain('stays downloadable for 24 hours');
  });

  it('offers it in Bangla, with the ZIP and CSV names kept', () => {
    const text = textOf(render('bn', []));
    expect(text).toContain('বড় এক্সপোর্টের অনুরোধ করুন (ফাইলসহ)');
    expect(text).toContain('২৪ ঘণ্টা');
    expect([...new Set(latinWords(text))].sort()).toEqual(['CSV', 'ZIP']);
  });

  it('shows a ready export with its download link and when it expires', () => {
    const html = render('en', [ready]);
    expect(html).toContain('href="/app/privacy/large-export/job1/download"');
    expect(textOf(html)).toContain('Download ZIP');
    expect(textOf(html)).toContain('expires 6 Oct 2026, 10:05 UTC');
    expect(html).not.toContain('Request large export');
  });

  it('shows the same in Bangla', () => {
    const text = textOf(render('bn', [{ ...ready, expiresLabel: '৬ অক্টো, ২০২৬, ১০:০৫ UTC' }]));
    expect(text).toContain('ZIP ডাউনলোড করুন');
    expect(text).toContain('মেয়াদ শেষ: ৬ অক্টো, ২০২৬, ১০:০৫ UTC');
  });

  it('shows an export that is being prepared, in each language', () => {
    expect(textOf(render('en', [{ ...ready, status: 'PENDING' }]))).toContain('Preparing…');
    expect(textOf(render('bn', [{ ...ready, status: 'CLAIMED' }]))).toContain('তৈরি হচ্ছে…');
  });

  it('lets a failed or expired export be requested again', () => {
    const failed = textOf(render('bn', [{ ...ready, status: 'FAILED' }]));
    expect(failed).toContain('বড় এক্সপোর্টের অনুরোধ করুন (ফাইলসহ)');
  });
});
