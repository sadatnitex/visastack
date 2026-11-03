import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import {
  type Db,
  createApplicant,
  listApplicants,
  provisionAccount,
  setConsent,
} from '@visastack/services';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { caseCountryOptions, casePurposeGroups } from '../../../lib/case-choices';

/**
 * Add a Family Member inside the trip forms, against a real database: the person is made once,
 * only with the confirmations the Home form asks for, owned by the signed-in account, and a try
 * that is refused makes nobody.
 */

const state = vi.hoisted(() => ({ db: undefined as unknown, accountId: '' }));
vi.mock('../../../lib/session', () => ({
  withSession: async (fn: (ctx: { db: unknown; accountId: string }) => unknown) =>
    fn({ db: state.db, accountId: state.accountId }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
  unstable_rethrow: (error: unknown) => {
    if (error instanceof Error && error.message.startsWith('NEXT_REDIRECT')) throw error;
  },
}));

const { addTravellersAction, startGroupTripAction } = await import('./actions');

const INITIAL = { ok: true, message: '' };
let db: Db;
let selfId: string;

const form = (entries: readonly (readonly [string, string])[]) => {
  const data = new FormData();
  for (const [k, v] of entries) data.append(k, v);
  return data;
};
const where = [
  ['destination', caseCountryOptions()[0]?.iso2 ?? ''],
  ['purpose', casePurposeGroups()[0]?.options[0]?.key ?? ''],
] as const;
const member = (name = 'Karim Uddin', authority = true) =>
  [
    ['newName', name],
    ['newKind', 'FAMILY_MEMBER'],
    ...(authority ? ([['newAuthority', 'true']] as const) : []),
  ] as const;
const everyone = () => listApplicants(db, state.accountId);
const redirectTo = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run();
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('NEXT_REDIRECT')) {
      return error.message.replace('NEXT_REDIRECT ', '');
    }
    throw error;
  }
  throw new Error('no redirect');
};

beforeEach(async () => {
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

describe('Add a Family Member while starting a group trip', () => {
  it('makes the person on this account, with the confirmed authority, and puts them on the trip', async () => {
    const to = await redirectTo(() =>
      startGroupTripAction(
        INITIAL,
        form([...where, ['traveller', selfId], ...member('Karim Uddin')]),
      ),
    );
    expect(to).toMatch(/^\/app\/trips\/[0-9a-f-]{36}$/);
    const people = await everyone();
    const karim = people.find((p) => p.displayName === 'Karim Uddin');
    expect(karim).toMatchObject({
      ownerAccountId: state.accountId,
      relationship: 'FAMILY_MEMBER',
    });
    expect(karim?.authorityConfirmedAt).not.toBeNull();
    const links = await db.select().from(schema.umpeTripTravellers);
    expect(links.map((l) => l.applicantId).sort()).toEqual([selfId, karim?.id].sort());
  });

  it('lets the new person be the only traveller named', async () => {
    const to = await redirectTo(() =>
      startGroupTripAction(INITIAL, form([...where, ...member('Nadia Rahman')])),
    );
    expect(to).toMatch(/^\/app\/trips\//);
    expect((await everyone()).map((p) => p.displayName)).toContain('Nadia Rahman');
  });

  it('refuses without the authority confirmation, and makes nobody', async () => {
    const result = await startGroupTripAction(
      INITIAL,
      form([...where, ['traveller', selfId], ...member('Karim Uddin', false)]),
    );
    expect(result).toMatchObject({ ok: false, field: 'newAuthority' });
    expect(await everyone()).toHaveLength(1);
    expect(await db.select().from(schema.umpeTripTravellers)).toHaveLength(0);
  });

  it('refuses an empty or over-long name, and a relationship that is not family or minor', async () => {
    const empty = await startGroupTripAction(
      INITIAL,
      form([...where, ['traveller', selfId], ...member('   ')]),
    );
    expect(empty).toMatchObject({ ok: false, field: 'newName' });
    const long = await startGroupTripAction(
      INITIAL,
      form([...where, ['traveller', selfId], ...member('x'.repeat(121))]),
    );
    expect(long).toMatchObject({ ok: false, field: 'newName' });
    const self = await startGroupTripAction(
      INITIAL,
      form([
        ...where,
        ['traveller', selfId],
        ['newName', 'Second Me'],
        ['newKind', 'SELF'],
        ['newAuthority', 'true'],
      ]),
    );
    expect(self).toMatchObject({ ok: false, field: 'newKind' });
    expect(await everyone()).toHaveLength(1);
  });

  it("makes nobody when a ticked traveller is not the account holder's", async () => {
    const stranger = await provisionAccount(db, { email: 'other@example.com' });
    if (!stranger.ok) throw new Error('account');
    await setConsent(db, {
      actorAccountId: stranger.value.id,
      accountId: stranger.value.id,
      type: 'CORE_PROCESSING',
      granted: true,
    });
    const theirs = await createApplicant(db, {
      actorAccountId: stranger.value.id,
      ownerAccountId: stranger.value.id,
      displayName: 'Someone Else',
    });
    if (!theirs.ok) throw new Error('applicant');
    const result = await startGroupTripAction(
      INITIAL,
      form([...where, ['traveller', theirs.value.id], ...member('Karim Uddin')]),
    );
    expect(result).toMatchObject({ ok: false, field: 'traveller' });
    const mine = await db
      .select()
      .from(schema.applicants)
      .where(eq(schema.applicants.ownerAccountId, state.accountId));
    expect(mine).toHaveLength(1);
  });

  it('says to choose someone when nobody is ticked and no family member is being added', async () => {
    const result = await startGroupTripAction(INITIAL, form([...where]));
    expect(result).toMatchObject({ ok: false, field: 'traveller' });
  });
});

describe('Add a Family Member on a trip that already exists', () => {
  const startTrip = async () => {
    const to = await redirectTo(() =>
      startGroupTripAction(INITIAL, form([...where, ['traveller', selfId]])),
    );
    return to.split('/').pop() ?? '';
  };

  it('adds a new family member to the trip later', async () => {
    const tripId = await startTrip();
    const to = await redirectTo(() =>
      addTravellersAction(INITIAL, form([['tripId', tripId], ...member('Karim Uddin')])),
    );
    expect(to).toBe(`/app/trips/${tripId}?done=added`);
    const links = await db.select().from(schema.umpeTripTravellers);
    expect(links).toHaveLength(2);
  });

  it('refuses a missing trip id and an unconfirmed authority, and makes nobody', async () => {
    const tripId = await startTrip();
    const noAuthority = await addTravellersAction(
      INITIAL,
      form([['tripId', tripId], ...member('Karim Uddin', false)]),
    );
    expect(noAuthority).toMatchObject({ ok: false, field: 'newAuthority' });
    const noTrip = await addTravellersAction(INITIAL, form([...member('Karim Uddin')]));
    expect(noTrip.ok).toBe(false);
    expect(await everyone()).toHaveLength(1);
  });
  it("makes nobody when the trip is another account's", async () => {
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
    const foreignTripId = to.split('/').pop() ?? '';
    const result = await addTravellersAction(
      INITIAL,
      form([['tripId', foreignTripId], ...member('Karim Uddin')]),
    );
    expect(result.ok).toBe(false);
    expect(await everyone()).toHaveLength(1);
  });
});
