import { randomUUID } from 'node:crypto';
import { schema } from '@visastack/db';
import type { Db } from '@visastack/services';

/**
 * Made-up dataset generator for capacity measurement. Every name, address and value is invented
 * (addresses end in example.test). The same seed always gives the same shape, so two runs are
 * comparable. Rows go in through the real tables with the real constraints.
 */
export interface DatasetShape {
  readonly agencies: number;
  readonly staffPerAgency: number;
  readonly travellers: number;
  readonly cases: number;
  readonly docsPerTravellerMin: number;
  readonly docsPerTravellerMax: number;
  readonly factsPerTraveller: number;
  readonly tasksPerCase: number;
  readonly evidenceRequestsPerCase: number;
  readonly notificationsPerTraveller: number;
  readonly notificationsPerStaff: number;
  readonly requirementsInRulePack: number;
  /** Adds one extra agency that can see EVERY case (worst case for list screens). */
  readonly stressAgency: boolean;
  readonly seed: number;
}

/** The launch envelope from the directive: 20 agencies, 200 staff, 5,000 profiles, 1,000 open cases. */
export const LAUNCH_SHAPE: DatasetShape = {
  agencies: 20,
  staffPerAgency: 10,
  travellers: 5000,
  cases: 1000,
  docsPerTravellerMin: 3,
  docsPerTravellerMax: 9,
  factsPerTraveller: 12,
  tasksPerCase: 5,
  evidenceRequestsPerCase: 3,
  notificationsPerTraveller: 8,
  notificationsPerStaff: 50,
  requirementsInRulePack: 30,
  stressAgency: true,
  seed: 20261006,
};

export const TINY_SHAPE: DatasetShape = {
  ...LAUNCH_SHAPE,
  agencies: 3,
  staffPerAgency: 3,
  travellers: 30,
  cases: 12,
  docsPerTravellerMin: 1,
  docsPerTravellerMax: 3,
  factsPerTraveller: 3,
  requirementsInRulePack: 4,
};

export interface AgencyHandle {
  readonly organizationId: string;
  readonly staff: readonly { readonly accountId: string; readonly role: string }[];
  readonly caseCount: number;
}

export interface TravellerHandle {
  readonly accountId: string;
  readonly applicantId: string;
}

export interface DatasetManifest {
  readonly shape: DatasetShape;
  readonly agencies: readonly AgencyHandle[];
  readonly stressAgency?: AgencyHandle;
  readonly travellers: readonly TravellerHandle[];
  /** Field keys that exist in the registry (for write tests). */
  readonly fieldKeys: readonly string[];
  readonly counts: Readonly<Record<string, number>>;
  readonly seededMs: number;
}

/** Small, fast, repeatable random numbers. */
export function makeRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Case counts per agency: a few big agencies and a long tail, summing exactly to `total`. */
export function skewedCounts(parts: number, total: number): number[] {
  const weights = Array.from({ length: parts }, (_, i) => 1 / (i + 1) ** 0.8);
  const sum = weights.reduce((a, b) => a + b, 0);
  const counts = weights.map((w) => Math.max(1, Math.floor((w / sum) * total)));
  let i = 0;
  while (counts.reduce((a, b) => a + b, 0) < total) {
    counts[i % parts] = (counts[i % parts] ?? 0) + 1;
    i++;
  }
  while (counts.reduce((a, b) => a + b, 0) > total) {
    const j = counts.indexOf(Math.max(...counts));
    counts[j] = (counts[j] ?? 1) - 1;
  }
  return counts;
}

const DOC_TYPES = [
  'passport',
  'bank_statement',
  'employment_letter',
  'photo',
  'itinerary',
  'accommodation',
  'tax_return',
  'insurance',
];
const FIELD_KEYS = [
  'given_name',
  'family_name',
  'date_of_birth',
  'nationality',
  'passport_number',
  'passport_expiry',
  'address_line',
  'city',
  'phone',
  'employer',
  'occupation',
  'marital_status',
  'emergency_contact',
  'previous_visas',
];
const OPEN_STATES = [
  'INTAKE',
  'IN_PROGRESS',
  'IN_REVIEW',
  'AWAITING_APPLICANT',
  'SUBMISSION_READY',
] as const;
const DESTINATIONS = ['Singapore', 'Germany', 'Canada', 'Japan', 'United Kingdom', 'Australia'];

async function insertChunks<T>(
  rows: readonly T[],
  size: number,
  write: (chunk: T[]) => Promise<unknown>,
): Promise<number> {
  for (let i = 0; i < rows.length; i += size) await write(rows.slice(i, i + size));
  return rows.length;
}

function pick<T>(items: readonly T[], rand: () => number): T {
  return items[Math.floor(rand() * items.length)] as T;
}

export async function seedDataset(db: Db, shape: DatasetShape): Promise<DatasetManifest> {
  const started = Date.now();
  const rand = makeRandom(shape.seed);
  const counts: Record<string, number> = {};
  const add = (name: string, n: number) => {
    counts[name] = (counts[name] ?? 0) + n;
  };
  const now = new Date();
  const day = 86_400_000;

  // Rule pack (one published pack with requirements)
  const packId = randomUUID();
  const packVersionId = randomUUID();
  await db.insert(schema.packs).values({
    id: packId,
    key: `load-pack-${shape.seed}`,
    name: 'Load test pack',
    jurisdiction: 'Test',
    authoritative: false,
  });
  await db.insert(schema.packVersions).values({
    id: packVersionId,
    packId,
    version: 1,
    status: 'PUBLISHED',
    publishedAt: now,
  });
  add('packs', 1);
  add('pack_versions', 1);
  const requirements = Array.from({ length: shape.requirementsInRulePack }, (_, i) => ({
    packVersionId,
    kind: i % 3 === 0 ? ('DOCUMENT' as const) : ('FIELD' as const),
    fieldKey: i % 3 === 0 ? null : (FIELD_KEYS[i % FIELD_KEYS.length] ?? null),
    docType: i % 3 === 0 ? (DOC_TYPES[i % DOC_TYPES.length] ?? null) : null,
    citation: `Load test rule ${i + 1}`,
    optional: i % 5 === 0,
  }));
  add(
    'pack_requirements',
    await insertChunks(requirements, 500, (c) => db.insert(schema.packRequirements).values(c)),
  );

  // Field definitions
  const fieldRows = FIELD_KEYS.map((key) => ({
    id: randomUUID(),
    key: `${key}.load.${shape.seed}`,
    dataType: 'string',
  }));
  await db.insert(schema.fieldDefinitions).values(fieldRows);
  add('field_definitions', fieldRows.length);

  // Agencies and staff
  const orgRows = Array.from({ length: shape.agencies + (shape.stressAgency ? 1 : 0) }, (_, i) => ({
    id: randomUUID(),
    name: i < shape.agencies ? `Agency ${i + 1} (made up)` : 'Agency STRESS (sees every case)',
    status: 'ACTIVE' as const,
  }));
  await db.insert(schema.organizations).values(orgRows);
  add('organizations', orgRows.length);

  const staffAccounts: {
    id: string;
    email: string;
    emailVerifiedAt: Date;
    orgIndex: number;
    role: 'OWNER' | 'ADMIN' | 'CASE_MANAGER' | 'REVIEWER';
  }[] = [];
  for (let o = 0; o < orgRows.length; o++) {
    for (let s = 0; s < shape.staffPerAgency; s++) {
      const role =
        s === 0 ? 'OWNER' : s === 1 ? 'ADMIN' : s % 2 === 0 ? 'CASE_MANAGER' : 'REVIEWER';
      staffAccounts.push({
        id: randomUUID(),
        email: `staff-${o + 1}-${s + 1}@example.test`,
        emailVerifiedAt: now,
        orgIndex: o,
        role,
      });
    }
  }
  add(
    'accounts',
    await insertChunks(staffAccounts, 1000, (c) =>
      db
        .insert(schema.accounts)
        .values(c.map((a) => ({ id: a.id, email: a.email, emailVerifiedAt: a.emailVerifiedAt }))),
    ),
  );
  add(
    'memberships',
    await insertChunks(staffAccounts, 1000, (c) =>
      db.insert(schema.memberships).values(
        c.map((a) => ({
          accountId: a.id,
          organizationId: orgRows[a.orgIndex]?.id as string,
          role: a.role,
        })),
      ),
    ),
  );

  // Travellers
  const travellers = Array.from({ length: shape.travellers }, (_, i) => ({
    accountId: randomUUID(),
    applicantId: randomUUID(),
    email: `traveller-${i + 1}@example.test`,
    name: `Traveller ${i + 1} (made up)`,
  }));
  add(
    'accounts',
    await insertChunks(travellers, 1000, (c) =>
      db
        .insert(schema.accounts)
        .values(c.map((t) => ({ id: t.accountId, email: t.email, emailVerifiedAt: now }))),
    ),
  );
  add(
    'applicants',
    await insertChunks(travellers, 1000, (c) =>
      db.insert(schema.applicants).values(
        c.map((t) => ({
          id: t.applicantId,
          ownerAccountId: t.accountId,
          displayName: t.name,
          authorityConfirmedAt: now,
        })),
      ),
    ),
  );

  add(
    'consent_records',
    await insertChunks(travellers, 2000, (c) =>
      db.insert(schema.consentRecords).values(
        c.map((t) => ({
          accountId: t.accountId,
          type: 'CORE_PROCESSING' as const,
          grantedAt: now,
        })),
      ),
    ),
  );

  // Cases, spread unevenly across agencies, each on a distinct traveller
  const perAgency = skewedCounts(shape.agencies, shape.cases);
  const missionRows: {
    id: string;
    applicantId: string;
    title: string;
    destination: string;
    state: (typeof OPEN_STATES)[number];
    ownerOrganizationId: string;
    packVersionId: string;
    targetDeadline: Date;
    travelStartDate: Date;
  }[] = [];
  const caseAgency: number[] = [];
  let cursor = 0;
  for (let a = 0; a < shape.agencies; a++) {
    for (let c = 0; c < (perAgency[a] ?? 0); c++) {
      const traveller = travellers[cursor % travellers.length] as (typeof travellers)[number];
      cursor++;
      missionRows.push({
        id: randomUUID(),
        applicantId: traveller.applicantId,
        title: `Visa case ${cursor} (made up)`,
        destination: pick(DESTINATIONS, rand),
        state: pick(OPEN_STATES, rand),
        ownerOrganizationId: orgRows[a]?.id as string,
        packVersionId,
        targetDeadline: new Date(now.getTime() + Math.floor(rand() * 90) * day),
        travelStartDate: new Date(now.getTime() + (30 + Math.floor(rand() * 120)) * day),
      });
      caseAgency.push(a);
    }
  }
  add(
    'missions',
    await insertChunks(missionRows, 500, (c) => db.insert(schema.missions).values(c)),
  );

  // Grants: each case's traveller shares with its agency; some are limited to the one case.
  // A second wave shares a slice of travellers with a second agency; the stress agency sees every case.
  const grantRows: (typeof schema.grants.$inferInsert)[] = [];
  const baseGrant = {
    actions: ['VIEW_METADATA', 'PREVIEW', 'COMMENT', 'MANAGE'] as (
      | 'VIEW_METADATA'
      | 'PREVIEW'
      | 'COMMENT'
      | 'MANAGE'
    )[],
    purpose: 'Visa application support (made up)',
    status: 'ACTIVE' as const,
    acceptedAt: now,
    startAt: new Date(now.getTime() - day),
    expiryAt: new Date(now.getTime() + 180 * day),
  };
  for (let i = 0; i < missionRows.length; i++) {
    const m = missionRows[i] as (typeof missionRows)[number];
    grantRows.push({
      ...baseGrant,
      applicantId: m.applicantId,
      recipientOrganizationId: m.ownerOrganizationId,
      missionId: rand() < 0.2 ? m.id : null,
    });
    if (rand() < 0.5) {
      const other = orgRows[Math.floor(rand() * shape.agencies)] as (typeof orgRows)[number];
      if (other.id !== m.ownerOrganizationId) {
        grantRows.push({
          ...baseGrant,
          applicantId: m.applicantId,
          recipientOrganizationId: other.id,
          missionId: null,
        });
      }
    }
    if (shape.stressAgency) {
      grantRows.push({
        ...baseGrant,
        applicantId: m.applicantId,
        recipientOrganizationId: orgRows[shape.agencies]?.id as string,
        missionId: null,
      });
    }
  }
  add('grants', await insertChunks(grantRows, 500, (c) => db.insert(schema.grants).values(c)));

  // Assignments: every case goes to one or two of its agency's staff
  const staffByOrg = new Map<number, typeof staffAccounts>();
  for (const s of staffAccounts)
    staffByOrg.set(s.orgIndex, [...(staffByOrg.get(s.orgIndex) ?? []), s]);
  const assignmentRows: (typeof schema.assignments.$inferInsert)[] = [];
  const stressIndex = shape.agencies;
  for (let i = 0; i < missionRows.length; i++) {
    const m = missionRows[i] as (typeof missionRows)[number];
    const staff = (staffByOrg.get(caseAgency[i] as number) ?? []).filter((s) => s.role !== 'OWNER');
    const chosen = new Set<string>();
    for (let k = 0; k < (rand() < 0.4 ? 2 : 1); k++)
      chosen.add((pick(staff, rand) as (typeof staff)[number]).id);
    for (const memberAccountId of chosen) {
      assignmentRows.push({
        organizationId: m.ownerOrganizationId,
        memberAccountId,
        missionId: m.id,
      });
    }
  }
  add(
    'assignments',
    await insertChunks(assignmentRows, 1000, (c) => db.insert(schema.assignments).values(c)),
  );

  // Tasks and evidence requests per case
  const taskRows: (typeof schema.missionTasks.$inferInsert)[] = [];
  const requestRows: (typeof schema.evidenceRequests.$inferInsert)[] = [];
  for (const m of missionRows) {
    for (let t = 0; t < shape.tasksPerCase; t++) {
      taskRows.push({
        missionId: m.id,
        description: `Task ${t + 1} for ${m.title}`,
        status: 'OPEN' as const,
        dueDate: new Date(now.getTime() + Math.floor(rand() * 30) * day),
      });
    }
    for (let r = 0; r < shape.evidenceRequestsPerCase; r++) {
      requestRows.push({
        organizationId: m.ownerOrganizationId,
        applicantId: m.applicantId,
        missionId: m.id,
        kind: r % 2 === 0 ? 'DOCUMENT' : 'FIELD',
        docType: r % 2 === 0 ? pick(DOC_TYPES, rand) : null,
        fieldKey: r % 2 === 0 ? null : pick(FIELD_KEYS, rand),
        message: 'Please provide this item (made up).',
      });
    }
  }
  add(
    'mission_tasks',
    await insertChunks(taskRows, 1000, (c) => db.insert(schema.missionTasks).values(c)),
  );
  add(
    'evidence_requests',
    await insertChunks(requestRows, 1000, (c) => db.insert(schema.evidenceRequests).values(c)),
  );

  // Documents (metadata only; one version each) and profile facts
  const storageRows: (typeof schema.storageObjects.$inferInsert)[] = [];
  const documentRows: (typeof schema.documents.$inferInsert)[] = [];
  const versionRows: (typeof schema.documentVersions.$inferInsert)[] = [];
  const factRows: (typeof schema.facts.$inferInsert)[] = [];
  const factVersionRows: (typeof schema.factVersions.$inferInsert)[] = [];
  for (let i = 0; i < travellers.length; i++) {
    const t = travellers[i] as (typeof travellers)[number];
    const docs =
      shape.docsPerTravellerMin +
      Math.floor(rand() * (shape.docsPerTravellerMax - shape.docsPerTravellerMin + 1));
    for (let d = 0; d < docs; d++) {
      const storageId = randomUUID();
      const documentId = randomUUID();
      storageRows.push({
        id: storageId,
        bucket: 'CLEAN',
        objectKey: `load/${t.applicantId}/${documentId}`,
        sizeBytes: 150_000 + Math.floor(rand() * 2_000_000),
      });
      documentRows.push({
        id: documentId,
        applicantId: t.applicantId,
        originalName: `${pick(DOC_TYPES, rand)}-${d + 1}.pdf`,
        docType: pick(DOC_TYPES, rand),
        uploaderAccountId: t.accountId,
      });
      versionRows.push({
        documentId,
        storageObjectId: storageId,
        processingStatus: rand() < 0.8 ? 'APPROVED' : 'AWAITING_REVIEW',
        safetyStatus: 'CLEAN',
        sizeBytes: 150_000 + Math.floor(rand() * 2_000_000),
        pages: 1 + Math.floor(rand() * 10),
      });
    }
    for (let f = 0; f < shape.factsPerTraveller; f++) {
      const factId = randomUUID();
      const versionId = randomUUID();
      factRows.push({
        id: factId,
        applicantId: t.applicantId,
        fieldDefinitionId: (fieldRows[f % fieldRows.length] as (typeof fieldRows)[number]).id,
        currentVersionId: versionId,
      });
      factVersionRows.push({
        id: versionId,
        factId,
        value: `value-${f}-${i}`,
        normalizedValue: `value-${f}-${i}`,
      });
    }
  }
  add(
    'storage_objects',
    await insertChunks(storageRows, 2000, (c) => db.insert(schema.storageObjects).values(c)),
  );
  add(
    'documents',
    await insertChunks(documentRows, 1000, (c) => db.insert(schema.documents).values(c)),
  );
  add(
    'document_versions',
    await insertChunks(versionRows, 1000, (c) => db.insert(schema.documentVersions).values(c)),
  );
  add('facts', await insertChunks(factRows, 2000, (c) => db.insert(schema.facts).values(c)));
  add(
    'fact_versions',
    await insertChunks(factVersionRows, 1500, (c) => db.insert(schema.factVersions).values(c)),
  );

  // Notifications (in-app, already sent; a share are read)
  const notificationRows: (typeof schema.notifications.$inferInsert)[] = [];
  const noteFor = (accountId: string, n: number) => {
    for (let k = 0; k < n; k++) {
      notificationRows.push({
        eventType: 'EVIDENCE_REQUESTED',
        channel: 'IN_APP',
        idempotencyKey: `load:${accountId}:${k}`,
        recipientAccountId: accountId,
        payload: {
          subject: 'Something needs your attention (made up)',
          summary: 'A request was added to your case.',
          deepLinkPath: '/cases',
        },
        status: rand() < 0.4 ? 'READ' : 'SENT',
        createdAt: new Date(now.getTime() - Math.floor(rand() * 60 * day)),
      });
    }
  };
  for (const t of travellers) noteFor(t.accountId, shape.notificationsPerTraveller);
  for (const s of staffAccounts) noteFor(s.id, shape.notificationsPerStaff);
  add(
    'notifications',
    await insertChunks(notificationRows, 1000, (c) => db.insert(schema.notifications).values(c)),
  );

  const handleFor = (o: number): AgencyHandle => ({
    organizationId: orgRows[o]?.id as string,
    staff: staffAccounts
      .filter((s) => s.orgIndex === o)
      .map((s) => ({ accountId: s.id, role: s.role })),
    caseCount: o === stressIndex ? missionRows.length : (perAgency[o] ?? 0),
  });
  return {
    shape,
    agencies: Array.from({ length: shape.agencies }, (_, o) => handleFor(o)),
    ...(shape.stressAgency ? { stressAgency: handleFor(stressIndex) } : {}),
    travellers: travellers.map((t) => ({ accountId: t.accountId, applicantId: t.applicantId })),
    fieldKeys: fieldRows.map((f) => f.key),
    counts,
    seededMs: Date.now() - started,
  };
}
