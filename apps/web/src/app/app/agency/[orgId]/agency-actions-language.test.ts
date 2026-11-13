import { keyedError } from '@visastack/services';
import { serviceMessages } from '@visastack/services/i18n';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Every agency action that turns a service refusal into words, driven from one table: the service
 * answers with a keyed refusal that has Bangla, and the action must show that Bangla under bn and
 * the exact English under en. An action still reading `error.message` shows English under bn and
 * fails here.
 */

const mocks = vi.hoisted(() => ({
  failing: [
    'addMemberByEmail',
    'addNote',
    'assignMember',
    'cancelEvidenceRequest',
    'createAppointmentForOrg',
    'createClientInvitation',
    'createTaskForOrg',
    'decideAppointmentForOrg',
    'decideEvidenceResponse',
    'decideTaskForOrg',
    'recordIssuerVerification',
    'recordMissionDecision',
    'removeOrganizationLogo',
    'requestEvidence',
    'requestEvidenceBatch',
    'revokeClientInvitation',
    'revokeOrganizationInvitation',
    'setMembershipActive',
    'setRequireDifferentReviewer',
    'startEvidenceReview',
    'unassignMember',
    'updateOrganizationBranding',
    'updateTaskForOrg',
    'uploadOrganizationLogo',
    'addAgencyItem',
    'discardAgencyDraft',
    'makeAgencyCopy',
    'publishAgencyDraft',
    'removeAgencyItem',
    'startAgencyListUpdate',
    'updateAgencyItem',
    'chooseCollectionPack',
    'createCollectionLink',
    'createCollectionRequest',
    'editCollectionDraft',
    'endCollectionRequest',
    'issueCollectionRequest',
    'placeGuestHold',
    'recordCollectionReview',
    'releaseGuestHold',
    'suggestAgencyChecklistCorrection',
    'setMemberMayRequestDocuments',
    'listSelectedEvidenceForOrg',
  ] as string[],
  locale: 'en' as 'en' | 'bn',
  key: '',
  fns: {} as Record<string, ReturnType<typeof vi.fn>>,
  listSelected: undefined as unknown as { mockResolvedValue: (value: unknown) => void },
  fail: (async () => undefined) as () => Promise<unknown>,
}));

vi.mock('../../../../lib/locale', () => ({ getLocale: async () => mocks.locale }));
vi.mock('@visastack/services', async (load) => {
  const actual = await load<typeof import('@visastack/services')>();
  const fns = mocks.fns;
  const fail = async () => ({ ok: false, error: actual.keyedError('invalid', mocks.key as never) });
  mocks.fail = fail;
  for (const name of mocks.failing) fns[name] = vi.fn(fail);
  // listSelectedEvidenceForOrg is the last name in the list: it is the one that succeeds by default.
  mocks.listSelected = fns[mocks.failing[mocks.failing.length - 1] as string] as never;
  const scope = vi.fn(async () => ({ ok: true, value: { organizationId: 'org-1' } }));
  return {
    ...actual,
    ...fns,
    agencyChecklistPrincipal: scope,
    agencyCollectionPrincipal: scope,
    getCollectionRequest: vi.fn(async () => ({ ok: true, value: { destination: 'JP' } })),
    requireAccess: vi.fn(async () => ({ ok: true, value: { applicant: { id: 'a1' } } })),
  };
});
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  unstable_rethrow: (failure: unknown) => {
    throw failure;
  },
}));
vi.mock('next/server', () => ({ after: vi.fn() }));
vi.mock('../../../../lib/capabilities', () => ({
  getPlatformCapabilities: () => ({ agencyCollaboration: 'available' }),
  capabilityUnavailableMessage: () => 'unavailable',
}));
vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: { db: object; accountId: string }) => unknown) =>
    fn({ db: {}, accountId: 'signed-in-account' }),
}));
vi.mock('../../../../lib/jobs', () => ({ triggerNotificationWorker: async () => undefined }));
vi.mock('../../../../lib/send-now', () => ({ sendEmailNow: async () => 'sent' }));
vi.mock('../../../../lib/base-url', () => ({ resolveBaseUrl: () => 'https://example.test' }));
vi.mock('../../../../lib/providers', () => ({
  createKeyManagementPort: () => ({}),
  createMalwareScanner: () => ({}),
}));
vi.mock('../../../../lib/providers-media', () => ({ createImageSanitizer: () => ({}) }));
vi.mock('../../../../lib/storage', () => ({ createStorage: () => ({}) }));
vi.mock('../../../../lib/server-error', () => ({ reportServerError: vi.fn() }));

const bn = serviceMessages.bn as Record<string, string>;
const en = serviceMessages.en as Record<string, string>;
const BENGALI = /[ঀ-৿]/;

/** The first key of a domain that has Bangla and no placeholders, so the whole sentence is exact. */
function keyOf(prefix: string): string {
  const key = Object.keys(bn).find((k) => k.startsWith(`${prefix}.`) && !en[k]?.includes('{'));
  if (!key) throw new Error(`no Bangla key for ${prefix}`);
  return key;
}

const actions = await import('./actions');
const checklists = await import('./checklists/actions');
const collection = await import('./collection/actions');
const review = await import('./collection/collection-review-actions');
const correction = await import('./collection/request/checklist-correction-actions');
const team = await import('./team/actions');

type Action = (prev: never, data: FormData) => Promise<{ message: string }>;
interface Site {
  /** What the person sees this as, for the test name. */
  readonly name: string;
  readonly run: Action;
  /** The service function whose refusal this site words. */
  readonly fails: string;
  readonly domain: string;
  readonly form: Record<string, string | string[]>;
}

const ORG = { organizationId: 'org-1' };
const CASE = { ...ORG, missionId: 'm1' };
const REQ = { ...ORG, requestId: 'r1' };
const CHECK = { ...ORG, packVersionId: 'pv1', packId: 'p1', requirementId: 'q1' };
const asAction = (fn: unknown) => fn as Action;

const SITES: Site[] = [
  {
    name: 'request one item',
    run: asAction(actions.requestEvidenceAction),
    fails: 'requestEvidence',
    domain: 'agency',
    form: { ...CASE, applicantId: 'a1', kind: 'FIELD', key: 'passport_number' },
  },
  {
    name: 'request several items',
    run: asAction(actions.requestEvidenceAction),
    fails: 'requestEvidenceBatch',
    domain: 'agency',
    form: { ...CASE, applicantId: 'a1', item: ['DOCUMENT:PASSPORT'] },
  },
  {
    name: 'start review',
    run: asAction(actions.startEvidenceReviewAction),
    fails: 'startEvidenceReview',
    domain: 'agency',
    form: REQ,
  },
  {
    name: 'decide a response',
    run: asAction(actions.decideEvidenceResponseAction),
    fails: 'decideEvidenceResponse',
    domain: 'agency',
    form: { ...REQ, outcome: 'ACCEPTED' },
  },
  {
    name: 'cancel a request',
    run: asAction(actions.cancelEvidenceRequestAction),
    fails: 'cancelEvidenceRequest',
    domain: 'agency',
    form: REQ,
  },
  {
    name: 'add a member',
    run: asAction(actions.addMemberAction),
    fails: 'addMemberByEmail',
    domain: 'agency',
    form: { ...ORG, memberEmail: 'a@example.com', role: 'REVIEWER' },
  },
  {
    name: 'revoke a team invitation',
    run: asAction(actions.revokeInvitationAction),
    fails: 'revokeOrganizationInvitation',
    domain: 'agency',
    form: { ...ORG, invitationId: 'i1' },
  },
  {
    name: 'invite a client',
    run: asAction(actions.inviteClientAction),
    fails: 'createClientInvitation',
    domain: 'agency',
    form: {
      ...ORG,
      caseOwnerAccountId: 'o1',
      displayName: 'Sam',
      contactDestination: 'sam@example.com',
    },
  },
  {
    name: 'revoke a client invitation',
    run: asAction(actions.revokeClientInvitationAction),
    fails: 'revokeClientInvitation',
    domain: 'agency',
    form: { ...ORG, invitationId: 'i1' },
  },
  {
    name: 'assign a member',
    run: asAction(actions.assignMemberAction),
    fails: 'assignMember',
    domain: 'agency',
    form: { ...CASE, memberAccountId: 'u1' },
  },
  {
    name: 'unassign a member',
    run: asAction(actions.unassignMemberAction),
    fails: 'unassignMember',
    domain: 'agency',
    form: { ...CASE, memberAccountId: 'u1' },
  },
  {
    name: 'add a task',
    run: asAction(actions.createTaskForOrgAction),
    fails: 'createTaskForOrg',
    domain: 'agency',
    form: { ...CASE, description: 'Call them' },
  },
  {
    name: 'change a task',
    run: asAction(actions.updateTaskForOrgAction),
    fails: 'updateTaskForOrg',
    domain: 'agency',
    form: { ...CASE, taskId: 't1' },
  },
  {
    name: 'decide a task',
    run: asAction(actions.decideTaskForOrgAction),
    fails: 'decideTaskForOrg',
    domain: 'agency',
    form: { ...CASE, taskId: 't1', status: 'DONE' },
  },
  {
    name: 'schedule an appointment',
    run: asAction(actions.createAppointmentForOrgAction),
    fails: 'createAppointmentForOrg',
    domain: 'agency',
    form: { ...CASE, title: 'Visit', localDate: '2030-01-02', localTime: '10:00', timezone: 'UTC' },
  },
  {
    name: 'decide an appointment',
    run: asAction(actions.decideAppointmentForOrgAction),
    fails: 'decideAppointmentForOrg',
    domain: 'agency',
    form: { ...CASE, appointmentId: 'ap1', status: 'DONE' },
  },
  {
    name: 'add a note',
    run: asAction(actions.addNoteAction),
    fails: 'addNote',
    domain: 'agency',
    form: { ...CASE, body: 'Hello', visibility: 'AGENCY_INTERNAL' },
  },
  {
    name: 'record a decision',
    run: asAction(actions.recordDecisionAction),
    fails: 'recordMissionDecision',
    domain: 'agency',
    form: { ...CASE, packRequirementId: 'pr1', outcome: 'ACCEPTED' },
  },
  {
    name: 'list selected evidence',
    run: asAction(actions.recordIssuerVerificationAction),
    fails: 'listSelectedEvidenceForOrg',
    domain: 'agency',
    form: {
      ...CASE,
      applicantId: 'a1',
      packRequirementId: 'pr1',
      issuerIdentity: 'X',
      contactMethod: 'email',
      exactClaim: 'Y',
      response: 'Z',
      validUntil: '2030-01-01',
    },
  },
  {
    name: 'record an issuer confirmation',
    run: asAction(actions.recordIssuerVerificationAction),
    fails: 'recordIssuerVerification',
    domain: 'agency',
    form: {
      ...CASE,
      applicantId: 'a1',
      packRequirementId: 'pr1',
      issuerIdentity: 'X',
      contactMethod: 'email',
      exactClaim: 'Y',
      response: 'Z',
      validUntil: '2030-01-01',
    },
  },
  {
    name: 'switch a member on or off',
    run: asAction(actions.toggleMemberAction),
    fails: 'setMembershipActive',
    domain: 'agency',
    form: { ...ORG, membershipId: 'mb1', active: 'true' },
  },
  {
    name: 'require a different reviewer',
    run: asAction(actions.setRequireDifferentReviewerAction),
    fails: 'setRequireDifferentReviewer',
    domain: 'agency',
    form: { ...ORG, required: 'true' },
  },
  {
    name: 'change branding',
    run: asAction(actions.updateBrandingAction),
    fails: 'updateOrganizationBranding',
    domain: 'agency',
    form: { ...ORG, name: 'Agency' },
  },
  {
    name: 'upload a logo',
    run: asAction(actions.uploadLogoAction),
    fails: 'uploadOrganizationLogo',
    domain: 'agency',
    form: { ...ORG },
  },
  {
    name: 'remove a logo',
    run: asAction(actions.removeLogoAction),
    fails: 'removeOrganizationLogo',
    domain: 'agency',
    form: { ...ORG },
  },

  {
    name: 'copy a checklist',
    run: asAction(checklists.copyListAction),
    fails: 'makeAgencyCopy',
    domain: 'agency',
    form: CHECK,
  },
  {
    name: 'start a checklist update',
    run: asAction(checklists.startUpdateAction),
    fails: 'startAgencyListUpdate',
    domain: 'agency',
    form: CHECK,
  },
  {
    name: 'save a checklist item',
    run: asAction(checklists.saveItemAction),
    fails: 'updateAgencyItem',
    domain: 'agency',
    form: { ...CHECK, necessity: 'MANDATORY' },
  },
  {
    name: 'remove a checklist item',
    run: asAction(checklists.removeItemAction),
    fails: 'removeAgencyItem',
    domain: 'agency',
    form: CHECK,
  },
  {
    name: 'add a checklist item',
    run: asAction(checklists.addItemAction),
    fails: 'addAgencyItem',
    domain: 'agency',
    form: { ...CHECK, docType: 'PASSPORT', wording: 'Passport' },
  },
  {
    name: 'publish a checklist draft',
    run: asAction(checklists.publishDraftAction),
    fails: 'publishAgencyDraft',
    domain: 'agency',
    form: CHECK,
  },
  {
    name: 'discard a checklist draft',
    run: asAction(checklists.discardDraftAction),
    fails: 'discardAgencyDraft',
    domain: 'agency',
    form: CHECK,
  },

  {
    name: 'create a document request',
    run: asAction(collection.createRequestAction),
    fails: 'createCollectionRequest',
    domain: 'umpe_collection_request_service',
    form: { ...ORG, destination: 'JP' },
  },
  {
    name: 'edit the working checklist',
    run: asAction(collection.editDraftAction),
    fails: 'editCollectionDraft',
    domain: 'umpe_collection_request_service',
    form: { ...REQ, edit: 'add', label: 'Photo' },
  },
  {
    name: 'choose an official checklist',
    run: asAction(collection.choosePackAction),
    fails: 'chooseCollectionPack',
    domain: 'umpe_collection_request_service',
    form: { ...REQ, packVersionId: 'pv1' },
  },
  {
    name: 'issue a request',
    run: asAction(collection.issueRequestAction),
    fails: 'issueCollectionRequest',
    domain: 'umpe_collection_request_service',
    form: REQ,
  },
  {
    name: 'make a new link',
    run: asAction(collection.newLinkAction),
    fails: 'createCollectionLink',
    domain: 'umpe_collection_request_service',
    form: REQ,
  },
  {
    name: 'email a link',
    run: asAction(collection.emailLinkAction),
    fails: 'createCollectionLink',
    domain: 'umpe_collection_request_service',
    form: { ...REQ, email: 'a@example.com' },
  },
  {
    name: 'end a request',
    run: asAction(collection.endRequestAction),
    fails: 'endCollectionRequest',
    domain: 'umpe_collection_request_service',
    form: REQ,
  },
  {
    name: 'review an answer',
    run: asAction(review.reviewAnswerAction),
    fails: 'recordCollectionReview',
    domain: 'umpe_collection_request_service',
    form: { ...REQ, answerId: 'an1', decision: 'ACCEPTED' },
  },
  {
    name: 'place a hold',
    run: asAction(review.guestHoldAction),
    fails: 'placeGuestHold',
    domain: 'umpe_collection_request_service',
    form: { ...REQ, reason: 'Legal' },
  },
  {
    name: 'release a hold',
    run: asAction(review.guestHoldAction),
    fails: 'releaseGuestHold',
    domain: 'umpe_collection_request_service',
    form: { ...REQ, intent: 'release' },
  },
  // The correction messages have no checked Bangla yet, so this row proves the wiring with an agency key.
  {
    name: 'suggest a correction',
    run: asAction(correction.suggestAgencyCorrectionAction),
    fails: 'suggestAgencyChecklistCorrection',
    domain: 'agency',
    form: { ...REQ, category: 'MISSING' },
  },
  {
    name: 'let a member request documents',
    run: asAction(team.setMemberRequestDocumentsAction),
    fails: 'setMemberMayRequestDocuments',
    domain: 'umpe_collection_request_service',
    form: { ...ORG, membershipId: 'mb1', allowed: 'true' },
  },
];

function formOf(site: Site): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(site.form)) {
    for (const one of Array.isArray(value) ? value : [value]) data.append(name, one);
  }
  if (site.fails === 'uploadOrganizationLogo') {
    data.set('logo', new File([new Uint8Array([1, 2, 3])], 'logo.png', { type: 'image/png' }));
  }
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.locale = 'en';
  for (const name of mocks.failing) mocks.fns[name]?.mockImplementation(mocks.fail);
  mocks.listSelected.mockResolvedValue({
    ok: true,
    value: [{ packRequirementId: 'pr1', factId: 'f1' }],
  });
});

async function show(site: Site, locale: 'en' | 'bn', key: string): Promise<string> {
  mocks.locale = locale;
  mocks.key = key;
  const result = await site.run({ ok: true, message: '' } as never, formOf(site));
  expect(mocks.fns[site.fails]).toHaveBeenCalled();
  return result.message;
}

describe('agency refusals in the visitor language, every converted site', () => {
  it('covers each converted call site of the seven action files', () => {
    // 44 sites: a new converted site without a row here is a gap this count makes visible.
    expect(SITES).toHaveLength(44);
  });

  describe.each(SITES.map((site) => [site.name, site] as const))('%s', (_name, site) => {
    it('shows the Bangla under bn', async () => {
      const key = keyOf(site.domain);
      const text = await show(site, 'bn', key);
      expect(text).toMatch(BENGALI);
      expect(text).toBe(bn[key]);
    });

    it('shows the exact English under en', async () => {
      const key = keyOf(site.domain);
      expect(await show(site, 'en', key)).toBe(en[key]);
    });
  });

  it('measures bn N = rendered N: every site rendered Bangla under bn', () => {
    expect(SITES.every((site) => keyOf(site.domain))).toBe(true);
  });

  it('builds the keyed error the services mock returns', () => {
    expect(keyedError('invalid', keyOf('agency') as never).messageKey).toBe(keyOf('agency'));
  });
});

describe('recording an issuer confirmation checks the person before it looks anything up', () => {
  const site = SITES.find((s) => s.fails === 'listSelectedEvidenceForOrg') as Site;
  const lookup = site.fails;
  const record = 'recordIssuerVerification' as string;

  it('asks the service as the signed-in person, for the agency and case named in the form', async () => {
    mocks.key = keyOf('agency');
    await site.run({ ok: true, message: '' } as never, formOf(site));
    const listSelected = mocks.fns[lookup];
    expect(listSelected).toHaveBeenCalledWith({}, 'signed-in-account', 'org-1', 'm1');
  });

  it('records nothing and answers with the refusal alone when the service refuses the person', async () => {
    mocks.key = keyOf('agency');
    mocks.fns[lookup]?.mockImplementation(mocks.fail);
    const answers: string[] = [];
    // A made-up agency, a made-up case, and a real case with or without evidence chosen: the
    // service refuses a stranger the same way for each (agency-org-actor-matrix.test.ts), so the
    // form shows one answer and never reaches the record step.
    for (const form of [
      { organizationId: 'made-up-org', missionId: 'm1' },
      { organizationId: 'org-1', missionId: 'made-up-case' },
      { organizationId: 'org-1', missionId: 'm-nothing-chosen' },
      { organizationId: 'org-1', missionId: 'm1' },
    ]) {
      const data = formOf(site);
      data.set('organizationId', form.organizationId);
      data.set('missionId', form.missionId);
      answers.push((await site.run({ ok: true, message: '' } as never, data)).message);
    }
    expect(new Set(answers).size).toBe(1);
    expect(answers[0]).toBe(en[keyOf('agency')]);
    expect(mocks.fns[record]).not.toHaveBeenCalled();
  });
});
