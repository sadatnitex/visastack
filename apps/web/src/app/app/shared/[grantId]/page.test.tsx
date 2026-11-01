import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, stub, stubProps } from '../../../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({
  getRecipientWorkspace: vi.fn(),
  mayUseVisaPhotoSizes: vi.fn(),
  safeCopyOffers: vi.fn(),
  safeCopiesOn: true,
}));

vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  getRecipientWorkspace: mocks.getRecipientWorkspace,
}));
vi.mock('../../../../lib/photo-sizes', () => ({
  mayUseVisaPhotoSizes: mocks.mayUseVisaPhotoSizes,
}));
vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: { db: true }, accountId: 'agent-1', email: 'agent@example.com' }),
}));
vi.mock('../../../../components/visa-photo-sizes', () => ({
  VisaPhotoSizes: stub('VisaPhotoSizes'),
}));
vi.mock('../../../../lib/safe-copy', () => ({
  safeCopyOffers: mocks.safeCopyOffers,
  safeCopiesAvailable: () => mocks.safeCopiesOn,
}));
vi.mock('../../../../components/safe-copy-download', () => ({
  SafeCopyDownload: stub('SafeCopyDownload'),
}));

const { default: SharedWorkspacePage } = await import('./page');

const ORG = '00000000-0000-4000-8000-0000000000aa';

function workspace(actions: readonly string[], organizationId: string | null = ORG) {
  return {
    ok: true,
    value: {
      applicantId: 'app-1',
      applicantDisplayName: 'Synthetic Traveller',
      grant: {
        id: 'grant-1',
        purpose: 'visa-application',
        expiryAt: null,
        actions,
        recipientOrganizationId: organizationId,
      },
      fields: [],
      documents: [
        { id: 'photo-1', displayName: 'me.jpg', docType: 'PHOTO' },
        { id: 'card-1', displayName: 'card.jpg', docType: 'PHOTO_ID' },
        { id: 'cert-1', displayName: 'cert.pdf', docType: 'EMPLOYMENT_CERTIFICATE' },
      ],
      missionScopeUnavailable: false,
    },
  };
}

const render = async () =>
  renderServer(SharedWorkspacePage({ params: Promise.resolve({ grantId: 'grant-1' }) }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.safeCopiesOn = true;
  mocks.safeCopyOffers.mockImplementation(
    async (_db, _account, ids: string[]) => new Map(ids.map((id) => [id, 'none'])),
  );
});

describe('Visa Photo Sizes on a shared record', () => {
  it('appears for a photo the viewer may take safe copies of, asked of the central gate', async () => {
    mocks.getRecipientWorkspace.mockResolvedValue(workspace(['VIEW_METADATA', 'PREVIEW']));
    mocks.mayUseVisaPhotoSizes.mockResolvedValue(true);
    const sections = stubProps<{ documentId: string; actingFor: string }>(
      await render(),
      'VisaPhotoSizes',
    );
    expect(sections).toEqual([
      { documentId: 'photo-1', returnTo: '/app/shared/grant-1', actingFor: ORG },
    ]);
    // Decided by the gate across every grant, not by this one grant's action list, and only for
    // the Photograph kind itself (not PHOTO_ID, which can be an identity card).
    expect(mocks.mayUseVisaPhotoSizes).toHaveBeenCalledTimes(1);
    expect(mocks.mayUseVisaPhotoSizes).toHaveBeenCalledWith({ db: true }, 'agent-1', 'photo-1', {
      organizationId: ORG,
    });
  });

  it('is hidden when the gate says the viewer may only preview, even with a download action listed', async () => {
    mocks.getRecipientWorkspace.mockResolvedValue(
      workspace(['VIEW_METADATA', 'PREVIEW', 'DOWNLOAD_REDACTED']),
    );
    mocks.mayUseVisaPhotoSizes.mockResolvedValue(false);
    expect(stubProps(await render(), 'VisaPhotoSizes')).toEqual([]);
  });

  it('acts as an individual recipient when the grant names no organization', async () => {
    mocks.getRecipientWorkspace.mockResolvedValue(workspace(['PREVIEW'], null));
    mocks.mayUseVisaPhotoSizes.mockResolvedValue(true);
    const [section] = stubProps<{ actingFor: string }>(await render(), 'VisaPhotoSizes');
    expect(section?.actingFor).toBe('individual');
    expect(mocks.mayUseVisaPhotoSizes.mock.calls[0]?.[3]).toBe('individual');
  });

  it('is not found for an unknown or refused grant, the same answer for both', async () => {
    mocks.getRecipientWorkspace.mockResolvedValue({ ok: false, error: { code: 'NOT_FOUND' } });
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.getRecipientWorkspace).toHaveBeenCalledWith(
      { db: true },
      { actorAccountId: 'agent-1', grantId: 'grant-1' },
    );
    expect(mocks.mayUseVisaPhotoSizes).not.toHaveBeenCalled();
  });
});

describe('Safe copies on a shared record (S23)', () => {
  const offering = (offers: Record<string, string>) =>
    mocks.safeCopyOffers.mockImplementation(
      async (_db, _account, ids: string[]) => new Map(ids.map((id) => [id, offers[id] ?? 'none'])),
    );

  it('offers Download Safe Copy only where the gate allows it, and says when one is not prepared', async () => {
    mocks.getRecipientWorkspace.mockResolvedValue(
      workspace(['VIEW_METADATA', 'DOWNLOAD_REDACTED']),
    );
    mocks.mayUseVisaPhotoSizes.mockResolvedValue(false);
    offering({ 'photo-1': 'none', 'card-1': 'not_prepared', 'cert-1': 'ready' });
    const html = await render();
    expect(stubProps(html, 'SafeCopyDownload')).toEqual([
      { documentId: 'cert-1', returnTo: '/app/shared/grant-1', actingFor: ORG },
    ]);
    expect(html.match(/Safe Copy: Not Prepared Yet/g)).toHaveLength(1);
    // Asked once, for every document, through the grant's relationship.
    expect(mocks.safeCopyOffers).toHaveBeenCalledTimes(1);
    expect(mocks.safeCopyOffers.mock.calls[0]?.slice(1)).toEqual([
      'agent-1',
      ['photo-1', 'card-1', 'cert-1'],
      { organizationId: ORG },
    ]);
    expect(html).toContain('A safe copy is a picture of each page');
  });

  it('shows the button behind an identity check only for a ready copy, and names files it cannot cover', async () => {
    mocks.getRecipientWorkspace.mockResolvedValue(workspace(['DOWNLOAD_REDACTED'], null));
    mocks.mayUseVisaPhotoSizes.mockResolvedValue(false);
    offering({ 'photo-1': 'confirm', 'card-1': 'not_available', 'cert-1': 'not_prepared' });
    const html = await render();
    const buttons = stubProps<{ documentId: string; actingFor: string }>(html, 'SafeCopyDownload');
    expect(buttons.map((b) => b.documentId)).toEqual(['photo-1']);
    expect(buttons[0]?.actingFor).toBe('individual');
    expect(html).toContain('Safe Copy Not Available for This File');
    expect(mocks.safeCopyOffers.mock.calls[0]?.[3]).toBe('individual');
  });

  it('shows nothing about safe copies to a viewer who may not download them', async () => {
    mocks.getRecipientWorkspace.mockResolvedValue(workspace(['VIEW_METADATA', 'PREVIEW']));
    mocks.mayUseVisaPhotoSizes.mockResolvedValue(false);
    const html = await render();
    expect(stubProps(html, 'SafeCopyDownload')).toEqual([]);
    expect(html).not.toContain('Safe Copy');
    expect(html).not.toContain('safe copy is a picture');
  });

  it('says plainly when safe copies are off here, and asks nothing', async () => {
    mocks.safeCopiesOn = false;
    mocks.getRecipientWorkspace.mockResolvedValue(workspace(['DOWNLOAD_REDACTED']));
    mocks.mayUseVisaPhotoSizes.mockResolvedValue(false);
    const html = await render();
    expect(html).toContain('Safe copies are not available here yet.');
    expect(mocks.safeCopyOffers).not.toHaveBeenCalled();
    expect(stubProps(html, 'SafeCopyDownload')).toEqual([]);
  });
});

describe('a long shared record stays short (WP-SB3)', () => {
  function large() {
    const base = workspace(['VIEW_METADATA', 'DOWNLOAD_REDACTED']);
    return {
      ...base,
      value: {
        ...base.value,
        fields: Array.from({ length: 30 }, (_, index) => ({
          fieldKey: `custom_field_${index}`,
          value: `Value ${index}`,
        })),
        documents: Array.from({ length: 30 }, (_, index) => ({
          id: `doc-${index}`,
          displayName: `File ${index}.pdf`,
          docType: index === 25 ? 'PHOTO' : 'EMPLOYMENT_CERTIFICATE',
        })),
      },
    };
  }
  const renderAt = (search: Record<string, string>) =>
    renderServer(
      SharedWorkspacePage({
        params: Promise.resolve({ grantId: 'grant-1' }),
        searchParams: Promise.resolve(search),
      }),
    );

  it('lists ten details and ten documents, each with Show More', async () => {
    mocks.getRecipientWorkspace.mockResolvedValue(large());
    mocks.mayUseVisaPhotoSizes.mockResolvedValue(true);
    const html = await render();
    expect(html.match(/id="shared-field-\d+"/g)).toHaveLength(10);
    expect(html.match(/id="shared-document-\d+"/g)).toHaveLength(10);
    expect(html).toContain('Showing 10 of 30 details.');
    expect(html).toContain('Showing 10 of 30 documents.');
    expect(html).toContain('href="/app/shared/grant-1?fields=20#shared-field-11"');
    expect(html).toContain('href="/app/shared/grant-1?docs=20#shared-document-11"');
    // Only the documents on the page are asked about; the photo is not on it yet.
    expect(mocks.safeCopyOffers.mock.calls[0]?.[2]).toHaveLength(10);
    expect(mocks.mayUseVisaPhotoSizes).not.toHaveBeenCalled();
  });

  it('keeps the other list where it was when one grows', async () => {
    mocks.getRecipientWorkspace.mockResolvedValue(large());
    mocks.mayUseVisaPhotoSizes.mockResolvedValue(true);
    const html = await renderAt({ docs: '30' });
    expect(html.match(/id="shared-document-\d+"/g)).toHaveLength(30);
    expect(html.match(/id="shared-field-\d+"/g)).toHaveLength(10);
    expect(html).toContain('href="/app/shared/grant-1?docs=30&amp;fields=20#shared-field-11"');
    expect(html).toContain('Showing all 30 documents.');
    expect(mocks.mayUseVisaPhotoSizes).toHaveBeenCalledTimes(1);
  });
});
