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
  createAiConnection,
  exchangeAiAuthorizationCode,
  refreshAiTokens,
  resolveAiAccessToken,
} from './ai-connection';
import {
  AI_RECENTLY_ENDED_MS,
  type ChangeAiConnectionInput,
  changeAiConnection,
  getAiConnection,
  listAiConnections,
  turnOffAiConnection,
} from './ai-connection-manage';
import { accountPrincipal } from './principal';
import { requireAccess } from './require-access';
import { verifyStepUp } from './step-up-proof';
import { withAiConnection } from './with-ai-connection';

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
const STEP_UP_SECRET = 'synthetic-step-up-secret-for-tests-only-0123456789';
const ADMIT = async () => true;

let db: Db;

beforeEach(async () => {
  db = drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
});

async function person(email: string) {
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

function fullNumbersCheck(accountId: string, resourceId: string) {
  const request = { accountId, action: 'EXPORT_PROFILE' as const, resourceId };
  const proof = verifyStepUp(
    STEP_UP_SECRET,
    issueStepUpAssurance(STEP_UP_SECRET, request),
    request,
  );
  if (!proof) throw new Error('step-up');
  return proof;
}

/** A finished connection: approved on the consent screen, then the app exchanged its code. */
async function connected(
  ownerId: string,
  applicantId: string,
  choices: AiConnectionChoices = CHOICES,
  now = new Date(),
) {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier, 'ascii').digest('base64url');
  const created = await createAiConnection(await proofFor(ownerId, applicantId), {
    client: CLIENT,
    choices,
    codeChallenge: challenge,
    redirectUri: REDIRECT,
    resource: RESOURCE,
    ...(choices.revealIdentifiers ? { stepUp: fullNumbersCheck(ownerId, applicantId) } : {}),
    now,
  });
  if (!isOk(created)) throw new Error(created.error.description);
  const tokens = await exchangeAiAuthorizationCode(db, {
    code: created.value.code,
    codeVerifier: verifier,
    clientId: CLIENT.clientId,
    redirectUri: REDIRECT,
    resource: RESOURCE,
    now,
  });
  if (!isOk(tokens)) throw new Error(tokens.error.description);
  return {
    connectionId: created.value.connectionId,
    token: tokens.value.access_token,
    refresh: tokens.value.refresh_token,
  };
}

/** What the app gets on its next call: the granted scope, or a refusal. */
async function nextCall(token: string) {
  return withAiConnection(
    db,
    { token, resource: RESOURCE, tool: 'probe', admission: ADMIT },
    async (gateway) => gateway.scope,
    () => ({ kind: 'served', layers: [], cases: 0, values: 0, documents: 0, documentTexts: 0 }),
  );
}

function change(
  connectionId: string,
  choices: Partial<ChangeAiConnectionInput['choices']> = {},
  extra: Partial<ChangeAiConnectionInput> = {},
): ChangeAiConnectionInput {
  return { connectionId, choices: { ...CHOICES, duration: 'keep', ...choices }, ...extra };
}

describe('listing AI connections', () => {
  it('shows the owner each live connection, names a one-case connection, and hides unfinished ones', async () => {
    const { ownerId, applicantId } = await person('owner@example.com');
    const mission = await createMission(db, {
      actorAccountId: ownerId,
      applicantId,
      title: 'UK Visit',
    });
    if (!isOk(mission)) throw new Error('mission');
    const { connectionId } = await connected(ownerId, applicantId, {
      ...CHOICES,
      caseMode: 'ONE',
      missionId: mission.value.id,
    });
    // Approved but the app never finished connecting: it can read nothing, so it is not listed.
    await createAiConnection(await proofFor(ownerId, applicantId), {
      client: CLIENT,
      choices: CHOICES,
      codeChallenge: 'a'.repeat(43),
      redirectUri: REDIRECT,
      resource: RESOURCE,
    });

    const listed = await listAiConnections(await proofFor(ownerId, applicantId));
    if (!isOk(listed)) throw new Error('list');
    expect(listed.value.available).toBe(true);
    expect(listed.value.active.map((item) => item.id)).toEqual([connectionId]);
    expect(listed.value.active[0]).toMatchObject({
      clientName: 'Claude',
      clientHost: 'claude.ai',
      caseMode: 'ONE',
      caseTitle: 'UK Visit',
      revealIdentifiers: false,
      lastUsedAt: null,
      endedAt: null,
      scopes: ['identity', 'travel_documents', 'document_list'],
    });
    expect(listed.value.recentlyEnded).toEqual([]);
  });

  it('keeps a turned-off or run-out connection under recently ended for 30 days only', async () => {
    const { ownerId, applicantId } = await person('owner@example.com');
    const now = new Date();
    const off = await connected(ownerId, applicantId);
    const ranOut = await connected(ownerId, applicantId, { ...CHOICES, duration: '1h' }, now);
    await turnOffAiConnection(await proofFor(ownerId, applicantId), {
      connectionId: off.connectionId,
    });
    const later = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const listed = await listAiConnections(await proofFor(ownerId, applicantId), { now: later });
    if (!isOk(listed)) throw new Error('list');
    expect(listed.value.active).toEqual([]);
    expect(
      Object.fromEntries(listed.value.recentlyEnded.map((item) => [item.id, item.endedBy])),
    ).toEqual({ [off.connectionId]: 'owner', [ranOut.connectionId]: 'time' });

    const muchLater = new Date(now.getTime() + AI_RECENTLY_ENDED_MS + 3 * 60 * 60 * 1000);
    const old = await listAiConnections(await proofFor(ownerId, applicantId), { now: muchLater });
    expect(isOk(old) && old.value.recentlyEnded).toEqual([]);
  });

  it('refuses anyone but the owner, and never shows another record or account', async () => {
    const first = await person('first@example.com');
    const second = await person('second@example.com');
    await connected(first.ownerId, first.applicantId);

    // The gate itself refuses another person on this record.
    const foreign = await requireAccess(
      db,
      accountPrincipal(second.ownerId),
      'VIEW_METADATA',
      { applicantId: first.applicantId },
      { purpose: 'ai_connection' },
    );
    expect(isOk(foreign)).toBe(false);
    // A forged proof is refused.
    const forged = await listAiConnections({
      tx: db,
      actor: { kind: 'applicant_owner' },
    } as never);
    expect(isErr(forged) && forged.error.code).toBe('not_owner');
    // The other person's own record lists nothing of the first record.
    const theirs = await listAiConnections(await proofFor(second.ownerId, second.applicantId));
    expect(isOk(theirs) && theirs.value.active).toEqual([]);
  });
});

describe('turning a connection off', () => {
  it('ends it and every token at once: the next call, refresh and look-up are refused', async () => {
    const { ownerId, applicantId } = await person('owner@example.com');
    const { connectionId, token, refresh } = await connected(ownerId, applicantId);
    expect(isOk(await nextCall(token))).toBe(true);

    const off = await turnOffAiConnection(await proofFor(ownerId, applicantId), { connectionId });
    expect(isOk(off) && off.value.alreadyOff).toBe(false);

    expect(await nextCall(token)).toEqual({ ok: false, error: { kind: 'unauthorized' } });
    expect(await resolveAiAccessToken(db, { token, resource: RESOURCE })).toBeNull();
    expect(
      isErr(await refreshAiTokens(db, { refreshToken: refresh, clientId: CLIENT.clientId })),
    ).toBe(true);
    const tokens = await db
      .select()
      .from(schema.aiConnectionTokens)
      .where(eq(schema.aiConnectionTokens.connectionId, connectionId));
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens.every((row) => row.revokedAt !== null)).toBe(true);
    const [row] = await db
      .select()
      .from(schema.aiConnections)
      .where(eq(schema.aiConnections.id, connectionId));
    expect(row?.revokedAt).not.toBeNull();
    expect(row?.revokedReason).toBe('turned off by owner');
  });

  it('audits once with ids and kinds only; a second turn-off is a quiet success', async () => {
    const { ownerId, applicantId } = await person('owner@example.com');
    const { connectionId } = await connected(ownerId, applicantId);
    await turnOffAiConnection(await proofFor(ownerId, applicantId), { connectionId });
    const again = await turnOffAiConnection(await proofFor(ownerId, applicantId), {
      connectionId,
    });
    expect(isOk(again) && again.value.alreadyOff).toBe(true);
    const events = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'AI_CONNECTION_REVOKED'));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      resourceType: 'ai_connection',
      resourceId: connectionId,
      applicantId,
      actorAccountId: ownerId,
    });
    expect(events[0]?.metadata).toEqual({ reason: 'owner_turned_off' });
  });

  it('refuses another person, a forged proof, and a connection of another record', async () => {
    const first = await person('first@example.com');
    const second = await person('second@example.com');
    const { connectionId, token } = await connected(first.ownerId, first.applicantId);
    const fromOtherRecord = await turnOffAiConnection(
      await proofFor(second.ownerId, second.applicantId),
      { connectionId },
    );
    expect(isErr(fromOtherRecord) && fromOtherRecord.error.code).toBe('not_found');
    const forged = await turnOffAiConnection(
      { tx: db, actor: { kind: 'applicant_owner' } } as never,
      { connectionId },
    );
    expect(isErr(forged) && forged.error.code).toBe('not_owner');
    // Nothing changed: the app still reads.
    expect(isOk(await nextCall(token))).toBe(true);
  });
});

describe('changing access', () => {
  it('takes effect on the next call and is audited with kinds only', async () => {
    const { ownerId, applicantId } = await person('owner@example.com');
    const mission = await createMission(db, {
      actorAccountId: ownerId,
      applicantId,
      title: 'UK Visit',
    });
    if (!isOk(mission)) throw new Error('mission');
    const { connectionId, token } = await connected(ownerId, applicantId);
    const before = await nextCall(token);
    expect(isOk(before) && before.value.layers).toEqual(['identity', 'travel_documents']);

    const changed = await changeAiConnection(
      await proofFor(ownerId, applicantId),
      change(connectionId, {
        layers: ['money'],
        caseMode: 'ONE',
        missionId: mission.value.id,
        documentList: false,
        documentText: true,
      }),
    );
    expect(isOk(changed)).toBe(true);
    const after = await nextCall(token);
    if (!isOk(after)) throw new Error('call');
    expect(after.value).toMatchObject({
      layers: ['money'],
      caseMode: 'ONE',
      documentList: false,
      documentText: true,
      documentTextGroups: ['financial'],
      revealIdentifiers: false,
    });
    const [event] = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'AI_CONNECTION_CHANGED'));
    expect(event).toMatchObject({ resourceId: connectionId, missionId: mission.value.id });
    expect(event?.metadata).toEqual({
      layers: ['money', 'document_text'],
      caseMode: 'ONE',
      revealIdentifiers: false,
      duration: 'keep',
    });
  });

  it('keeps the end, or counts a new one from the change, which can shorten it at once', async () => {
    const { ownerId, applicantId } = await person('owner@example.com');
    const start = new Date();
    const { connectionId, token } = await connected(ownerId, applicantId, CHOICES, start);
    const kept = await changeAiConnection(
      await proofFor(ownerId, applicantId),
      change(connectionId),
    );
    expect(isOk(kept) && kept.value.expiresAt?.getTime()).toBe(
      start.getTime() + 30 * 24 * 60 * 60 * 1000,
    );
    const changedAt = new Date();
    const shorter = await changeAiConnection(
      await proofFor(ownerId, applicantId),
      change(connectionId, {}, { now: changedAt, choices: { ...CHOICES, duration: '1h' } }),
    );
    expect(isOk(shorter) && shorter.value.expiresAt?.getTime()).toBe(
      changedAt.getTime() + 60 * 60 * 1000,
    );
    const pastNewEnd = new Date(changedAt.getTime() + 61 * 60 * 1000);
    expect(
      await resolveAiAccessToken(db, { token, resource: RESOURCE, now: pastNewEnd }),
    ).toBeNull();
    const untilOff = await changeAiConnection(
      await proofFor(ownerId, applicantId),
      change(connectionId, { duration: 'until_off' }),
    );
    expect(isOk(untilOff) && untilOff.value.expiresAt).toBeNull();
  });

  it('turning Full Document Numbers on needs a fresh identity check for exporting this record', async () => {
    const { ownerId, applicantId } = await person('owner@example.com');
    const { connectionId, token } = await connected(ownerId, applicantId);
    const proof = () => proofFor(ownerId, applicantId);
    const without = await changeAiConnection(
      await proof(),
      change(connectionId, { revealIdentifiers: true }),
    );
    expect(isErr(without) && without.error.code).toBe('step_up_required');
    const otherRecord = await changeAiConnection(
      await proof(),
      change(
        connectionId,
        { revealIdentifiers: true },
        { stepUp: fullNumbersCheck(ownerId, '00000000-0000-4000-8000-000000000000') },
      ),
    );
    expect(isErr(otherRecord) && otherRecord.error.code).toBe('step_up_required');
    const stillMasked = await nextCall(token);
    expect(isOk(stillMasked) && stillMasked.value.revealIdentifiers).toBe(false);

    const withCheck = await changeAiConnection(
      await proof(),
      change(
        connectionId,
        { revealIdentifiers: true },
        { stepUp: fullNumbersCheck(ownerId, applicantId) },
      ),
    );
    expect(isOk(withCheck)).toBe(true);
    const revealed = await nextCall(token);
    expect(isOk(revealed) && revealed.value.revealIdentifiers).toBe(true);
    // Keeping it on needs no new check; turning it off never does.
    expect(
      isOk(
        await changeAiConnection(
          await proof(),
          change(connectionId, { revealIdentifiers: true, layers: ['identity'] }),
        ),
      ),
    ).toBe(true);
    expect(isOk(await changeAiConnection(await proof(), change(connectionId)))).toBe(true);
    const masked = await nextCall(token);
    expect(isOk(masked) && masked.value.revealIdentifiers).toBe(false);
  });

  it('refuses another person, a case of another record, and an ended connection', async () => {
    const first = await person('first@example.com');
    const second = await person('second@example.com');
    const theirCase = await createMission(db, {
      actorAccountId: second.ownerId,
      applicantId: second.applicantId,
      title: 'Someone Else Case',
    });
    if (!isOk(theirCase)) throw new Error('mission');
    const { connectionId } = await connected(first.ownerId, first.applicantId);

    const fromOtherRecord = await changeAiConnection(
      await proofFor(second.ownerId, second.applicantId),
      change(connectionId, { layers: ['health'] }),
    );
    expect(isErr(fromOtherRecord) && fromOtherRecord.error.code).toBe('not_found');
    const forged = await changeAiConnection(
      { tx: db, actor: { kind: 'applicant_owner' } } as never,
      change(connectionId),
    );
    expect(isErr(forged) && forged.error.code).toBe('not_owner');
    const foreignCase = await changeAiConnection(
      await proofFor(first.ownerId, first.applicantId),
      change(connectionId, { caseMode: 'ONE', missionId: theirCase.value.id }),
    );
    expect(isErr(foreignCase) && foreignCase.error.code).toBe('case_not_on_record');

    await turnOffAiConnection(await proofFor(first.ownerId, first.applicantId), { connectionId });
    const ended = await changeAiConnection(
      await proofFor(first.ownerId, first.applicantId),
      change(connectionId, { duration: 'until_off' }),
    );
    expect(isErr(ended) && ended.error.code).toBe('ended');
    const read = await getAiConnection(
      await proofFor(first.ownerId, first.applicantId),
      connectionId,
    );
    expect(isErr(read) && read.error.code).toBe('ended');
    const [row] = await db
      .select()
      .from(schema.aiConnections)
      .where(eq(schema.aiConnections.id, connectionId));
    expect(row?.scopes).toEqual(['identity', 'travel_documents', 'document_list']);
  });
});
