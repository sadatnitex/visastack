import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../../../../lib/axe.test-support';
import { renderServer, textOf } from '../../../../../lib/next-mocks.test-support';

const service = vi.hoisted(() => ({
  getApplicant: vi.fn(),
  getProfileSectionState: vi.fn(),
  getWalletView: vi.fn(),
  hasConsent: vi.fn(),
  listApplicantAssurance: vi.fn(),
  listApplicantProfile: vi.fn(),
  listDocumentsDetailed: vi.fn(),
  listPendingAppSuggestions: vi.fn(),
  aiSuggestionsInUse: vi.fn(),
  requireAccess: vi.fn(),
  listEndedRecords: vi.fn(),
}));
const editorProps = vi.hoisted(() => ({ last: undefined as unknown }));

vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  ...service,
}));
vi.mock('../../../../../lib/session', () => ({
  withSession: (callback: (ctx: unknown) => unknown) => callback({ db: {}, accountId: 'owner' }),
}));
vi.mock('../../../../../lib/profile-photos', () => ({ ownedPhotoUrl: () => null }));
vi.mock('../../../../../lib/providers', () => ({
  createKeyManagementPort: () => ({ port: 'keys' }),
}));
vi.mock('../../../../../lib/ccd/depth.server', () => ({ readDepth: async () => 'auto' }));
vi.mock('../profile-editor', () => ({
  ProfileEditor: (props: unknown) => {
    editorProps.last = props;
    return <div id="profile-editor">Versioned editor</div>;
  },
}));
vi.mock('../../../../../components/profile-photo/profile-photo-control', () => ({
  ProfilePhotoControl: () => <div>Photo control</div>,
}));
vi.mock('../actions', () => ({
  decideProposalAction: vi.fn(),
  acceptClearDetailsAction: vi.fn(),
  decideClassificationProposalAction: vi.fn(),
  decideInconsistencyFlagAction: vi.fn(),
  readAgainAction: vi.fn(),
  runClassificationAction: vi.fn(),
  runInconsistencyCheckAction: vi.fn(),
}));

const { default: ProfilePage } = await import('./page');

const render = async () =>
  renderServer(
    ProfilePage({
      params: Promise.resolve({ id: 'person' }),
      searchParams: Promise.resolve({}),
    } as never),
  );

function suggestion(overrides: { documentVersionId?: string | null; fromApp?: unknown } = {}) {
  return {
    proposal: {
      id: 'p-1',
      aiExtractionRunId: 'r-1',
      documentVersionId: overrides.documentVersionId ?? null,
      applicantId: 'person',
      type: 'UPDATE',
      fieldKey: 'phone',
      value: '+8801700000999',
      confidence: 0,
      rationale: 'The person told me their number changed.',
      status: 'PENDING',
    },
    evidence: [],
    ...('fromApp' in overrides
      ? overrides.fromApp === undefined
        ? {}
        : { fromApp: overrides.fromApp }
      : { fromApp: { name: 'Claude', host: 'claude.ai' } }),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  service.getApplicant.mockResolvedValue({
    id: 'person',
    displayName: 'Karim Hossain',
    relationship: 'SELF',
    ownerAccountId: 'owner',
    createdAt: new Date('2026-01-01'),
  });
  service.getProfileSectionState.mockResolvedValue({
    activated: new Set(),
    notApplicable: new Set(),
    noneDeclared: new Set(),
  });
  service.getWalletView.mockResolvedValue({ ok: true, value: [] });
  service.hasConsent.mockResolvedValue(true);
  service.listApplicantAssurance.mockResolvedValue({ ok: true, value: [] });
  service.listApplicantProfile.mockResolvedValue([]);
  service.listDocumentsDetailed.mockResolvedValue({ ok: true, value: [] });
  service.listPendingAppSuggestions.mockResolvedValue([]);
  service.aiSuggestionsInUse.mockResolvedValue(false);
  service.requireAccess.mockResolvedValue({ ok: true, value: { proof: 'owner' } });
  service.listEndedRecords.mockResolvedValue(new Map());
});

describe('Ended entries (LC-G1)', () => {
  it('passes the ended entries to the editor, read through the owner gate', async () => {
    service.listEndedRecords.mockResolvedValue(new Map([['r1', '2025-06-30T00:00:00.000Z']]));
    await render();
    expect(service.listEndedRecords).toHaveBeenCalledWith({ proof: 'owner' });
    expect((editorProps.last as { endedRecords?: unknown }).endedRecords).toEqual({
      r1: '2025-06-30T00:00:00.000Z',
    });
  });
});

describe('Suggestions from AI Apps on My Profile (S21)', () => {
  it('is not there when no AI app suggested anything, so the page reads as before', async () => {
    const text = textOf(await render());
    expect(text).not.toContain('Suggestions from AI Apps');
    expect(text).not.toContain('Suggested by');
  });

  it('lists an app’s suggestion about the profile, named by the app, with its own reason', async () => {
    service.listPendingAppSuggestions.mockResolvedValue([suggestion()]);
    const html = await render();
    const text = textOf(html);
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(text).toContain('Suggestions from AI Apps');
    expect(text).toContain('1 change your AI apps suggested');
    expect(text).toContain('Suggested by Claude (claude.ai)');
    expect(text).toContain('The app’s reason, in its own words:');
    expect(text).toContain('The person told me their number changed.');
    expect(text).toContain('Accept');
    expect(text).toContain('Skip');
    expect(html.match(/Suggested by/g)).toHaveLength(1);
    expect(await axeViolations(html)).toEqual([]);
  });
});

describe('comparing an app suggestion with a protected value (S21 review)', () => {
  it('reads the protected value first, so the same value is not shown as a difference', async () => {
    const entry = (value: string | null) => ({
      factId: 'f-phone',
      fieldKey: 'phone',
      repeatingRecordKey: null,
      value,
      status: 'APPLICANT_CONFIRMED',
      method: 'MANUAL',
      updatedAt: '2026-10-10T12:00:00Z',
      effectiveFrom: null,
      isProtected: true,
      sourceDocumentId: null,
    });
    // Without the key the stored value cannot be read; with it, it is the same as the suggestion.
    service.listApplicantProfile.mockImplementation(async (_db, _id, keys) =>
      keys ? [entry('+8801700000999')] : [entry('masked')],
    );
    service.listPendingAppSuggestions.mockResolvedValue([suggestion()]);
    const text = textOf(await render());
    expect(service.listApplicantProfile).toHaveBeenCalledWith({}, 'person', { port: 'keys' });
    expect(text).toContain('Suggested by Claude (claude.ai)');
    expect(text).not.toContain('Which is right?');
  });
});

describe('the section after the last decision (S21 review A2)', () => {
  it('stays, saying nothing is waiting, while an app may suggest more', async () => {
    service.aiSuggestionsInUse.mockResolvedValue(true);
    const html = await render();
    expect(textOf(html)).toContain('Suggestions from AI Apps');
    expect(textOf(html)).toContain('Nothing waiting.');
    expect(html).toContain('id="ai-app-suggestions-title" tabindex="-1"');
  });
});
