import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import {
  COMPANION_NOT_SWITCHED_ON,
  type Db,
  TRIP_COMPANIONS_SWITCH,
  createApplicant,
  provisionAccount,
  setConsent,
} from '@visastack/services';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { caseCountryOptions, casePurposeGroups } from '../../../lib/case-choices';

/**
 * Add Someone Else in the trip forms, and Remove and Send Again on the trip page, against a real
 * database. Whatever the actions send back to the browser carries only plain words: never an
 * address, a link or a token. A refused try makes nobody, and the service's own words come through.
 */

const state = vi.hoisted(() => ({ db: undefined as unknown, accountId: '' }));
/** The raw links the service handed to the actions, so a test can prove none ever left them. */
const handedOver = vi.hoisted(() => ({ tokens: [] as string[] }));
/** The mail side: which records the sender was asked to send, and what to break on purpose. */
const mail = vi.hoisted(() => ({
  sentFor: [] as string[],
  noKeyService: false,
  sendThrows: false,
  background: [] as Promise<unknown>[],
}));

vi.mock('../../../lib/session', () => ({
  withSession: async (fn: (ctx: { db: unknown; accountId: string }) => unknown) =>
    fn({ db: state.db, accountId: state.accountId }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
// Work queued for after the response runs at once here, and is awaited by the tests that care.
vi.mock('next/server', () => ({
  after: (work: () => Promise<unknown>) => {
    mail.background.push(work());
  },
}));
vi.mock('../../../lib/send-now', () => ({
  sendEmailNow: async (resourceId: string) => {
    mail.sentFor.push(resourceId);
    if (mail.sendThrows) throw new Error('the mail provider is down');
    return 'sent';
  },
}));
// A key service that only this test knows (the real one needs settings).
vi.mock('../../../lib/providers', async () => {
  const { randomBytes, randomUUID } = await import('node:crypto');
  const wrapped = new Map<string, Uint8Array>();
  const port = {
    currentKeyVersion: () => 'test-v1',
    async generateDataKey() {
      const id = randomUUID();
      const key = randomBytes(32);
      wrapped.set(id, key);
      return { keyVersion: 'test-v1', plaintextDataKey: key, wrappedDataKey: Buffer.from(id) };
    },
    async unwrapDataKey(_version: string, data: Uint8Array) {
      const key = wrapped.get(Buffer.from(data).toString());
      if (!key) throw new Error('unknown key');
      return key;
    },
  };
  return { createKeyManagementPort: () => (mail.noKeyService ? undefined : port) };
});
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
  unstable_rethrow: (error: unknown) => {
    if (error instanceof Error && error.message.startsWith('NEXT_REDIRECT')) throw error;
  },
}));
vi.mock('@visastack/services', async (importOriginal) => {
  const real = await importOriginal<typeof import('@visastack/services')>();
  return {
    ...real,
    addCompanion: async (...args: Parameters<typeof real.addCompanion>) => {
      const added = await real.addCompanion(...args);
      if (added.ok && added.value.invitation)
        handedOver.tokens.push(added.value.invitation.rawToken);
      return added;
    },
    resendInvitation: async (...args: Parameters<typeof real.resendInvitation>) => {
      const again = await real.resendInvitation(...args);
      if (again.ok && again.value.invitation)
        handedOver.tokens.push(again.value.invitation.rawToken);
      return again;
    },
  };
});

const {
  addTravellersAction,
  removeCompanionAction,
  removeTravellerAction,
  resendCompanionAction,
  startGroupTripAction,
} = await import('./actions');

const INITIAL = { ok: true, message: '' };
const FRIEND = 'friend@example.com';
const RATE_LIMITED = 'Too many invitations in a short time. Please try again later.';
let db: Db;
let selfId: string;
let previousSwitch: string | undefined;
/** Everything an action said back, to check no address, link or token is in any of it. */
let said: unknown[] = [];

const form = (entries: readonly (readonly [string, string])[]) => {
  const data = new FormData();
  for (const [k, v] of entries) data.append(k, v);
  return data;
};
const where = [
  ['destination', caseCountryOptions()[0]?.iso2 ?? ''],
  ['purpose', casePurposeGroups()[0]?.options[0]?.key ?? ''],
] as const;
const someone = (name: string, email?: string) =>
  [
    ['newPersonName', name],
    ...(email === undefined ? [] : [['newPersonEmail', email] as const]),
  ] as const;
const redirectTo = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    const result = await run();
    said.push(result);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('NEXT_REDIRECT')) {
      const to = error.message.replace('NEXT_REDIRECT ', '');
      said.push(to);
      return to;
    }
    throw error;
  }
  throw new Error('no redirect');
};
const answer = async <T>(run: () => Promise<T>): Promise<T> => {
  const result = await run();
  said.push(result);
  return result;
};
const startTrip = async () => {
  const to = await redirectTo(() =>
    startGroupTripAction(INITIAL, form([...where, ['traveller', selfId]])),
  );
  return to.split('/').pop() ?? '';
};
const companions = () => db.select().from(schema.umpeTripCompanions);
const outbox = () => db.select().from(schema.notifications);
const queuedFor = async () =>
  (await outbox()).filter((n) => n.eventType === 'TRIP_COMPANION_INVITATION_CREATED');
const applicants = () => db.select().from(schema.applicants);
const trips = () => db.select().from(schema.umpeTrips);

async function otherOrganiserWithTrip(): Promise<string> {
  const other = await provisionAccount(db, { email: 'other@example.com' });
  if (!other.ok) throw new Error('account');
  await setConsent(db, {
    actorAccountId: other.value.id,
    accountId: other.value.id,
    type: 'CORE_PROCESSING',
    granted: true,
  });
  const theirs = await createApplicant(db, {
    actorAccountId: other.value.id,
    ownerAccountId: other.value.id,
    displayName: 'Someone Else',
  });
  if (!theirs.ok) throw new Error('applicant');
  const mine = state.accountId;
  state.accountId = other.value.id;
  const to = await redirectTo(() =>
    startGroupTripAction(INITIAL, form([...where, ['traveller', theirs.value.id]])),
  );
  state.accountId = mine;
  return to.split('/').pop() ?? '';
}

beforeEach(async () => {
  previousSwitch = process.env[TRIP_COMPANIONS_SWITCH];
  process.env[TRIP_COMPANIONS_SWITCH] = 'true';
  said = [];
  handedOver.tokens.length = 0;
  mail.sentFor.length = 0;
  mail.background.length = 0;
  mail.noKeyService = false;
  mail.sendThrows = false;
  db = drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
  state.db = db;
  const account = await provisionAccount(db, { email: 'owner@example.com' });
  if (!account.ok) throw new Error('account');
  state.accountId = account.value.id;
  await setConsent(db, {
    actorAccountId: state.accountId,
    accountId: state.accountId,
    type: 'CORE_PROCESSING',
    granted: true,
  });
  const self = await createApplicant(db, {
    actorAccountId: state.accountId,
    ownerAccountId: state.accountId,
    displayName: 'Rahima Akter',
  });
  if (!self.ok) throw new Error('applicant');
  selfId = self.value.id;
}, 60_000);

afterEach(() => {
  if (previousSwitch === undefined) delete process.env[TRIP_COMPANIONS_SWITCH];
  else process.env[TRIP_COMPANIONS_SWITCH] = previousSwitch;
});

describe('Add Someone Else while starting a group trip', () => {
  it('adds a name with no email as "not on VisaStack yet", with no invitation', async () => {
    const to = await redirectTo(() =>
      startGroupTripAction(
        INITIAL,
        form([...where, ['traveller', selfId], ...someone('Jamal Hossain')]),
      ),
    );
    expect(to).toMatch(/^\/app\/trips\/[0-9a-f-]{36}$/);
    const rows = await companions();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      displayName: 'Jamal Hossain',
      state: 'NAME_ONLY',
      email: null,
      tokenHash: null,
    });
    expect(handedOver.tokens).toHaveLength(0);
    // Nobody else was made: no applicant and no account for the person.
    expect(await applicants()).toHaveLength(1);
  });

  it('adds a person with an email as invited, and nothing sent back holds the address or the link', async () => {
    const to = await redirectTo(() =>
      startGroupTripAction(
        INITIAL,
        form([...where, ['traveller', selfId], ...someone('Nadia Rahman', FRIEND)]),
      ),
    );
    expect(to).toMatch(/^\/app\/trips\/[0-9a-f-]{36}$/);
    const rows = await companions();
    expect(rows[0]).toMatchObject({ displayName: 'Nadia Rahman', state: 'INVITED', email: FRIEND });
    expect(rows[0]?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(handedOver.tokens).toHaveLength(1);
    const everything = JSON.stringify(said);
    expect(everything).not.toContain(FRIEND);
    expect(everything).not.toContain(handedOver.tokens[0] ?? 'missing');
    expect(everything).not.toContain(rows[0]?.tokenHash ?? 'missing');
  });

  it('emails the invitation from the server: one sealed message, sent once, and the link only in it', async () => {
    await redirectTo(() =>
      startGroupTripAction(
        INITIAL,
        form([...where, ['traveller', selfId], ...someone('Nadia Rahman', FRIEND)]),
      ),
    );
    await Promise.all(mail.background);
    const rows = await companions();
    const queued = await queuedFor();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ recipientEmail: FRIEND, resourceId: rows[0]?.id });
    expect(mail.sentFor).toEqual([rows[0]?.id]);
    // The outbox holds the link sealed: the raw token is nowhere in it, nor in anything said back.
    const token = handedOver.tokens[0] ?? 'missing';
    expect(JSON.stringify(await outbox())).not.toContain(token);
    expect(JSON.stringify(said)).not.toContain(token);
  });

  it('sends nothing for a name with no email', async () => {
    await redirectTo(() =>
      startGroupTripAction(
        INITIAL,
        form([...where, ['traveller', selfId], ...someone('Jamal Hossain')]),
      ),
    );
    await Promise.all(mail.background);
    expect(await queuedFor()).toHaveLength(0);
    expect(mail.sentFor).toEqual([]);
  });

  it('keeps the person and says the invitation was not sent when the key service is missing', async () => {
    mail.noKeyService = true;
    const to = await redirectTo(() =>
      startGroupTripAction(
        INITIAL,
        form([...where, ['traveller', selfId], ...someone('Nadia Rahman', FRIEND)]),
      ),
    );
    expect(to).toMatch(/^\/app\/trips\/[0-9a-f-]{36}\?done=not-sent$/);
    const rows = await companions();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ state: 'INVITED', email: FRIEND });
    expect(await queuedFor()).toHaveLength(0);
    expect(mail.sentFor).toEqual([]);
    expect(JSON.stringify(said)).not.toContain(FRIEND);
  });

  it('is not undone by a mail provider that fails after the response', async () => {
    mail.sendThrows = true;
    const to = await redirectTo(() =>
      startGroupTripAction(
        INITIAL,
        form([...where, ['traveller', selfId], ...someone('Nadia Rahman', FRIEND)]),
      ),
    );
    expect(to).toMatch(/^\/app\/trips\/[0-9a-f-]{36}$/);
    await expect(Promise.all(mail.background)).resolves.toBeDefined();
    expect(await companions()).toHaveLength(1);
    expect(await queuedFor()).toHaveLength(1);
  });

  it('lets the person be added together with a family member', async () => {
    const to = await redirectTo(() =>
      startGroupTripAction(
        INITIAL,
        form([
          ...where,
          ['traveller', selfId],
          ['newName', 'Karim Uddin'],
          ['newKind', 'FAMILY_MEMBER'],
          ['newAuthority', 'true'],
          ...someone('Nadia Rahman'),
        ]),
      ),
    );
    expect(to).toMatch(/^\/app\/trips\/[0-9a-f-]{36}$/);
    expect(await companions()).toHaveLength(1);
    expect(await applicants()).toHaveLength(2);
  });

  it('refuses an empty name, a name that is too long and an address that is not one, and makes nobody', async () => {
    const empty = await answer(() =>
      startGroupTripAction(INITIAL, form([...where, ['traveller', selfId], ...someone('   ')])),
    );
    expect(empty).toMatchObject({ ok: false, field: 'newPersonName' });
    const long = await answer(() =>
      startGroupTripAction(
        INITIAL,
        form([...where, ['traveller', selfId], ...someone('x'.repeat(121))]),
      ),
    );
    expect(long).toMatchObject({ ok: false, field: 'newPersonName' });
    const badEmail = await answer(() =>
      startGroupTripAction(
        INITIAL,
        form([...where, ['traveller', selfId], ...someone('Nadia Rahman', 'not-an-address')]),
      ),
    );
    expect(badEmail).toMatchObject({ ok: false, field: 'newPersonEmail' });
    expect(await trips()).toHaveLength(0);
    expect(await companions()).toHaveLength(0);
  });

  it('refuses, in the service words, when the feature is off, and makes no trip and no family member', async () => {
    delete process.env[TRIP_COMPANIONS_SWITCH];
    const result = await answer(() =>
      startGroupTripAction(
        INITIAL,
        form([
          ...where,
          ['traveller', selfId],
          ['newName', 'Karim Uddin'],
          ['newKind', 'FAMILY_MEMBER'],
          ['newAuthority', 'true'],
          ...someone('Nadia Rahman', FRIEND),
        ]),
      ),
    );
    expect(result).toEqual({
      ok: false,
      message: COMPANION_NOT_SWITCHED_ON,
      field: 'newPersonName',
    });
    expect(COMPANION_NOT_SWITCHED_ON).toBe('Travelling with someone else is not switched on yet.');
    expect(await trips()).toHaveLength(0);
    expect(await applicants()).toHaveLength(1);
    expect(await companions()).toHaveLength(0);
  });

  it('keeps the trip and says so when adding the person fails after it exists', async () => {
    // The organiser's own address is refused by the service, after the trip was made.
    const to = await redirectTo(() =>
      startGroupTripAction(
        INITIAL,
        form([...where, ['traveller', selfId], ...someone('Me Again', 'owner@example.com')]),
      ),
    );
    expect(to).toMatch(/^\/app\/trips\/[0-9a-f-]{36}\?done=partial-someone$/);
    expect(await trips()).toHaveLength(1);
    expect(await companions()).toHaveLength(0);
  });

  it('makes nobody when a ticked traveller is not the account holder’s', async () => {
    await otherOrganiserWithTrip();
    const theirs = (await applicants()).find((a) => a.id !== selfId);
    const result = await answer(() =>
      startGroupTripAction(
        INITIAL,
        form([...where, ['traveller', theirs?.id ?? ''], ...someone('Nadia Rahman', FRIEND)]),
      ),
    );
    expect(result).toMatchObject({ ok: false, field: 'traveller' });
    expect(await companions()).toHaveLength(0);
  });
});

describe('Add Someone Else on a trip that already exists', () => {
  it('adds the person and goes back to the trip with a notice that does not mention a case', async () => {
    const tripId = await startTrip();
    const to = await redirectTo(() =>
      addTravellersAction(INITIAL, form([['tripId', tripId], ...someone('Nadia Rahman', FRIEND)])),
    );
    expect(to).toBe(`/app/trips/${tripId}?done=added-someone`);
    const rows = await companions();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tripId, state: 'INVITED' });
    expect(handedOver.tokens).toHaveLength(1);
    expect(JSON.stringify(said)).not.toContain(FRIEND);
    await Promise.all(mail.background);
    expect(await queuedFor()).toHaveLength(1);
    expect(mail.sentFor).toEqual([rows[0]?.id]);
  });

  it('keeps the person and says the invitation was not sent, on an existing trip', async () => {
    const tripId = await startTrip();
    mail.noKeyService = true;
    const to = await redirectTo(() =>
      addTravellersAction(INITIAL, form([['tripId', tripId], ...someone('Nadia Rahman', FRIEND)])),
    );
    expect(to).toBe(`/app/trips/${tripId}?done=not-sent`);
    expect(await companions()).toHaveLength(1);
    expect(await queuedFor()).toHaveLength(0);
  });

  it('a forged trip id adds nobody and says the trip is not available', async () => {
    const forged = '3f2b8c1e-9d4a-4e6b-8a7c-1d2e3f4a5b6c';
    const result = await answer(() =>
      addTravellersAction(INITIAL, form([['tripId', forged], ...someone('Nadia Rahman', FRIEND)])),
    );
    expect(result).toEqual({ ok: false, message: 'This trip is not available to you.' });
    const garbage = await answer(() =>
      addTravellersAction(INITIAL, form([['tripId', 'x'], ...someone('Nadia Rahman', FRIEND)])),
    );
    expect(garbage.ok).toBe(false);
    expect(await companions()).toHaveLength(0);
  });

  it('a trip of another account adds nobody there and makes no family member here', async () => {
    const foreignTripId = await otherOrganiserWithTrip();
    const result = await answer(() =>
      addTravellersAction(
        INITIAL,
        form([
          ['tripId', foreignTripId],
          ['newName', 'Karim Uddin'],
          ['newKind', 'FAMILY_MEMBER'],
          ['newAuthority', 'true'],
          ...someone('Nadia Rahman', FRIEND),
        ]),
      ),
    );
    expect(result.ok).toBe(false);
    expect(await companions()).toHaveLength(0);
    expect((await applicants()).filter((a) => a.ownerAccountId === state.accountId)).toHaveLength(
      1,
    );
  });

  it('refuses, in the service words, when the feature is off', async () => {
    const tripId = await startTrip();
    delete process.env[TRIP_COMPANIONS_SWITCH];
    const result = await answer(() =>
      addTravellersAction(INITIAL, form([['tripId', tripId], ...someone('Nadia Rahman', FRIEND)])),
    );
    expect(result).toEqual({
      ok: false,
      message: 'Travelling with someone else is not switched on yet.',
      field: 'newPersonName',
    });
    expect(await companions()).toHaveLength(0);
  });

  it('says the service’s words for a duplicate address, and points at the email field', async () => {
    const tripId = await startTrip();
    await redirectTo(() =>
      addTravellersAction(INITIAL, form([['tripId', tripId], ...someone('Nadia Rahman', FRIEND)])),
    );
    const again = await answer(() =>
      addTravellersAction(INITIAL, form([['tripId', tripId], ...someone('Nadia Again', FRIEND)])),
    );
    expect(again).toEqual({
      ok: false,
      message: 'You have already added someone with that email to this trip.',
      field: 'newPersonEmail',
    });
    expect(await companions()).toHaveLength(1);
  });

  it('sends nothing for a closed section: no person is added', async () => {
    const tripId = await startTrip();
    const result = await answer(() => addTravellersAction(INITIAL, form([['tripId', tripId]])));
    expect(result).toMatchObject({ ok: false, field: 'traveller' });
    expect(await companions()).toHaveLength(0);
  });
});

describe('review fixes: partial results and a trip with nobody on it', () => {
  it('points the email field at the right message: invalid, own and duplicate addresses', async () => {
    const tripId = await startTrip();
    for (const email of ['not-an-address', 'owner@example.com']) {
      const refused = await answer(() =>
        addTravellersAction(INITIAL, form([['tripId', tripId], ...someone('Nadia Rahman', email)])),
      );
      expect(refused, email).toMatchObject({ ok: false, field: 'newPersonEmail' });
    }
    expect(await companions()).toHaveLength(0);
  });

  it('keeps working on a trip whose travellers were all taken off it', async () => {
    const tripId = await startTrip();
    await redirectTo(() =>
      addTravellersAction(INITIAL, form([['tripId', tripId], ...someone('Nadia Rahman', FRIEND)])),
    );
    const [row] = await companions();
    await redirectTo(() =>
      removeTravellerAction(
        INITIAL,
        form([
          ['tripId', tripId],
          ['applicantId', selfId],
        ]),
      ),
    );
    const to = await redirectTo(() =>
      removeCompanionAction(
        INITIAL,
        form([
          ['tripId', tripId],
          ['companionId', row?.id ?? ''],
        ]),
      ),
    );
    expect(to).toBe(`/app/trips/${tripId}?done=removed-someone`);
    expect((await companions())[0]).toMatchObject({ state: 'REMOVED' });
  });

  it('goes to the trip with a partial notice when Someone Else is refused after a family member was added, and makes no second record on a retry', async () => {
    const tripId = await startTrip();
    const to = await redirectTo(() =>
      addTravellersAction(
        INITIAL,
        form([
          ['tripId', tripId],
          ['newName', 'Karim Uddin'],
          ['newKind', 'FAMILY_MEMBER'],
          ['newAuthority', 'true'],
          ...someone('Nadia Rahman', 'owner@example.com'),
        ]),
      ),
    );
    expect(to).toBe(`/app/trips/${tripId}?done=partial-someone`);
    expect((await applicants()).filter((p) => p.displayName === 'Karim Uddin')).toHaveLength(1);
    expect(await companions()).toHaveLength(0);
  });
});

describe('Remove and Send Again', () => {
  const addOn = async (tripId: string, name: string, email?: string) => {
    await redirectTo(() =>
      addTravellersAction(INITIAL, form([['tripId', tripId], ...someone(name, email)])),
    );
    const rows = await companions();
    const row = rows.find((r) => r.displayName === name);
    if (!row) throw new Error('companion');
    return row.id;
  };

  it('removes a person, clears their address and goes back to the trip', async () => {
    const tripId = await startTrip();
    const id = await addOn(tripId, 'Nadia Rahman', FRIEND);
    const to = await redirectTo(() =>
      removeCompanionAction(
        INITIAL,
        form([
          ['tripId', tripId],
          ['companionId', id],
        ]),
      ),
    );
    expect(to).toBe(`/app/trips/${tripId}?done=removed-someone`);
    const [row] = await db
      .select()
      .from(schema.umpeTripCompanions)
      .where(eq(schema.umpeTripCompanions.id, id));
    expect(row).toMatchObject({ state: 'REMOVED', email: null, tokenHash: null });
  });

  it('refuses to remove on a forged trip, and for a person of another trip, in plain words', async () => {
    const tripId = await startTrip();
    const id = await addOn(tripId, 'Nadia Rahman', FRIEND);
    const foreign = await otherOrganiserWithTrip();
    const wrongTrip = await answer(() =>
      removeCompanionAction(
        INITIAL,
        form([
          ['tripId', foreign],
          ['companionId', id],
        ]),
      ),
    );
    expect(wrongTrip.ok).toBe(false);
    const junk = await answer(() =>
      removeCompanionAction(
        INITIAL,
        form([
          ['tripId', tripId],
          ['companionId', 'nope'],
        ]),
      ),
    );
    expect(junk).toEqual({ ok: false, message: 'That person is not on this trip.' });
    const [row] = await db
      .select()
      .from(schema.umpeTripCompanions)
      .where(eq(schema.umpeTripCompanions.id, id));
    expect(row?.state).toBe('INVITED');
  });

  it('sends again to someone who is invited, with a new link, and says nothing about an email', async () => {
    const tripId = await startTrip();
    const id = await addOn(tripId, 'Nadia Rahman', FRIEND);
    const before = (await companions())[0]?.tokenHash;
    const result = await answer(() =>
      resendCompanionAction(
        INITIAL,
        form([
          ['tripId', tripId],
          ['companionId', id],
        ]),
      ),
    );
    expect(result).toEqual({
      ok: true,
      message: 'A new invitation is on its way. It lasts 7 days.',
    });
    const after = (await companions())[0]?.tokenHash;
    expect(after).not.toBe(before);
    expect(handedOver.tokens).toHaveLength(2);
    expect(JSON.stringify(said)).not.toContain(FRIEND);
    expect(JSON.stringify(said)).not.toContain(handedOver.tokens[1] ?? 'missing');
    // Two emails were queued (the first was replaced, so only the newest is still waiting), and the
    // sender was asked for this person twice. No link is in the outbox in the clear.
    await Promise.all(mail.background);
    const queued = await queuedFor();
    expect(queued).toHaveLength(2);
    expect(queued.filter((n) => n.status === 'QUEUED')).toHaveLength(1);
    expect(mail.sentFor).toEqual([id, id]);
    for (const token of handedOver.tokens) {
      expect(JSON.stringify(await outbox())).not.toContain(token);
    }
  });

  it('says it could not send, and keeps the person, when the key service is missing', async () => {
    const tripId = await startTrip();
    const id = await addOn(tripId, 'Nadia Rahman', FRIEND);
    mail.noKeyService = true;
    const result = await answer(() =>
      resendCompanionAction(
        INITIAL,
        form([
          ['tripId', tripId],
          ['companionId', id],
        ]),
      ),
    );
    expect(result).toEqual({
      ok: false,
      message: 'The invitation could not be sent just now. Try Send Again in a moment.',
    });
    expect((await companions())[0]?.state).toBe('INVITED');
    mail.noKeyService = false;
    const retry = await answer(() =>
      resendCompanionAction(
        INITIAL,
        form([
          ['tripId', tripId],
          ['companionId', id],
        ]),
      ),
    );
    expect(retry.ok).toBe(true);
  });

  it('answers a person who declined exactly like one still waiting, and sends them nothing', async () => {
    const tripId = await startTrip();
    const waiting = await addOn(tripId, 'Nadia Rahman', FRIEND);
    const declined = await addOn(tripId, 'Karim Uddin', 'karim@example.com');
    await db
      .update(schema.umpeTripCompanions)
      .set({ state: 'DECLINED', tokenHash: null, expiresAt: null })
      .where(eq(schema.umpeTripCompanions.id, declined));
    await Promise.all(mail.background);
    mail.sentFor.length = 0;
    const answerFor = (companionId: string) =>
      answer(() =>
        resendCompanionAction(
          INITIAL,
          form([
            ['tripId', tripId],
            ['companionId', companionId],
          ]),
        ),
      );
    const forWaiting = await answerFor(waiting);
    const forDeclined = await answerFor(declined);
    expect(forDeclined).toEqual(forWaiting);
    await Promise.all(mail.background);
    // Only the person still waiting was sent anything.
    expect(mail.sentFor).toEqual([waiting]);
  });

  it('sends again only to someone who is invited: not a name alone, not someone who joined', async () => {
    const tripId = await startTrip();
    const nameOnly = await addOn(tripId, 'Jamal Hossain');
    const noEmail = await answer(() =>
      resendCompanionAction(
        INITIAL,
        form([
          ['tripId', tripId],
          ['companionId', nameOnly],
        ]),
      ),
    );
    expect(noEmail).toEqual({
      ok: false,
      message: 'This person has no email address to send an invitation to.',
    });
    const joiner = await provisionAccount(db, { email: 'joined@example.com' });
    if (!joiner.ok) throw new Error('account');
    const invited = await addOn(tripId, 'Nadia Rahman', FRIEND);
    await db
      .update(schema.umpeTripCompanions)
      .set({
        state: 'JOINED',
        tokenHash: null,
        expiresAt: null,
        joinedAccountId: joiner.value.id,
      })
      .where(eq(schema.umpeTripCompanions.id, invited));
    const joined = await answer(() =>
      resendCompanionAction(
        INITIAL,
        form([
          ['tripId', tripId],
          ['companionId', invited],
        ]),
      ),
    );
    expect(joined).toEqual({ ok: false, message: 'This person has already joined the trip.' });
  });

  it('says the service’s words when sending again is limited, whoever the address belongs to', async () => {
    const tripId = await startTrip();
    const id = await addOn(tripId, 'Nadia Rahman', FRIEND);
    let last: { ok: boolean; message: string } = INITIAL;
    // One address may be sent to five times a day, and the first invitation counted as one.
    for (let i = 0; i < 6 && last.ok; i += 1) {
      last = await answer(() =>
        resendCompanionAction(
          INITIAL,
          form([
            ['tripId', tripId],
            ['companionId', id],
          ]),
        ),
      );
    }
    expect(last).toEqual({ ok: false, message: RATE_LIMITED });
    expect(JSON.stringify(said)).not.toContain(FRIEND);
  });

  it('refuses both while the feature is off, in the service words', async () => {
    const tripId = await startTrip();
    const id = await addOn(tripId, 'Nadia Rahman', FRIEND);
    delete process.env[TRIP_COMPANIONS_SWITCH];
    const resend = await answer(() =>
      resendCompanionAction(
        INITIAL,
        form([
          ['tripId', tripId],
          ['companionId', id],
        ]),
      ),
    );
    expect(resend).toEqual({ ok: false, message: COMPANION_NOT_SWITCHED_ON });
    const remove = await answer(() =>
      removeCompanionAction(
        INITIAL,
        form([
          ['tripId', tripId],
          ['companionId', id],
        ]),
      ),
    );
    expect(remove).toEqual({ ok: false, message: COMPANION_NOT_SWITCHED_ON });
    expect((await companions())[0]?.state).toBe('INVITED');
  });
});

describe('what the actions say back', () => {
  it('never holds a link, an address or a stored hash, whatever happened', async () => {
    const tripId = await startTrip();
    await redirectTo(() =>
      addTravellersAction(INITIAL, form([['tripId', tripId], ...someone('Nadia Rahman', FRIEND)])),
    );
    const id = (await companions())[0]?.id ?? '';
    await answer(() =>
      resendCompanionAction(
        INITIAL,
        form([
          ['tripId', tripId],
          ['companionId', id],
        ]),
      ),
    );
    await answer(() =>
      addTravellersAction(INITIAL, form([['tripId', tripId], ...someone('Again', FRIEND)])),
    );
    await answer(() =>
      addTravellersAction(INITIAL, form([['tripId', tripId], ...someone('Bad', 'nope')])),
    );
    await redirectTo(() =>
      removeCompanionAction(
        INITIAL,
        form([
          ['tripId', tripId],
          ['companionId', id],
        ]),
      ),
    );
    const everything = JSON.stringify(said);
    expect(handedOver.tokens.length).toBeGreaterThanOrEqual(2);
    for (const token of handedOver.tokens) expect(everything).not.toContain(token);
    expect(everything).not.toContain(FRIEND);
    expect(everything).not.toMatch(/[0-9a-f]{64}/);
    expect(everything).not.toMatch(/token|hash/i);
  });
});
