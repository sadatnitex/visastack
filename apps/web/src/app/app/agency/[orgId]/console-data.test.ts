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
  loadCases,
  loadEvidenceRequests,
  loadMembers,
  loadOrgAccess,
  loadPendingClientInvitations,
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
    expect(await loadPendingClientInvitations(db, 'acct', 'o1', notAdmin)).toEqual([]);
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
    expect(await loadPendingClientInvitations(db, 'acct', 'o1', admin)).toEqual([]);
  });

  it('keep only the invitations still waiting for an answer', async () => {
    const rows = [
      { id: 'i1', status: 'PENDING' },
      { id: 'i2', status: 'ACCEPTED' },
      { id: 'i3', status: 'REVOKED' },
      { id: 'i4', status: 'PENDING' },
    ];
    svc.listOrganizationInvitations.mockResolvedValue(ok(rows));
    svc.listClientInvitations.mockResolvedValue(ok(rows));
    expect((await loadPendingTeamInvitations(db, 'acct', 'o1', admin)).map((i) => i.id)).toEqual([
      'i1',
      'i4',
    ]);
    expect((await loadPendingClientInvitations(db, 'acct', 'o1', admin)).map((i) => i.id)).toEqual([
      'i1',
      'i4',
    ]);
    expect(svc.listOrganizationInvitations).toHaveBeenCalledWith(db, {
      actorAccountId: 'acct',
      organizationId: 'o1',
    });
    expect(svc.listClientInvitations).toHaveBeenCalledWith(db, {
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

  beforeEach(() => {
    svc.listVisibleMissionsForMember.mockResolvedValue({
      admin: true,
      missions: [manual, withPack],
    });
    svc.listAssignmentsDetailed.mockImplementation(async (_db, _org, _ap, missionId) =>
      missionId === 'm-pack' ? [{ memberAccountId: 'acct', memberEmail: 'me@example.com' }] : [],
    );
    svc.listNotes.mockResolvedValue([
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
    ]);
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
    expect((await loadCases(db, 'acct', 'o1', members)).admin).toBe(true);
    svc.listVisibleMissionsForMember.mockResolvedValue({ admin: false, missions: [] });
    expect(await loadCases(db, 'acct', 'o1', members)).toEqual({ admin: false, cases: [] });
  });

  it('calls every per-case service with the arguments it takes', async () => {
    await loadCases(db, 'acct', 'o1', members);
    expect(svc.listAssignmentsDetailed).toHaveBeenCalledWith(db, 'o1', 'ap2', 'm-pack');
    expect(svc.listNotes).toHaveBeenCalledWith(db, 'o1', 'ap2', 'm-pack');
    expect(svc.listMissionRequirementsForOrg).toHaveBeenCalledWith(db, 'o1', 'm-pack');
    expect(svc.listMissionDecisions).toHaveBeenCalledWith(db, 'acct', 'm-pack');
    expect(svc.listSelectedEvidenceForOrg).toHaveBeenCalledWith(db, 'o1', 'm-pack');
    expect(svc.listTasksForOrg).toHaveBeenCalledWith(db, 'o1', 'ap2', 'm-pack');
    expect(svc.listAppointmentsForOrg).toHaveBeenCalledWith(db, 'o1', 'ap2', 'm-pack');
    expect(svc.getLiveAcknowledgement).toHaveBeenCalledWith(db, 'm-pack');
  });

  it('computes readiness only for a case that has a pack and is not in manual mode', async () => {
    const { cases } = await loadCases(db, 'acct', 'o1', members);
    expect(svc.computeReadiness).toHaveBeenCalledTimes(1);
    expect(svc.computeReadiness).toHaveBeenCalledWith(db, 'm-pack');
    expect(cases.find((c) => c.missionId === 'm-manual')?.readiness).toBeNull();
    expect(cases.find((c) => c.missionId === 'm-pack')?.readiness).toEqual({
      ready: true,
      requiredCount: 2,
    });
  });

  it('names a note author from the roster, and says Unknown for anyone not on it', async () => {
    const { cases } = await loadCases(db, 'acct', 'o1', members);
    const notes = cases[1]?.notes ?? [];
    expect(notes.map((n) => n.authorEmail)).toEqual(['author@example.com', 'Unknown']);
    expect(notes[0]?.createdAt).toBe('2026-10-01T10:00:00.000Z');
  });

  it('says Unknown for every author when the viewer cannot see the roster', async () => {
    const { cases } = await loadCases(db, 'acct', 'o1', []);
    expect(cases[1]?.notes.map((n) => n.authorEmail)).toEqual(['Unknown', 'Unknown']);
  });

  it('labels requirements: a field by its stored key when it has no known label, a document by its type', async () => {
    const { cases } = await loadCases(db, 'acct', 'o1', members);
    expect(cases[1]?.requirements).toEqual([
      { id: 'q1', label: 'unknown.field' },
      { id: 'q2', label: 'PASSPORT' },
    ]);
  });

  it('leaves requirements and decisions empty when the service refuses them', async () => {
    svc.listMissionRequirementsForOrg.mockResolvedValue(fail());
    svc.listMissionDecisions.mockResolvedValue(fail());
    const { cases } = await loadCases(db, 'acct', 'o1', members);
    expect(cases[1]?.requirements).toEqual([]);
    expect(cases[1]?.decisions).toEqual([]);
  });

  it('flattens issuer confirmations from fact and document evidence, marking an expired one', async () => {
    const { cases } = await loadCases(db, 'acct', 'o1', members);
    const verifications = cases[1]?.issuerVerifications ?? [];
    expect(verifications.map((v) => [v.id, v.packRequirementId, v.expired])).toEqual([
      ['v1', 'q1', false],
      ['v2', 'q2', true],
    ]);
    expect(svc.listIssuerVerificationsForFact).toHaveBeenCalledWith(db, 'f1');
    expect(svc.listIssuerVerificationsForDocument).toHaveBeenCalledWith(db, 'doc1');
  });

  it('reports the viewer as assigned only where an assignment names them', async () => {
    const { cases } = await loadCases(db, 'acct', 'o1', members);
    expect(cases.find((c) => c.missionId === 'm-manual')?.viewerAssigned).toBe(false);
    expect(cases.find((c) => c.missionId === 'm-pack')?.viewerAssigned).toBe(true);
  });

  it('turns dates into ISO strings and keeps a missing due date null', async () => {
    const { cases } = await loadCases(db, 'acct', 'o1', members);
    expect(cases[1]?.tasks.map((t) => t.dueDate)).toEqual(['2026-10-10T00:00:00.000Z', null]);
    expect(cases[1]?.appointments[0]?.localDateTime).toBe('2026-10-15T09:00:00.000Z');
    expect(cases[1]?.decisions[0]?.createdAt).toBe('2026-10-03T10:00:00.000Z');
  });

  it("carries the applicant's live acknowledgement date, or null when there is none", async () => {
    const { cases } = await loadCases(db, 'acct', 'o1', members);
    expect(cases.find((c) => c.missionId === 'm-manual')?.liveAcknowledgementAt).toBeNull();
    expect(cases.find((c) => c.missionId === 'm-pack')?.liveAcknowledgementAt).toBe(
      '2026-10-04T10:00:00.000Z',
    );
  });

  it('keeps the original fields of the visible case alongside the detail', async () => {
    const { cases } = await loadCases(db, 'acct', 'o1', members);
    expect(cases[0]).toMatchObject({ missionId: 'm-manual', applicantId: 'ap1', manualMode: true });
  });

  it('reads every case code in one call and attaches only the codes that exist (ADR 0018)', async () => {
    svc.referenceCodesFor.mockResolvedValue(new Map([['m-pack', 'C-7K2Q9M']]));
    const { cases } = await loadCases(db, 'acct', 'o1', members);
    expect(svc.referenceCodesFor).toHaveBeenCalledTimes(1);
    expect(svc.referenceCodesFor).toHaveBeenCalledWith(db, 'C', ['m-manual', 'm-pack']);
    expect(cases.find((c) => c.missionId === 'm-pack')?.referenceCode).toBe('C-7K2Q9M');
    expect('referenceCode' in (cases.find((c) => c.missionId === 'm-manual') ?? {})).toBe(false);
  });

  it('shows no case code at all while the registry is empty or missing', async () => {
    const { cases } = await loadCases(db, 'acct', 'o1', members);
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
