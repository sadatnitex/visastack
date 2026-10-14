import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isErr, isOk } from '@visastack/core';
import { CATALOGUE_MODULES, MODULE_FIELDS } from '@visastack/core/catalogue';
import { schema } from '@visastack/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { exportAccount } from './export';
import { getProfileSectionState, setExemption, setSectionOpen } from './profile-sections';

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

async function ownerWithApplicant(db: Db, email: string, withdrawConsent = false) {
  const p = await provisionAccount(db, { email });
  if (!isOk(p)) throw new Error('provision');
  await setConsent(db, {
    actorAccountId: p.value.id,
    accountId: p.value.id,
    type: 'CORE_PROCESSING',
    granted: true,
  });
  const applicant = await createApplicant(db, {
    actorAccountId: p.value.id,
    ownerAccountId: p.value.id,
    displayName: 'Owner',
  });
  if (!isOk(applicant)) throw new Error('applicant');
  if (withdrawConsent) {
    await setConsent(db, {
      actorAccountId: p.value.id,
      accountId: p.value.id,
      type: 'CORE_PROCESSING',
      granted: false,
    });
  }
  return { accountId: p.value.id, applicantId: applicant.value.id };
}

const lockedSection = CATALOGUE_MODULES.find((m) => !m.defaultOpen && !m.internal)?.key ?? '';
const defaultSection = CATALOGUE_MODULES.find((m) => m.defaultOpen)?.key ?? '';
const groupedField = MODULE_FIELDS.find((f) => f.group);

describe('profile sections and exemptions', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('starts empty, opens and closes a locked section, and remembers the choice', async () => {
    const { accountId, applicantId } = await ownerWithApplicant(db, 'sec1@example.com');
    expect((await getProfileSectionState(db, applicantId)).activated.size).toBe(0);

    const opened = await setSectionOpen(db, {
      actorAccountId: accountId,
      applicantId,
      sectionKey: lockedSection,
      open: true,
    });
    expect(isOk(opened)).toBe(true);
    expect((await getProfileSectionState(db, applicantId)).activated.has(lockedSection)).toBe(true);

    const closed = await setSectionOpen(db, {
      actorAccountId: accountId,
      applicantId,
      sectionKey: lockedSection,
      open: false,
    });
    expect(isOk(closed)).toBe(true);
    expect((await getProfileSectionState(db, applicantId)).activated.has(lockedSection)).toBe(
      false,
    );
    const rows = await db.select().from(schema.profileSectionStates);
    expect(rows).toHaveLength(1);
  });

  it('refuses an unknown section, an internal one, and closing an always-open one', async () => {
    const { accountId, applicantId } = await ownerWithApplicant(db, 'sec2@example.com');
    const base = { actorAccountId: accountId, applicantId, open: true };
    expect(isErr(await setSectionOpen(db, { ...base, sectionKey: 'no_such_section' }))).toBe(true);
    const internal = CATALOGUE_MODULES.find((m) => m.internal)?.key;
    if (internal) {
      expect(isErr(await setSectionOpen(db, { ...base, sectionKey: internal }))).toBe(true);
    }
    const result = await setSectionOpen(db, { ...base, sectionKey: defaultSection, open: false });
    expect(isErr(result)).toBe(true);
  });

  it('refuses everyone but the owner, and audits the refusal', async () => {
    const { applicantId } = await ownerWithApplicant(db, 'sec3@example.com');
    const stranger = await provisionAccount(db, { email: 'stranger-sec@example.com' });
    if (!isOk(stranger)) throw new Error('stranger');
    const result = await setSectionOpen(db, {
      actorAccountId: stranger.value.id,
      applicantId,
      sectionKey: lockedSection,
      open: true,
    });
    expect(isErr(result) && result.error.code).toBe('forbidden');
    expect(await db.select().from(schema.profileSectionStates)).toHaveLength(0);
    const denied = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'PROFILE_SECTION_CHANGE_DENIED'));
    expect(denied).toHaveLength(1);
  });

  it('needs core processing consent', async () => {
    const { accountId, applicantId } = await ownerWithApplicant(db, 'sec4@example.com', true);
    const result = await setSectionOpen(db, {
      actorAccountId: accountId,
      applicantId,
      sectionKey: lockedSection,
      open: true,
    });
    expect(isErr(result) && result.error.code).toBe('consent_required');
  });

  it('marks a field "does not apply" and a record "none", validates names, and undoes both', async () => {
    const { accountId, applicantId } = await ownerWithApplicant(db, 'sec5@example.com');
    const base = { actorAccountId: accountId, applicantId };
    const field = MODULE_FIELDS.find((f) => !f.group && !f.role)?.key ?? '';
    expect(
      isOk(
        await setExemption(db, {
          ...base,
          kind: 'FIELD_NOT_APPLICABLE',
          targetKey: field,
          on: true,
        }),
      ),
    ).toBe(true);
    expect(groupedField).toBeDefined();
    expect(
      isOk(
        await setExemption(db, {
          ...base,
          kind: 'RECORD_NONE',
          targetKey: groupedField?.group ?? '',
          on: true,
        }),
      ),
    ).toBe(true);
    // Setting it twice never duplicates.
    await setExemption(db, { ...base, kind: 'FIELD_NOT_APPLICABLE', targetKey: field, on: true });
    const state = await getProfileSectionState(db, applicantId);
    expect([...state.notApplicable]).toEqual([field]);
    expect([...state.noneDeclared]).toEqual([groupedField?.group]);

    // A field key is not a record name and the other way round.
    expect(
      isErr(await setExemption(db, { ...base, kind: 'RECORD_NONE', targetKey: field, on: true })),
    ).toBe(true);
    expect(
      isErr(
        await setExemption(db, {
          ...base,
          kind: 'FIELD_NOT_APPLICABLE',
          targetKey: 'made_up',
          on: true,
        }),
      ),
    ).toBe(true);

    await setExemption(db, { ...base, kind: 'FIELD_NOT_APPLICABLE', targetKey: field, on: false });
    expect((await getProfileSectionState(db, applicantId)).notApplicable.size).toBe(0);
  });

  it('writes an audit event for every change and removes everything with the applicant', async () => {
    const { accountId, applicantId } = await ownerWithApplicant(db, 'sec6@example.com');
    await setSectionOpen(db, {
      actorAccountId: accountId,
      applicantId,
      sectionKey: lockedSection,
      open: true,
    });
    const events = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'PROFILE_SECTION_OPENED'));
    expect(events).toHaveLength(1);
    expect(events[0]?.resourceId).toBe(lockedSection);

    await db.delete(schema.applicants).where(eq(schema.applicants.id, applicantId));
    expect(await db.select().from(schema.profileSectionStates)).toHaveLength(0);
  });

  it("includes opened sections and marks in the person's own data export", async () => {
    const { accountId, applicantId } = await ownerWithApplicant(db, 'sec7@example.com');
    await setSectionOpen(db, {
      actorAccountId: accountId,
      applicantId,
      sectionKey: lockedSection,
      open: true,
    });
    await setExemption(db, {
      actorAccountId: accountId,
      applicantId,
      kind: 'RECORD_NONE',
      targetKey: groupedField?.group ?? '',
      on: true,
    });
    const exported = await exportAccount(db, { actorAccountId: accountId, accountId });
    if (!isOk(exported)) throw new Error('export');
    const mine = exported.value.applicants[0];
    expect(mine?.profileSections.map((row) => row.sectionKey)).toEqual([lockedSection]);
    expect(mine?.profileExemptions.map((row) => row.targetKey)).toEqual([groupedField?.group]);
  });
});
