import { createHash, randomBytes } from 'node:crypto';
import { type PermissionAction, isOk } from '@visastack/core';
import { fieldPolicyOf } from '@visastack/core/catalogue';
import { schema } from '@visastack/db';
import { eq } from 'drizzle-orm';
import { provisionAccount } from '../accounts';
import { AGENCY_AI_TOOLS } from '../ai-tools/agency-tools';
import { type AiToolResult, runAiTool } from '../ai-tools/index';
import { createApplicant } from '../applicants';
import { setConsent } from '../consent';
import type { Db } from '../db';
import { setGrantAiAssist } from '../grant-ai-assist';
import { createMission } from '../missions';
import { setOrganizationAiSetting } from '../organization-ai-settings';
import { addMembership, createOrganization, reviewOrganization } from '../organizations';
import { editFact, registerFieldDefinition } from '../profile';
import { requiresProtection } from '../protected-fields';
import { assignReferenceCode, referenceCodesFor } from '../reference-codes';
import { acceptGrant, createGrant } from '../sharing';
import { issueStepUpAssurance } from '../step-up';
import { createAgencyAiConnection } from './agency-ai-connections';
import { exchangeAiAuthorizationCode } from './ai-connection';
import { accountPrincipal } from './principal';
import { requireAccess } from './require-access';
import { verifyStepUp } from './step-up-proof';

/**
 * Shared fixtures for the agency AI connector tests (S22): synthetic travellers, agencies, grants
 * with and without `AI_ASSIST`, and agency connections, built through the real services.
 */

export const AGENCY_RESOURCE = 'https://vs.example.test/mcp';
export const AGENCY_REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
export const AGENCY_CLIENT = {
  clientId: 'https://claude.ai/oauth/claude-code-client-metadata',
  clientName: 'Claude',
  clientHost: 'claude.ai',
};
const STEP_UP_SECRET = 'agency-ai-test-step-up-secret';
export const ADMIT = async () => true;

/** Turns Agency AI Tools on for the platform (the platform owner's switch). */
export async function enableAgencyAiTools(db: Db, dailyLimit: number | null = null) {
  await db
    .insert(schema.platformAiFeatureSettings)
    .values({ featureKey: 'ai_agency_tools', enabled: true, dailyLimit })
    .onConflictDoUpdate({
      target: schema.platformAiFeatureSettings.featureKey,
      set: { enabled: true, dailyLimit },
    });
}

export async function traveller(db: Db, email: string) {
  const provisioned = await provisionAccount(db, { email });
  if (!isOk(provisioned)) throw new Error('provision');
  const ownerId = provisioned.value.id;
  for (const type of ['CORE_PROCESSING', 'SHARING'] as const) {
    await setConsent(db, { actorAccountId: ownerId, accountId: ownerId, type, granted: true });
  }
  const applicant = await createApplicant(db, {
    actorAccountId: ownerId,
    ownerAccountId: ownerId,
    displayName: `Traveller ${email}`,
  });
  if (!isOk(applicant)) throw new Error('applicant');
  return { ownerId, applicantId: applicant.value.id };
}

export async function fact(
  db: Db,
  ownerId: string,
  applicantId: string,
  fieldKey: string,
  value: string,
  packId: string,
) {
  const policy = fieldPolicyOf(fieldKey);
  if (!policy || requiresProtection(policy.sensitivity))
    throw new Error(`use a plain field: ${fieldKey}`);
  await registerFieldDefinition(db, {
    key: fieldKey,
    dataType: 'text',
    sensitivity: policy.sensitivity,
    packId,
  });
  const edited = await editFact(db, { actorAccountId: ownerId, applicantId, fieldKey, value });
  if (!isOk(edited)) throw new Error(`fact ${fieldKey}`);
}

/** A clean document with read text; returns its id and visible reference. */
export async function documentWithText(db: Db, applicantId: string, docType: string, text: string) {
  const [storage] = await db
    .insert(schema.storageObjects)
    .values({ bucket: 'CLEAN', objectKey: `clean/${randomBytes(6).toString('hex')}` })
    .returning({ id: schema.storageObjects.id });
  if (!storage) throw new Error('storage');
  const [doc] = await db
    .insert(schema.documents)
    .values({ applicantId, originalName: 'scan.pdf', docType })
    .returning({ id: schema.documents.id });
  if (!doc) throw new Error('document');
  await assignReferenceCode(db, 'D', doc.id);
  const [version] = await db
    .insert(schema.documentVersions)
    .values({
      documentId: doc.id,
      storageObjectId: storage.id,
      processingStatus: 'APPROVED',
      safetyStatus: 'CLEAN',
    })
    .returning({ id: schema.documentVersions.id });
  if (!version) throw new Error('version');
  await db.insert(schema.ocrRuns).values({
    documentVersionId: version.id,
    applicantId,
    status: 'SUCCEEDED',
    provider: 'test',
    modelVersion: 'm',
    promptVersion: 'p',
    extractedText: text,
  });
  const reference = (await referenceCodesFor(db, 'D', [doc.id])).get(doc.id);
  if (!reference) throw new Error('document code');
  return { documentId: doc.id, reference };
}

export async function caseOf(db: Db, ownerId: string, applicantId: string, title: string) {
  const mission = await createMission(db, {
    actorAccountId: ownerId,
    applicantId,
    title,
    destination: 'United Kingdom',
    purpose: 'Visit family',
    travelStartDate: new Date('2026-12-01T00:00:00Z'),
  });
  if (!isOk(mission)) throw new Error('mission');
  const reference = (await referenceCodesFor(db, 'C', [mission.value.id])).get(mission.value.id);
  if (!reference) throw new Error('case code');
  return { missionId: mission.value.id, reference };
}

/** An ACTIVE agency with its creator as OWNER, its AI setting on (unless told otherwise). */
export async function agency(db: Db, email: string, name: string, settingOn = true) {
  const owner = await provisionAccount(db, { email });
  if (!isOk(owner)) throw new Error('provision');
  const org = await createOrganization(db, { actorAccountId: owner.value.id, name });
  if (!isOk(org)) throw new Error('org');
  const reviewer = await provisionAccount(db, {
    email: `reviewer-${org.value.id}@platform.example.com`,
  });
  if (!isOk(reviewer)) throw new Error('reviewer');
  const reviewed = await reviewOrganization(db, {
    reviewerAccountId: reviewer.value.id,
    organizationId: org.value.id,
    decision: 'ACTIVE',
    stepUpSatisfied: true,
  });
  if (!isOk(reviewed)) throw new Error('review');
  if (settingOn) {
    const set = await setOrganizationAiSetting(db, {
      organizationId: org.value.id,
      accountId: owner.value.id,
      enabled: true,
      confirmed: true,
    });
    if (!isOk(set)) throw new Error('setting');
  }
  return { ownerId: owner.value.id, organizationId: org.value.id };
}

export async function member(
  db: Db,
  organization: { ownerId: string; organizationId: string },
  email: string,
  role: 'ADMIN' | 'CASE_MANAGER' | 'REVIEWER',
) {
  const account = await provisionAccount(db, { email });
  if (!isOk(account)) throw new Error('provision');
  const added = await addMembership(db, {
    actorAccountId: organization.ownerId,
    organizationId: organization.organizationId,
    accountId: account.value.id,
    role,
  });
  if (!isOk(added)) throw new Error('membership');
  return { accountId: account.value.id, membershipId: added.value.id };
}

/** An accepted grant to the agency; with `ai`, the traveller then turns AI tools on for it. */
export async function shareWithAgency(
  db: Db,
  input: {
    readonly ownerId: string;
    readonly applicantId: string;
    readonly organization: { ownerId: string; organizationId: string };
    readonly ai: boolean;
    readonly actions?: readonly PermissionAction[];
    readonly missionId?: string;
    readonly categories?: readonly string[];
    readonly recipientAccountId?: string;
  },
) {
  const created = await createGrant(db, {
    actorAccountId: input.ownerId,
    applicantId: input.applicantId,
    recipientOrganizationId: input.organization.organizationId,
    actions: input.actions ?? ['VIEW_METADATA', 'PREVIEW', 'COMMENT'],
    purpose: 'Help with my visa',
    ...(input.missionId ? { missionId: input.missionId } : {}),
    ...(input.categories ? { categories: input.categories } : {}),
  });
  if (!isOk(created)) throw new Error(`grant: ${created.error.message}`);
  if (input.recipientAccountId) {
    await db
      .update(schema.grants)
      .set({ recipientAccountId: input.recipientAccountId })
      .where(eq(schema.grants.id, created.value.id));
  }
  const accepted = await acceptGrant(db, {
    actorAccountId: input.organization.ownerId,
    grantId: created.value.id,
  });
  if (!isOk(accepted)) throw new Error(`accept: ${accepted.error.message}`);
  if (input.ai) await allowAi(db, input.ownerId, input.applicantId, created.value.id, true);
  return created.value.id;
}

/** The traveller's own choice on a grant, with the fresh identity check turning it on needs. */
export async function allowAi(
  db: Db,
  ownerId: string,
  applicantId: string,
  grantId: string,
  allow: boolean,
) {
  const proof = await requireAccess(
    db,
    accountPrincipal(ownerId),
    'VIEW_METADATA',
    { applicantId },
    { purpose: 'owner_sharing' },
  );
  if (!isOk(proof)) throw new Error('owner proof');
  const request = { accountId: ownerId, action: 'SHARE' as const, resourceId: applicantId };
  const stepUp = verifyStepUp(
    STEP_UP_SECRET,
    issueStepUpAssurance(STEP_UP_SECRET, request),
    request,
  );
  const changed = await setGrantAiAssist(proof.value, {
    grantId,
    allow,
    ...(stepUp ? { stepUp } : {}),
  });
  if (!isOk(changed)) throw new Error(`ai assist: ${changed.error}`);
}

/** The agency consent screen approved and the code exchanged: an access token. */
export async function connectAgency(
  db: Db,
  organizationId: string,
  accountId: string,
): Promise<{ token: string; connectionId: string }> {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier, 'ascii').digest('base64url');
  const created = await db.transaction((tx) =>
    createAgencyAiConnection(tx, {
      organizationId,
      accountId,
      client: AGENCY_CLIENT,
      duration: '30d',
      codeChallenge: challenge,
      redirectUri: AGENCY_REDIRECT,
      resource: AGENCY_RESOURCE,
    }),
  );
  if (!isOk(created)) throw new Error(`agency connection: ${created.error}`);
  const tokens = await exchangeAiAuthorizationCode(db, {
    code: created.value.code,
    codeVerifier: verifier,
    clientId: AGENCY_CLIENT.clientId,
    redirectUri: AGENCY_REDIRECT,
    resource: AGENCY_RESOURCE,
  });
  if (!isOk(tokens)) throw new Error(tokens.error.description);
  return { token: tokens.value.access_token, connectionId: created.value.connectionId };
}

type AgencyToolName = (typeof AGENCY_AI_TOOLS)[number]['name'];

/** One agency tool call through the real gate; the outcome kind and the result. */
export async function callAgencyTool(
  db: Db,
  token: string,
  name: AgencyToolName,
  input: Record<string, unknown>,
): Promise<{ kind: string; result: AiToolResult; text: string }> {
  const tool = AGENCY_AI_TOOLS.find((item) => item.name === name);
  if (!tool) throw new Error(name);
  const outcome = await runAiTool(db, tool, input as never, {
    token,
    resource: AGENCY_RESOURCE,
    admission: ADMIT,
  });
  if (outcome.kind === 'failed') throw outcome.error;
  const first = outcome.result.content[0];
  return {
    kind: outcome.kind,
    result: outcome.result,
    text: first?.type === 'text' ? first.text : '',
  };
}

/** Everything an answer said, as one string, to look for values that must never appear. */
export function said(result: AiToolResult): string {
  return JSON.stringify(result);
}
