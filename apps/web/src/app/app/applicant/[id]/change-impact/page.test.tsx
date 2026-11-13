// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, textOf } from '../../../../../lib/next-mocks.test-support';

/**
 * The page where What This Change Affects is opened again: one change per address, the ordinary
 * not-found for anything else or anything refused, and a way to try again when it did not load.
 */

const mocks = vi.hoisted(() => ({ readDocument: vi.fn(), readDetail: vi.fn() }));
vi.mock('../../../../../lib/change-impact-read', () => ({
  readDocumentChangeImpact: mocks.readDocument,
  readDetailChangeImpact: mocks.readDetail,
}));
vi.mock('../../../../../lib/locale', () => ({ getLocale: async () => 'en' }));

const { default: ChangeImpactPage, metadata } = await import('./page');
const { APPLICANT_ID, DETAIL_RECORDED, DOCUMENT_RECORDED, LIVE_CASE, QUIET_EMPTY } = await import(
  './fixtures.test-support'
);
const { axeViolations } = await import('../../../../../lib/axe.test-support');

const page = (query: Record<string, string | string[]>) =>
  renderServer(
    ChangeImpactPage({
      params: Promise.resolve({ id: APPLICANT_ID }),
      searchParams: Promise.resolve(query),
    }),
  );

beforeEach(() => {
  vi.resetAllMocks();
});

describe('the What This Change Affects page', () => {
  it('shows the review of a replaced document under one page title', async () => {
    mocks.readDocument.mockResolvedValue(DOCUMENT_RECORDED);
    const html = await page({ document: 'd-old' });
    expect(mocks.readDocument.mock.calls).toEqual([[APPLICANT_ID, 'd-old']]);
    expect(mocks.readDetail).not.toHaveBeenCalled();
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toMatch(/<h1[^>]*>What This Change Affects<\/h1>/);
    expect(textOf(html)).toContain(`${LIVE_CASE} still uses the earlier document.`);
    expect(html).toContain(`href="/app/applicant/${APPLICANT_ID}/documents"`);
    expect(metadata.title).toBe('What This Change Affects');
    expect(await axeViolations(html)).toEqual([]);
  });

  it('shows the review of a changed detail', async () => {
    mocks.readDetail.mockResolvedValue(DETAIL_RECORDED);
    const html = await page({ detail: 'f-employer' });
    expect(mocks.readDetail.mock.calls).toEqual([[APPLICANT_ID, 'f-employer']]);
    expect(textOf(html)).toContain('You changed Employer Name on');
    expect(html).toContain(`href="/app/applicant/${APPLICANT_ID}/profile"`);
  });

  it('stays calm for a change that affects nothing', async () => {
    mocks.readDetail.mockResolvedValue(QUIET_EMPTY);
    const html = await page({ detail: 'f-employer' });
    expect(textOf(html)).toContain('Nothing else uses this. No action is needed.');
    expect(html).not.toMatch(/role="alert"/);
  });

  it('is the ordinary not-found when the read is refused', async () => {
    mocks.readDocument.mockResolvedValue('refused');
    await expect(page({ document: 'd-old' })).rejects.toThrow('NEXT_NOT_FOUND');
    mocks.readDetail.mockResolvedValue('refused');
    await expect(page({ detail: 'f-1' })).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('is the ordinary not-found with both parameters, with neither, or with an empty one', async () => {
    await expect(page({ document: 'd-old', detail: 'f-1' })).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(page({})).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(page({ document: '' })).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(page({ other: 'x' })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.readDocument).not.toHaveBeenCalled();
    expect(mocks.readDetail).not.toHaveBeenCalled();
  });

  it('offers the same address again when the list did not load', async () => {
    mocks.readDetail.mockResolvedValue('failed');
    const html = await page({ detail: 'f-1' });
    expect(textOf(html)).toContain('This List Did Not Load');
    expect(textOf(html)).toContain('Nothing in your records was changed.');
    expect(html).toContain(`href="/app/applicant/${APPLICANT_ID}/change-impact?detail=f-1"`);
    expect(html).not.toMatch(/role="alert"/);
    expect(await axeViolations(html)).toEqual([]);
  });
});
