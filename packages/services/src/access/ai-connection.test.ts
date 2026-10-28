import { createHash, randomBytes } from 'node:crypto';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from '../accounts';
import type { AiConnectionChoices } from '../ai-connection-scopes';
import { createApplicant } from '../applicants';
import { setConsent } from '../consent';
import type { Db } from '../db';
import { createMission } from '../missions';
import { issueStepUpAssurance } from '../step-up';
import {
  AI_CODE_TTL_MS,
  createAiConnection,
  exchangeAiAuthorizationCode,
  pkceMatches,
  refreshAiTokens,
  resolveAiAccessToken,
  revokeAiToken,
} from './ai-connection';
import { accountPrincipal } from './principal';
import { requireAccess } from './require-access';
import { verifyStepUp } from './step-up-proof';

const RESOURCE = 'https://vs.example.test/mcp';
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const CLIENT = {
  clientId: 'https://claude.ai/oauth/claude-code-client-metadata',
  clientName: 'Claude',
  clientHost: 'claude.ai',
};
const CHOICES: AiConnectionChoices = {
  layers: ['identity', 'travel_documents'],
  caseMode: 'ALL_CURRENT',
  documentList: true,
  documentText: false,
  revealIdentifiers: false,
  duration: '30d',
};

let db: Db;

function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier, 'ascii').digest('base64url');
  return { verifier, challenge };
}

async function person(email = 'owner@example.com') {
  const provisioned = await provisionAccount(db, { email });
  if (!isOk(provisioned)) throw new Error('provision');
  const ownerId = provisioned.value.id;
  await setConsent(db, {
    actorAccountId: ownerId,
    accountId: ownerId,
    type: 'CORE_PROCESSING',
    granted: true,
  });
  const applicant = await createApplicant(db, {
    actorAccountId: ownerId,
    ownerAccountId: ownerId,
    displayName: 'Synthetic Traveller',
  });
  if (!isOk(applicant)) throw new Error('applicant');
  return { ownerId, applicantId: applicant.value.id };
}

async function proofFor(accountId: string, applicantId: string) {
  const proof = await requireAccess(
    db,
    accountPrincipal(accountId),
    'VIEW_METADATA',
    { applicantId },
    { purpose: 'ai_connection' },
  );
  if (!isOk(proof)) throw new Error('proof');
  return proof.value;
}

async function consent(choices: AiConnectionChoices = CHOICES, now = new Date()) {
  const { ownerId, applicantId } = await person();
  const { verifier, challenge } = pkce();
  const created = await createAiConnection(await proofFor(ownerId, applicantId), {
    client: CLIENT,
    choices,
    codeChallenge: challenge,
    redirectUri: REDIRECT,
    resource: RESOURCE,
    now,
  });
  if (!isOk(created)) throw new Error(created.error.description);
  return { ownerId, applicantId, verifier, ...created.value };
}

function exchange(
  code: string,
  verifier: string,
  extra: Partial<Parameters<typeof exchangeAiAuthorizationCode>[1]> = {},
) {
  return exchangeAiAuthorizationCode(db, {
    code,
    codeVerifier: verifier,
    clientId: CLIENT.clientId,
    redirectUri: REDIRECT,
    resource: RESOURCE,
    ...extra,
  });
}

beforeEach(async () => {
  db = drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
});

describe('PKCE', () => {
  it('accepts only S256 of the verifier, and refuses a plain-text challenge', () => {
    const { verifier, challenge } = pkce();
    expect(pkceMatches(verifier, challenge)).toBe(true);
    // "plain" would send the verifier itself as the challenge: never accepted.
    expect(pkceMatches(verifier, verifier.slice(0, 43))).toBe(false);
    expect(pkceMatches('short', challenge)).toBe(false);
  });
});

describe('AI connection tokens', () => {
  it('stores only hashes, then exchanges a code once for a token pair', async () => {
    const { code, verifier, connectionId } = await consent();
    const rows = await db.select().from(schema.aiConnectionTokens);
    expect(JSON.stringify(rows)).not.toContain(code);

    const tokens = await exchange(code, verifier);
    if (!isOk(tokens)) throw new Error(tokens.error.description);
    expect(tokens.value.token_type).toBe('Bearer');
    expect(tokens.value.expires_in).toBe(3600);
    expect(tokens.value.scope.split(' ')).toEqual([
      'visastack.identity',
      'visastack.travel_documents',
      'visastack.document_list',
      'offline_access',
    ]);
    const stored = JSON.stringify(await db.select().from(schema.aiConnectionTokens));
    expect(stored).not.toContain(tokens.value.access_token);
    expect(stored).not.toContain(tokens.value.refresh_token);
    const [connection] = await db
      .select()
      .from(schema.aiConnections)
      .where(eq(schema.aiConnections.id, connectionId));
    expect(connection?.activatedAt).not.toBeNull();

    const resolved = await resolveAiAccessToken(db, {
      token: tokens.value.access_token,
      resource: RESOURCE,
    });
    expect(resolved?.connectionId).toBe(connectionId);
  });

  it('a code works once: presenting it again also cuts off what it led to', async () => {
    const { code, verifier } = await consent();
    const first = await exchange(code, verifier);
    if (!isOk(first)) throw new Error('first');
    const again = await exchange(code, verifier);
    expect(isErr(again) && again.error.error).toBe('invalid_grant');
    expect(
      await resolveAiAccessToken(db, { token: first.value.access_token, resource: RESOURCE }),
    ).toBeNull();
  });

  it('a code dies after 60 seconds', async () => {
    const now = new Date();
    const { code, verifier } = await consent(CHOICES, now);
    const late = await exchange(code, verifier, {
      now: new Date(now.getTime() + AI_CODE_TTL_MS + 1),
    });
    expect(isErr(late) && late.error.error).toBe('invalid_grant');
  });

  it('refuses a wrong verifier, return address, app or resource, and uses the code up', async () => {
    for (const extra of [
      { codeVerifier: pkce().verifier },
      { redirectUri: 'https://claude.ai/api/mcp/other' },
      { clientId: 'https://chatgpt.com/oauth/client.json' },
      { resource: 'https://vs.example.test/other' },
    ]) {
      const { code, verifier } = await consent();
      const wrong = await exchange(code, verifier, extra);
      expect(isErr(wrong)).toBe(true);
      // The right request afterwards fails too: a code is used up by any presentation.
      expect(isErr(await exchange(code, verifier))).toBe(true);
    }
  });

  it('a wrong resource is refused with invalid_target', async () => {
    const { code, verifier } = await consent();
    const wrong = await exchange(code, verifier, { resource: 'https://evil.example/mcp' });
    expect(isErr(wrong) && wrong.error.error).toBe('invalid_target');
  });

  it('an access token works only for its own resource', async () => {
    const { code, verifier } = await consent();
    const tokens = await exchange(code, verifier);
    if (!isOk(tokens)) throw new Error('tokens');
    expect(
      await resolveAiAccessToken(db, {
        token: tokens.value.access_token,
        resource: 'https://other.example/mcp',
      }),
    ).toBeNull();
  });

  it('refresh rotates, and reusing an old refresh token cuts off the whole sign-in', async () => {
    const { code, verifier } = await consent();
    const first = await exchange(code, verifier);
    if (!isOk(first)) throw new Error('first');
    const second = await refreshAiTokens(db, {
      refreshToken: first.value.refresh_token,
      clientId: CLIENT.clientId,
      resource: RESOURCE,
    });
    if (!isOk(second)) throw new Error(second.error.description);
    expect(second.value.refresh_token).not.toBe(first.value.refresh_token);

    const reused = await refreshAiTokens(db, {
      refreshToken: first.value.refresh_token,
      clientId: CLIENT.clientId,
    });
    expect(isErr(reused) && reused.error.error).toBe('invalid_grant');
    // The newest pair is dead too.
    expect(
      await resolveAiAccessToken(db, { token: second.value.access_token, resource: RESOURCE }),
    ).toBeNull();
    const latest = await refreshAiTokens(db, {
      refreshToken: second.value.refresh_token,
      clientId: CLIENT.clientId,
    });
    expect(isErr(latest) && latest.error.error).toBe('invalid_grant');
  });

  it('refresh refuses another app', async () => {
    const { code, verifier } = await consent();
    const first = await exchange(code, verifier);
    if (!isOk(first)) throw new Error('first');
    const other = await refreshAiTokens(db, {
      refreshToken: first.value.refresh_token,
      clientId: 'https://chatgpt.com/oauth/client.json',
    });
    expect(isErr(other) && other.error.error).toBe('invalid_grant');
  });

  it('revoking works at once and never says whether a token existed', async () => {
    const { code, verifier } = await consent();
    const tokens = await exchange(code, verifier);
    if (!isOk(tokens)) throw new Error('tokens');
    expect(isOk(await revokeAiToken(db, { token: 'vsa_unknown' }))).toBe(true);
    expect(isOk(await revokeAiToken(db, { token: tokens.value.access_token }))).toBe(true);
    expect(
      await resolveAiAccessToken(db, { token: tokens.value.access_token, resource: RESOURCE }),
    ).toBeNull();
    const refreshed = await refreshAiTokens(db, {
      refreshToken: tokens.value.refresh_token,
      clientId: CLIENT.clientId,
    });
    expect(isErr(refreshed)).toBe(true);
  });

  it('turning the connection off or reaching its end stops every token', async () => {
    const now = new Date();
    const { code, verifier, connectionId } = await consent({ ...CHOICES, duration: '1h' }, now);
    const tokens = await exchange(code, verifier, { now });
    if (!isOk(tokens)) throw new Error('tokens');
    // The access token never outlives the connection.
    expect(tokens.value.expires_in).toBeLessThanOrEqual(3600);
    const later = new Date(now.getTime() + 61 * 60 * 1000);
    expect(
      await resolveAiAccessToken(db, {
        token: tokens.value.access_token,
        resource: RESOURCE,
        now: later,
      }),
    ).toBeNull();

    await db
      .update(schema.aiConnections)
      .set({ revokedAt: new Date() })
      .where(eq(schema.aiConnections.id, connectionId));
    const refreshed = await refreshAiTokens(db, {
      refreshToken: tokens.value.refresh_token,
      clientId: CLIENT.clientId,
    });
    expect(isErr(refreshed)).toBe(true);
  });

  it('only the owner of the record can connect it, and only its own case', async () => {
    const { ownerId, applicantId } = await person('first@example.com');
    const other = await person('second@example.com');
    const mission = await createMission(db, {
      actorAccountId: other.ownerId,
      applicantId: other.applicantId,
      title: 'Someone Else Case',
    });
    if (!isOk(mission)) throw new Error('mission');
    const { challenge } = pkce();
    const foreignCase = await createAiConnection(await proofFor(ownerId, applicantId), {
      client: CLIENT,
      choices: { ...CHOICES, caseMode: 'ONE', missionId: mission.value.id },
      codeChallenge: challenge,
      redirectUri: REDIRECT,
      resource: RESOURCE,
    });
    expect(isErr(foreignCase)).toBe(true);
    // A forged proof is refused.
    const forged = await createAiConnection(
      { tx: db, actor: { kind: 'applicant_owner' } } as never,
      {
        client: CLIENT,
        choices: CHOICES,
        codeChallenge: challenge,
        redirectUri: REDIRECT,
        resource: RESOURCE,
      },
    );
    expect(isErr(forged)).toBe(true);
  });

  it('audits the connection with kinds and counts only', async () => {
    const { connectionId } = await consent();
    const [event] = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'AI_CONNECTION_CREATED'));
    expect(event?.resourceId).toBe(connectionId);
    expect(Object.keys(event?.metadata ?? {}).sort()).toEqual([
      'caseMode',
      'clientHost',
      'duration',
      'layers',
      'revealIdentifiers',
    ]);
  });

  it('full document numbers need a fresh identity check for exporting this record', async () => {
    const { ownerId, applicantId } = await person();
    const { challenge } = pkce();
    const base = {
      client: CLIENT,
      choices: { ...CHOICES, revealIdentifiers: true },
      codeChallenge: challenge,
      redirectUri: REDIRECT,
      resource: RESOURCE,
    };
    const without = await createAiConnection(await proofFor(ownerId, applicantId), base);
    expect(isErr(without) && without.error.error).toBe('access_denied');

    const secret = 'synthetic-step-up-secret-for-tests-only-0123456789';
    const proofOf = (action: 'EXPORT_PROFILE' | 'SHARE', resourceId: string) => {
      const request = { accountId: ownerId, action, resourceId };
      const proof = verifyStepUp(secret, issueStepUpAssurance(secret, request), request);
      if (!proof) throw new Error('step-up');
      return proof;
    };
    // A check for another action, or another record, does not count.
    for (const stepUp of [
      proofOf('SHARE', applicantId),
      proofOf('EXPORT_PROFILE', '00000000-0000-4000-8000-000000000000'),
    ]) {
      const wrong = await createAiConnection(await proofFor(ownerId, applicantId), {
        ...base,
        stepUp,
      });
      expect(isErr(wrong)).toBe(true);
    }
    const withCheck = await createAiConnection(await proofFor(ownerId, applicantId), {
      ...base,
      stepUp: proofOf('EXPORT_PROFILE', applicantId),
    });
    expect(isOk(withCheck)).toBe(true);
  });
});
