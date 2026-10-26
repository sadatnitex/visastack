import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { accountPrincipal, requireAccess } from './access';
import { provisionAccount } from './accounts';
import { decideAcknowledgement } from './acknowledgements';
import { type AiExtractionPort, runExtraction } from './ai';
import { createApplicant } from './applicants';
import {
  ATTENTION_REQUEST_STATUSES,
  ATTENTION_TASK_STATUSES,
  type AttentionItem,
  CALENDAR_PAST_DAYS,
  CALENDAR_SOURCE_LIMIT,
  WITH_AGENCY_REQUEST_STATUSES,
  attentionTier,
  daysUntilDueDay,
  listCalendarDates,
  listNeedsAttention,
  rankAttentionItems,
  recognisedTimeZone,
} from './attention';
import { setConsent } from './consent';
import type { Db } from './db';
import { addDocumentVersion, registerDocument } from './documents';
import { incrementMaterialRevision } from './material-revision';
import {
  createAppointment,
  createMission,
  createTask,
  decideTask,
  snapshotMission,
  updateAppointment,
} from './missions';
import { registerFieldDefinition } from './profile';
import { acceptGrant, createGrant } from './sharing';
import { supersedeDocument } from './wallet';

// Made-up values, seeded so the test can prove none of them reaches an item.
const PASSPORT_NUMBER = 'BX7319046';
const AGENCY_NOTE = `Please send your bank statement, account 0123456789, passport ${PASSPORT_NUMBER}`;
const FILE_NAME = 'Nusrat_Jahan_passport_scan.pdf';
const READ_NAME = 'Nusrath';
// 26 Oct 2026, 12:00 UTC: 18:00 the same day in Dhaka (the applicant's default time zone).
const NOW = new Date('2026-10-26T12:00:00Z');
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const HEAVY = 60_000;

let db: Db;
beforeEach(async () => {
  db = drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
});

async function account(email: string): Promise<string> {
  const provisioned = await provisionAccount(db, { email });
  if (!isOk(provisioned)) throw new Error(`provision ${email}`);
  return provisioned.value.id;
}

const reader: AiExtractionPort = {
  async extract() {
    return {
      ok: true,
      result: {
        proposals: ['given_name', 'nationality'].map((fieldKey) => ({
          type: 'NEW' as const,
          fieldKey,
          value: READ_NAME,
          confidence: 0.9,
          evidenceSnippet: READ_NAME,
        })),
        usage: {
          costUnits: 1,
          inputUnits: 1,
          outputUnits: 1,
          cachedUnits: 0,
          modelVersion: 'test-model',
          promptVersion: 'p1',
          schemaVersion: 's1',
          provider: 'test',
          latencyMs: 1,
        },
      },
    };
  },
  cacheKeyComponents() {
    return { model: 'test-model', promptVersion: 'p1', schemaVersion: 's1' };
  },
};

async function person(email: string) {
  const ownerId = await account(email);
  for (const type of ['CORE_PROCESSING', 'AI_EXTRACTION', 'SHARING'] as const) {
    await setConsent(db, { actorAccountId: ownerId, accountId: ownerId, type, granted: true });
  }
  const applicant = await createApplicant(db, {
    actorAccountId: ownerId,
    ownerAccountId: ownerId,
    displayName: 'Synthetic Traveller',
  });
  if (!isOk(applicant)) throw new Error('applicant');
  return { ownerId, applicantId: applicant.value.id };
}

async function proofFor(accountId: string, applicantId: string, purpose = 'self') {
  return requireAccess(
    db,
    accountPrincipal(accountId),
    'VIEW_METADATA',
    { applicantId },
    {
      purpose,
    },
  );
}

async function attention(ownerId: string, applicantId: string, now = NOW) {
  const proof = await proofFor(ownerId, applicantId);
  if (!isOk(proof)) throw new Error('owner proof');
  const listed = await listNeedsAttention(proof.value, { now });
  if (!isOk(listed)) throw new Error(`attention: ${listed.error.message}`);
  return listed.value;
}

async function caseFor(ownerId: string, applicantId: string, title: string) {
  const mission = await createMission(db, { actorAccountId: ownerId, applicantId, title });
  if (!isOk(mission)) throw new Error('mission');
  return mission.value.id;
}

async function task(
  ownerId: string,
  missionId: string,
  description: string,
  dueDate?: Date,
  dueTimezone?: string,
) {
  const created = await createTask(db, {
    actorAccountId: ownerId,
    missionId,
    description,
    ...(dueDate ? { dueDate } : {}),
    ...(dueTimezone ? { dueTimezone } : {}),
  });
  if (!isOk(created)) throw new Error('task');
  return created.value.id;
}

async function organization(): Promise<string> {
  const [org] = await db
    .insert(schema.organizations)
    .values({ name: 'Harbor Visas' })
    .returning({ id: schema.organizations.id });
  if (!org) throw new Error('org');
  return org.id;
}

type RequestStatus = (typeof schema.evidenceRequestStatus.enumValues)[number];

async function request(
  organizationId: string,
  applicantId: string,
  values: {
    readonly status: RequestStatus;
    readonly missionId?: string;
    readonly dueDate?: Date;
    readonly kind?: 'FIELD' | 'DOCUMENT';
    readonly createdAt?: Date;
  },
) {
  const [row] = await db
    .insert(schema.evidenceRequests)
    .values({
      organizationId,
      applicantId,
      missionId: values.missionId ?? null,
      kind: values.kind ?? 'DOCUMENT',
      docType: values.kind === 'FIELD' ? null : 'BANK_STATEMENT',
      fieldKey: values.kind === 'FIELD' ? 'employer_name' : null,
      message: AGENCY_NOTE,
      dueDate: values.dueDate ?? null,
      status: values.status,
      ...(values.createdAt ? { createdAt: values.createdAt } : {}),
    })
    .returning({ id: schema.evidenceRequests.id });
  if (!row) throw new Error('request');
  return row.id;
}

async function document(
  ownerId: string,
  applicantId: string,
  docType: string,
  expiresAt: Date | null,
) {
  const registered = await registerDocument(db, {
    actorAccountId: ownerId,
    applicantId,
    originalName: FILE_NAME,
    docType,
  });
  if (!isOk(registered)) throw new Error('document');
  if (expiresAt) {
    await db
      .update(schema.documents)
      .set({ expiresAt })
      .where(eq(schema.documents.id, registered.value.id));
  }
  return registered.value.id;
}

async function confirmThenChange(ownerId: string, missionId: string) {
  const snap = await snapshotMission(db, { actorAccountId: ownerId, missionId });
  if (!isOk(snap)) throw new Error('snapshot');
  const decided = await decideAcknowledgement(db, {
    actorAccountId: ownerId,
    missionId,
    snapshotId: snap.value.id,
    expectedSnapshotChecksum: snap.value.checksum,
    decision: 'ACKNOWLEDGED',
    stepUpSatisfied: true,
  });
  if (!isOk(decided)) throw new Error('acknowledge');
  await db.transaction(async (tx) => incrementMaterialRevision(tx, missionId));
}

async function suggestions(ownerId: string, applicantId: string) {
  for (const key of ['given_name', 'nationality']) {
    await registerFieldDefinition(db, { key, dataType: 'string', sensitivity: 'STANDARD' });
  }
  const scan = await document(ownerId, applicantId, 'NID', null);
  const version = await addDocumentVersion(db, {
    actorAccountId: ownerId,
    documentId: scan,
    bucket: 'QUARANTINE',
    objectKey: 'obj-nid',
  });
  if (!isOk(version)) throw new Error('version');
  const run = await runExtraction(db, reader, {
    actorAccountId: ownerId,
    applicantId,
    documentVersionId: version.value.version.id,
    text: READ_NAME,
    budgetLimitUnits: 10,
  });
  if (!isOk(run)) throw new Error('run');
}

// --- Pure ranking --------------------------------------------------------------

function item(overrides: Partial<AttentionItem> & Pick<AttentionItem, 'key'>): AttentionItem {
  const base: Omit<AttentionItem, 'tier'> = {
    kind: 'task',
    title: 'Task',
    why: 'Why',
    applicantId: 'a',
    applicantName: 'A',
    caseId: null,
    caseTitle: null,
    dueDate: null,
    dueState: 'unknown',
    daysUntilDue: null,
    sentBack: false,
    count: null,
    subject: null,
    href: '/app',
    createdAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
  return { ...base, tier: overrides.tier ?? attentionTier(base) };
}

/** A fixed, seeded shuffle so a failure can be reproduced. */
function shuffled<T>(values: readonly T[], seed: number): T[] {
  const out = [...values];
  let state = seed;
  for (let i = out.length - 1; i > 0; i--) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

describe('attention literals', () => {
  it('match the stored statuses, so a renamed status cannot silently drop items', () => {
    for (const status of ATTENTION_REQUEST_STATUSES) {
      expect(schema.evidenceRequestStatus.enumValues).toContain(status);
    }
    for (const status of WITH_AGENCY_REQUEST_STATUSES) {
      expect(schema.evidenceRequestStatus.enumValues).toContain(status);
    }
    for (const status of ATTENTION_TASK_STATUSES) {
      expect(schema.missionTaskStatus.enumValues).toContain(status);
    }
    expect(schema.acknowledgementDecision.enumValues).toContain('ACKNOWLEDGED');
    expect(schema.proposalStatus.enumValues).toContain('PENDING');
  });
});

describe('attentionTier (ADR 0016)', () => {
  it('places each kind in its tier, taking the highest tier that applies', () => {
    const t = (
      kind: AttentionItem['kind'],
      dueState: AttentionItem['dueState'],
      sentBack = false,
    ) => attentionTier({ kind, dueState, sentBack });
    expect(t('evidence_request', 'overdue', true)).toBe(1);
    expect(t('task', 'overdue')).toBe(1);
    expect(t('evidence_request', 'later', true)).toBe(2);
    expect(t('evidence_request', 'unknown', true)).toBe(2);
    expect(t('evidence_request', 'due_soon', true)).toBe(2);
    expect(t('task', 'due_soon')).toBe(3);
    expect(t('evidence_request', 'due_soon')).toBe(3);
    expect(t('case_changed', 'none')).toBe(4);
    expect(t('task', 'later')).toBe(5);
    expect(t('evidence_request', 'unknown')).toBe(5);
    expect(t('document_expiry', 'overdue')).toBe(6);
    expect(t('document_expiry', 'due_soon')).toBe(6);
    expect(t('suggestions', 'none')).toBe(7);
    expect(t('sharing_invitations', 'none')).toBe(7);
  });
});

describe('rankAttentionItems', () => {
  const items = [
    item({ key: 'suggestions:a', kind: 'suggestions', dueState: 'none' }),
    item({
      key: 'document_expiry:d1',
      kind: 'document_expiry',
      dueDate: '2026-11-20',
      dueState: 'later',
    }),
    item({
      key: 'document_expiry:d0',
      kind: 'document_expiry',
      dueDate: '2026-09-01',
      dueState: 'overdue',
    }),
    item({ key: 'task:undated', dueState: 'unknown', title: 'B' }),
    item({ key: 'task:undated-older', dueState: 'unknown', createdAt: '2026-09-01T00:00:00.000Z' }),
    item({ key: 'task:later', dueDate: '2026-12-01', dueState: 'later' }),
    item({ key: 'case_changed:m', kind: 'case_changed', dueState: 'none' }),
    item({ key: 'task:soon-2', dueDate: '2026-10-29', dueState: 'due_soon' }),
    item({ key: 'task:soon-1', dueDate: '2026-10-27', dueState: 'due_soon' }),
    item({
      key: 'evidence_request:sent-back',
      kind: 'evidence_request',
      sentBack: true,
      dueState: 'later',
      dueDate: '2026-11-30',
    }),
    item({ key: 'task:overdue-new', dueDate: '2026-10-20', dueState: 'overdue' }),
    item({
      key: 'evidence_request:overdue-old',
      kind: 'evidence_request',
      sentBack: true,
      dueDate: '2026-10-01',
      dueState: 'overdue',
    }),
    item({ key: 'sharing_invitations:account', kind: 'sharing_invitations', dueState: 'none' }),
    item({ key: 'task:undated', dueState: 'unknown', title: 'B' }),
  ];
  const expected = [
    'evidence_request:overdue-old',
    'task:overdue-new',
    'evidence_request:sent-back',
    'task:soon-1',
    'task:soon-2',
    'case_changed:m',
    'task:later',
    'task:undated-older',
    'task:undated',
    'document_expiry:d0',
    'document_expiry:d1',
    'sharing_invitations:account',
    'suggestions:a',
  ];

  it('orders by tier, then dated before undated with the earliest first, then oldest created', () => {
    expect(rankAttentionItems(items).map((i) => i.key)).toEqual(expected);
  });

  it('gives the same order for any input order', () => {
    for (let seed = 1; seed <= 25; seed++) {
      expect(rankAttentionItems(shuffled(items, seed)).map((i) => i.key)).toEqual(expected);
    }
  });

  it('keeps an event once, in its highest tier', () => {
    const ranked = rankAttentionItems([
      item({ key: 'task:x', dueDate: '2026-11-30', dueState: 'later' }),
      item({ key: 'task:x', dueDate: '2026-10-01', dueState: 'overdue' }),
    ]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.tier).toBe(1);
  });

  it('breaks full ties by title, then key', () => {
    const ranked = rankAttentionItems([
      item({ key: 'task:b', title: 'Same' }),
      item({ key: 'task:a', title: 'Same' }),
      item({ key: 'task:c', title: 'Earlier' }),
    ]);
    expect(ranked.map((i) => i.key)).toEqual(['task:c', 'task:a', 'task:b']);
  });

  it('works the tier out again, so a hand-built item cannot claim a higher one', () => {
    const ranked = rankAttentionItems([
      item({ key: 'sharing_invitations:account', kind: 'sharing_invitations', tier: 1 }),
      item({ key: 'case_changed:m', kind: 'case_changed', dueState: 'none' }),
    ]);
    expect(ranked.map((i) => [i.key, i.tier])).toEqual([
      ['case_changed:m', 4],
      ['sharing_invitations:account', 7],
    ]);
  });
});

describe('daysUntilDueDay', () => {
  it('a due date of today is not overdue; it is past due only once the day has ended', () => {
    expect(daysUntilDueDay(day('2026-10-26'), NOW, 'UTC')).toBe(0);
    expect(daysUntilDueDay(day('2026-10-25'), NOW, 'UTC')).toBe(-1);
    expect(daysUntilDueDay(day('2026-10-27'), NOW, 'UTC')).toBe(1);
  });

  it('counts the day where the person is', () => {
    // 20:00 UTC on 26 Oct is already 27 Oct in Dhaka, and still 26 Oct in New York.
    const late = new Date('2026-10-26T20:00:00Z');
    expect(daysUntilDueDay(day('2026-10-26'), late, 'Asia/Dhaka')).toBe(-1);
    expect(daysUntilDueDay(day('2026-10-26'), late, 'America/New_York')).toBe(0);
    // An unknown zone name reads as UTC rather than failing the page.
    expect(daysUntilDueDay(day('2026-10-26'), late, 'Not/AZone')).toBe(0);
  });
});

// --- The projection, against a migrated database ---------------------------------

describe('listNeedsAttention', () => {
  it(
    'builds one ranked list from requests, tasks, changed cases, expiring documents and suggestions',
    async () => {
      const { ownerId, applicantId } = await person('attention@example.com');
      const orgId = await organization();
      const visa = await caseFor(ownerId, applicantId, 'Japan Visit');
      const study = await caseFor(ownerId, applicantId, 'Study in Canada');
      const closed = await caseFor(ownerId, applicantId, 'Old Trip');
      await db
        .update(schema.missions)
        .set({ state: 'CLOSED' })
        .where(eq(schema.missions.id, closed));

      const overdueTask = await task(ownerId, visa, 'Book the visa appointment', day('2026-10-20'));
      const todayTask = await task(ownerId, visa, 'Print the form', day('2026-10-26'));
      const soonTask = await task(ownerId, study, 'Pay the fee', day('2026-10-30'));
      const undatedTask = await task(ownerId, study, 'Ask for a reference letter');
      const doneTask = await task(ownerId, visa, 'Already done', day('2026-10-01'));
      expect(
        isOk(
          await decideTask(db, {
            actorAccountId: ownerId,
            missionId: visa,
            taskId: doneTask,
            status: 'DONE',
          }),
        ),
      ).toBe(true);
      await task(ownerId, closed, 'Task on a closed case', day('2026-10-01'));

      const sentBackOverdue = await request(orgId, applicantId, {
        status: 'NEEDS_REPLACEMENT',
        missionId: visa,
        dueDate: day('2026-10-10'),
      });
      const sentBack = await request(orgId, applicantId, {
        status: 'NEEDS_REPLACEMENT',
        dueDate: day('2026-12-15'),
      });
      const openUndated = await request(orgId, applicantId, { status: 'OPEN', kind: 'FIELD' });
      await request(orgId, applicantId, { status: 'DECLINED', dueDate: day('2026-10-01') });
      await request(orgId, applicantId, { status: 'CANCELLED', dueDate: day('2026-10-01') });
      await request(orgId, applicantId, { status: 'RECEIVED', dueDate: day('2026-10-01') });
      await request(orgId, applicantId, {
        status: 'OPEN',
        missionId: closed,
        dueDate: day('2026-10-01'),
      });

      await confirmThenChange(ownerId, study);

      const expired = await document(ownerId, applicantId, 'PASSPORT', day('2026-09-30'));
      const expiring = await document(ownerId, applicantId, 'BANK_STATEMENT', day('2026-11-25'));
      await document(ownerId, applicantId, 'TAX_RETURN', day('2027-12-31'));
      await document(ownerId, applicantId, 'EMPLOYMENT_CERTIFICATE', null);

      await suggestions(ownerId, applicantId);

      const result = await attention(ownerId, applicantId);
      expect(result.items.map((i) => i.key)).toEqual([
        `evidence_request:${sentBackOverdue}`,
        `task:${overdueTask}`,
        `evidence_request:${sentBack}`,
        `task:${todayTask}`,
        `task:${soonTask}`,
        `case_changed:${study}`,
        // Tier 5: the undated open items, oldest first.
        `task:${undatedTask}`,
        `evidence_request:${openUndated}`,
        `document_expiry:${expired}`,
        `document_expiry:${expiring}`,
        `suggestions:${applicantId}`,
      ]);
      expect(result.items.map((i) => i.tier)).toEqual([1, 1, 2, 3, 3, 4, 5, 5, 6, 6, 7]);

      const byKey = new Map(result.items.map((i) => [i.key, i]));
      const today = byKey.get(`task:${todayTask}`);
      expect(today).toMatchObject({ dueDate: '2026-10-26', dueState: 'due_soon', daysUntilDue: 0 });
      expect(byKey.get(`task:${overdueTask}`)).toMatchObject({
        dueState: 'overdue',
        caseId: visa,
        caseTitle: 'Japan Visit',
        href: `/app/mission/${visa}`,
      });
      expect(byKey.get(`task:${undatedTask}`)).toMatchObject({
        dueDate: null,
        dueState: 'unknown',
        daysUntilDue: null,
      });
      expect(byKey.get(`evidence_request:${sentBackOverdue}`)).toMatchObject({
        sentBack: true,
        dueState: 'overdue',
        href: `/app/applicant/${applicantId}/evidence`,
        subject: {
          kind: 'request',
          requestKind: 'DOCUMENT',
          docType: 'BANK_STATEMENT',
          fieldKey: null,
        },
      });
      expect(byKey.get(`evidence_request:${openUndated}`)).toMatchObject({
        dueState: 'unknown',
        subject: { kind: 'request', requestKind: 'FIELD', fieldKey: 'employer_name' },
      });
      expect(byKey.get(`suggestions:${applicantId}`)).toMatchObject({ count: 2 });
      expect(byKey.get(`document_expiry:${expired}`)).toMatchObject({
        dueDate: '2026-09-30',
        dueState: 'overdue',
        subject: { kind: 'document', docType: 'PASSPORT' },
        href: `/app/applicant/${applicantId}/expiry`,
      });

      // Each event once.
      expect(new Set(result.items.map((i) => i.key)).size).toBe(result.items.length);
      // Declined, cancelled and answered requests never show, nor anything on a closed case.
      expect(result.items.filter((i) => i.kind === 'evidence_request')).toHaveLength(3);
      expect(result.items.filter((i) => i.kind === 'task')).toHaveLength(4);
      expect(result.requests).toEqual({ waitingOnYou: 3, withAgency: 1 });
      expect(result.activeCaseCount).toBe(2);
      expect(result.activeCases.map((c) => c.id).sort()).toEqual([visa, study].sort());

      // Nothing sensitive: no agency note, no number from it, no file name, no read value.
      const text = JSON.stringify(result);
      for (const secret of [PASSPORT_NUMBER, '0123456789', AGENCY_NOTE, FILE_NAME, READ_NAME]) {
        expect(text).not.toContain(secret);
      }
    },
    HEAVY,
  );

  it(
    'clears or changes an item once it is dealt with',
    async () => {
      const { ownerId, applicantId } = await person('resolve@example.com');
      const orgId = await organization();
      const visa = await caseFor(ownerId, applicantId, 'Japan Visit');
      const overdueTask = await task(ownerId, visa, 'Book the visa appointment', day('2026-10-20'));
      const open = await request(orgId, applicantId, {
        status: 'OPEN',
        missionId: visa,
        dueDate: day('2026-10-01'),
      });
      const sentBack = await request(orgId, applicantId, { status: 'NEEDS_REPLACEMENT' });
      const expired = await document(ownerId, applicantId, 'PASSPORT', day('2026-09-30'));
      await confirmThenChange(ownerId, visa);

      const before = (await attention(ownerId, applicantId)).items.map((i) => i.key);
      expect(before).toEqual(
        expect.arrayContaining([
          `task:${overdueTask}`,
          `evidence_request:${open}`,
          `evidence_request:${sentBack}`,
          `document_expiry:${expired}`,
          `case_changed:${visa}`,
        ]),
      );

      // Completing the task.
      expect(
        isOk(
          await decideTask(db, {
            actorAccountId: ownerId,
            missionId: visa,
            taskId: overdueTask,
            status: 'DONE',
          }),
        ),
      ).toBe(true);
      // Replacing the expired passport with a current one.
      const renewed = await document(ownerId, applicantId, 'PASSPORT', day('2036-09-30'));
      expect(
        isOk(
          await supersedeDocument(db, {
            actorAccountId: ownerId,
            oldDocumentId: expired,
            newDocumentId: renewed,
          }),
        ),
      ).toBe(true);
      // Answering one request (the agency now has it) and a fix being accepted on the other.
      await db
        .update(schema.evidenceRequests)
        .set({ status: 'RECEIVED' })
        .where(eq(schema.evidenceRequests.id, open));
      await db
        .update(schema.evidenceRequests)
        .set({ status: 'ACCEPTED' })
        .where(eq(schema.evidenceRequests.id, sentBack));

      const afterResult = await attention(ownerId, applicantId);
      const after = afterResult.items.map((i) => i.key);
      expect(after).not.toContain(`task:${overdueTask}`);
      expect(after).not.toContain(`document_expiry:${expired}`);
      expect(after).not.toContain(`document_expiry:${renewed}`);
      expect(after).not.toContain(`evidence_request:${open}`);
      expect(after).not.toContain(`evidence_request:${sentBack}`);
      expect(afterResult.requests).toEqual({ waitingOnYou: 0, withAgency: 1 });

      // Confirming the case again clears "changed since you confirmed it".
      const snap = await snapshotMission(db, { actorAccountId: ownerId, missionId: visa });
      if (!isOk(snap)) throw new Error('snapshot');
      expect(
        isOk(
          await decideAcknowledgement(db, {
            actorAccountId: ownerId,
            missionId: visa,
            snapshotId: snap.value.id,
            expectedSnapshotChecksum: snap.value.checksum,
            decision: 'ACKNOWLEDGED',
            stepUpSatisfied: true,
          }),
        ),
      ).toBe(true);
      const confirmed = (await attention(ownerId, applicantId)).items.map((i) => i.key);
      expect(confirmed).not.toContain(`case_changed:${visa}`);

      // Moving a due date out changes the item rather than removing it.
      const moved = await task(ownerId, visa, 'Collect the passport', day('2026-10-20'));
      expect(
        (await attention(ownerId, applicantId)).items.find((i) => i.key === `task:${moved}`)?.tier,
      ).toBe(1);
      await db
        .update(schema.missionTasks)
        .set({ dueDate: day('2026-11-30') })
        .where(eq(schema.missionTasks.id, moved));
      expect(
        (await attention(ownerId, applicantId)).items.find((i) => i.key === `task:${moved}`),
      ).toMatchObject({ tier: 5, dueState: 'later' });
    },
    HEAVY,
  );

  it(
    'reads the due day in the task time zone, else the applicant time zone',
    async () => {
      const { ownerId, applicantId } = await person('zones@example.com');
      const visa = await caseFor(ownerId, applicantId, 'Japan Visit');
      const dhaka = await task(ownerId, visa, 'Due in Dhaka', day('2026-10-26'));
      const newYork = await task(
        ownerId,
        visa,
        'Due in New York',
        day('2026-10-26'),
        'America/New_York',
      );
      const late = new Date('2026-10-26T20:00:00Z');
      const items = (await attention(ownerId, applicantId, late)).items;
      expect(items.find((i) => i.key === `task:${dhaka}`)?.dueState).toBe('overdue');
      expect(items.find((i) => i.key === `task:${newYork}`)?.dueState).toBe('due_soon');
    },
    HEAVY,
  );

  it(
    'is for the owner only: the gate refuses a stranger, and a shared viewer is refused here',
    async () => {
      const { ownerId, applicantId } = await person('owner@example.com');
      const strangerId = await account('stranger@example.com');
      const stranger = await proofFor(strangerId, applicantId);
      expect(isErr(stranger)).toBe(true);

      const friendId = await account('friend@example.com');
      const grant = await createGrant(db, {
        actorAccountId: ownerId,
        applicantId,
        recipientAccountId: friendId,
        actions: ['VIEW_METADATA'],
        purpose: 'family-help',
      });
      if (!isOk(grant)) throw new Error('grant');
      const accepted = await acceptGrant(db, { actorAccountId: friendId, grantId: grant.value.id });
      if (!isOk(accepted)) throw new Error('accept');
      const friend = await proofFor(friendId, applicantId, 'family-help');
      expect(isOk(friend)).toBe(true);
      if (!isOk(friend)) return;
      const refused = await listNeedsAttention(friend.value, { now: NOW });
      expect(isErr(refused) && refused.error.code).toBe('forbidden');

      const owner = await proofFor(ownerId, applicantId);
      if (!isOk(owner)) throw new Error('owner proof');
      const copy = { ...owner.value } as unknown as typeof owner.value;
      const copied = await listNeedsAttention(copy, { now: NOW });
      expect(isErr(copied) && copied.error.code).toBe('forbidden');
    },
    HEAVY,
  );

  it(
    'shows nothing for a new applicant, without error',
    async () => {
      const { ownerId, applicantId } = await person('empty@example.com');
      const result = await attention(ownerId, applicantId);
      expect(result.items).toEqual([]);
      expect(result.requests).toEqual({ waitingOnYou: 0, withAgency: 0 });
      expect(result.activeCases).toEqual([]);
    },
    HEAVY,
  );
});

describe('listNeedsAttention: whose day and whose task', () => {
  async function inZone(email: string, timezone: string) {
    const who = await person(email);
    await db
      .update(schema.applicants)
      .set({ timezone })
      .where(eq(schema.applicants.id, who.applicantId));
    return who;
  }

  it(
    'a document is expired only once its expiry day has ended where the person is',
    async () => {
      const dhaka = await inZone('dhaka@example.com', 'Asia/Dhaka');
      const la = await inZone('la@example.com', 'America/Los_Angeles');
      const dhakaDoc = await document(
        dhaka.ownerId,
        dhaka.applicantId,
        'PASSPORT',
        day('2026-10-26'),
      );
      const laDoc = await document(la.ownerId, la.applicantId, 'PASSPORT', day('2026-10-26'));
      const state = async (
        who: { ownerId: string; applicantId: string },
        key: string,
        at: string,
      ) =>
        (await attention(who.ownerId, who.applicantId, new Date(at))).items.find(
          (i) => i.key === key,
        );

      // 23:30 on 26 Oct in Dhaka: still the expiry day.
      const dhakaLate = await state(dhaka, `document_expiry:${dhakaDoc}`, '2026-10-26T17:30:00Z');
      expect(dhakaLate).toMatchObject({ dueState: 'due_soon', daysUntilDue: 0 });
      expect(Object.is(dhakaLate?.daysUntilDue, -0)).toBe(false);
      // 00:30 on 27 Oct in Dhaka: expired.
      expect(
        await state(dhaka, `document_expiry:${dhakaDoc}`, '2026-10-26T18:30:00Z'),
      ).toMatchObject({ dueState: 'overdue', daysUntilDue: -1, title: 'Document Expired' });

      // 23:30 on 26 Oct in Los Angeles is already 27 Oct in UTC; still the expiry day there.
      expect(await state(la, `document_expiry:${laDoc}`, '2026-10-27T06:30:00Z')).toMatchObject({
        dueState: 'due_soon',
        daysUntilDue: 0,
        title: 'Document Expiring Soon',
      });
      expect(await state(la, `document_expiry:${laDoc}`, '2026-10-27T07:30:00Z')).toMatchObject({
        dueState: 'overdue',
        daysUntilDue: -1,
      });
      // Outside the widest reminder threshold (90 days by default): not an item.
      const far = await document(la.ownerId, la.applicantId, 'BANK_STATEMENT', day('2027-02-01'));
      expect(await state(la, `document_expiry:${far}`, '2026-10-27T07:30:00Z')).toBeUndefined();
    },
    HEAVY,
  );

  it(
    "a request is past due once the due day has ended in the traveller's time zone",
    async () => {
      const la = await inZone('la-request@example.com', 'America/Los_Angeles');
      const orgId = await organization();
      const id = await request(orgId, la.applicantId, {
        status: 'OPEN',
        dueDate: day('2026-10-26'),
      });
      const at = async (iso: string) =>
        (await attention(la.ownerId, la.applicantId, new Date(iso))).items.find(
          (i) => i.key === `evidence_request:${id}`,
        )?.dueState;
      expect(await at('2026-10-27T06:59:00Z')).toBe('due_soon');
      expect(await at('2026-10-27T07:01:00Z')).toBe('overdue');
    },
    HEAVY,
  );

  it(
    'shows only tasks the traveller can act on: unassigned or assigned to the traveller',
    async () => {
      const { ownerId, applicantId } = await person('tasks@example.com');
      const staffId = await account('staff@example.com');
      const visa = await caseFor(ownerId, applicantId, 'Japan Visit');
      const mine = await task(ownerId, visa, 'Sign the form', day('2026-10-20'));
      const unassigned = await task(ownerId, visa, 'Print the photo', day('2026-10-20'));
      const agencys = await task(ownerId, visa, 'Check the file', day('2026-10-01'));
      await db
        .update(schema.missionTasks)
        .set({ assigneeAccountId: ownerId })
        .where(eq(schema.missionTasks.id, mine));
      await db
        .update(schema.missionTasks)
        .set({ assigneeAccountId: staffId })
        .where(eq(schema.missionTasks.id, agencys));
      const keys = (await attention(ownerId, applicantId)).items.map((i) => i.key);
      expect(keys).toContain(`task:${mine}`);
      expect(keys).toContain(`task:${unassigned}`);
      expect(keys).not.toContain(`task:${agencys}`);
    },
    HEAVY,
  );
});

describe('listCalendarDates (v1.2 B05 calendar export)', () => {
  async function calendar(ownerId: string, applicantId: string) {
    const proof = await proofFor(ownerId, applicantId);
    if (!isOk(proof)) throw new Error('owner proof');
    const listed = await listCalendarDates(proof.value, { now: NOW });
    if (!isOk(listed)) throw new Error(`calendar: ${listed.error.message}`);
    return listed.value;
  }

  async function appointment(
    ownerId: string,
    missionId: string,
    localDateTime: string,
    timezone = 'Asia/Dhaka',
  ) {
    const created = await createAppointment(db, {
      actorAccountId: ownerId,
      missionId,
      title: `Biometrics for passport ${PASSPORT_NUMBER}`,
      localDateTime: new Date(`${localDateTime}.000Z`),
      timezone,
      place: 'Gulshan Avenue, House 12',
      channel: 'In Person',
    });
    if (!isOk(created)) throw new Error('appointment');
    return created.value.id;
  }

  it(
    'lists appointments with their wall-clock time and zone, and due and expiry days, earliest first',
    async () => {
      const { ownerId, applicantId } = await person('calendar@example.com');
      const orgId = await organization();
      const visa = await caseFor(ownerId, applicantId, 'Japan Visit');
      const appt = await appointment(ownerId, visa, '2026-11-03T09:30:00');
      const due = await task(
        ownerId,
        visa,
        'Pay the fee from account 0123456789',
        day('2026-11-03'),
      );
      const asked = await request(orgId, applicantId, {
        status: 'NEEDS_REPLACEMENT',
        missionId: visa,
        dueDate: day('2026-11-01'),
      });
      const passport = await document(ownerId, applicantId, 'PASSPORT', day('2027-04-30'));

      const result = await calendar(ownerId, applicantId);
      expect(result.truncated).toBe(false);
      expect(result.items).toEqual([
        {
          key: `request_due:${asked}`,
          kind: 'request_due',
          resourceId: asked,
          updatedAt: expect.any(String),
          when: { kind: 'date', date: '2026-11-01' },
          caseTitle: 'Japan Visit',
        },
        // The all-day item on 3 Nov comes before the timed one that day.
        {
          key: `task_due:${due}`,
          kind: 'task_due',
          resourceId: due,
          updatedAt: expect.any(String),
          when: { kind: 'date', date: '2026-11-03' },
          caseTitle: 'Japan Visit',
        },
        {
          key: `appointment:${appt}`,
          kind: 'appointment',
          resourceId: appt,
          updatedAt: expect.any(String),
          when: { kind: 'local', localDateTime: '2026-11-03T09:30:00', timeZone: 'Asia/Dhaka' },
          caseTitle: 'Japan Visit',
        },
        {
          key: `document_expires:${passport}`,
          kind: 'document_expires',
          resourceId: passport,
          updatedAt: expect.any(String),
          when: { kind: 'date', date: '2027-04-30' },
          caseTitle: null,
        },
      ]);
      // Nothing sensitive travels: no note, title, place, description, file name or number.
      const text = JSON.stringify(result);
      for (const secret of [
        PASSPORT_NUMBER,
        '0123456789',
        FILE_NAME,
        'Gulshan',
        'Biometrics',
        'Pay the fee',
        'bank statement',
      ]) {
        expect(text).not.toContain(secret);
      }
    },
    HEAVY,
  );

  it(
    'leaves out undated items, finished work, closed cases, replaced documents and staff tasks',
    async () => {
      const { ownerId, applicantId } = await person('calendar-out@example.com');
      const staffId = await account('calendar-staff@example.com');
      const orgId = await organization();
      const open = await caseFor(ownerId, applicantId, 'Japan Visit');
      const closed = await caseFor(ownerId, applicantId, 'Old Trip');
      await db
        .update(schema.missions)
        .set({ state: 'CLOSED' })
        .where(eq(schema.missions.id, closed));

      const kept = await task(ownerId, open, 'Kept', day('2026-11-05'));
      const undated = await task(ownerId, open, 'No date');
      const done = await task(ownerId, open, 'Done', day('2026-11-06'));
      await db
        .update(schema.missionTasks)
        .set({ status: 'DONE' })
        .where(eq(schema.missionTasks.id, done));
      const staffs = await task(ownerId, open, 'Agency check', day('2026-11-07'));
      await db
        .update(schema.missionTasks)
        .set({ assigneeAccountId: staffId })
        .where(eq(schema.missionTasks.id, staffs));
      const closedTask = await task(ownerId, closed, 'Closed case task', day('2026-11-08'));
      const closedAppt = await appointment(ownerId, closed, '2026-11-09T10:00:00');
      const cancelledAppt = await appointment(ownerId, open, '2026-11-10T10:00:00');
      await db
        .update(schema.missionAppointments)
        .set({ status: 'CANCELLED' })
        .where(eq(schema.missionAppointments.id, cancelledAppt));

      const undatedRequest = await request(orgId, applicantId, { status: 'OPEN' });
      const received = await request(orgId, applicantId, {
        status: 'RECEIVED',
        dueDate: day('2026-11-11'),
      });
      const onClosed = await request(orgId, applicantId, {
        status: 'OPEN',
        missionId: closed,
        dueDate: day('2026-11-12'),
      });
      const looseRequest = await request(orgId, applicantId, {
        status: 'OPEN',
        dueDate: day('2026-11-13'),
      });

      const noExpiry = await document(ownerId, applicantId, 'NID', null);
      const oldPassport = await document(ownerId, applicantId, 'PASSPORT', day('2026-12-01'));
      const newPassport = await document(ownerId, applicantId, 'PASSPORT', day('2036-12-01'));
      await db
        .update(schema.documents)
        .set({ supersededByDocumentId: newPassport })
        .where(eq(schema.documents.id, oldPassport));

      const keys = (await calendar(ownerId, applicantId)).items.map((i) => i.key);
      expect(keys).toEqual([
        `task_due:${kept}`,
        `request_due:${looseRequest}`,
        `document_expires:${newPassport}`,
      ]);
      for (const gone of [
        `task_due:${undated}`,
        `task_due:${done}`,
        `task_due:${staffs}`,
        `task_due:${closedTask}`,
        `appointment:${closedAppt}`,
        `appointment:${cancelledAppt}`,
        `request_due:${undatedRequest}`,
        `request_due:${received}`,
        `request_due:${onClosed}`,
        `document_expires:${noExpiry}`,
        `document_expires:${oldPassport}`,
      ]) {
        expect(keys).not.toContain(gone);
      }
    },
    HEAVY,
  );

  it(
    "keeps a stored time zone it does not recognise as unknown, never moving the traveller's time",
    async () => {
      const { ownerId, applicantId } = await person('calendar-zone@example.com');
      const visa = await caseFor(ownerId, applicantId, 'Japan Visit');
      // Rows saved before zones were checked: written straight to the table.
      await db.insert(schema.missionAppointments).values([
        {
          missionId: visa,
          title: 'Old',
          localDateTime: new Date('2026-11-03T09:30:00.000Z'),
          timezone: 'Mars/Olympus_Mons',
        },
        {
          missionId: visa,
          title: 'Old',
          localDateTime: new Date('2026-11-04T09:30:00.000Z'),
          timezone: 'Asia/Dhaka\r\nX-INJECT:1',
        },
      ]);
      const whens = (await calendar(ownerId, applicantId)).items.map((i) => i.when);
      expect(whens).toEqual([
        { kind: 'local', localDateTime: '2026-11-03T09:30:00', timeZone: null },
        { kind: 'local', localDateTime: '2026-11-04T09:30:00', timeZone: null },
      ]);
    },
    HEAVY,
  );

  it(
    "reads only the owner's own applicant: a stranger, a shared viewer and a copied proof are refused",
    async () => {
      const { ownerId, applicantId } = await person('calendar-owner@example.com');
      const other = await person('calendar-other@example.com');
      const visa = await caseFor(other.ownerId, other.applicantId, 'Other Trip');
      await task(other.ownerId, visa, 'Not yours', day('2026-11-05'));
      expect((await calendar(ownerId, applicantId)).items).toEqual([]);

      const strangerId = await account('calendar-stranger@example.com');
      expect(isErr(await proofFor(strangerId, applicantId))).toBe(true);

      const friendId = await account('calendar-friend@example.com');
      const grant = await createGrant(db, {
        actorAccountId: ownerId,
        applicantId,
        recipientAccountId: friendId,
        actions: ['VIEW_METADATA'],
        purpose: 'family-help',
      });
      if (!isOk(grant)) throw new Error('grant');
      const accepted = await acceptGrant(db, { actorAccountId: friendId, grantId: grant.value.id });
      if (!isOk(accepted)) throw new Error('accept');
      const friend = await proofFor(friendId, applicantId, 'family-help');
      if (!isOk(friend)) throw new Error('friend proof');
      const refused = await listCalendarDates(friend.value);
      expect(isErr(refused) && refused.error.code).toBe('forbidden');

      const owner = await proofFor(ownerId, applicantId);
      if (!isOk(owner)) throw new Error('owner proof');
      const copy = { ...owner.value } as unknown as typeof owner.value;
      const copied = await listCalendarDates(copy);
      expect(isErr(copied) && copied.error.code).toBe('forbidden');
    },
    HEAVY,
  );

  it(
    'reads at most the cap from a source, earliest first, and says so',
    async () => {
      const { ownerId, applicantId } = await person('calendar-cap@example.com');
      const visa = await caseFor(ownerId, applicantId, 'Japan Visit');
      await db.insert(schema.missionTasks).values(
        Array.from({ length: CALENDAR_SOURCE_LIMIT + 2 }, (_, i) => ({
          missionId: visa,
          description: `Task ${i}`,
          dueDate: new Date(Date.UTC(2026, 10, 1) + i * 86_400_000),
        })),
      );
      const result = await calendar(ownerId, applicantId);
      expect(result.items).toHaveLength(CALENDAR_SOURCE_LIMIT);
      expect(result.truncated).toBe(true);
      expect(result.items[0]?.when).toEqual({ kind: 'date', date: '2026-11-01' });
    },
    HEAVY,
  );

  it(
    "reads from a week before today in the traveller's zone, so old dates never push out upcoming ones",
    async () => {
      const { ownerId, applicantId } = await person('calendar-window@example.com');
      const orgId = await organization();
      const visa = await caseFor(ownerId, applicantId, 'Japan Visit');
      const oldDay = (i: number) => new Date(Date.UTC(2025, 0, 1) + i * 86_400_000);
      await db.insert(schema.missionTasks).values(
        Array.from({ length: CALENDAR_SOURCE_LIMIT + 5 }, (_, i) => ({
          missionId: visa,
          description: `Old ${i}`,
          dueDate: oldDay(i),
        })),
      );
      await db.insert(schema.missionAppointments).values(
        Array.from({ length: CALENDAR_SOURCE_LIMIT + 5 }, (_, i) => ({
          missionId: visa,
          title: 'Old',
          localDateTime: oldDay(i),
          timezone: 'Asia/Dhaka',
        })),
      );
      for (let i = 0; i < CALENDAR_SOURCE_LIMIT + 5; i++) {
        await document(ownerId, applicantId, 'PASSPORT', oldDay(i));
      }
      // NOW is 26 Oct in Dhaka, so the first day read is 19 Oct.
      expect(CALENDAR_PAST_DAYS).toBe(7);
      const edge = await task(ownerId, visa, 'Edge', day('2026-10-19'));
      const before = await task(ownerId, visa, 'Before', day('2026-10-18'));
      const upcoming = await task(ownerId, visa, 'Upcoming', day('2026-11-02'));
      const appt = await appointment(ownerId, visa, '2026-11-03T09:30:00');
      const asked = await request(orgId, applicantId, {
        status: 'OPEN',
        dueDate: day('2026-11-04'),
      });
      const oldRequest = await request(orgId, applicantId, {
        status: 'OPEN',
        dueDate: day('2026-01-04'),
      });
      const passport = await document(ownerId, applicantId, 'PASSPORT', day('2027-04-30'));

      const result = await calendar(ownerId, applicantId);
      expect(result.truncated).toBe(false);
      expect(result.items.map((i) => i.key)).toEqual([
        `task_due:${edge}`,
        `task_due:${upcoming}`,
        `appointment:${appt}`,
        `request_due:${asked}`,
        `document_expires:${passport}`,
      ]);
      expect(result.items.map((i) => i.key)).not.toContain(`task_due:${before}`);
      expect(result.items.map((i) => i.key)).not.toContain(`request_due:${oldRequest}`);
    },
    HEAVY,
  );
});

describe('recognisedTimeZone and appointment time zones (written into calendar files)', () => {
  it('accepts known IANA names only, trimmed', () => {
    expect(recognisedTimeZone(' Asia/Dhaka ')).toBe('Asia/Dhaka');
    expect(recognisedTimeZone('America/Los_Angeles')).toBe('America/Los_Angeles');
    expect(recognisedTimeZone('UTC')).toBe('UTC');
    for (const bad of [
      '',
      'Mars/Olympus_Mons',
      'Asia/Dhaka\r\nX-INJECT:1',
      'Asia/Dhaka;X=1',
      'a b',
    ]) {
      expect(recognisedTimeZone(bad)).toBeNull();
    }
  });

  it(
    'createAppointment and updateAppointment refuse a zone that is not a known IANA name',
    async () => {
      const { ownerId, applicantId } = await person('zone-check@example.com');
      const visa = await caseFor(ownerId, applicantId, 'Japan Visit');
      const base = {
        actorAccountId: ownerId,
        missionId: visa,
        title: 'Interview',
        localDateTime: new Date('2026-11-03T09:30:00.000Z'),
      };
      for (const timezone of ['Asia/Dhaka\r\nX-INJECT:1', 'Mars/Olympus_Mons']) {
        const refused = await createAppointment(db, { ...base, timezone });
        expect(isErr(refused) && refused.error.code).toBe('invalid');
      }
      const made = await createAppointment(db, { ...base, timezone: ' Asia/Dhaka ' });
      if (!isOk(made)) throw new Error('appointment');
      expect(made.value.timezone).toBe('Asia/Dhaka');
      const moved = await updateAppointment(db, {
        actorAccountId: ownerId,
        missionId: visa,
        appointmentId: made.value.id,
        timezone: 'Asia/Dhaka\nX-INJECT:1',
      });
      expect(isErr(moved) && moved.error.code).toBe('invalid');
      const ok = await updateAppointment(db, {
        actorAccountId: ownerId,
        missionId: visa,
        appointmentId: made.value.id,
        timezone: 'Europe/London',
      });
      expect(isOk(ok) && ok.value.timezone).toBe('Europe/London');
    },
    HEAVY,
  );
});
