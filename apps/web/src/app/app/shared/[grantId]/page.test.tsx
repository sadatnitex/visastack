import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, stub, stubProps } from '../../../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({
  getRecipientWorkspace: vi.fn(),
  mayUseVisaPhotoSizes: vi.fn(),
  safeCopyOffer: vi.fn(),
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
vi.mock('../../../../lib/safe-copy', () => ({ safeCopyOffer: mocks.safeCopyOffer }));
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
  mocks.safeCopyOffer.mockResolvedValue('none');
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
  it('offers Download Safe Copy only where the gate allows it, and says when one is not prepared', async () => {
    mocks.getRecipientWorkspace.mockResolvedValue(
      workspace(['VIEW_METADATA', 'DOWNLOAD_REDACTED']),
    );
    mocks.mayUseVisaPhotoSizes.mockResolvedValue(false);
    const offers: Record<string, string> = {
      'photo-1': 'none',
      'card-1': 'not_prepared',
      'cert-1': 'ready',
    };
    mocks.safeCopyOffer.mockImplementation(async (_db, _account, id: string) => offers[id]);
    const html = await render();
    expect(stubProps(html, 'SafeCopyDownload')).toEqual([
      { documentId: 'cert-1', returnTo: '/app/shared/grant-1', actingFor: ORG },
    ]);
    expect(html.match(/Safe Copy: Not Prepared Yet/g)).toHaveLength(1);
    // Asked of the gate for every document, through the grant's relationship.
    expect(mocks.safeCopyOffer.mock.calls.map((call) => call[2])).toEqual([
      'photo-1',
      'card-1',
      'cert-1',
    ]);
    expect(mocks.safeCopyOffer.mock.calls[0]?.[3]).toEqual({ organizationId: ORG });
    expect(html).toContain('A safe copy is a picture of each page');
  });

  it('shows the button for a restricted document that needs a fresh identity check first', async () => {
    mocks.getRecipientWorkspace.mockResolvedValue(workspace(['DOWNLOAD_REDACTED'], null));
    mocks.mayUseVisaPhotoSizes.mockResolvedValue(false);
    mocks.safeCopyOffer.mockResolvedValue('confirm');
    const buttons = stubProps<{ actingFor: string }>(await render(), 'SafeCopyDownload');
    expect(buttons).toHaveLength(3);
    expect(buttons[0]?.actingFor).toBe('individual');
  });

  it('shows nothing about safe copies to a viewer who may not download them', async () => {
    mocks.getRecipientWorkspace.mockResolvedValue(workspace(['VIEW_METADATA', 'PREVIEW']));
    mocks.mayUseVisaPhotoSizes.mockResolvedValue(false);
    const html = await render();
    expect(stubProps(html, 'SafeCopyDownload')).toEqual([]);
    expect(html).not.toContain('Safe Copy');
    expect(html).not.toContain('safe copy is a picture');
  });
});
