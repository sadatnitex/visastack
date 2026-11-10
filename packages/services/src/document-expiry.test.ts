import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { desc, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { accountPrincipal, requireAccess } from './access';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { setDocumentExpiry } from './document-expiry';
import {
  type ExpiryEntry,
  describeExpiry,
  expiryDayCountsAsExpired,
  expiryDayInRange,
  isTypedMirror,
  latestTypedDay,
} from './document-expiry-rules';
import { addDocumentVersion, listDocumentsDetailed, registerDocument } from './documents';
import { createMission } from './missions';
import { sweepExpiryReminders } from './notification-sweep';

/** Synthetic data only. A person types an expiry date for any document; a read date is never overwritten. */

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-11-10T12:00:00.000Z');
const FUTURE = '2031-04-30';
const OTHER_FUTURE = '2032-01-15';

async function freshDb(): Promise<Db> {
  const client = await createMigratedPglite();
  return drizzle(client, { schema }) as unknown as Db;
}

async function seedOwner(db: Db, email: string) {
  const account = await provisionAccount(db, { email });
  if (!isOk(account)) throw new Error('provision');
  await setConsent(db, {
    actorAccountId: account.value.id,
    accountId: account.value.id,
    type: 'CORE_PROCESSING',
    granted: true,
  });
  const applicant = await createApplicant(db, {
    actorAccountId: account.value.id,
    ownerAccountId: account.value.id,
    displayName: 'Anna Eriksson',
  });
  if (!isOk(applicant)) throw new Error('applicant');
  return { accountId: account.value.id, applicantId: applicant.value.id };
}

async function seedDocument(
  db: Db,
  owner: { accountId: string; applicantId: string },
  docType = 'VISA',
) {
  const doc = await registerDocument(db, {
    actorAccountId: owner.accountId,
    applicantId: owner.applicantId,
    originalName: 'scan.pdf',
    docType,
  });
  if (!isOk(doc)) throw new Error('doc');
  const version = await addDocumentVersion(db, {
    actorAccountId: owner.accountId,
    documentId: doc.value.id,
    bucket: 'CLEAN',
    objectKey: `obj-${doc.value.id}`,
    safetyStatus: 'CLEAN',
    processingStatus: 'AWAITING_REVIEW',
  });
  if (!isOk(version)) throw new Error('version');
  return doc.value.id;
}

async function proofFor(db: Db, accountId: string, documentId: string) {
  const access = await requireAccess(
    db,
    accountPrincipal(accountId),
    'MANAGE',
    { documentId },
    { purpose: 'owner_document_expiry' },
  );
  if (!isOk(access)) throw new Error(`access: ${access.error.message}`);
  return access.value;
}

async function setExpiry(
  db: Db,
  accountId: string,
  documentId: string,
  expiresOn: string | null,
  extra: { acknowledgePast?: boolean; now?: Date } = {},
) {
  return setDocumentExpiry(await proofFor(db, accountId, documentId), {
    expiresOn,
    now: NOW,
    ...extra,
  });
}

async function documentRow(db: Db, documentId: string) {
  const [row] = await db.select().from(schema.documents).where(eq(schema.documents.id, documentId));
  if (!row) throw new Error('document missing');
  return row;
}

async function entriesOf(db: Db, documentId: string) {
  return db
    .select()
    .from(schema.documentExpiryEntries)
    .where(eq(schema.documentExpiryEntries.documentId, documentId))
    .orderBy(desc(schema.documentExpiryEntries.createdAt), desc(schema.documentExpiryEntries.id));
}

/** A read date as the passport reading leaves it: the saved date plus a READ entry. */
async function putReadDate(db: Db, documentId: string, day: string) {
  await db
    .update(schema.documents)
    .set({ expiresAt: new Date(`${day}T00:00:00.000Z`) })
    .where(eq(schema.documents.id, documentId));
  await db
    .insert(schema.documentExpiryEntries)
    .values({ documentId, expiresOn: day, source: 'READ' });
}

describe('the rules that decide where an expiry date came from', () => {
  const typed = (expiresOn: string | null, mirrored = true): ExpiryEntry => ({
    source: 'TYPED',
    expiresOn,
    mirrored: mirrored && expiresOn !== null,
  });
  const read = (expiresOn: string): ExpiryEntry => ({ source: 'READ', expiresOn, mirrored: false });
  const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

  it('calls a saved date a typed mirror only when the newest entry is typed and the day matches', () => {
    expect(isTypedMirror(day(FUTURE), [typed(FUTURE)])).toBe(true);
    // A typed date that only agreed with a read date was never saved as the date: not a mirror.
    expect(isTypedMirror(day(FUTURE), [typed(FUTURE, false), read(FUTURE)])).toBe(false);
    expect(isTypedMirror(day(OTHER_FUTURE), [typed(FUTURE)])).toBe(false);
    expect(isTypedMirror(day(FUTURE), [read(FUTURE), typed(FUTURE)])).toBe(false);
    expect(isTypedMirror(day(FUTURE), [typed(null)])).toBe(false);
    expect(isTypedMirror(null, [typed(FUTURE)])).toBe(false);
    expect(isTypedMirror(day(FUTURE), [])).toBe(false);
  });

  it('treats a date with no entries as a read date and flags only a real disagreement', () => {
    expect(describeExpiry(day(FUTURE), [])).toEqual({
      origin: 'READ',
      typedOn: null,
      mismatch: false,
    });
    expect(describeExpiry(null, [])).toEqual({ origin: 'NONE', typedOn: null, mismatch: false });
    expect(describeExpiry(day(FUTURE), [typed(FUTURE)])).toEqual({
      origin: 'TYPED',
      typedOn: FUTURE,
      mismatch: false,
    });
    expect(describeExpiry(day(FUTURE), [typed(OTHER_FUTURE), read(FUTURE)])).toEqual({
      origin: 'READ',
      typedOn: OTHER_FUTURE,
      mismatch: true,
    });
    expect(describeExpiry(day(FUTURE), [typed(FUTURE), read(FUTURE)]).mismatch).toBe(false);
    // A cleared typed date is no longer a typed date.
    expect(latestTypedDay([typed(null), typed(FUTURE)])).toBeNull();
    expect(describeExpiry(day(FUTURE), [typed(null), typed(OTHER_FUTURE)]).mismatch).toBe(false);
  });

  it('bounds the year and tells a passed day from today', () => {
    expect(expiryDayInRange('1949-12-31', NOW)).toBe(false);
    expect(expiryDayInRange('1950-01-01', NOW)).toBe(true);
    expect(expiryDayInRange('2076-11-10', NOW)).toBe(true);
    expect(expiryDayInRange('2077-01-01', NOW)).toBe(false);
    expect(expiryDayCountsAsExpired('2026-11-09', NOW)).toBe(true);
    // Today already counts as expired for readiness, so it is asked about too.
    expect(expiryDayCountsAsExpired('2026-11-10', NOW)).toBe(true);
    expect(expiryDayCountsAsExpired('2026-11-11', NOW)).toBe(false);
  });
});

describe('typing an expiry date for any document', () => {
  let db: Db;
  let owner: { accountId: string; applicantId: string };
  let documentId: string;

  beforeEach(async () => {
    db = await freshDb();
    owner = await seedOwner(db, 'expiry-owner@example.com');
    documentId = await seedDocument(db, owner);
  });

  it('saves a typed date on a visa with no read date: a typed entry and the saved date follow', async () => {
    const saved = await setExpiry(db, owner.accountId, documentId, FUTURE);
    expect(isOk(saved) && saved.value).toMatchObject({
      status: 'saved',
      changed: true,
      expiresOn: FUTURE,
      state: { origin: 'TYPED', typedOn: FUTURE, mismatch: false },
    });
    expect((await documentRow(db, documentId)).expiresAt?.toISOString()).toBe(
      `${FUTURE}T00:00:00.000Z`,
    );
    const entries = await entriesOf(db, documentId);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      source: 'TYPED',
      expiresOn: FUTURE,
      enteredByAccountId: owner.accountId,
    });
  });

  it('keeps every change as a new entry and moves the saved date while it is only a typed mirror', async () => {
    await setExpiry(db, owner.accountId, documentId, FUTURE);
    const changed = await setExpiry(db, owner.accountId, documentId, OTHER_FUTURE);
    expect(isOk(changed) && changed.value).toMatchObject({
      changed: true,
      expiresOn: OTHER_FUTURE,
    });
    expect((await documentRow(db, documentId)).expiresAt?.toISOString().slice(0, 10)).toBe(
      OTHER_FUTURE,
    );
    expect((await entriesOf(db, documentId)).map((entry) => entry.expiresOn)).toEqual([
      OTHER_FUTURE,
      FUTURE,
    ]);
    // The same date again adds nothing.
    const again = await setExpiry(db, owner.accountId, documentId, OTHER_FUTURE);
    expect(isOk(again) && again.value).toMatchObject({ status: 'saved', changed: false });
    expect(await entriesOf(db, documentId)).toHaveLength(2);
  });

  it('keeps a read date in force, adds the typed one beside it and flags the mismatch', async () => {
    await putReadDate(db, documentId, FUTURE);
    const saved = await setExpiry(db, owner.accountId, documentId, OTHER_FUTURE);
    expect(isOk(saved) && saved.value).toMatchObject({
      status: 'saved',
      changed: true,
      expiresOn: FUTURE,
      state: { origin: 'READ', typedOn: OTHER_FUTURE, mismatch: true },
    });
    expect((await documentRow(db, documentId)).expiresAt?.toISOString().slice(0, 10)).toBe(FUTURE);
    expect(
      (await entriesOf(db, documentId)).map((entry) => [entry.source, entry.expiresOn]),
    ).toEqual([
      ['TYPED', OTHER_FUTURE],
      ['READ', FUTURE],
    ]);
    // Typing the same day as the read date is not a mismatch.
    const agree = await setExpiry(db, owner.accountId, documentId, FUTURE);
    expect(isOk(agree) && agree.value).toMatchObject({
      state: { origin: 'READ', mismatch: false },
    });
    // Clearing that agreeing date must not remove the read date it agreed with.
    const cleared = await setExpiry(db, owner.accountId, documentId, null);
    expect(isOk(cleared) && cleared.value).toMatchObject({
      expiresOn: FUTURE,
      state: { origin: 'READ' },
    });
    expect((await documentRow(db, documentId)).expiresAt?.toISOString().slice(0, 10)).toBe(FUTURE);
  });

  it('never removes a read date that was in force before any entry existed', async () => {
    await db
      .update(schema.documents)
      .set({ expiresAt: new Date(`${FUTURE}T00:00:00.000Z`) })
      .where(eq(schema.documents.id, documentId));
    await setExpiry(db, owner.accountId, documentId, OTHER_FUTURE);
    const cleared = await setExpiry(db, owner.accountId, documentId, null);
    expect(isOk(cleared) && cleared.value).toMatchObject({
      changed: true,
      expiresOn: FUTURE,
      state: { origin: 'READ', typedOn: null, mismatch: false },
    });
    expect((await documentRow(db, documentId)).expiresAt?.toISOString().slice(0, 10)).toBe(FUTURE);
  });

  it('clears the saved date only when it is a typed mirror, and keeps the history', async () => {
    await setExpiry(db, owner.accountId, documentId, FUTURE);
    const cleared = await setExpiry(db, owner.accountId, documentId, null);
    expect(isOk(cleared) && cleared.value).toMatchObject({
      changed: true,
      expiresOn: null,
      state: { origin: 'NONE', typedOn: null },
    });
    expect((await documentRow(db, documentId)).expiresAt).toBeNull();
    expect((await entriesOf(db, documentId)).map((entry) => entry.expiresOn)).toEqual([
      null,
      FUTURE,
    ]);
    // Clearing again, with nothing typed standing, changes nothing.
    const nothing = await setExpiry(db, owner.accountId, documentId, null);
    expect(isOk(nothing) && nothing.value).toMatchObject({ changed: false });
    expect(await entriesOf(db, documentId)).toHaveLength(2);
  });

  it('asks once before saving a date that has passed, then saves it when the person confirms', async () => {
    const asked = await setExpiry(db, owner.accountId, documentId, '2026-01-01');
    expect(isOk(asked) && asked.value).toEqual({ status: 'needs_confirmation' });
    expect(await entriesOf(db, documentId)).toHaveLength(0);
    expect((await documentRow(db, documentId)).expiresAt).toBeNull();

    const confirmed = await setExpiry(db, owner.accountId, documentId, '2026-01-01', {
      acknowledgePast: true,
    });
    expect(isOk(confirmed) && confirmed.value).toMatchObject({
      status: 'saved',
      expiresOn: '2026-01-01',
    });
    // Today counts as expired too, and asks; tomorrow does not.
    const today = await setExpiry(db, owner.accountId, documentId, '2026-11-10');
    expect(isOk(today) && today.value).toEqual({ status: 'needs_confirmation' });
    const tomorrow = await setExpiry(db, owner.accountId, documentId, '2026-11-11');
    expect(isOk(tomorrow) && tomorrow.value).toMatchObject({ status: 'saved' });
  });

  it('does not ask again about a passed date that is already saved', async () => {
    await setExpiry(db, owner.accountId, documentId, '2026-01-01', { acknowledgePast: true });
    const again = await setExpiry(db, owner.accountId, documentId, '2026-01-01');
    expect(isOk(again) && again.value).toMatchObject({ status: 'saved', changed: false });
    expect(await entriesOf(db, documentId)).toHaveLength(1);
  });

  it('refuses a date that is not a real day or is out of range, with plain words', async () => {
    for (const bad of ['2031-02-30', '30/04/2031', 'tomorrow', '', '1949-01-01', '2090-01-01']) {
      const refused = await setExpiry(db, owner.accountId, documentId, bad, {
        acknowledgePast: true,
      });
      expect(refused.ok ? null : refused.error.code, bad).toBe('invalid');
    }
    expect(await entriesOf(db, documentId)).toHaveLength(0);
  });

  it('answers another person, a wide share and a deleted document with the not-found pattern', async () => {
    const stranger = await seedOwner(db, 'expiry-stranger@example.com');
    const denied = await requireAccess(
      db,
      accountPrincipal(stranger.accountId),
      'MANAGE',
      { documentId },
      { purpose: 'owner_document_expiry' },
    );
    expect(denied.ok).toBe(false);
    expect(await entriesOf(db, documentId)).toHaveLength(0);

    // A proof for a document that has since been removed gets the same plain answer.
    const proof = await proofFor(db, owner.accountId, documentId);
    await db.delete(schema.documents).where(eq(schema.documents.id, documentId));
    const gone = await setDocumentExpiry(proof, { expiresOn: FUTURE, now: NOW });
    expect(gone.ok ? null : gone.error.code).toBe('not_found');
  });

  it('refuses a proof made for the whole record: it is not a proof for one document', async () => {
    const wide = await requireAccess(
      db,
      accountPrincipal(owner.accountId),
      'MANAGE',
      { applicantId: owner.applicantId },
      { purpose: 'owner_document_expiry' },
    );
    if (!isOk(wide)) throw new Error('access');
    const refused = await setDocumentExpiry(wide.value, { expiresOn: FUTURE, now: NOW });
    expect(refused.ok ? null : refused.error.code).toBe('forbidden');
    expect(await entriesOf(db, documentId)).toHaveLength(0);
  });

  it('keeps the date out of the audit trail and records where the in-force date came from', async () => {
    await putReadDate(db, documentId, FUTURE);
    await setExpiry(db, owner.accountId, documentId, OTHER_FUTURE);
    await setExpiry(db, owner.accountId, documentId, null);
    const events = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.resourceId, documentId));
    expect(JSON.stringify(events)).not.toContain(OTHER_FUTURE);
    expect(JSON.stringify(events)).not.toContain(FUTURE);
    const entered = events.filter((event) => event.eventType === 'DOCUMENT_EXPIRY_ENTERED');
    const cleared = events.filter((event) => event.eventType === 'DOCUMENT_EXPIRY_CLEARED');
    expect(entered).toHaveLength(1);
    expect(cleared).toHaveLength(1);
    expect(entered[0]).toMatchObject({
      actorAccountId: owner.accountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: owner.applicantId,
      metadata: { source: 'TYPED', readDateInForce: true, inForceChanged: false },
    });
  });

  it('serialises two saves for one document: both are kept and the last one wins', async () => {
    const [first, second] = await Promise.all([
      setExpiry(db, owner.accountId, documentId, FUTURE),
      setExpiry(db, owner.accountId, documentId, OTHER_FUTURE),
    ]);
    expect(isOk(first) && isOk(second)).toBe(true);
    const entries = await entriesOf(db, documentId);
    expect(entries).toHaveLength(2);
    const row = await documentRow(db, documentId);
    expect(row.expiresAt?.toISOString().slice(0, 10)).toBe(entries[0]?.expiresOn);
  });

  it('marks the cases that chose the document as needing a new look when the saved date changes', async () => {
    const mission = await createMission(db, {
      actorAccountId: owner.accountId,
      applicantId: owner.applicantId,
      title: 'Synthetic Case',
      destination: 'United Kingdom',
      purpose: 'Tourism',
    });
    if (!isOk(mission)) throw new Error('mission');
    const [requirement] = await db
      .insert(schema.packRequirements)
      .values({
        packVersionId:
          (
            await db
              .insert(schema.packVersions)
              .values({
                packId:
                  (
                    await db
                      .insert(schema.packs)
                      .values({
                        key: 'synthetic.expiry',
                        name: 'Synthetic Expiry',
                        authoritative: true,
                      })
                      .returning()
                  )[0]?.id ?? '',
                version: 1,
                status: 'PUBLISHED',
              })
              .returning()
          )[0]?.id ?? '',
        kind: 'DOCUMENT',
        docType: 'VISA',
        citation: 'Synthetic rule',
        optional: false,
        necessity: 'MANDATORY',
      })
      .returning();
    await db.insert(schema.selectedEvidence).values({
      missionId: mission.value.id,
      packRequirementId: requirement?.id ?? '',
      documentId,
      selectedByAccountId: owner.accountId,
    });
    const before = (
      await db.select().from(schema.missions).where(eq(schema.missions.id, mission.value.id))
    )[0]?.materialRevision;
    await setExpiry(db, owner.accountId, documentId, FUTURE);
    const after = (
      await db.select().from(schema.missions).where(eq(schema.missions.id, mission.value.id))
    )[0]?.materialRevision;
    expect(after).toBe((before ?? 0) + 1);
  });
});

describe('what the lists and reminders see', () => {
  let db: Db;
  let owner: { accountId: string; applicantId: string };

  beforeEach(async () => {
    db = await freshDb();
    owner = await seedOwner(db, 'expiry-lists@example.com');
  });

  it('lists a typed date as typed, a read date as read and a mismatch as a mismatch', async () => {
    const visa = await seedDocument(db, owner, 'VISA');
    const passport = await seedDocument(db, owner, 'PASSPORT');
    await setExpiry(db, owner.accountId, visa, FUTURE);
    await putReadDate(db, passport, FUTURE);
    await setExpiry(db, owner.accountId, passport, OTHER_FUTURE);
    const listed = await listDocumentsDetailed(db, owner.accountId, owner.applicantId, {
      withExpiry: true,
    });
    if (!isOk(listed)) throw new Error('list');
    const byId = new Map(listed.value.map((doc) => [doc.id, doc]));
    expect(byId.get(visa)?.expiry).toEqual({
      origin: 'TYPED',
      typedOn: FUTURE,
      mismatch: false,
      canType: true,
    });
    expect(byId.get(passport)?.expiry).toEqual({
      origin: 'READ',
      typedOn: OTHER_FUTURE,
      mismatch: true,
      canType: true,
    });
    // The read date is the one shown as the saved date.
    expect(byId.get(passport)?.expiresAt?.slice(0, 10)).toBe(FUTURE);
  });

  it('leaves the source of the date out unless the screen asks for it', async () => {
    const visa = await seedDocument(db, owner, 'VISA');
    await setExpiry(db, owner.accountId, visa, FUTURE);
    const plain = await listDocumentsDetailed(db, owner.accountId, owner.applicantId);
    if (!isOk(plain)) throw new Error('list');
    expect(plain.value[0]?.expiry).toBeUndefined();
    expect(plain.value[0]?.expiresAt?.slice(0, 10)).toBe(FUTURE);
  });

  it('sends the expiry reminder for a typed date on a document that is not a passport', async () => {
    const certificate = await seedDocument(db, owner, 'EMPLOYMENT_CERTIFICATE');
    const sweepNow = new Date('2026-06-15T12:00:00.000Z');
    const thirtyDays = new Date(sweepNow.getTime() + 30 * DAY_MS).toISOString().slice(0, 10);
    const typed = await setExpiry(db, owner.accountId, certificate, thirtyDays, { now: sweepNow });
    expect(isOk(typed)).toBe(true);
    const result = await sweepExpiryReminders(db, sweepNow);
    expect(result.enqueued).toBe(1);
    const rows = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.eventType, 'DOCUMENT_EXPIRY'));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.resourceId === certificate)).toBe(true);
  });
});

describe('correcting a typed date', () => {
  it('reminds again about the corrected date, and never sends a second reminder for a date nobody touched', async () => {
    const db = await freshDb();
    const owner = await seedOwner(db, 'expiry-rearm@example.com');
    const certificate = await seedDocument(db, owner, 'EMPLOYMENT_CERTIFICATE');
    const passport = await seedDocument(db, owner, 'PASSPORT');
    const sweepNow = new Date('2026-06-15T12:00:00.000Z');
    const inDays = (days: number) =>
      new Date(sweepNow.getTime() + days * DAY_MS).toISOString().slice(0, 10);
    await db
      .update(schema.documents)
      .set({ expiresAt: new Date(`${inDays(30)}T00:00:00.000Z`) })
      .where(eq(schema.documents.id, passport));
    await setExpiry(db, owner.accountId, certificate, inDays(30), { now: sweepNow });
    const reminders = async () =>
      (
        await db
          .select()
          .from(schema.notifications)
          .where(eq(schema.notifications.eventType, 'DOCUMENT_EXPIRY'))
      ).length;

    await sweepExpiryReminders(db, sweepNow);
    expect(await reminders()).toBe(4); // two documents, two channels
    await sweepExpiryReminders(db, sweepNow);
    expect(await reminders()).toBe(4); // the same sweep again adds nothing

    // The person corrects a slip: the new date is 400 days out, and 30 days before it they hear again.
    await setExpiry(db, owner.accountId, certificate, inDays(400), { now: sweepNow });
    const later = new Date(sweepNow.getTime() + 370 * DAY_MS);
    await sweepExpiryReminders(db, later);
    const rows = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.eventType, 'DOCUMENT_EXPIRY'));
    const forCertificate = rows.filter((row) => row.resourceId === certificate);
    expect(forCertificate).toHaveLength(4);
    expect(forCertificate.some((row) => row.idempotencyKey.includes(`:30@${inDays(400)}`))).toBe(
      true,
    );
    // A date read from the passport keeps the key it always had.
    expect(
      rows
        .filter((row) => row.resourceId === passport)
        .every((row) => row.idempotencyKey.endsWith(':30')),
    ).toBe(true);
  });
});

describe('before the migration has run', () => {
  let db: Db;
  let owner: { accountId: string; applicantId: string };
  let documentId: string;

  beforeEach(async () => {
    db = await freshDb();
    owner = await seedOwner(db, 'expiry-missing@example.com');
    documentId = await seedDocument(db, owner);
    await db.execute(sql`drop table document_expiry_entries`);
  });

  it('refuses to save plainly, changes nothing and still lists the document', async () => {
    const refused = await setExpiry(db, owner.accountId, documentId, FUTURE);
    expect(refused.ok ? null : refused.error.code).toBe('invalid');
    expect(refused.ok ? '' : refused.error.message).toMatch(/not switched on/);
    expect((await documentRow(db, documentId)).expiresAt).toBeNull();

    const listed = await listDocumentsDetailed(db, owner.accountId, owner.applicantId, {
      withExpiry: true,
    });
    if (!isOk(listed)) throw new Error('list');
    expect(listed.value[0]?.expiry).toEqual({
      origin: 'NONE',
      typedOn: null,
      mismatch: false,
      canType: false,
    });
  });

  it('keeps a saved date readable as a read date', async () => {
    await db
      .update(schema.documents)
      .set({ expiresAt: new Date(`${FUTURE}T00:00:00.000Z`) })
      .where(eq(schema.documents.id, documentId));
    const listed = await listDocumentsDetailed(db, owner.accountId, owner.applicantId, {
      withExpiry: true,
    });
    if (!isOk(listed)) throw new Error('list');
    expect(listed.value[0]?.expiry).toMatchObject({ origin: 'READ', canType: false });
  });
});
