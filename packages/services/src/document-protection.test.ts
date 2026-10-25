import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { type Result, isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type StaffScope, accountPrincipal, staffPrincipal } from './access/principal';
import {
  DEFAULT_DOCUMENT_PROTECTION,
  isRestrictedDocumentType,
  requireAccess,
} from './access/require-access';
import { loadDocumentProtectionSettings } from './access/restricted-documents';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import {
  DOCUMENT_PROTECTION_AUDIT_EVENT,
  DOCUMENT_PROTECTION_REASON_REQUIRED,
  type SetDocumentProtectionInput,
  getDocumentProtectionOverview,
  readDocumentProtectionSettings,
  setDocumentProtection,
} from './document-protection';
import { registerDocument } from './documents';
import type { ServiceError } from './errors';
import { type PlatformAuthInput, grantPlatformRole } from './platform-roles';

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

async function account(db: Db, email: string): Promise<string> {
  const result = await provisionAccount(db, { email });
  if (!isOk(result)) throw new Error(`provision ${email}`);
  return result.value.id;
}

function errorCode<T>(result: Result<T, ServiceError>): string | undefined {
  return isErr(result) ? result.error.code : undefined;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('document protection switches', () => {
  let db: Db;
  let ownerAuth: PlatformAuthInput;
  let securityAuth: PlatformAuthInput;
  let complianceAuth: PlatformAuthInput;

  async function scopeFor(auth: PlatformAuthInput) {
    const scope = await staffPrincipal(db, auth, 'DOCUMENT_PROTECTION_MANAGE');
    if (!isOk(scope)) throw new Error('staff scope');
    return scope.value;
  }

  async function change(
    input: Omit<SetDocumentProtectionInput, 'stepUpSatisfied' | 'removalConfirmed'> & {
      stepUpSatisfied?: boolean;
      removalConfirmed?: boolean;
    },
  ) {
    return setDocumentProtection(db, await scopeFor(securityAuth), {
      stepUpSatisfied: false,
      removalConfirmed: true,
      reason: 'Feedback from agencies',
      ...input,
    });
  }

  async function auditRows() {
    return db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, DOCUMENT_PROTECTION_AUDIT_EVENT));
  }

  beforeEach(async () => {
    db = await freshDb();
    const ownerEmail = 'owner@platform.example.com';
    const ownerId = await account(db, ownerEmail);
    ownerAuth = { accountId: ownerId, email: ownerEmail, bootstrapEmails: [ownerEmail] };
    const grant = async (
      email: string,
      role: 'PLATFORM_OWNER' | 'SECURITY_ADMIN' | 'COMPLIANCE_ADMIN',
    ) => {
      const id = email === ownerEmail ? ownerId : await account(db, email);
      const granted = await grantPlatformRole(db, {
        actor: ownerAuth,
        targetAccountId: id,
        role,
        reason: 'test',
        stepUpSatisfied: true,
      });
      if (!isOk(granted)) throw new Error(`grant ${role}`);
      return { accountId: id, email, bootstrapEmails: [] };
    };
    await grant(ownerEmail, 'PLATFORM_OWNER');
    securityAuth = await grant('security@platform.example.com', 'SECURITY_ADMIN');
    complianceAuth = await grant('compliance@platform.example.com', 'COMPLIANCE_ADMIN');
  });

  it('uses the built-in rule when no switch is stored', async () => {
    const settings = await readDocumentProtectionSettings(db);
    expect(isRestrictedDocumentType('PASSPORT', settings)).toBe(true);
    expect(isRestrictedDocumentType('BANK_STATEMENT', settings)).toBe(true);
    expect(isRestrictedDocumentType('MEDICAL_REPORT', settings)).toBe(true);
    // The whole Financial group is restricted by default (owner decision 2026-10-25).
    expect(isRestrictedDocumentType('SALARY_SLIP', settings)).toBe(true);
    expect(isRestrictedDocumentType('EMPLOYMENT_CERTIFICATE', settings)).toBe(false);
    expect(isRestrictedDocumentType(null, settings)).toBe(true);
    expect(isRestrictedDocumentType('SOMETHING_NOBODY_KNOWS', settings)).toBe(true);
  });

  it('lets a stored switch override a category or a single type, the type switch winning', async () => {
    expect(
      isOk(
        await change({
          scope: 'CATEGORY',
          key: 'medical',
          restricted: false,
          stepUpSatisfied: true,
        }),
      ),
    ).toBe(true);
    expect(
      isOk(
        await change({ scope: 'DOCUMENT_TYPE', key: 'EMPLOYMENT_CERTIFICATE', restricted: true }),
      ),
    ).toBe(true);
    expect(
      isOk(
        await change({
          scope: 'DOCUMENT_TYPE',
          key: 'PASSPORT',
          restricted: false,
          stepUpSatisfied: true,
        }),
      ),
    ).toBe(true);
    const settings = await readDocumentProtectionSettings(db);
    expect(isRestrictedDocumentType('MEDICAL_REPORT', settings)).toBe(false);
    // Restricted one by one by default, so the category switch does not reach it.
    expect(isRestrictedDocumentType('OTHER_MEDICAL_DOCUMENT', settings)).toBe(true);
    expect(isRestrictedDocumentType('EMPLOYMENT_CERTIFICATE', settings)).toBe(true);
    // An alias follows its type's switch.
    expect(isRestrictedDocumentType('PASSPORT_BIO_PAGE', settings)).toBe(false);
    // The rest of Identity and Civil is still restricted.
    expect(isRestrictedDocumentType('BIRTH_CERTIFICATE', settings)).toBe(true);
  });

  it('keeps unknown types restricted unless that switch is turned off', async () => {
    expect(isRestrictedDocumentType(null, await readDocumentProtectionSettings(db))).toBe(true);
    const off = await change({
      scope: 'UNKNOWN_TYPE',
      key: 'unknown',
      restricted: false,
      stepUpSatisfied: true,
    });
    expect(isOk(off)).toBe(true);
    let settings = await readDocumentProtectionSettings(db);
    expect(isRestrictedDocumentType(null, settings)).toBe(false);
    expect(isRestrictedDocumentType('SOMETHING_NOBODY_KNOWS', settings)).toBe(false);
    // Known restricted types are untouched by it.
    expect(isRestrictedDocumentType('PASSPORT', settings)).toBe(true);
    expect(isOk(await change({ scope: 'UNKNOWN_TYPE', key: 'unknown', restricted: null }))).toBe(
      true,
    );
    settings = await readDocumentProtectionSettings(db);
    expect(isRestrictedDocumentType(null, settings)).toBe(true);
  });

  it('refuses anyone without the permission, a copied scope, another action and a stale scope', async () => {
    const plainId = await account(db, 'plain@example.com');
    const plain = await staffPrincipal(
      db,
      { accountId: plainId, email: 'plain@example.com', bootstrapEmails: [] },
      'DOCUMENT_PROTECTION_MANAGE',
    );
    expect(errorCode(plain)).toBe('forbidden');
    expect(errorCode(await staffPrincipal(db, complianceAuth, 'DOCUMENT_PROTECTION_MANAGE'))).toBe(
      'forbidden',
    );
    expect(isOk(await staffPrincipal(db, ownerAuth, 'DOCUMENT_PROTECTION_MANAGE'))).toBe(true);

    const input = {
      scope: 'DOCUMENT_TYPE',
      key: 'EMPLOYMENT_CERTIFICATE',
      restricted: true,
      removalConfirmed: true,
      stepUpSatisfied: true,
    } as const;
    const genuine = await scopeFor(securityAuth);
    const copy = { ...genuine } as unknown as StaffScope<'DOCUMENT_PROTECTION_MANAGE'>;
    expect(errorCode(await setDocumentProtection(db, copy, input))).toBe('forbidden');
    expect(errorCode(await getDocumentProtectionOverview(db, copy))).toBe('forbidden');

    const other = await staffPrincipal(db, securityAuth, 'AI_SETTINGS_MANAGE');
    if (!isOk(other)) throw new Error('other scope');
    const wrongAction = other.value as unknown as StaffScope<'DOCUMENT_PROTECTION_MANAGE'>;
    expect(errorCode(await setDocumentProtection(db, wrongAction, input))).toBe('forbidden');

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 6 * 60 * 1000);
    expect(errorCode(await setDocumentProtection(db, genuine, input))).toBe('forbidden');
    vi.useRealTimers();

    expect(await db.select().from(schema.documentProtectionSettings)).toHaveLength(0);
    expect(await auditRows()).toHaveLength(0);
  });

  it('needs the on-page confirmation for any change that removes protection, checked first', async () => {
    const unconfirmed = (input: { scope: 'CATEGORY'; key: string; restricted: boolean | null }) =>
      change({ ...input, removalConfirmed: false, stepUpSatisfied: true });
    const off = await unconfirmed({ scope: 'CATEGORY', key: 'medical', restricted: false });
    expect(isOk(off) && off.value).toMatchObject({ changed: false, confirmationRequired: true });
    // Before the sign-in check, so an unconfirmed change never sends anyone to sign in.
    const offNoStepUp = await change({
      scope: 'CATEGORY',
      key: 'medical',
      restricted: false,
      removalConfirmed: false,
    });
    expect(isOk(offNoStepUp) && offNoStepUp.value.confirmationRequired).toBe(true);
    // Adding protection, and a reset that keeps it, need no confirmation.
    const on = await unconfirmed({
      scope: 'CATEGORY',
      key: 'employment_business',
      restricted: true,
    });
    expect(isOk(on) && on.value).toMatchObject({ changed: true, confirmationRequired: false });
    const reset = await unconfirmed({
      scope: 'CATEGORY',
      key: 'employment_business',
      restricted: null,
    });
    // This reset removes protection, so it needs confirmation like turning off.
    expect(isOk(reset) && reset.value).toMatchObject({
      changed: false,
      confirmationRequired: true,
    });
    expect(isOk(await change({ scope: 'CATEGORY', key: 'medical', restricted: true }))).toBe(true);
    const keepsProtection = await unconfirmed({
      scope: 'CATEGORY',
      key: 'medical',
      restricted: null,
    });
    expect(isOk(keepsProtection) && keepsProtection.value.changed).toBe(true);
    const stored = await db.select().from(schema.documentProtectionSettings);
    expect(stored.map((row) => `${row.key}:${row.restricted}`)).toEqual([
      'employment_business:true',
    ]);
    expect(await auditRows()).toHaveLength(3);
  });

  it('refuses to remove protection without a reason, before the sign-in check', async () => {
    for (const reason of ['', '   ']) {
      for (const restricted of [false, null] as const) {
        if (restricted === null) {
          await change({ scope: 'CATEGORY', key: 'employment_business', restricted: true });
        }
        const key = restricted === null ? 'employment_business' : 'medical';
        const result = await change({ scope: 'CATEGORY', key, restricted, reason });
        expect(isErr(result) && result.error, `${key}:${reason}`).toEqual({
          code: 'invalid',
          message: DOCUMENT_PROTECTION_REASON_REQUIRED,
        });
      }
    }
    // A reason given with only the step-up missing gets the step-up answer.
    expect(errorCode(await change({ scope: 'CATEGORY', key: 'medical', restricted: false }))).toBe(
      'step_up_required',
    );
    // Turning protection on keeps the reason optional.
    const on = await change({
      scope: 'CATEGORY',
      key: 'education_qualifications',
      restricted: true,
      reason: '',
    });
    expect(isOk(on) && on.value.changed).toBe(true);
    const stored = await db.select().from(schema.documentProtectionSettings);
    expect(stored.map((row) => `${row.key}:${row.restricted}:${row.reason}`).sort()).toEqual([
      'education_qualifications:true:null',
      'employment_business:true:Feedback from agencies',
    ]);
  });

  it('asks for a fresh sign-in to remove protection, never to add it', async () => {
    const off = await change({ scope: 'CATEGORY', key: 'medical', restricted: false });
    expect(errorCode(off)).toBe('step_up_required');
    expect(await db.select().from(schema.documentProtectionSettings)).toHaveLength(0);

    // Turning on needs no re-check.
    expect(
      isOk(await change({ scope: 'CATEGORY', key: 'employment_business', restricted: true })),
    ).toBe(true);
    // Going back to the default removes protection here, so it needs one.
    expect(
      errorCode(await change({ scope: 'CATEGORY', key: 'employment_business', restricted: null })),
    ).toBe('step_up_required');
    expect(
      isOk(
        await change({
          scope: 'CATEGORY',
          key: 'employment_business',
          restricted: null,
          stepUpSatisfied: true,
        }),
      ),
    ).toBe(true);
    // A type switch that would lift its category's protection needs one too.
    expect(
      errorCode(await change({ scope: 'DOCUMENT_TYPE', key: 'MEDICAL_REPORT', restricted: false })),
    ).toBe('step_up_required');
    // Switching off what is already off removes nothing.
    expect(
      isOk(
        await change({ scope: 'DOCUMENT_TYPE', key: 'EMPLOYMENT_CERTIFICATE', restricted: false }),
      ),
    ).toBe(true);
  });

  it('writes one audit event per change, never with the reason text, and none for a repeat', async () => {
    const security = await scopeFor(securityAuth);
    const first = await setDocumentProtection(db, security, {
      scope: 'CATEGORY',
      key: 'medical',
      restricted: false,
      reason: 'Agencies asked for fewer sign-in checks on vaccination cards',
      removalConfirmed: true,
      stepUpSatisfied: true,
    });
    expect(isOk(first) && first.value).toEqual({
      changed: true,
      confirmationRequired: false,
      restrictedBefore: true,
      restrictedAfter: false,
    });
    const repeat = await setDocumentProtection(db, security, {
      scope: 'CATEGORY',
      key: 'medical',
      restricted: false,
      reason: 'Agencies asked for fewer sign-in checks on vaccination cards',
      removalConfirmed: true,
      stepUpSatisfied: true,
    });
    expect(isOk(repeat) && repeat.value.changed).toBe(false);
    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorAccountId: securityAuth.accountId,
      resourceType: 'document_protection_setting',
      resourceId: 'CATEGORY:medical',
      reason: null,
      metadata: {
        scope: 'CATEGORY',
        key: 'medical',
        setting: 'off',
        restrictedBefore: true,
        restrictedAfter: false,
        stepUp: true,
      },
    });
    // The free text stays in the settings table only, never in the audit chain.
    expect(JSON.stringify(rows[0])).not.toContain('vaccination cards');
    const [stored] = await db.select().from(schema.documentProtectionSettings);
    expect(stored).toMatchObject({
      scope: 'CATEGORY',
      key: 'medical',
      restricted: false,
      reason: 'Agencies asked for fewer sign-in checks on vaccination cards',
      changedByAccountId: securityAuth.accountId,
    });
    expect(isOk(await change({ scope: 'CATEGORY', key: 'medical', restricted: null }))).toBe(true);
    expect(await auditRows()).toHaveLength(2);
    expect(await db.select().from(schema.documentProtectionSettings)).toHaveLength(0);
  });

  it('refuses switches that do not exist and an overlong reason', async () => {
    for (const bad of [
      { scope: 'CATEGORY', key: 'not_a_group' },
      { scope: 'CATEGORY', key: 'universal' },
      { scope: 'DOCUMENT_TYPE', key: 'PASSPORT_BIO_PAGE' },
      { scope: 'DOCUMENT_TYPE', key: 'NOT_A_TYPE' },
      { scope: 'UNKNOWN_TYPE', key: 'other' },
      { scope: 'SOMETHING', key: 'medical' },
    ] as const) {
      const result = await change({
        ...(bad as unknown as { scope: 'CATEGORY'; key: string }),
        restricted: true,
      });
      expect(errorCode(result), `${bad.scope}:${bad.key}`).toBe('invalid');
    }
    const long = await change({
      scope: 'CATEGORY',
      key: 'financial',
      restricted: true,
      reason: 'x'.repeat(501),
    });
    expect(errorCode(long)).toBe('invalid');
    expect(await auditRows()).toHaveLength(0);
  });

  it('shows every switch with its state, default and last change', async () => {
    await change({
      scope: 'CATEGORY',
      key: 'medical',
      restricted: false,
      reason: 'feedback',
      stepUpSatisfied: true,
    });
    const overview = await getDocumentProtectionOverview(db, await scopeFor(securityAuth));
    if (!isOk(overview)) throw new Error('overview');
    const { categories, unknown } = overview.value;
    expect(categories).toHaveLength(14);
    expect(unknown).toMatchObject({ restricted: true, defaultRestricted: true, overridden: false });
    const medical = categories.find((c) => c.key === 'medical');
    expect(medical).toMatchObject({
      label: 'Medical',
      restricted: false,
      defaultRestricted: true,
      overridden: true,
      reason: 'feedback',
      changedByEmail: 'security@platform.example.com',
    });
    expect(medical?.changedAt).toBeInstanceOf(Date);
    const report = medical?.types.find((t) => t.key === 'MEDICAL_REPORT');
    expect(report).toMatchObject({
      restricted: false,
      defaultRestricted: false,
      overridden: false,
    });
    const other = medical?.types.find((t) => t.key === 'OTHER_MEDICAL_DOCUMENT');
    expect(other).toMatchObject({ restricted: true, defaultRestricted: true });
    expect(medical?.restrictedTypeCount).toBe(medical?.types.filter((t) => t.restricted).length);
    const identity = categories.find((c) => c.key === 'identity_civil');
    expect(identity?.restricted).toBe(true);
    expect(identity?.restrictedTypeCount).toBe(identity?.types.length);
  });

  describe('requireAccess', () => {
    let ownerId: string;
    let applicantId: string;

    beforeEach(async () => {
      ownerId = await account(db, 'traveller@example.com');
      for (const type of ['CORE_PROCESSING', 'SHARING'] as const) {
        await setConsent(db, { actorAccountId: ownerId, accountId: ownerId, type, granted: true });
      }
      const applicant = await createApplicant(db, {
        actorAccountId: ownerId,
        ownerAccountId: ownerId,
        displayName: 'Traveller',
      });
      if (!isOk(applicant)) throw new Error('applicant');
      applicantId = applicant.value.id;
    });

    async function documentOf(docType: string): Promise<string> {
      const document = await registerDocument(db, {
        actorAccountId: ownerId,
        applicantId,
        originalName: `${docType}.pdf`,
        docType,
      });
      if (!isOk(document)) throw new Error('document');
      return document.value.id;
    }

    function preview(tx: Db, documentId: string) {
      return requireAccess(
        tx,
        accountPrincipal(ownerId),
        'PREVIEW',
        { documentId },
        {
          purpose: 'self',
        },
      );
    }

    it('honours a switched-off category and a switched-on extra type', async () => {
      const medical = await documentOf('MEDICAL_REPORT');
      const employment = await documentOf('EMPLOYMENT_CERTIFICATE');
      expect(errorCode(await preview(db, medical))).toBe('step_up_required');
      expect(isOk(await preview(db, employment))).toBe(true);

      await change({ scope: 'CATEGORY', key: 'medical', restricted: false, stepUpSatisfied: true });
      await change({ scope: 'DOCUMENT_TYPE', key: 'EMPLOYMENT_CERTIFICATE', restricted: true });

      expect(isOk(await preview(db, medical))).toBe(true);
      expect(errorCode(await preview(db, employment))).toBe('step_up_required');
    });

    it('honours the unknown-type switch', async () => {
      const unknownDoc = await documentOf('SOMETHING_NOBODY_KNOWS');
      expect(errorCode(await preview(db, unknownDoc))).toBe('step_up_required');
      await change({
        scope: 'UNKNOWN_TYPE',
        key: 'unknown',
        restricted: false,
        stepUpSatisfied: true,
      });
      expect(isOk(await preview(db, unknownDoc))).toBe(true);
    });

    it('restricts every document when the switches cannot be read, reports it, and keeps the transaction usable', async () => {
      const medical = await documentOf('MEDICAL_REPORT');
      const employment = await documentOf('EMPLOYMENT_CERTIFICATE');
      const unknownDoc = await documentOf('SOMETHING_NOBODY_KNOWS');
      await change({ scope: 'CATEGORY', key: 'medical', restricted: false, stepUpSatisfied: true });
      await change({
        scope: 'UNKNOWN_TYPE',
        key: 'unknown',
        restricted: false,
        stepUpSatisfied: true,
      });
      expect(isOk(await preview(db, medical))).toBe(true);
      expect(isOk(await preview(db, employment))).toBe(true);

      await db.execute(
        sql`alter table document_protection_settings rename to document_protection_settings_gone`,
      );
      const reported = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        const settings = await loadDocumentProtectionSettings(db, DEFAULT_DOCUMENT_PROTECTION);
        for (const docType of ['MEDICAL_REPORT', 'EMPLOYMENT_CERTIFICATE', 'SALARY_SLIP', null]) {
          expect(isRestrictedDocumentType(docType, settings), String(docType)).toBe(true);
        }
        // Not the built-in defaults: those leave everyday documents open.
        expect(
          isRestrictedDocumentType('EMPLOYMENT_CERTIFICATE', DEFAULT_DOCUMENT_PROTECTION),
        ).toBe(false);
        expect(reported).toHaveBeenCalledWith(
          expect.stringContaining('[document-protection] switches could not be read'),
        );
        await db.transaction(async (tx) => {
          for (const id of [medical, employment, unknownDoc]) {
            expect(errorCode(await preview(tx, id))).toBe('step_up_required');
          }
          // The same transaction still works after the failed reads.
          expect(errorCode(await preview(tx, employment))).toBe('step_up_required');
        });
        // The admin page gets a clear "not available" answer instead of an error.
        const overview = await getDocumentProtectionOverview(db, await scopeFor(securityAuth));
        expect(errorCode(overview)).toBe('upstream_error');
      } finally {
        reported.mockRestore();
      }
    });
  });
});
