import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The agency console's loaders decide which service reads a page makes. The
 * services themselves refuse anyone without standing; these tests pin the other
 * half: that an administrator-only read is not even attempted for anyone else,
 * that results are assembled the way the pages expect, and that the arguments
 * reach the services in the order the services take them.
 */

const svc = vi.hoisted(() => ({
  computeReadiness: vi.fn(),
  getLiveAcknowledgement: vi.fn(),
  getOrganization: vi.fn(),
  isActiveMember: vi.fn(),
  isOrgAdmin: vi.fn(),
  listApplicantsForOrganization: vi.fn(),
  listAppointmentsForOrg: vi.fn(),
  listAssignmentsDetailed: vi.fn(),
  listClientInvitations: vi.fn(),
  listEvidenceRequestsForOrgDetailed: vi.fn(),
  listIssuerVerificationsForDocument: vi.fn(),
  listIssuerVerificationsForFact: vi.fn(),
  listMissionDecisions: vi.fn(),
  listMissionRequirementsForOrg: vi.fn(),
  listNotes: vi.fn(),
  listOrgMemberships: vi.fn(),
  listOrganizationInvitations: vi.fn(),
  listSelectedEvidenceForOrg: vi.fn(),
  listTasksForOrg: vi.fn(),
  listUnassignedActiveMissions: vi.fn(),
  listVisibleMissionsForMember: vi.fn(),
  referenceCodesFor: vi.fn(),
}));

vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  ...svc,
}));

const {
  loadApplicants,
  loadCaseActivity,
  loadCaseListPage,
  loadCases,
  loadEvidenceRequestPage,
  loadEvidenceRequests,
  loadMembers,
  loadOpenCase,
  loadOrgAccess,
  loadPendingClientInvitationPage,
  loadPendingTeamInvitations,
  loadUnassignedQueue,
  loadVisibleCaseList,
} = await import('./console-data');

const db = {} as never;
const admin = { admin: true };
const notAdmin = { admin: false };
const ok = <T>(value: T) => ({ ok: true as const, value });
const fail = () => ({ ok: false as const, error: { message: 'no' } });

beforeEach(() => {
  vi.clearAllMocks();
  // No registry yet (before migration 0091): every record reads without a code.
  svc.referenceCodesFor.mockResolvedValue(new Map());
});

describe('loadOrgAccess', () => {
  it('returns null for an organization that does not exist, and asks nothing else', async () => {
    svc.getOrganization.mockResolvedValue(null);
    expect(await loadOrgAccess(db, 'acct', 'o1')).toBeNull();
    expect(svc.isOrgAdmin).not.toHaveBeenCalled();
    expect(svc.isActiveMember).not.toHaveBeenCalled();
  });

  it('treats an administrator as a member without a second lookup', async () => {
    svc.getOrganization.mockResolvedValue({ id: 'o1' });
    svc.isOrgAdmin.mockResolvedValue(true);
    expect(await loadOrgAccess(db, 'acct', 'o1')).toEqual({
      org: { id: 'o1' },
      admin: true,
      member: true,
    });
    expect(svc.isActiveMember).not.toHaveBeenCalled();
    expect(svc.isOrgAdmin).toHaveBeenCalledWith(db, 'acct', 'o1');
  });

  it('lets an active member who is not an administrator in as a member only', async () => {
    svc.getOrganization.mockResolvedValue({ id: 'o1' });
    svc.isOrgAdmin.mockResolvedValue(false);
    svc.isActiveMember.mockResolvedValue(true);
    expect(await loadOrgAccess(db, 'acct', 'o1')).toMatchObject({ admin: false, member: true });
  });

  it('reports someone with no standing as neither, still returning the organization for the header', async () => {
    svc.getOrganization.mockResolvedValue({ id: 'o1' });
    svc.isOrgAdmin.mockResolvedValue(false);
    svc.isActiveMember.mockResolvedValue(false);
    expect(await loadOrgAccess(db, 'acct', 'o1')).toEqual({
      org: { id: 'o1' },
      admin: false,
      member: false,
    });
  });
});

describe('administrator-only reads', () => {
  it('are not attempted at all for anyone who is not an administrator', async () => {
    expect(await loadMembers(db, 'acct', 'o1', notAdmin)).toEqual([]);
    expect(await loadEvidenceRequests(db, 'acct', 'o1', notAdmin)).toEqual([]);
    expect(await loadPendingTeamInvitations(db, 'acct', 'o1', notAdmin)).toEqual([]);
    expect(
      (await loadPendingClientInvitationPage(db, 'acct', 'o1', notAdmin, { limit: 15 })).items,
    ).toEqual([]);
    expect(await loadApplicants(db, 'o1', notAdmin)).toEqual([]);
    expect(await loadUnassignedQueue(db, 'o1', notAdmin)).toEqual([]);
    for (const read of [
      svc.listOrgMemberships,
      svc.listEvidenceRequestsForOrgDetailed,
      svc.listOrganizationInvitations,
      svc.listClientInvitations,
      svc.listApplicantsForOrganization,
      svc.listUnassignedActiveMissions,
    ]) {
      expect(read).not.toHaveBeenCalled();
    }
  });

  it('reach the services with the actor and organization in the order they take them', async () => {
    svc.listOrgMemberships.mockResolvedValue(ok([{ accountId: 'a1' }]));
    svc.listEvidenceRequestsForOrgDetailed.mockResolvedValue(ok([{ id: 'r1' }]));
    svc.listApplicantsForOrganization.mockResolvedValue([{ id: 'ap1' }]);
    svc.listUnassignedActiveMissions.mockResolvedValue([{ missionId: 'm1' }]);
    expect(await loadMembers(db, 'acct', 'o1', admin)).toEqual([{ accountId: 'a1' }]);
    expect(await loadEvidenceRequests(db, 'acct', 'o1', admin)).toEqual([{ id: 'r1' }]);
    expect(await loadApplicants(db, 'o1', admin)).toEqual([{ id: 'ap1' }]);
    expect(await loadUnassignedQueue(db, 'o1', admin)).toEqual([{ missionId: 'm1' }]);
    expect(svc.listOrgMemberships).toHaveBeenCalledWith(db, 'acct', 'o1');
    expect(svc.listEvidenceRequestsForOrgDetailed).toHaveBeenCalledWith(db, 'acct', 'o1');
    expect(svc.listApplicantsForOrganization).toHaveBeenCalledWith(db, 'o1');
    expect(svc.listUnassignedActiveMissions).toHaveBeenCalledWith(db, 'o1');
  });

  it('turn a refused read into an empty list, never an error', async () => {
    svc.listOrgMemberships.mockResolvedValue(fail());
    svc.listEvidenceRequestsForOrgDetailed.mockResolvedValue(fail());
    svc.listOrganizationInvitations.mockResolvedValue(fail());
    svc.listClientInvitations.mockResolvedValue(fail());
    expect(await loadMembers(db, 'acct', 'o1', admin)).toEqual([]);
    expect(await loadEvidenceRequests(db, 'acct', 'o1', admin)).toEqual([]);
    expect(await loadPendingTeamInvitations(db, 'acct', 'o1', admin)).toEqual([]);
    expect(await loadPendingClientInvitationPage(db, 'acct', 'o1', admin, { limit: 15 })).toEqual({
      items: [],
      nextCursor: null,
      total: 0,
    });
  });

  it('keep only the invitations still waiting for an answer', async () => {
    const rows = [
      { id: 'i1', status: 'PENDING' },
      { id: 'i2', status: 'ACCEPTED' },
      { id: 'i3', status: 'REVOKED' },
      { id: 'i4', status: 'PENDING' },
    ];
    svc.listOrganizationInvitations.mockResolvedValue(ok(rows));
    expect((await loadPendingTeamInvitations(db, 'acct', 'o1', admin)).map((i) => i.id)).toEqual([
      'i1',
      'i4',
    ]);
    expect(svc.listOrganizationInvitations).toHaveBeenCalledWith(db, {
      actorAccountId: 'acct',
      organizationId: 'o1',
    });
  });
});

describe('loadVisibleCaseList', () => {
  it('asks for the cases this actor may see, organization first', async () => {
    svc.listVisibleMissionsForMember.mockResolvedValue({
      admin: false,
      missions: [{ missionId: 'm1' }],
    });
    expect(await loadVisibleCaseList(db, 'acct', 'o1')).toEqual([{ missionId: 'm1' }]);
    expect(svc.listVisibleMissionsForMember).toHaveBeenCalledWith(db, 'o1', 'acct');
  });
});

describe('loadCases', () => {
  const manual = {
    missionId: 'm-manual',
    applicantId: 'ap1',
    manualMode: true,
    packVersionId: 'pv-ignored',
  };
  const withPack = {
    missionId: 'm-pack',
    applicantId: 'ap2',
    manualMode: false,
    packVersionId: 'pv1',
  };
  const members = [{ accountId: 'author-1', email: 'author@example.com' }] as never;
  const noteRows = [
    {
      id: 'n1',
      body: 'Called the client',
      createdAt: new Date('2026-10-01T10:00:00Z'),
      visibility: 'AGENCY_INTERNAL',
      authorAccountId: 'author-1',
    },
    {
      id: 'n2',
      body: 'Written by someone off the roster',
      createdAt: new Date('2026-10-02T10:00:00Z'),
      visibility: 'AGENCY_INTERNAL',
      authorAccountId: 'stranger',
    },
  ];

  beforeEach(() => {
    svc.listVisibleMissionsForMember.mockResolvedValue({
      admin: true,
      missions: [manual, withPack],
    });
    svc.listAssignmentsDetailed.mockImplementation(async (_db, _org, _ap, missionId) =>
      missionId === 'm-pack' ? [{ memberAccountId: 'acct', memberEmail: 'me@example.com' }] : [],
    );
    svc.listMissionRequirementsForOrg.mockResolvedValue(
      ok([
        { id: 'q1', kind: 'FIELD', fieldKey: 'unknown.field', docType: null },
        { id: 'q2', kind: 'DOCUMENT', fieldKey: null, docType: 'PASSPORT' },
      ]),
    );
    svc.listMissionDecisions.mockResolvedValue(
      ok([
        {
          id: 'd1',
          packRequirementId: 'q1',
          outcome: 'ACCEPTED',
          reason: 'Looks right',
          createdAt: new Date('2026-10-03T10:00:00Z'),
        },
      ]),
    );
    svc.listSelectedEvidenceForOrg.mockResolvedValue(
      ok([
        { packRequirementId: 'q1', factId: 'f1', documentId: null },
        { packRequirementId: 'q2', factId: null, documentId: 'doc1' },
        { packRequirementId: 'q3', factId: null, documentId: null },
      ]),
    );
    svc.listIssuerVerificationsForFact.mockResolvedValue([
      {
        id: 'v1',
        issuerIdentity: 'Bank A',
        exactClaim: 'Balance above threshold',
        response: 'CONFIRMED',
        validUntil: new Date(Date.now() + 86_400_000),
      },
    ]);
    svc.listIssuerVerificationsForDocument.mockResolvedValue([
      {
        id: 'v2',
        issuerIdentity: 'Registry B',
        exactClaim: 'Passport issued',
        response: 'CONFIRMED',
        validUntil: new Date(Date.now() - 86_400_000),
      },
    ]);
    svc.listTasksForOrg.mockResolvedValue([
      {
        id: 't1',
        description: 'Chase the bank',
        status: 'OPEN',
        priority: 'HIGH',
        assigneeAccountId: 'acct',
        dueDate: new Date('2026-10-10T00:00:00Z'),
      },
      {
        id: 't2',
        description: 'No due date',
        status: 'OPEN',
        priority: 'LOW',
        assigneeAccountId: null,
        dueDate: null,
      },
    ]);
    svc.listAppointmentsForOrg.mockResolvedValue([
      {
        id: 'a1',
        title: 'Biometrics',
        localDateTime: new Date('2026-10-15T09:00:00Z'),
        timezone: 'Asia/Dhaka',
        place: 'Dhaka',
        channel: 'IN_PERSON',
        status: 'OPEN',
      },
    ]);
    svc.computeReadiness.mockResolvedValue(ok({ ready: true, requiredCount: 2 }));
    svc.getLiveAcknowledgement.mockImplementation(async (_db, missionId) =>
      missionId === 'm-pack' ? { createdAt: new Date('2026-10-04T10:00:00Z') } : null,
    );
  });

  it('returns whether the viewer is an administrator, as decided by the service', async () => {
    expect((await loadCases(db, 'acct', 'o1')).admin).toBe(true);
    svc.listVisibleMissionsForMember.mockResolvedValue({ admin: false, missions: [] });
    expect(await loadCases(db, 'acct', 'o1')).toEqual({ admin: false, cases: [] });
  });

  it('calls every per-case service with the arguments it takes', async () => {
    await loadCases(db, 'acct', 'o1');
    expect(svc.listAssignmentsDetailed).toHaveBeenCalledWith(db, 'o1', 'ap2', 'm-pack');
    // WP-SB5: the Dashboard shows no notes, so it reads none; the open case reads them a page at a time.
    expect(svc.listNotes).not.toHaveBeenCalled();
    expect(svc.listMissionRequirementsForOrg).toHaveBeenCalledWith(db, 'o1', 'm-pack');
    expect(svc.listMissionDecisions).toHaveBeenCalledWith(db, 'acct', 'm-pack');
    expect(svc.listSelectedEvidenceForOrg).toHaveBeenCalledWith(db, 'o1', 'm-pack');
    expect(svc.listTasksForOrg).toHaveBeenCalledWith(db, 'o1', 'ap2', 'm-pack');
    expect(svc.listAppointmentsForOrg).toHaveBeenCalledWith(db, 'o1', 'ap2', 'm-pack');
    expect(svc.getLiveAcknowledgement).toHaveBeenCalledWith(db, 'm-pack');
  });

  it('computes readiness only for a case that has a pack and is not in manual mode', async () => {
    const { cases } = await loadCases(db, 'acct', 'o1');
    expect(svc.computeReadiness).toHaveBeenCalledTimes(1);
    expect(svc.computeReadiness).toHaveBeenCalledWith(db, 'm-pack');
    expect(cases.find((c) => c.missionId === 'm-manual')?.readiness).toBeNull();
    expect(cases.find((c) => c.missionId === 'm-pack')?.readiness).toEqual({
      ready: true,
      requiredCount: 2,
    });
  });

  it('names a note author on the open case from the roster, and says Unknown for anyone not on it', async () => {
    svc.listVisibleMissionsForMember.mockResolvedValue({
      admin: true,
      missions: [withPack],
      nextCursor: null,
      total: 1,
    });
    svc.listNotes.mockResolvedValue({
      items: noteRows,
      nextCursor: 'next-notes',
      total: 12,
    });
    const open = await loadOpenCase(db, 'acct', 'o1', members, 'm-pack', { notesLimit: 10 });
    expect(open?.notes.map((n) => n.authorEmail)).toEqual(['author@example.com', 'Unknown']);
    expect(open?.notes[0]?.createdAt).toBe('2026-10-01T10:00:00.000Z');
    expect(open?.notesTotal).toBe(12);
    expect(open?.notesNextCursor).toBe('next-notes');
  });

  it('says Unknown for every author on the open case when the viewer cannot see the roster', async () => {
    svc.listVisibleMissionsForMember.mockResolvedValue({
      admin: false,
      missions: [withPack],
      nextCursor: null,
      total: 1,
    });
    svc.listNotes.mockResolvedValue({ items: noteRows, nextCursor: null, total: 2 });
    const open = await loadOpenCase(db, 'acct', 'o1', [], 'm-pack', { notesLimit: 10 });
    expect(open?.notes.map((n) => n.authorEmail)).toEqual(['Unknown', 'Unknown']);
  });

  it('labels requirements: a field by its stored key when it has no known label, a document by its type', async () => {
    const { cases } = await loadCases(db, 'acct', 'o1');
    expect(cases[1]?.requirements).toEqual([
      { id: 'q1', label: 'unknown.field' },
      { id: 'q2', label: 'PASSPORT' },
    ]);
  });

  it('leaves requirements and decisions empty when the service refuses them', async () => {
    svc.listMissionRequirementsForOrg.mockResolvedValue(fail());
    svc.listMissionDecisions.mockResolvedValue(fail());
    const { cases } = await loadCases(db, 'acct', 'o1');
    expect(cases[1]?.requirements).toEqual([]);
    expect(cases[1]?.decisions).toEqual([]);
  });

  it('flattens issuer confirmations from fact and document evidence, marking an expired one', async () => {
    const { cases } = await loadCases(db, 'acct', 'o1');
    const verifications = cases[1]?.issuerVerifications ?? [];
    expect(verifications.map((v) => [v.id, v.packRequirementId, v.expired])).toEqual([
      ['v1', 'q1', false],
      ['v2', 'q2', true],
    ]);
    expect(svc.listIssuerVerificationsForFact).toHaveBeenCalledWith(db, 'f1');
    expect(svc.listIssuerVerificationsForDocument).toHaveBeenCalledWith(db, 'doc1');
  });

  it('reports the viewer as assigned only where an assignment names them', async () => {
    const { cases } = await loadCases(db, 'acct', 'o1');
    expect(cases.find((c) => c.missionId === 'm-manual')?.viewerAssigned).toBe(false);
    expect(cases.find((c) => c.missionId === 'm-pack')?.viewerAssigned).toBe(true);
  });

  it('turns dates into ISO strings and keeps a missing due date null', async () => {
    const { cases } = await loadCases(db, 'acct', 'o1');
    expect(cases[1]?.tasks.map((t) => t.dueDate)).toEqual(['2026-10-10T00:00:00.000Z', null]);
    expect(cases[1]?.appointments[0]?.localDateTime).toBe('2026-10-15T09:00:00.000Z');
    expect(cases[1]?.decisions[0]?.createdAt).toBe('2026-10-03T10:00:00.000Z');
  });

  it("carries the applicant's live acknowledgement date, or null when there is none", async () => {
    const { cases } = await loadCases(db, 'acct', 'o1');
    expect(cases.find((c) => c.missionId === 'm-manual')?.liveAcknowledgementAt).toBeNull();
    expect(cases.find((c) => c.missionId === 'm-pack')?.liveAcknowledgementAt).toBe(
      '2026-10-04T10:00:00.000Z',
    );
  });

  it('keeps the original fields of the visible case alongside the detail', async () => {
    const { cases } = await loadCases(db, 'acct', 'o1');
    expect(cases[0]).toMatchObject({ missionId: 'm-manual', applicantId: 'ap1', manualMode: true });
  });

  it('reads every case code in one call and attaches only the codes that exist (ADR 0018)', async () => {
    svc.referenceCodesFor.mockResolvedValue(new Map([['m-pack', 'C-7K2Q9M']]));
    const { cases } = await loadCases(db, 'acct', 'o1');
    expect(svc.referenceCodesFor).toHaveBeenCalledTimes(1);
    expect(svc.referenceCodesFor).toHaveBeenCalledWith(db, 'C', ['m-manual', 'm-pack']);
    expect(cases.find((c) => c.missionId === 'm-pack')?.referenceCode).toBe('C-7K2Q9M');
    expect('referenceCode' in (cases.find((c) => c.missionId === 'm-manual') ?? {})).toBe(false);
  });

  it('shows no case code at all while the registry is empty or missing', async () => {
    const { cases } = await loadCases(db, 'acct', 'o1');
    expect(cases.some((c) => 'referenceCode' in c)).toBe(false);
  });
});

describe('loadEvidenceRequests: reference codes (ADR 0018)', () => {
  it('reads every request code in one call and attaches only the codes that exist', async () => {
    svc.listEvidenceRequestsForOrgDetailed.mockResolvedValue(ok([{ id: 'r1' }, { id: 'r2' }]));
    svc.referenceCodesFor.mockResolvedValue(new Map([['r2', 'R-7K2Q9M']]));
    expect(await loadEvidenceRequests(db, 'acct', 'o1', admin)).toEqual([
      { id: 'r1' },
      { id: 'r2', referenceCode: 'R-7K2Q9M' },
    ]);
    expect(svc.referenceCodesFor).toHaveBeenCalledTimes(1);
    expect(svc.referenceCodesFor).toHaveBeenCalledWith(db, 'R', ['r1', 'r2']);
  });

  it('never asks for codes when the person is not an administrator or the read was refused', async () => {
    await loadEvidenceRequests(db, 'acct', 'o1', notAdmin);
    svc.listEvidenceRequestsForOrgDetailed.mockResolvedValue(fail());
    await loadEvidenceRequests(db, 'acct', 'o1', admin);
    expect(svc.referenceCodesFor).not.toHaveBeenCalled();
  });
});

describe('loadOpenCase (WP-SB5): one case, only when visible', () => {
  const visibleCase = {
    missionId: 'm1',
    applicantId: 'ap1',
    manualMode: true,
    packVersionId: null,
  };
  beforeEach(() => {
    svc.listAssignmentsDetailed.mockResolvedValue([]);
    svc.listMissionRequirementsForOrg.mockResolvedValue(ok([]));
    svc.listMissionDecisions.mockResolvedValue(ok([]));
    svc.listSelectedEvidenceForOrg.mockResolvedValue(ok([]));
    svc.listTasksForOrg.mockResolvedValue([]);
    svc.listAppointmentsForOrg.mockResolvedValue([]);
    svc.getLiveAcknowledgement.mockResolvedValue(null);
    svc.listNotes.mockResolvedValue({ items: [], nextCursor: null, total: 0 });
  });

  it('asks the visibility read for this one case and reads nothing when it is not visible', async () => {
    svc.listVisibleMissionsForMember.mockResolvedValue({
      admin: false,
      missions: [],
      nextCursor: null,
      total: 0,
    });
    expect(await loadOpenCase(db, 'acct', 'o1', [], 'm9', { notesLimit: 10 })).toBeNull();
    expect(svc.listVisibleMissionsForMember).toHaveBeenCalledWith(db, 'o1', 'acct', {
      only: 'm9',
      limit: 1,
    });
    for (const read of [
      svc.listAssignmentsDetailed,
      svc.listNotes,
      svc.listTasksForOrg,
      svc.listAppointmentsForOrg,
      svc.listMissionDecisions,
      svc.getLiveAcknowledgement,
    ]) {
      expect(read).not.toHaveBeenCalled();
    }
  });

  it('reads the open case and a page of its notes, and no other case', async () => {
    svc.listVisibleMissionsForMember.mockResolvedValue({
      admin: true,
      missions: [visibleCase],
      nextCursor: null,
      total: 1,
    });
    svc.referenceCodesFor.mockResolvedValue(new Map([['m1', 'C-7K2Q9M']]));
    const open = await loadOpenCase(db, 'acct', 'o1', [], 'm1', {
      notesLimit: 20,
      notesBefore: 'cursor-1',
    });
    expect(open?.missionId).toBe('m1');
    expect(open?.referenceCode).toBe('C-7K2Q9M');
    expect(svc.listNotes).toHaveBeenCalledWith(db, 'o1', 'ap1', 'm1', {
      limit: 20,
      withTotal: true,
      before: 'cursor-1',
    });
    for (const read of [svc.listAssignmentsDetailed, svc.listTasksForOrg, svc.listNotes]) {
      expect(read).toHaveBeenCalledTimes(1);
    }
    expect(svc.referenceCodesFor).toHaveBeenCalledWith(db, 'C', ['m1']);
  });
});

describe('loadCaseListPage (WP-SB5)', () => {
  it('asks for one page of 15 visible cases and their codes, with no per-case read', async () => {
    svc.listVisibleMissionsForMember.mockResolvedValue({
      admin: false,
      missions: [{ missionId: 'm1' }, { missionId: 'm2' }],
      nextCursor: 'next',
      total: 40,
    });
    svc.referenceCodesFor.mockResolvedValue(new Map([['m2', 'C-2']]));
    const page = await loadCaseListPage(db, 'acct', 'o1', { limit: 15, before: 'c1' });
    expect(svc.listVisibleMissionsForMember).toHaveBeenCalledWith(db, 'o1', 'acct', {
      limit: 15,
      before: 'c1',
    });
    expect(page).toEqual({
      admin: false,
      total: 40,
      nextCursor: 'next',
      cases: [{ missionId: 'm1' }, { missionId: 'm2', referenceCode: 'C-2' }],
    });
    expect(svc.listAssignmentsDetailed).not.toHaveBeenCalled();
    expect(svc.listNotes).not.toHaveBeenCalled();
  });
});

describe('loadCaseActivity (WP-SB5)', () => {
  const kase = (id: string, updatedAt: string) => ({
    missionId: id,
    applicantId: `ap-${id}`,
    title: `Case ${id}`,
    updatedAt,
  });
  const note = (id: string, at: string, author: string | null = null) => ({
    id,
    body: `Body ${id}`,
    createdAt: new Date(at),
    cursorAt: at.replace('Z', '000Z'),
    cursor: `cursor-${id}`,
    authorAccountId: author,
  });

  it('merges the notes of the ten most recently updated cases, newest first, and names authors from the roster', async () => {
    const cases = Array.from({ length: 12 }, (_, i) =>
      kase(`m${i}`, `2026-10-${String(10 + i).padStart(2, '0')}T00:00:00.000Z`),
    );
    svc.listVisibleMissionsForMember.mockResolvedValue({ admin: true, missions: cases });
    svc.listNotes.mockImplementation(async (_db, _org, _ap, missionId) => ({
      items:
        missionId === 'm11'
          ? [note('a', '2026-10-20T10:00:00.000Z', 'author-1')]
          : missionId === 'm10'
            ? [note('b', '2026-10-21T10:00:00.000Z', 'stranger')]
            : [],
      nextCursor: null,
    }));
    const members = [{ accountId: 'author-1', email: 'author@example.com' }] as never;
    const activity = await loadCaseActivity(db, 'acct', 'o1', members, { before: 'c0' });
    expect(svc.listNotes).toHaveBeenCalledTimes(10);
    expect(svc.listNotes).toHaveBeenCalledWith(db, 'o1', 'ap-m11', 'm11', {
      limit: 50,
      before: 'c0',
    });
    expect(svc.listNotes).not.toHaveBeenCalledWith(db, 'o1', 'ap-m0', 'm0', expect.anything());
    expect(activity.caseLimitReached).toBe(true);
    expect(activity.notes.map((n) => [n.id, n.authorEmail])).toEqual([
      ['b', null],
      ['a', 'author@example.com'],
    ]);
    expect(activity.nextCursor).toBeNull();
  });

  it('keeps 50 notes and continues after the last one kept when more exist', async () => {
    svc.listVisibleMissionsForMember.mockResolvedValue({
      admin: false,
      missions: [kase('m1', '2026-10-01T00:00:00.000Z'), kase('m2', '2026-10-02T00:00:00.000Z')],
    });
    const many = (prefix: string, minuteOffset: number) =>
      Array.from({ length: 30 }, (_, i) =>
        note(
          `${prefix}${i}`,
          new Date(Date.UTC(2026, 9, 1, 0, 100 - i * 2 - minuteOffset)).toISOString(),
        ),
      );
    svc.listNotes.mockImplementation(async (_db, _org, _ap, missionId) => ({
      items: missionId === 'm1' ? many('x', 0) : many('y', 1),
      nextCursor: null,
    }));
    const activity = await loadCaseActivity(db, 'acct', 'o1', [], {});
    expect(activity.notes).toHaveLength(50);
    expect(activity.notes.slice(0, 3).map((n) => n.id)).toEqual(['x0', 'y0', 'x1']);
    expect(activity.nextCursor).toBe(`cursor-${activity.notes.at(-1)?.id}`);
  });
});

describe('loadPendingClientInvitationPage (WP-SB5)', () => {
  it('is not even attempted for a non-administrator', async () => {
    expect(
      await loadPendingClientInvitationPage(db, 'acct', 'o1', notAdmin, { limit: 15 }),
    ).toEqual({
      items: [],
      nextCursor: null,
      total: 0,
    });
    expect(svc.listClientInvitations).not.toHaveBeenCalled();
  });

  it('asks for one page of 15 pending invitations', async () => {
    svc.listClientInvitations.mockResolvedValue(
      ok({ items: [{ id: 'i1' }], nextCursor: null, total: 1 }),
    );
    await loadPendingClientInvitationPage(db, 'acct', 'o1', admin, { limit: 15, before: 'c1' });
    expect(svc.listClientInvitations).toHaveBeenCalledWith(
      db,
      { actorAccountId: 'acct', organizationId: 'o1' },
      { limit: 15, status: 'PENDING', before: 'c1' },
    );
  });
});

describe('loadEvidenceRequestPage (WP-SB5)', () => {
  it('is not even attempted for a non-administrator', async () => {
    const page = await loadEvidenceRequestPage(db, 'acct', 'o1', notAdmin, { limit: 15 });
    expect(page.items).toEqual([]);
    expect(svc.listEvidenceRequestsForOrgDetailed).not.toHaveBeenCalled();
  });

  it('asks for the statuses of one view, and counts every view from the status counts', async () => {
    svc.listEvidenceRequestsForOrgDetailed.mockResolvedValue(
      ok({
        items: [{ id: 'r1' }],
        nextCursor: 'n',
        total: 4,
        statusCounts: { RECEIVED: 3, UNDER_REVIEW: 1, OPEN: 2, CANCELLED: 1 },
      }),
    );
    svc.referenceCodesFor.mockResolvedValue(new Map([['r1', 'R-1']]));
    const page = await loadEvidenceRequestPage(db, 'acct', 'o1', admin, {
      view: 'review',
      limit: 15,
    });
    expect(svc.listEvidenceRequestsForOrgDetailed).toHaveBeenCalledWith(db, 'acct', 'o1', {
      limit: 15,
      statuses: ['RECEIVED', 'UNDER_REVIEW'],
    });
    expect(page.viewCounts).toEqual({ all: 7, open: 2, review: 4, replacement: 0, closed: 1 });
    expect(page.items).toEqual([{ id: 'r1', referenceCode: 'R-1' }]);
    expect(page.nextCursor).toBe('n');
  });
});

describe('loadEvidenceRequests for one case (WP-SB5)', () => {
  it('keeps only the requests that name the case before reading any code', async () => {
    svc.listEvidenceRequestsForOrgDetailed.mockResolvedValue(
      ok([
        { id: 'named', missionId: 'm1', applicantId: 'ap1' },
        { id: 'other-case', missionId: 'm2', applicantId: 'ap1' },
        { id: 'traveller-wide', missionId: null, applicantId: 'ap1' },
        { id: 'other-traveller', missionId: null, applicantId: 'ap2' },
      ]),
    );
    const rows = await loadEvidenceRequests(db, 'acct', 'o1', admin, {
      forCase: { missionId: 'm1', applicantId: 'ap1' },
    });
    // A traveller-wide request is never counted on one case (W0 structural flag 2).
    expect(rows.map((r) => r.id)).toEqual(['named']);
    expect(svc.referenceCodesFor).toHaveBeenCalledWith(db, 'R', ['named']);
  });
});
