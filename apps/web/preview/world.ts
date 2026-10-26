import { randomUUID } from 'node:crypto';
import { schema } from '@visastack/db';
import { type Db, assignReferenceCodes } from '@visastack/services';
import { PROFILE_FIELDS } from '../src/lib/profile-fields';

/**
 * The made-up world the preview renders. Everything here is invented (addresses end in
 * example.test) and goes in through the real tables with their real constraints, so a page
 * behaves exactly as it will with real data: change a row and the page changes. Nothing in
 * the product reads from this file.
 *
 * Several people are chosen to break layouts on purpose: a very long name, a Bangla name,
 * an expired passport, an overdue request, an account that has not consented yet, and
 * accounts with nothing at all (the first-day experience).
 */

export type PersonaKey =
  | 'rahim'
  | 'shirin'
  | 'imran'
  | 'agencyOwner'
  | 'agencyMember'
  | 'agencyNew'
  | 'platformAdmin';

export interface Persona {
  readonly accountId: string;
  readonly email: string;
}

export interface World {
  readonly personas: Readonly<Record<PersonaKey, Persona>>;
  readonly ids: {
    readonly orgId: string;
    readonly newOrgId: string;
    readonly pendingOrgId: string;
    readonly applicantSelf: string;
    readonly applicantSpouse: string;
    readonly applicantMinor: string;
    readonly applicantLongName: string;
    readonly applicantBangla: string;
    readonly shirinApplicant: string;
    readonly missionSingapore: string;
    readonly missionGermany: string;
    readonly missionJapan: string;
    readonly incomingGrant: string;
    readonly packId: string;
    readonly packKey: string;
    readonly agencyMissionId: string;
  };
}

const DAY = 86_400_000;
const now = Date.now();
const at = (days: number) => new Date(now + days * DAY);
const isoDay = (days: number) => at(days).toISOString().slice(0, 10);

async function account(db: Db, email: string): Promise<Persona> {
  const accountId = randomUUID();
  await db
    .insert(schema.accounts)
    .values({ id: accountId, email, emailVerifiedAt: at(-60), lastActiveAt: at(-1) });
  return { accountId, email };
}

async function consent(db: Db, accountId: string, types: readonly string[]) {
  for (const type of types) {
    await db.insert(schema.consentRecords).values({
      accountId,
      type: type as (typeof schema.consentRecords.$inferInsert)['type'],
      grantedAt: at(-40),
    });
  }
}

async function applicant(
  db: Db,
  ownerAccountId: string,
  displayName: string,
  relationship: 'SELF' | 'FAMILY_MEMBER' | 'MINOR_GUARDIAN',
): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.applicants).values({
    id,
    ownerAccountId,
    displayName,
    relationship,
    authorityConfirmedAt: at(-40),
  });
  // Visible reference codes (ADR 0018); does nothing while the registry table is missing.
  await assignReferenceCodes(db, 'P', [id]);
  return id;
}

interface DocSpec {
  readonly originalName: string;
  readonly docType: string;
  readonly expiresInDays?: number;
  readonly processing?: (typeof schema.documentVersions.$inferInsert)['processingStatus'];
  readonly safety?: (typeof schema.documentVersions.$inferInsert)['safetyStatus'];
  readonly approvedName?: string;
}

async function documents(db: Db, applicantId: string, uploader: string, specs: DocSpec[]) {
  for (const spec of specs) {
    const storageId = randomUUID();
    const documentId = randomUUID();
    const quarantined = spec.safety === 'QUARANTINED';
    await db.insert(schema.storageObjects).values({
      id: storageId,
      bucket: quarantined ? 'QUARANTINE' : 'CLEAN',
      objectKey: `preview/${applicantId}/${documentId}`,
      sizeBytes: 380_000,
    });
    await db.insert(schema.documents).values({
      id: documentId,
      applicantId,
      originalName: spec.originalName,
      approvedName: spec.approvedName ?? null,
      docType: spec.docType,
      uploaderAccountId: uploader,
      documentDate: isoDay(-20),
      expiresAt: spec.expiresInDays === undefined ? null : at(spec.expiresInDays),
    });
    await assignReferenceCodes(db, 'D', [documentId]);
    await db.insert(schema.documentVersions).values({
      documentId,
      storageObjectId: storageId,
      processingStatus: spec.processing ?? 'APPROVED',
      safetyStatus: spec.safety ?? 'CLEAN',
      sizeBytes: 380_000,
      pages: 3,
    });
  }
}

export async function buildWorld(db: Db): Promise<World> {
  // ---- accounts ----
  const rahim = await account(db, 'rahim.uddin@example.test');
  const shirin = await account(db, 'shirin.akter@example.test');
  const imran = await account(db, 'imran.hossain@example.test');
  const agencyOwner = await account(db, 'farhana.rahman@dhakavisadesk.example.test');
  const agencyAdmin = await account(db, 'tanvir.ahmed@dhakavisadesk.example.test');
  const agencyMember = await account(db, 'mitu.sarkar@dhakavisadesk.example.test');
  const agencyReviewer = await account(db, 'sajid.karim@dhakavisadesk.example.test');
  const agencyNew = await account(db, 'nadia.islam@padmatravel.example.test');
  const platformAdmin = await account(db, 'admin@example.test');
  const pendingOwner = await account(db, 'owner@meghnaglobal.example.test');

  await consent(db, rahim.accountId, ['CORE_PROCESSING', 'SHARING', 'AI_EXTRACTION']);
  await consent(db, shirin.accountId, ['CORE_PROCESSING']);
  await consent(db, agencyOwner.accountId, ['CORE_PROCESSING']);
  await consent(db, agencyNew.accountId, ['CORE_PROCESSING']);

  // ---- field registry and expiry rules ----
  const fieldIds = new Map<string, string>();
  for (const f of PROFILE_FIELDS) {
    const id = randomUUID();
    fieldIds.set(f.key, id);
    await db.insert(schema.fieldDefinitions).values({
      id,
      key: f.key,
      dataType: f.type === 'date' ? 'date' : 'string',
      sensitivity: f.sensitivity,
      repeating: Boolean(f.group),
    });
  }
  await db.insert(schema.documentExpiryPolicies).values([
    { docType: 'passport', thresholdDays: [180, 90, 30, 7] },
    { docType: 'insurance', thresholdDays: [30, 7] },
    { docType: 'bank_statement', thresholdDays: [30, 7] },
  ]);

  // ---- Rahim: a busy traveller ----
  const applicantSelf = await applicant(db, rahim.accountId, 'Rahim Uddin', 'SELF');
  const applicantSpouse = await applicant(db, rahim.accountId, 'Nusrat Jahan', 'FAMILY_MEMBER');
  const applicantMinor = await applicant(db, rahim.accountId, 'Tahmid Uddin', 'MINOR_GUARDIAN');
  const applicantLongName = await applicant(
    db,
    rahim.accountId,
    'Mohammad Abdul Rahman Chowdhury Al-Mahmud Siddique Bhuiyan',
    'FAMILY_MEMBER',
  );
  const applicantBangla = await applicant(db, rahim.accountId, 'মোহাম্মদ আব্দুল করিম', 'FAMILY_MEMBER');

  const universal = PROFILE_FIELDS.filter((f) => f.pack === 'universal' && !f.group);
  for (const [index, f] of universal.entries()) {
    // About two thirds of the core profile is filled, so the completeness bar shows real progress.
    if (index % 3 === 2) continue;
    const factId = randomUUID();
    const versionId = randomUUID();
    const value =
      f.type === 'date'
        ? isoDay(-9000 + index * 37)
        : (f.options?.[0] ??
          (f.key.includes('name') ? 'Rahim Uddin' : `Sample ${f.label.toLowerCase()}`));
    await db.insert(schema.facts).values({
      id: factId,
      applicantId: applicantSelf,
      fieldDefinitionId: fieldIds.get(f.key) as string,
      currentVersionId: versionId,
    });
    await db.insert(schema.factVersions).values({
      id: versionId,
      factId,
      value,
      normalizedValue: value,
      status: index % 4 === 0 ? 'DOCUMENT_SUPPORTED' : 'APPLICANT_CONFIRMED',
      method: 'MANUAL',
      actorAccountId: rahim.accountId,
    });
  }

  await documents(db, applicantSelf, rahim.accountId, [
    {
      originalName: 'passport-scan-rahim-uddin.pdf',
      docType: 'passport',
      expiresInDays: 27,
      approvedName: 'Passport - Rahim Uddin',
    },
    {
      originalName:
        'Dutch-Bangla-Bank-Joint-Account-Statement-January-to-September-2026-certified-copy-final-v3.pdf',
      docType: 'bank_statement',
      expiresInDays: 89,
    },
    { originalName: 'employment-letter-sept-2026.pdf', docType: 'employment_letter' },
    { originalName: 'passport-photo-white-background.jpg', docType: 'photo' },
    { originalName: 'flight-itinerary-dac-sin.pdf', docType: 'itinerary' },
    {
      originalName: 'hotel-booking-marina-bay.pdf',
      docType: 'accommodation',
      processing: 'AWAITING_REVIEW',
    },
    { originalName: 'travel-insurance-2025.pdf', docType: 'insurance', expiresInDays: -12 },
    { originalName: 'tax-return-2025.pdf', docType: 'tax_return' },
    {
      originalName: 'scan-0042.pdf',
      docType: 'employment_letter',
      processing: 'QUARANTINED',
      safety: 'QUARANTINED',
    },
  ]);
  await documents(db, applicantSpouse, rahim.accountId, [
    { originalName: 'passport-nusrat-jahan.pdf', docType: 'passport', expiresInDays: 1400 },
  ]);

  // ---- rule packs ----
  const packId = randomUUID();
  const packKey = 'singapore-visit-pass-preview';
  const packVersionId = randomUUID();
  const makePack = async (
    id: string,
    versionId: string,
    key: string,
    name: string,
    authoritative: boolean,
    docRequirements: readonly string[],
  ) => {
    await db.insert(schema.packs).values({
      id,
      key,
      name,
      jurisdiction: name.split(' ')[0] ?? 'Test',
      route: 'Visitor',
      purpose: 'Short visit',
      authoritative,
    });
    await db.insert(schema.packVersions).values({
      id: versionId,
      packId: id,
      version: 1,
      status: 'PUBLISHED',
      publishedAt: at(-30),
      effectiveDate: at(-30),
      nextReviewDate: at(150),
      publicTrustPublishedAt: authoritative ? at(-10) : null,
      routeDescription: authoritative
        ? 'Apply online for a short visit. Bring your passport, bank statements and a letter from your employer.'
        : null,
      officialChannelName: authoritative ? 'Official immigration portal' : null,
      officialChannelUrl: authoritative ? 'https://example.test/immigration' : null,
    });
    const rows = [
      ...docRequirements.map((docType) => ({
        packVersionId: versionId,
        kind: 'DOCUMENT' as const,
        docType,
        citation: 'Official visitor guidance, section 4',
        sourceTitle: 'Official visa guidance',
        optional: docType === 'photo',
      })),
      ...universal.slice(0, 3).map((f) => ({
        packVersionId: versionId,
        kind: 'FIELD' as const,
        fieldKey: f.key,
        citation: 'Application form, part 1',
        optional: false,
      })),
    ];
    await db.insert(schema.packRequirements).values(rows);
  };
  await makePack(packId, packVersionId, packKey, 'Singapore Visit Pass', true, [
    'passport',
    'bank_statement',
    'employment_letter',
    'itinerary',
    'accommodation',
    'photo',
  ]);
  const schengenPack = randomUUID();
  const schengenVersion = randomUUID();
  await makePack(
    schengenPack,
    schengenVersion,
    'schengen-short-stay-preview',
    'Schengen Short Stay',
    false,
    ['passport', 'insurance', 'bank_statement', 'itinerary'],
  );

  // ---- organizations ----
  const orgId = randomUUID();
  const newOrgId = randomUUID();
  const pendingOrgId = randomUUID();
  await db.insert(schema.organizations).values([
    { id: orgId, name: 'Dhaka Visa Desk', status: 'ACTIVE' },
    { id: newOrgId, name: 'Padma Travel & Visa Services Limited (Bangladesh)', status: 'ACTIVE' },
    {
      id: pendingOrgId,
      name: 'Meghna Global Education Consultants',
      status: 'PENDING_VERIFICATION',
    },
  ]);
  await db.insert(schema.memberships).values([
    { accountId: agencyOwner.accountId, organizationId: orgId, role: 'OWNER' },
    { accountId: agencyAdmin.accountId, organizationId: orgId, role: 'ADMIN' },
    { accountId: agencyMember.accountId, organizationId: orgId, role: 'CASE_MANAGER' },
    { accountId: agencyReviewer.accountId, organizationId: orgId, role: 'REVIEWER' },
    { accountId: agencyNew.accountId, organizationId: newOrgId, role: 'OWNER' },
    { accountId: pendingOwner.accountId, organizationId: pendingOrgId, role: 'OWNER' },
  ]);

  // ---- Rahim's cases (his own, not agency-owned) ----
  const missionSingapore = randomUUID();
  const missionGermany = randomUUID();
  const missionJapan = randomUUID();
  await db.insert(schema.missions).values([
    {
      id: missionSingapore,
      applicantId: applicantSelf,
      title: 'Singapore business visit',
      destination: 'Singapore',
      jurisdiction: 'Singapore',
      serviceCategory: 'Business',
      state: 'IN_PROGRESS',
      packVersionId,
      targetDeadline: at(18),
      travelStartDate: at(40),
      travelEndDate: at(46),
    },
    {
      id: missionGermany,
      applicantId: applicantSelf,
      title: 'Germany family trip',
      destination: 'Germany',
      state: 'AWAITING_APPLICANT',
      packVersionId: schengenVersion,
      itineraryRef: 'Uddin Family Europe 2027',
      targetDeadline: at(75),
    },
    {
      id: missionJapan,
      applicantId: applicantSelf,
      title: 'Japan tourist visit (planning)',
      destination: 'Japan',
      state: 'DRAFT',
      manualMode: true,
    },
  ]);
  await assignReferenceCodes(db, 'C', [missionSingapore, missionGermany, missionJapan]);
  await db.insert(schema.missionTasks).values([
    {
      missionId: missionSingapore,
      description: 'Collect signed employer letter',
      status: 'IN_PROGRESS',
      dueDate: at(-3),
      priority: 'HIGH',
    },
    {
      missionId: missionSingapore,
      description: 'Book hotel for the full stay',
      status: 'OPEN',
      dueDate: at(4),
      priority: 'NORMAL',
    },
    {
      missionId: missionSingapore,
      description: 'Print the application summary',
      status: 'DONE',
      dueDate: at(-10),
      priority: 'LOW',
    },
  ]);

  // ---- the agency's evidence requests to Rahim ----
  const agencyGrant = {
    applicantId: applicantSelf,
    recipientOrganizationId: orgId,
    actions: ['VIEW_METADATA', 'PREVIEW', 'COMMENT', 'MANAGE'] as (
      | 'VIEW_METADATA'
      | 'PREVIEW'
      | 'COMMENT'
      | 'MANAGE'
    )[],
    purpose: 'Visa application support',
    status: 'ACTIVE' as const,
    acceptedAt: at(-30),
    startAt: at(-30),
    expiryAt: at(150),
  };
  await db.insert(schema.grants).values([
    agencyGrant,
    {
      ...agencyGrant,
      recipientOrganizationId: newOrgId,
      status: 'PENDING_ACCEPTANCE',
      acceptedAt: null,
      purpose: 'Second opinion on the Germany trip',
    },
    {
      ...agencyGrant,
      recipientOrganizationId: pendingOrgId,
      status: 'REVOKED',
      purpose: 'Earlier enquiry',
    },
    {
      ...agencyGrant,
      status: 'EXPIRED',
      expiryAt: at(-5),
      purpose: 'Initial consultation',
      missionId: missionSingapore,
    },
  ]);
  const ask = (
    status: (typeof schema.evidenceRequests.$inferInsert)['status'],
    docType: string,
    due: number | null,
    message: string | null,
  ) => ({
    organizationId: orgId,
    applicantId: applicantSelf,
    missionId: missionSingapore,
    kind: 'DOCUMENT' as const,
    docType,
    message,
    dueDate: due === null ? null : at(due),
    status,
    requestedByAccountId: agencyMember.accountId,
  });
  const rahimRequests = await db
    .insert(schema.evidenceRequests)
    .values([
      ask(
        'OPEN',
        'employment_letter',
        -2,
        'The embassy asks for a letter dated this month on company letterhead.',
      ),
      {
        ...ask('NEEDS_REPLACEMENT', 'bank_statement', 5, 'Last three months, with the bank stamp.'),
        kind: 'DOCUMENT' as const,
      },
      ask('UNDER_REVIEW', 'itinerary', 20, 'Return flights.'),
      ask('ACCEPTED', 'passport', null, null),
      {
        organizationId: orgId,
        applicantId: applicantSelf,
        missionId: missionSingapore,
        kind: 'FIELD' as const,
        fieldKey: universal[1]?.key ?? null,
        message: 'Please confirm this detail.',
        dueDate: at(9),
        status: 'OPEN' as const,
        requestedByAccountId: agencyMember.accountId,
      },
    ])
    .returning({ id: schema.evidenceRequests.id });
  await assignReferenceCodes(
    db,
    'R',
    rahimRequests.map((r) => r.id),
  );

  // ---- Shirin shares with Rahim (what "Shared with me" shows) ----
  const shirinApplicant = await applicant(db, shirin.accountId, 'Shirin Akter', 'SELF');
  const incomingGrant = randomUUID();
  await db.insert(schema.grants).values([
    {
      id: incomingGrant,
      applicantId: shirinApplicant,
      recipientAccountId: rahim.accountId,
      actions: ['VIEW_METADATA', 'PREVIEW'],
      purpose: 'Planning a family trip together',
      status: 'ACTIVE',
      acceptedAt: at(-6),
      startAt: at(-6),
      expiryAt: at(60),
    },
    {
      applicantId: shirinApplicant,
      recipientAccountId: rahim.accountId,
      actions: ['VIEW_METADATA'],
      purpose: 'Sharing hotel details',
      status: 'PENDING_ACCEPTANCE',
      expiryAt: at(30),
    },
    {
      applicantId: shirinApplicant,
      recipientAccountId: rahim.accountId,
      actions: ['VIEW_METADATA'],
      purpose: 'Old travel plan',
      status: 'REVOKED',
      expiryAt: at(10),
    },
  ]);

  // ---- notifications for Rahim ----
  const note = (
    key: string,
    subject: string,
    summary: string,
    deepLinkPath: string,
    read: boolean,
    ago: number,
  ) => ({
    eventType: 'EVIDENCE_REQUESTED',
    channel: 'IN_APP' as const,
    idempotencyKey: `preview:${key}`,
    recipientAccountId: rahim.accountId,
    payload: { subject, summary, deepLinkPath },
    status: read ? ('READ' as const) : ('SENT' as const),
    createdAt: at(-ago),
  });
  await db
    .insert(schema.notifications)
    .values([
      note(
        '1',
        'Passport expires in 27 days',
        'Rahim Uddin: renew it before you travel.',
        `/app/applicant/${applicantSelf}/expiry`,
        false,
        0,
      ),
      note(
        '2',
        'Dhaka Visa Desk asked for a document',
        'Employer letter, needed by the embassy.',
        `/app/applicant/${applicantSelf}/evidence`,
        false,
        1,
      ),
      note(
        '3',
        'Travel insurance has expired',
        'It ended 12 days ago.',
        `/app/applicant/${applicantSelf}/expiry`,
        false,
        2,
      ),
      note(
        '4',
        'Singapore business visit moved to In progress',
        'Your agency started the review.',
        `/app/mission/${missionSingapore}`,
        true,
        6,
      ),
      note(
        '5',
        'Shirin Akter shared access with you',
        'Planning a family trip together.',
        '/app/shared',
        true,
        8,
      ),
    ]);

  // ---- Dhaka Visa Desk: twelve cases for the agency views ----
  const travellers = [
    'Shahriar Kabir',
    'Farzana Yasmin',
    'Mehedi Hasan',
    'Sumaiya Akter',
    'Arif Chowdhury',
    'Tasnim Rahman',
    'Jahidul Islam',
    'Nasrin Sultana',
    'Rakibul Hasan',
    'Maliha Khan',
    'Abdullah Al Mamun',
    'Sharmin Nahar',
  ];
  const states = [
    'INTAKE',
    'IN_PROGRESS',
    'IN_REVIEW',
    'AWAITING_APPLICANT',
    'SUBMISSION_READY',
    'READY_FOR_REVIEW',
    'SUBMITTED',
  ] as const;
  const destinations = ['United Kingdom', 'Singapore', 'Germany', 'Canada', 'Japan', 'Australia'];
  let agencyMissionId = '';
  for (const [i, name] of travellers.entries()) {
    const traveller = await account(db, `traveller${i + 1}@example.test`);
    await consent(db, traveller.accountId, ['CORE_PROCESSING']);
    const applicantId = await applicant(db, traveller.accountId, name, 'SELF');
    const missionId = randomUUID();
    if (i === 0) agencyMissionId = missionId;
    await db.insert(schema.missions).values({
      id: missionId,
      applicantId,
      title: `${destinations[i % destinations.length]} ${i % 2 === 0 ? 'visitor visa' : 'study visa'}`,
      destination: destinations[i % destinations.length] ?? null,
      state: states[i % states.length] ?? 'INTAKE',
      ownerOrganizationId: orgId,
      packVersionId: i % 5 === 4 ? null : packVersionId,
      targetDeadline: i % 3 === 0 ? at(4 + i) : at(40 + i),
      travelStartDate: at(30 + i * 3),
    });
    await assignReferenceCodes(db, 'C', [missionId]);
    await db.insert(schema.grants).values({
      applicantId,
      recipientOrganizationId: orgId,
      actions: ['VIEW_METADATA', 'PREVIEW', 'COMMENT', 'MANAGE'],
      purpose: 'Visa application support',
      status: 'ACTIVE',
      acceptedAt: at(-20),
      startAt: at(-20),
      expiryAt: at(160),
    });
    // Seven of twelve are assigned; the rest need an owner.
    if (i % 12 < 7) {
      await db.insert(schema.assignments).values({
        organizationId: orgId,
        memberAccountId: i % 2 === 0 ? agencyMember.accountId : agencyAdmin.accountId,
        missionId,
      });
    }
    if (i % 2 === 0) {
      await db.insert(schema.missionTasks).values({
        missionId,
        description: 'Check the bank statement dates',
        status: 'OPEN',
        dueDate: at(i % 4 === 0 ? -(i + 1) : 3 + i),
      });
    }
    if (i % 3 !== 2) {
      const [request] = await db
        .insert(schema.evidenceRequests)
        .values({
          organizationId: orgId,
          applicantId,
          missionId,
          kind: 'DOCUMENT',
          docType: i % 2 === 0 ? 'bank_statement' : 'employment_letter',
          message: 'Please send this so we can continue.',
          dueDate: at(i % 4 === 0 ? -2 : 6),
          status: i % 3 === 0 ? 'OPEN' : 'NEEDS_REPLACEMENT',
          requestedByAccountId: agencyMember.accountId,
        })
        .returning({ id: schema.evidenceRequests.id });
      if (request) await assignReferenceCodes(db, 'R', [request.id]);
    }
  }

  // ---- platform administrator ----
  await db.insert(schema.platformRoles).values({
    accountId: platformAdmin.accountId,
    role: 'PLATFORM_OWNER',
    reason: 'Preview world: the platform owner',
  });

  return {
    personas: {
      rahim,
      shirin,
      imran,
      agencyOwner,
      agencyMember,
      agencyNew,
      platformAdmin,
    },
    ids: {
      orgId,
      newOrgId,
      pendingOrgId,
      applicantSelf,
      applicantSpouse,
      applicantMinor,
      applicantLongName,
      applicantBangla,
      shirinApplicant,
      missionSingapore,
      missionGermany,
      missionJapan,
      incomingGrant,
      packId,
      packKey,
      agencyMissionId,
    },
  };
}
