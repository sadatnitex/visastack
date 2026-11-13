import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { type Db, first, schema } from '../db';
import { type ServiceError, keyedError } from '../errors';
import { caseFlowAEn } from '../i18n/case-flow-a';
import { hashInvitationToken } from '../invitation-tokens';
import { tripCompanionsTablePresent } from '../umpe-trip-companion-tables';
import { tripCompanionsEnabled } from '../umpe-trip-companions-switch';

/**
 * The proof that opens one trip to someone travelling with the organiser (UMPE UX6, companions).
 *
 * A companion has no applicant, no case and no grant on the organiser's account, so `requireAccess`
 * is never used for them. The only thing that opens the trip to them is a live row of
 * `umpe_trip_companions` bound to the signed-in account:
 *
 * - `JOINED`: the person accepted, and this account is the one that joined. Reads the trip basics.
 * - `INVITED`: an unexpired invitation whose email is the signed-in account's own verified email,
 *   reached by its token. Reads the trip basics for the accept screen, and may accept or decline.
 *
 * A `TripCompanionAccess` is made only here, per page or action, never kept (five minutes at most),
 * and every service that takes one calls `tripCompanionAccessProblem` first, which also reads the
 * switch again and checks the standing. It is a class with a private constructor and a `#private`
 * brand like the other gates: an object literal or a copy is not one. A removed, declined, left,
 * expired, used or unknown row never yields one, and every refusal is the same "not found".
 */

let minting = false;
let mint: (fields: AccessFields) => TripCompanionAccess;

/** How the signed-in account stands with the trip. */
export type CompanionStanding = 'INVITED' | 'JOINED';

interface AccessFields {
  readonly accountId: string;
  readonly tripId: string;
  readonly companionId: string;
  readonly standing: CompanionStanding;
}

/**
 * The one wording of every refusal, so a refused lookup looks exactly like a missing one, in
 * every language: every refusal carries this one key, and the English is read from the list.
 */
const UNAVAILABLE_KEY = 'umpe_trip_companion_case.this_invitation_is_not_available';
export const COMPANION_UNAVAILABLE = caseFlowAEn[UNAVAILABLE_KEY];

function unavailable(): ServiceError {
  return keyedError('not_found', UNAVAILABLE_KEY);
}

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The most trips a person's own list shows at once. */
export const COMPANION_LIST_LIMIT = 50;

export class TripCompanionAccess {
  readonly #brand = 'TripCompanionAccess';
  readonly kind = 'trip_companion' as const;
  readonly accountId: string;
  readonly tripId: string;
  readonly companionId: string;
  readonly standing: CompanionStanding;
  readonly #verifiedAtMs: number;

  private constructor(fields: AccessFields) {
    if (!minting) {
      throw new Error('a TripCompanionAccess can only be made by the companion access functions');
    }
    this.accountId = fields.accountId;
    this.tripId = fields.tripId;
    this.companionId = fields.companionId;
    this.standing = fields.standing;
    this.#verifiedAtMs = Date.now();
    Object.freeze(this);
  }

  /** When the live check ran (a copy: changing it changes nothing). */
  get verifiedAt(): Date {
    return new Date(this.#verifiedAtMs);
  }

  /** Run-time check that `value` is a genuine proof, not a copy. */
  static isGenuine(value: unknown): value is TripCompanionAccess {
    return typeof value === 'object' && value !== null && #brand in value;
  }

  static {
    mint = (fields: AccessFields): TripCompanionAccess => {
      minting = true;
      try {
        return new TripCompanionAccess(fields);
      } finally {
        minting = false;
      }
    };
  }
}

/** How long a companion access stays good for: minted for one page or action, never kept. */
const ACCESS_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * The refusal for an access that is not a genuine, fresh one of the standing the caller needs, or
 * undefined when it is. Every service that takes a `TripCompanionAccess` calls this first; the
 * switch is read again so turning it off stops work at once.
 */
export function tripCompanionAccessProblem(
  access: unknown,
  standing: CompanionStanding,
  env: Readonly<Record<string, string | undefined>> = process.env,
): ServiceError | undefined {
  if (!tripCompanionsEnabled(env)) return unavailable();
  if (!TripCompanionAccess.isGenuine(access) || access.standing !== standing) return unavailable();
  const age = Date.now() - access.verifiedAt.getTime();
  if (!(age >= 0 && age <= ACCESS_MAX_AGE_MS)) return unavailable();
  return undefined;
}

/** The signed-in account's own verified email, lower-cased, or null. Never looked up by an email. */
async function verifiedEmailOf(db: Db, accountId: string): Promise<string | null> {
  if (!UUID.test(accountId)) return null;
  const account = first(
    await db
      .select({ email: schema.accounts.email, verifiedAt: schema.accounts.emailVerifiedAt })
      .from(schema.accounts)
      .where(eq(schema.accounts.id, accountId))
      .limit(1),
  );
  if (!account || account.verifiedAt === null) return null;
  return account.email.trim().toLowerCase();
}

/** The switch is on and the table exists: the one readiness rule for every companion read and write. */
export async function companionsReady(db: Db): Promise<boolean> {
  return tripCompanionsEnabled() && (await tripCompanionsTablePresent(db));
}

/**
 * Whether a queued invitation email may still go now (the worker asks at send time): the feature
 * is still on, the row is still INVITED and unexpired, and it still carries exactly the address the
 * email goes to. A used, declined, removed, expired or changed invitation, a missing row and a
 * malformed id are all false. It reads the row's own columns only, never an account by address, so
 * what it decides cannot depend on whether the address has an account.
 */
export async function companionInvitationStillDeliverable(
  db: Db,
  notification: {
    readonly resourceId: string | null;
    readonly recipientEmail: string | null;
  },
  now: Date = new Date(),
): Promise<boolean> {
  const { resourceId, recipientEmail } = notification;
  if (!resourceId || !recipientEmail || !UUID.test(resourceId)) return false;
  if (!(await companionsReady(db))) return false;
  const row = first(
    await db
      .select({ id: schema.umpeTripCompanions.id })
      .from(schema.umpeTripCompanions)
      .where(
        and(
          eq(schema.umpeTripCompanions.id, resourceId),
          eq(schema.umpeTripCompanions.state, 'INVITED'),
          gt(schema.umpeTripCompanions.expiresAt, now),
          eq(schema.umpeTripCompanions.email, recipientEmail.trim().toLowerCase()),
        ),
      )
      .limit(1),
  );
  return row !== undefined;
}

/**
 * The access of the account that joined this trip, or null for anything else: an unknown trip, a
 * row that was removed, declined or left, a different account, or the switch off. Re-run for every
 * read, so a removal or a leaving ends access on the next one.
 */
export async function joinedCompanionAccess(
  db: Db,
  accountId: string,
  tripId: string,
): Promise<TripCompanionAccess | null> {
  if (!UUID.test(accountId) || !UUID.test(tripId) || !(await companionsReady(db))) return null;
  const row = first(
    await db
      .select({ id: schema.umpeTripCompanions.id })
      .from(schema.umpeTripCompanions)
      .where(
        and(
          eq(schema.umpeTripCompanions.tripId, tripId),
          eq(schema.umpeTripCompanions.joinedAccountId, accountId),
          eq(schema.umpeTripCompanions.state, 'JOINED'),
        ),
      )
      .limit(1),
  );
  if (!row) return null;
  return mint({ accountId, tripId, companionId: row.id, standing: 'JOINED' });
}

/**
 * The access to one unexpired invitation, named by its token, for the account whose verified email
 * is the one invited. A malformed token, an unknown one, one already used, revoked or expired, and
 * one meant for another email are all the same null. The organiser's own account never gets one.
 */
export async function invitedCompanionAccess(
  db: Db,
  accountId: string,
  rawToken: string,
): Promise<TripCompanionAccess | null> {
  if (!TOKEN_SHAPE.test(rawToken) || !(await companionsReady(db))) return null;
  const email = await verifiedEmailOf(db, accountId);
  const row = first(
    await db
      .select({
        id: schema.umpeTripCompanions.id,
        tripId: schema.umpeTripCompanions.tripId,
        email: schema.umpeTripCompanions.email,
        ownerAccountId: schema.umpeTrips.ownerAccountId,
      })
      .from(schema.umpeTripCompanions)
      .innerJoin(schema.umpeTrips, eq(schema.umpeTrips.id, schema.umpeTripCompanions.tripId))
      .where(
        and(
          eq(schema.umpeTripCompanions.tokenHash, hashInvitationToken(rawToken)),
          eq(schema.umpeTripCompanions.state, 'INVITED'),
          gt(schema.umpeTripCompanions.expiresAt, new Date()),
        ),
      )
      .limit(1),
  );
  if (!row || email === null || row.email !== email || row.ownerAccountId === accountId) {
    return null;
  }
  return mint({ accountId, tripId: row.tripId, companionId: row.id, standing: 'INVITED' });
}

/**
 * One access per live row of this account: the trips it joined, then unexpired invitations sent to
 * its verified email (listed without any token: only the emailed link can accept). Newest first.
 */
export async function myCompanionAccesses(
  db: Db,
  accountId: string,
): Promise<TripCompanionAccess[]> {
  if (!UUID.test(accountId) || !(await companionsReady(db))) return [];
  const companions = schema.umpeTripCompanions;
  const joined = await db
    .select({ id: companions.id, tripId: companions.tripId })
    .from(companions)
    .where(and(eq(companions.joinedAccountId, accountId), eq(companions.state, 'JOINED')))
    .orderBy(desc(companions.updatedAt), desc(companions.id))
    .limit(COMPANION_LIST_LIMIT);
  const accesses = joined.map((row) =>
    mint({ accountId, tripId: row.tripId, companionId: row.id, standing: 'JOINED' }),
  );
  const email = await verifiedEmailOf(db, accountId);
  if (email === null) return accesses;
  const invited = await db
    .select({
      id: companions.id,
      tripId: companions.tripId,
      ownerAccountId: schema.umpeTrips.ownerAccountId,
    })
    .from(companions)
    .innerJoin(schema.umpeTrips, eq(schema.umpeTrips.id, companions.tripId))
    .where(
      and(
        eq(companions.email, email),
        eq(companions.state, 'INVITED'),
        gt(companions.expiresAt, sql`now()`),
      ),
    )
    .orderBy(desc(companions.createdAt), desc(companions.id))
    .limit(COMPANION_LIST_LIMIT);
  for (const row of invited) {
    if (row.ownerAccountId === accountId) continue;
    accesses.push(
      mint({ accountId, tripId: row.tripId, companionId: row.id, standing: 'INVITED' }),
    );
  }
  return accesses;
}
