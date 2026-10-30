import { isOk, referenceCheckCharacter } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { getAiFeatureState } from '../ai-feature-settings';
import { aiToolsFor } from '../ai-tools/index';
import { AI_TOOLS, runAiTool } from '../ai-tools/index';
import { MESSAGES } from '../ai-tools/result';
import { createApplicant } from '../applicants';
import { setConsent } from '../consent';
import type { Db } from '../db';
import { setOrganizationAiSetting } from '../organization-ai-settings';
import { setMembershipActive } from '../organizations';
import { createGrant, pauseGrant, resumeGrant, revokeGrant } from '../sharing';
import { createAgencyAiConnection, listAgencyAiConnections } from './agency-ai-connections';
import {
  ADMIT,
  AGENCY_CLIENT,
  AGENCY_REDIRECT,
  AGENCY_RESOURCE,
  agency,
  allowAi,
  callAgencyTool,
  caseOf,
  connectAgency,
  documentWithText,
  enableAgencyAiTools,
  fact,
  member,
  said,
  shareWithAgency,
  traveller,
} from './agency-ai.test-support';

/**
 * S22 (ADR 0021 S22 amendment): an agency's AI connection reads only what each traveller allowed
 * that agency's AI tools to see, judged on every call against the traveller's AI grants alone.
 * Each `it` names the break that turns it red (see the known-issues entry for the proofs).
 */

const GIVEN = 'Nusrat';
const TAX_ZONE = 'Zone Nine';
const EMPLOYER = 'Harbor Shipping';
const VISA_TEXT = 'Visa vignette text: multiple entry, valid two years';
const WORK_TEXT = 'Employment letter: senior engineer since 2019';
const PASSPORT_TEXT = 'Passport scan text BX7319046';
const OTHER_GIVEN = 'Farhana';

let db: Db;
beforeEach(async () => {
  db = drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
  await enableAgencyAiTools(db);
});

/** One traveller with two cases, details in three categories and three documents with text. */
async function richTraveller(email: string, given = GIVEN) {
  const t = await traveller(db, email);
  await fact(db, t.ownerId, t.applicantId, 'given_name', given, 'universal');
  await fact(db, t.ownerId, t.applicantId, 'tax_zone', TAX_ZONE, 'business');
  await fact(db, t.ownerId, t.applicantId, 'employer_name', EMPLOYER, 'professional');
  const caseA = await caseOf(db, t.ownerId, t.applicantId, 'London Trip');
  const caseB = await caseOf(db, t.ownerId, t.applicantId, 'Paris Conference');
  const visa = await documentWithText(db, t.applicantId, 'VISA', VISA_TEXT);
  const work = await documentWithText(db, t.applicantId, 'EMPLOYMENT_CERTIFICATE', WORK_TEXT);
  const passport = await documentWithText(db, t.applicantId, 'PASSPORT', PASSPORT_TEXT);
  return { ...t, caseA, caseB, visa, work, passport };
}

/** One part of a tool's structured answer. */
function field(result: { readonly structuredContent?: object }, key: string): unknown {
  return result.structuredContent ? Reflect.get(result.structuredContent, key) : undefined;
}

async function auditOf(applicantId: string) {
  return db
    .select()
    .from(schema.auditEvents)
    .where(eq(schema.auditEvents.applicantId, applicantId));
}

describe('agency AI connections: the traveller decides (S22)', () => {
  it('reads what an AI grant shares, through one case, and records it on the traveller', async () => {
    const t = await richTraveller('t1@example.com');
    const a = await agency(db, 'owner-a@example.com', 'Harbor Visas');
    const grantId = await shareWithAgency(db, { ...t, organization: a, ai: true });
    const { token, connectionId } = await connectAgency(db, a.organizationId, a.ownerId);

    const listed = await callAgencyTool(db, token, 'list_cases', {});
    expect(listed.kind).toBe('answered');
    const cases = field(listed.result, 'cases') as { reference: string }[];
    expect(cases.map((c) => c.reference).sort()).toEqual(
      [t.caseA.reference, t.caseB.reference].sort(),
    );

    const context = await callAgencyTool(db, token, 'prepare_context', {
      case_reference: t.caseA.reference,
    });
    expect(context.result.isError).toBeUndefined();
    const text = said(context.result);
    expect(text).toContain(GIVEN);
    expect(text).toContain(TAX_ZONE);
    expect(text).toContain(EMPLOYER);
    expect(text).toContain('London Trip');

    const visaText = await callAgencyTool(db, token, 'get_document_text', {
      case_reference: t.caseA.reference,
      document_reference: t.visa.reference,
    });
    expect(said(visaText.result)).toContain(VISA_TEXT);
    // A restricted type is never read, whatever the grant says.
    const passport = await callAgencyTool(db, token, 'get_document_text', {
      case_reference: t.caseA.reference,
      document_reference: t.passport.reference,
    });
    expect(passport.result.isError).toBe(true);
    expect(said(passport.result)).not.toContain('BX7319046');

    const served = (await auditOf(t.applicantId)).filter(
      (e) => e.eventType === 'AI_CONTEXT_SERVED',
    );
    expect(served.length).toBeGreaterThanOrEqual(3);
    for (const event of served) {
      expect(event.actorAccountId).toBe(a.ownerId);
      expect(event.resourceId).toBe(connectionId);
      expect(event.metadata).toMatchObject({
        connectionKind: 'AGENCY',
        organizationId: a.organizationId,
        grantIds: [grantId],
        purpose: 'ai_connection',
      });
    }
    // Values, document text and tokens never reach the audit.
    const trail = JSON.stringify(served);
    for (const secret of [GIVEN, TAX_ZONE, VISA_TEXT, token]) expect(trail).not.toContain(secret);
  });

  it('1. a grant without AI_ASSIST gives no access [break: drop the AI_ASSIST filter]', async () => {
    const t = await richTraveller('t1@example.com');
    const a = await agency(db, 'owner-a@example.com', 'Harbor Visas');
    await shareWithAgency(db, { ...t, organization: a, ai: false });
    const { token } = await connectAgency(db, a.organizationId, a.ownerId);

    const listed = await callAgencyTool(db, token, 'list_cases', {});
    expect(field(listed.result, 'cases')).toEqual([]);
    const context = await callAgencyTool(db, token, 'prepare_context', {
      case_reference: t.caseA.reference,
    });
    expect(context.text).toBe(MESSAGES.agencyCaseNotShared);
    expect(said(context.result)).not.toContain(GIVEN);
  });

  it('2. the same-grant rule: a case-only AI grant plus a whole-record grant without it gives no profile [break: judge against every grant]', async () => {
    const t = await richTraveller('t1@example.com');
    const a = await agency(db, 'owner-a@example.com', 'Harbor Visas');
    await shareWithAgency(db, {
      ...t,
      organization: a,
      ai: true,
      missionId: t.caseA.missionId,
    });
    await shareWithAgency(db, { ...t, organization: a, ai: false });
    const { token } = await connectAgency(db, a.organizationId, a.ownerId);

    const context = await callAgencyTool(db, token, 'prepare_context', {
      case_reference: t.caseA.reference,
    });
    expect(context.result.isError).toBeUndefined();
    const text = said(context.result);
    expect(text).toContain('London Trip');
    for (const value of [GIVEN, TAX_ZONE, EMPLOYER]) expect(text).not.toContain(value);
    const documents = await callAgencyTool(db, token, 'list_documents', {
      case_reference: t.caseA.reference,
    });
    expect(field(documents.result, 'documents')).toEqual([]);
    const visa = await callAgencyTool(db, token, 'get_document_text', {
      case_reference: t.caseA.reference,
      document_reference: t.visa.reference,
    });
    expect(said(visa.result)).not.toContain(VISA_TEXT);
    // The other case is not covered by the AI grant at all.
    const other = await callAgencyTool(db, token, 'prepare_context', {
      case_reference: t.caseB.reference,
    });
    expect(other.text).toBe(MESSAGES.agencyCaseNotShared);
  });

  it('a category AI grant shares only its categories and its snapshot of documents, and never opens a case by itself', async () => {
    const t = await richTraveller('t1@example.com');
    const a = await agency(db, 'owner-a@example.com', 'Harbor Visas');
    await shareWithAgency(db, { ...t, organization: a, ai: true, categories: ['universal'] });
    const { token } = await connectAgency(db, a.organizationId, a.ownerId);
    // A category grant covers details and documents, never a case (policy law 5's other side):
    // every agency read goes through a case, so it alone reads nothing.
    const alone = await callAgencyTool(db, token, 'prepare_context', {
      case_reference: t.caseA.reference,
    });
    expect(alone.text).toBe(MESSAGES.agencyCaseNotShared);
    await shareWithAgency(db, {
      ...t,
      organization: a,
      ai: true,
      missionId: t.caseA.missionId,
    });
    const context = await callAgencyTool(db, token, 'prepare_context', {
      case_reference: t.caseA.reference,
    });
    const text = said(context.result);
    expect(text).toContain(GIVEN);
    expect(text).not.toContain(TAX_ZONE);
    expect(text).not.toContain(EMPLOYER);
    const work = await callAgencyTool(db, token, 'get_document_text', {
      case_reference: t.caseA.reference,
      document_reference: t.work.reference,
    });
    expect(said(work.result)).not.toContain(WORK_TEXT);
    const visa = await callAgencyTool(db, token, 'get_document_text', {
      case_reference: t.caseA.reference,
      document_reference: t.visa.reference,
    });
    expect(said(visa.result)).toContain(VISA_TEXT);
  });

  it('3. a per-case exception hides the case, with the same answer as an unknown one [break: drop the exception list and the visibility check]', async () => {
    const t = await richTraveller('t1@example.com');
    const a = await agency(db, 'owner-a@example.com', 'Harbor Visas');
    const grantId = await shareWithAgency(db, { ...t, organization: a, ai: true });
    await db.insert(schema.grantCaseExclusions).values({
      grantId,
      missionId: t.caseB.missionId,
      applicantId: t.applicantId,
      createdByAccountId: t.ownerId,
    });
    const { token } = await connectAgency(db, a.organizationId, a.ownerId);

    const listed = await callAgencyTool(db, token, 'list_cases', {});
    const cases = field(listed.result, 'cases') as { reference: string }[];
    expect(cases.map((c) => c.reference)).toEqual([t.caseA.reference]);
    const hidden = await callAgencyTool(db, token, 'prepare_context', {
      case_reference: t.caseB.reference,
    });
    const unknown = await callAgencyTool(db, token, 'prepare_context', {
      case_reference: `C-Z9Z9Z${referenceCheckCharacter('C', 'Z9Z9Z')}`,
    });
    expect(hidden.text).toBe(MESSAGES.agencyCaseNotShared);
    expect(hidden.result).toEqual(unknown.result);
    expect(said(hidden.result)).not.toContain('Paris Conference');
  });

  it('4. another agency never reaches this traveller, even with a guessed reference [break: drop the agency filter]', async () => {
    const t = await richTraveller('t1@example.com');
    const a = await agency(db, 'owner-a@example.com', 'Harbor Visas');
    const b = await agency(db, 'owner-b@example.com', 'Other Visas');
    await shareWithAgency(db, { ...t, organization: a, ai: true });
    // The traveller also shares with agency B, but does not let B's AI tools read.
    await shareWithAgency(db, { ...t, organization: b, ai: false });
    const onlyA = await richTraveller('t2@example.com', OTHER_GIVEN);
    await shareWithAgency(db, { ...onlyA, organization: a, ai: true });
    const { token } = await connectAgency(db, b.organizationId, b.ownerId);

    const listed = await callAgencyTool(db, token, 'list_cases', {});
    expect(field(listed.result, 'cases')).toEqual([]);
    for (const reference of [t.caseA.reference, onlyA.caseA.reference]) {
      const guessed = await callAgencyTool(db, token, 'prepare_context', {
        case_reference: reference,
      });
      expect(guessed.text).toBe(MESSAGES.agencyCaseNotShared);
      expect(said(guessed.result)).not.toContain(GIVEN);
      expect(said(guessed.result)).not.toContain(OTHER_GIVEN);
    }
  });

  it('5. revoking, pausing, expiry and turning AI tools off each stop the very next call [break: cache the AI grants]', async () => {
    const t = await richTraveller('t1@example.com');
    const a = await agency(db, 'owner-a@example.com', 'Harbor Visas');
    const grantId = await shareWithAgency(db, { ...t, organization: a, ai: true });
    const { token } = await connectAgency(db, a.organizationId, a.ownerId);
    const read = async () =>
      callAgencyTool(db, token, 'prepare_context', { case_reference: t.caseA.reference });
    const works = async () => expect(said((await read()).result)).toContain(GIVEN);
    const refused = async () => expect((await read()).text).toBe(MESSAGES.agencyCaseNotShared);

    await works();
    expect(isOk(await pauseGrant(db, { actorAccountId: t.ownerId, grantId }))).toBe(true);
    await refused();
    expect(isOk(await resumeGrant(db, { actorAccountId: t.ownerId, grantId }))).toBe(true);
    await works();
    const [row] = await db.select().from(schema.grants).where(eq(schema.grants.id, grantId));
    await db
      .update(schema.grants)
      .set({ expiryAt: new Date(Date.now() - 1000) })
      .where(eq(schema.grants.id, grantId));
    await refused();
    await db
      .update(schema.grants)
      .set({ expiryAt: row?.expiryAt ?? null })
      .where(eq(schema.grants.id, grantId));
    await works();
    await allowAi(db, t.ownerId, t.applicantId, grantId, false);
    await refused();
    await allowAi(db, t.ownerId, t.applicantId, grantId, true);
    await works();
    expect(isOk(await revokeGrant(db, { actorAccountId: t.ownerId, grantId }))).toBe(true);
    await refused();
  });

  it('6. a member who may not see the case cannot reach it: case managers cannot connect, and a demoted admin stops [break: drop the role check and the visibility check]', async () => {
    const t = await richTraveller('t1@example.com');
    const a = await agency(db, 'owner-a@example.com', 'Harbor Visas');
    await shareWithAgency(db, { ...t, organization: a, ai: true });
    const manager = await member(db, a, 'manager@example.com', 'CASE_MANAGER');
    const refusedConnect = await db.transaction((tx) =>
      createAgencyAiConnection(tx, {
        organizationId: a.organizationId,
        accountId: manager.accountId,
        client: AGENCY_CLIENT,
        duration: '30d',
        codeChallenge: 'x'.repeat(43),
        redirectUri: AGENCY_REDIRECT,
        resource: AGENCY_RESOURCE,
      }),
    );
    expect(refusedConnect).toEqual({ ok: false, error: 'agency_member_ended' });

    const admin = await member(db, a, 'admin@example.com', 'ADMIN');
    const { token } = await connectAgency(db, a.organizationId, admin.accountId);
    expect(
      said(
        (await callAgencyTool(db, token, 'prepare_context', { case_reference: t.caseA.reference }))
          .result,
      ),
    ).toContain(GIVEN);
    // Demoted to case manager, assigned to no case.
    await db
      .update(schema.memberships)
      .set({ role: 'CASE_MANAGER' })
      .where(eq(schema.memberships.id, admin.membershipId));
    const after = await callAgencyTool(db, token, 'prepare_context', {
      case_reference: t.caseA.reference,
    });
    expect(after.kind).toBe('unauthorized');
    expect(said(after.result)).not.toContain(GIVEN);
    const listed = await callAgencyTool(db, token, 'list_cases', {});
    expect(listed.kind).toBe('unauthorized');
  });

  it('7. a member turned off, the agency setting off, a suspended agency, Suspended billing or a connection past 30 days are refused', async () => {
    const t = await richTraveller('t1@example.com');
    const a = await agency(db, 'owner-a@example.com', 'Harbor Visas');
    await shareWithAgency(db, { ...t, organization: a, ai: true });
    const admin = await member(db, a, 'admin@example.com', 'ADMIN');
    const { token } = await connectAgency(db, a.organizationId, a.ownerId);
    const adminConnection = await connectAgency(db, a.organizationId, admin.accountId);
    const read = (key: string) =>
      callAgencyTool(db, key, 'prepare_context', { case_reference: t.caseA.reference });

    // The agency's own setting.
    await setOrganizationAiSetting(db, {
      organizationId: a.organizationId,
      accountId: a.ownerId,
      enabled: false,
      confirmed: false,
    });
    expect((await read(token)).text).toBe(MESSAGES.agencyOff);
    await setOrganizationAiSetting(db, {
      organizationId: a.organizationId,
      accountId: a.ownerId,
      enabled: true,
      confirmed: true,
    });
    expect(said((await read(token)).result)).toContain(GIVEN);

    // Billing Suspended pauses Agency AI Tools (decision D6).
    await db
      .insert(schema.billingAccounts)
      .values({ organizationId: a.organizationId, status: 'SUSPENDED' });
    expect((await read(token)).text).toBe(MESSAGES.agencyOff);
    await db
      .update(schema.billingAccounts)
      .set({ status: 'ACTIVE' })
      .where(eq(schema.billingAccounts.organizationId, a.organizationId));
    expect(said((await read(token)).result)).toContain(GIVEN);

    // The agency suspended.
    await db
      .update(schema.organizations)
      .set({ status: 'SUSPENDED' })
      .where(eq(schema.organizations.id, a.organizationId));
    expect((await read(token)).text).toBe(MESSAGES.agencyOff);
    await db
      .update(schema.organizations)
      .set({ status: 'ACTIVE' })
      .where(eq(schema.organizations.id, a.organizationId));

    // Agency AI Tools turned off by the platform owner.
    await db
      .update(schema.platformAiFeatureSettings)
      .set({ enabled: false })
      .where(eq(schema.platformAiFeatureSettings.featureKey, 'ai_agency_tools'));
    expect((await read(token)).text).toBe(MESSAGES.agencyOff);
    await enableAgencyAiTools(db);

    // A connection older than 30 days (decision D4).
    await db
      .update(schema.aiConnections)
      .set({ createdAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) })
      .where(eq(schema.aiConnections.id, adminConnection.connectionId));
    expect((await read(adminConnection.token)).kind).toBe('unauthorized');

    // A member turned off: refused, and their connections end.
    const fresh = await connectAgency(db, a.organizationId, admin.accountId);
    expect(said((await read(fresh.token)).result)).toContain(GIVEN);
    const off = await setMembershipActive(db, {
      actorAccountId: a.ownerId,
      organizationId: a.organizationId,
      membershipId: admin.membershipId,
      active: false,
    });
    expect(isOk(off)).toBe(true);
    expect((await read(fresh.token)).kind).toBe('unauthorized');
    const [ended] = await db
      .select({ revokedAt: schema.aiConnections.revokedAt })
      .from(schema.aiConnections)
      .where(eq(schema.aiConnections.id, fresh.connectionId));
    expect(ended?.revokedAt).not.toBeNull();
    const denied = (await auditOf(t.applicantId)).length;
    expect(denied).toBeGreaterThan(0);
  });

  it('8. a member who owns the traveller’s record never reads it through the agency [break: accept the owner actor]', async () => {
    const a = await agency(db, 'owner-a@example.com', 'Harbor Visas');
    // The agency owner's own record, shared with their own agency, AI tools allowed.
    for (const type of ['CORE_PROCESSING', 'SHARING'] as const) {
      await setConsent(db, {
        actorAccountId: a.ownerId,
        accountId: a.ownerId,
        type,
        granted: true,
      });
    }
    const created0 = await createApplicant(db, {
      actorAccountId: a.ownerId,
      ownerAccountId: a.ownerId,
      displayName: 'Agency Owner Themselves',
    });
    if (!isOk(created0)) throw new Error('applicant');
    const own = { applicantId: created0.value.id };
    await fact(db, a.ownerId, own.applicantId, 'given_name', GIVEN, 'universal');
    const ownCase = await caseOf(db, a.ownerId, own.applicantId, 'My Own Trip');
    const created = await createGrant(db, {
      actorAccountId: a.ownerId,
      applicantId: own.applicantId,
      recipientOrganizationId: a.organizationId,
      actions: ['VIEW_METADATA', 'PREVIEW'],
      purpose: 'Help with my visa',
    });
    if (!isOk(created)) throw new Error(created.error.message);
    await db
      .update(schema.grants)
      .set({ status: 'ACTIVE', acceptedAt: new Date() })
      .where(eq(schema.grants.id, created.value.id));
    await allowAi(db, a.ownerId, own.applicantId, created.value.id, true);
    const { token } = await connectAgency(db, a.organizationId, a.ownerId);

    const listed = await callAgencyTool(db, token, 'list_cases', {});
    expect(field(listed.result, 'cases')).toEqual([]);
    const read = await callAgencyTool(db, token, 'prepare_context', {
      case_reference: ownCase.reference,
    });
    expect(read.text).toBe(MESSAGES.agencyCaseNotShared);
    expect(said(read.result)).not.toContain(GIVEN);
    const denied = await db
      .select({ reason: schema.auditEvents.reason })
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'AI_CONTEXT_DENIED'));
    expect(denied.map((row) => row.reason)).toContain('agency_own_record');
  });

  it('9. an agency connection is offered no suggestion, draft, reminder or file tool, and is refused one', async () => {
    const t = await richTraveller('t1@example.com');
    const a = await agency(db, 'owner-a@example.com', 'Harbor Visas');
    await shareWithAgency(db, { ...t, organization: a, ai: true });
    const { token } = await connectAgency(db, a.organizationId, a.ownerId);
    expect(aiToolsFor('AGENCY').map((tool) => tool.name)).toEqual([
      'prepare_context',
      'list_cases',
      'list_documents',
      'get_document_text',
    ]);
    for (const tool of aiToolsFor('AGENCY')) {
      expect(tool.annotations.readOnlyHint).toBe(true);
      expect(tool.kind).toBe('agency');
    }
    for (const name of [
      'suggest_profile_update',
      'save_draft',
      'add_reminder',
      'get_document_file',
      'get_profile_section',
    ] as const) {
      const ownerTool = AI_TOOLS.find((tool) => tool.name === name);
      if (!ownerTool) throw new Error(name);
      const outcome = await runAiTool(db, ownerTool, {} as never, {
        token,
        resource: AGENCY_RESOURCE,
        admission: ADMIT,
      });
      expect(outcome.kind, name).toBe('unauthorized');
      expect(JSON.stringify(outcome.result)).not.toContain(GIVEN);
    }
    expect(await db.select().from(schema.aiDrafts)).toHaveLength(0);
  });

  it('counts Agency AI Tools for the whole agency, about 500 a day by default, and refuses past the limit', async () => {
    const t = await richTraveller('t1@example.com');
    const a = await agency(db, 'owner-a@example.com', 'Harbor Visas');
    await shareWithAgency(db, { ...t, organization: a, ai: true });
    const state = await getAiFeatureState(db, 'ai_agency_tools', {
      organization: { organizationId: a.organizationId },
    } as never);
    // A made-up context is never genuine: the calm "off" answer.
    expect(state.available).toBe(false);
    await enableAgencyAiTools(db, 2);
    const { token } = await connectAgency(db, a.organizationId, a.ownerId);
    const read = () =>
      callAgencyTool(db, token, 'prepare_context', { case_reference: t.caseA.reference });
    expect(said((await read()).result)).toContain(GIVEN);
    expect(said((await read()).result)).toContain(GIVEN);
    expect((await read()).text).toBe(MESSAGES.agencyLimit);
    const [bucket] = await db
      .select()
      .from(schema.rateLimitBuckets)
      .where(
        and(
          eq(schema.rateLimitBuckets.subjectId, a.organizationId),
          eq(schema.rateLimitBuckets.action, 'ai_feature.ai_agency_tools'),
        ),
      );
    expect(bucket?.count).toBe(2);
  });

  it('lists the agency’s connections for owners and admins only, and Turn Off stops them', async () => {
    const t = await richTraveller('t1@example.com');
    const a = await agency(db, 'owner-a@example.com', 'Harbor Visas');
    const b = await agency(db, 'owner-b@example.com', 'Other Visas');
    await shareWithAgency(db, { ...t, organization: a, ai: true });
    const manager = await member(db, a, 'manager@example.com', 'CASE_MANAGER');
    const { token, connectionId } = await connectAgency(db, a.organizationId, a.ownerId);
    const listed = await listAgencyAiConnections(db, {
      organizationId: a.organizationId,
      accountId: a.ownerId,
    });
    expect(isOk(listed) && listed.value.connections.map((c) => c.id)).toEqual([connectionId]);
    expect(
      await listAgencyAiConnections(db, {
        organizationId: a.organizationId,
        accountId: manager.accountId,
      }),
    ).toEqual({ ok: false, error: 'forbidden' });
    // Another agency's owner cannot see or end it.
    const { turnOffAgencyAiConnection } = await import('./agency-ai-connections');
    expect(
      await turnOffAgencyAiConnection(db, {
        organizationId: b.organizationId,
        accountId: b.ownerId,
        connectionId,
      }),
    ).toEqual({ ok: false, error: 'not_found' });
    expect(
      await turnOffAgencyAiConnection(db, {
        organizationId: a.organizationId,
        accountId: a.ownerId,
        connectionId,
      }),
    ).toEqual({ ok: true, value: { alreadyOff: false } });
    const after = await callAgencyTool(db, token, 'list_cases', {});
    expect(after.kind).toBe('unauthorized');
  });
});
