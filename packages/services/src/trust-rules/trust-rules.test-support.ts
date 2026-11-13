import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { isOk } from '@visastack/core';
import { fieldPolicyOf } from '@visastack/core/catalogue';
import { schema } from '@visastack/db';
import { and, eq } from 'drizzle-orm';
import { accountPrincipal, requireAccess } from '../access';
import type { AuthorizedApplicant } from '../access';
import { createAiConnection, exchangeAiAuthorizationCode } from '../access/ai-connection';
import { provisionAccount } from '../accounts';
import { AI_TOOLS, runAiTool } from '../ai-tools';
import type { Db } from '../db';
import { readDocumentAccessToken } from '../document-access-token';
import type { DocumentAccessTokenFields } from '../document-access-token';
import { downloadEvidenceSubmissionFile } from '../evidence-submissions';
import {
  ACCESS_TOKEN_SECRET,
  type Agency,
  FakeStorage,
  type Traveller,
  agency,
  agencyProof,
  freshDb,
  share,
  stepUpFor,
  traveller,
} from '../evidence-submissions.test-support';
import { addMembership } from '../organizations';
import { registerFieldDefinition } from '../profile';

/**
 * Shared set-up for the executable trust rules. Everything here drives the real services on a
 * migrated in-memory database; the only stand-in is the file store, which records every call and
 * reaches no network. People and agencies are clearly synthetic.
 */

export const TRAVELLER_EMAIL = 'test-rahim-synthetic@example.test';
export const OTHER_TRAVELLER_EMAIL = 'test-karim-synthetic@example.test';
export const NORTH_NAME = 'TEST Agency North';
export const UNRELATED_NAME = 'TEST Agency Unrelated';

export interface TrustWorld {
  readonly db: Db;
  readonly storage: FakeStorage;
  /** The traveller whose records are asked about. */
  readonly rahim: Traveller;
  /** A second traveller who is not the owner of Rahim's records. */
  readonly karim: Traveller;
  /** The agency that holds a live grant on Rahim. */
  readonly north: Agency;
  /** An agency with no grant of any kind on Rahim. */
  readonly unrelated: Agency;
  /** North's grant on Rahim. */
  readonly northGrantId: string;
}

export async function trustWorld(): Promise<TrustWorld> {
  const db = await freshDb();
  const rahim = await traveller(db, TRAVELLER_EMAIL);
  const karim = await traveller(db, OTHER_TRAVELLER_EMAIL);
  const north = await agency(db, 'test-north-owner@example.test', NORTH_NAME);
  const unrelated = await agency(db, 'test-unrelated-owner@example.test', UNRELATED_NAME);
  const northGrantId = await share(db, rahim, north);
  return { db, storage: new FakeStorage(), rahim, karim, north, unrelated, northGrantId };
}

/** A second active admin of an agency, so one can be removed without the last-owner rule. */
export interface AgencyAdmin extends Agency {
  readonly membershipId: string;
}

export async function addAdmin(db: Db, a: Agency, email: string): Promise<AgencyAdmin> {
  const account = await provisionAccount(db, { email });
  if (!isOk(account)) throw new Error('provision admin');
  const membership = await addMembership(db, {
    actorAccountId: a.accountId,
    organizationId: a.organizationId,
    accountId: account.value.id,
    role: 'ADMIN',
  });
  if (!isOk(membership)) throw new Error(`add admin: ${membership.error.message}`);
  return {
    accountId: account.value.id,
    organizationId: a.organizationId,
    membershipId: membership.value.id,
  };
}

export type SubmissionRow = typeof schema.evidenceRequestSubmissions.$inferSelect;

export async function submissionsOf(db: Db, requestId: string): Promise<SubmissionRow[]> {
  const rows = await db
    .select()
    .from(schema.evidenceRequestSubmissions)
    .where(eq(schema.evidenceRequestSubmissions.evidenceRequestId, requestId));
  return rows.sort((a, b) => a.roundNo - b.roundNo);
}

export async function allSubmissions(db: Db): Promise<SubmissionRow[]> {
  const rows = await db.select().from(schema.evidenceRequestSubmissions);
  return rows.sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime() || (a.id < b.id ? -1 : 1));
}

export async function requestRow(db: Db, requestId: string) {
  const [row] = await db
    .select()
    .from(schema.evidenceRequests)
    .where(eq(schema.evidenceRequests.id, requestId));
  if (!row) throw new Error('request row missing');
  return row;
}

export async function decisionRows(db: Db, requestId: string) {
  return db
    .select()
    .from(schema.evidenceRequestDecisions)
    .where(eq(schema.evidenceRequestDecisions.evidenceRequestId, requestId));
}

/** Notices queued for the agency about one request (both channels, every admin). */
export async function agencyNoticesFor(db: Db, requestId: string) {
  return db
    .select()
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.resourceId, requestId),
        eq(schema.notifications.eventType, 'EVIDENCE_RESPONSE_RECEIVED'),
      ),
    );
}

export async function auditCount(db: Db, eventType: string, resourceId: string): Promise<number> {
  const rows = await db
    .select({ seq: schema.auditEvents.seq })
    .from(schema.auditEvents)
    .where(
      and(
        eq(schema.auditEvents.eventType, eventType),
        eq(schema.auditEvents.resourceId, resourceId),
      ),
    );
  return rows.length;
}

/** A recent identity confirmation plus the download call, with a proof the caller made earlier. */
export function downloadWith(
  storage: FakeStorage,
  proof: AuthorizedApplicant<'MANAGE'>,
  a: { readonly accountId: string },
  submission: { readonly id: string; readonly documentVersionId: string },
) {
  return downloadEvidenceSubmissionFile(storage, proof, {
    submissionId: submission.id,
    accessTokenSecret: ACCESS_TOKEN_SECRET,
    stepUp: stepUpFor(a.accountId, submission.documentVersionId),
  });
}

/** Download through a fresh proof (the agency still holds access). */
export async function downloadFresh(
  w: Pick<TrustWorld, 'db' | 'storage' | 'rahim'>,
  a: Agency,
  submission: { readonly id: string; readonly documentVersionId: string },
) {
  return downloadWith(w.storage, await agencyProof(w.db, a, w.rahim.applicantId), a, submission);
}

export function fieldsOfLink(url: string): DocumentAccessTokenFields {
  const fields = readDocumentAccessToken(new URL(url).searchParams);
  if (!fields) throw new Error('no access token on the link');
  return fields;
}

/** An owner's proof for reading metadata (needed by the profile history). */
export async function ownerMetaProof(
  db: Db,
  t: Traveller,
): Promise<AuthorizedApplicant<'VIEW_METADATA'>> {
  const proof = await requireAccess(
    db,
    accountPrincipal(t.accountId),
    'VIEW_METADATA',
    { applicantId: t.applicantId },
    { purpose: 'owner_profile_history' },
  );
  if (!isOk(proof)) throw new Error('owner proof');
  return proof.value;
}

export function randomId(): string {
  return randomUUID();
}

/** A retry key of the shape the page makes up. */
export function retryKey(label: string): string {
  return `retry-${label}-${randomBytes(6).toString('hex')}`;
}

// ---------------------------------------------------------------------------------------------
// An AI app suggesting a detail, the way the product does it: a connection the person made, then
// the connector's own suggestion tool. Nothing here writes a fact.

const RESOURCE = 'https://vs.example.test/mcp';
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const CLAUDE = {
  clientId: 'https://claude.ai/oauth/claude-code-client-metadata',
  clientName: 'Claude',
  clientHost: 'claude.ai',
};
const keys = {
  currentKeyVersion: () => 'test-v1',
  async generateDataKey() {
    return {
      keyVersion: 'test-v1',
      plaintextDataKey: randomBytes(32),
      wrappedDataKey: Buffer.alloc(32, 7),
    };
  },
  async unwrapDataKey() {
    return Buffer.alloc(32, 7);
  },
};

/** The platform owner's switch for AI App Suggestions, as the AI Features page saves it. */
export async function turnOnAiAppSuggestions(db: Db): Promise<void> {
  await db
    .insert(schema.platformAiFeatureSettings)
    .values({ featureKey: 'ai_app_suggestions', enabled: true, dailyLimit: null })
    .onConflictDoUpdate({
      target: schema.platformAiFeatureSettings.featureKey,
      set: { enabled: true, dailyLimit: null },
    });
}

export interface SuggestionApp {
  readonly suggest: (field: string, value: string, reason: string) => Promise<void>;
}

/** The person connects their own AI app with "Suggest Changes" on, and the app can then suggest. */
export async function connectSuggestionApp(db: Db, t: Traveller): Promise<SuggestionApp> {
  await turnOnAiAppSuggestions(db);
  const proof = await requireAccess(
    db,
    accountPrincipal(t.accountId),
    'VIEW_METADATA',
    { applicantId: t.applicantId },
    { purpose: 'ai_connection' },
  );
  if (!isOk(proof)) throw new Error('ai proof');
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier, 'ascii').digest('base64url');
  const created = await createAiConnection(proof.value, {
    client: CLAUDE,
    choices: {
      layers: ['identity', 'travel_documents'],
      caseMode: 'ALL_CURRENT',
      documentList: true,
      documentText: false,
      revealIdentifiers: false,
      duration: '30d',
      suggestChanges: true,
    },
    codeChallenge: challenge,
    redirectUri: REDIRECT,
    resource: RESOURCE,
  });
  if (!isOk(created)) throw new Error(created.error.description);
  const tokens = await exchangeAiAuthorizationCode(db, {
    code: created.value.code,
    codeVerifier: verifier,
    clientId: CLAUDE.clientId,
    redirectUri: REDIRECT,
    resource: RESOURCE,
  });
  if (!isOk(tokens)) throw new Error(tokens.error.description);
  const token = tokens.value.access_token;
  const tool = AI_TOOLS.find((x) => x.name === 'suggest_profile_update');
  if (!tool) throw new Error('suggestion tool missing');
  return {
    async suggest(field, value, reason) {
      const outcome = await runAiTool(
        db,
        tool,
        { section: 'identity', field, value, reason } as never,
        {
          token,
          resource: RESOURCE,
          admission: async () => true,
          encryption: keys,
          now: new Date(),
        },
      );
      if (outcome.kind !== 'answered' || outcome.result.isError) {
        throw new Error(`suggestion refused: ${JSON.stringify(outcome.result.content)}`);
      }
    },
  };
}

/** Make sure a catalogue detail is registered, as saving it by hand would. */
export async function registerCatalogueField(db: Db, fieldKey: string): Promise<void> {
  const policy = fieldPolicyOf(fieldKey);
  if (!policy) throw new Error(`unknown field ${fieldKey}`);
  await registerFieldDefinition(db, {
    key: fieldKey,
    dataType: 'text',
    sensitivity: policy.sensitivity,
    repeating: policy.group !== undefined,
  });
}

// ---------------------------------------------------------------------------------------------
// A tiny seeded generator (mulberry32), so a failing sequence can be replayed from its seed.

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
