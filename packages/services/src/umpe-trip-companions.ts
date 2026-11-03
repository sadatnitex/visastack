/**
 * UMPE UX6: travelling with someone else (companions and invitations).
 *
 * A companion is a person who is not one of the organiser's own managed people: a friend or
 * colleague added by name and an optional email. Nothing is made for them until they accept: no
 * account, no applicant, no case (ADR 0026 D5, no shadow applicant), and even after accepting they
 * never become a traveller on the organiser's trip. What the organiser may see of them is the
 * companion's own choice (Name Only, Plan Status, Travel Bookings), set only by the signed-in
 * companion, never by the organiser.
 *
 * ORGANISER side. Every export takes a genuine owner proof (`requireAccess`, actor
 * `applicant_owner`), and the trip is found only by its id AND that owner account, so another
 * account's trip looks exactly like a missing one. Nothing here looks an account up by an email, so
 * the organiser can never learn whether an address has an account: the same shapes and the same
 * words come back for every address, a declined invitation looks like one still waiting until it
 * would have expired, and no delivery or acceptance detail is ever returned.
 *
 * COMPANION side. A companion has no applicant, so `requireAccess` is never used. The functions that
 * read the trip take a `TripCompanionAccess` (access/trip-companion-access.ts), minted per read from
 * a live row bound to the signed-in account. The invitation functions take the raw token and the
 * signed-in account; a missing, malformed, expired, used, declined, removed or wrong-email
 * invitation is always the same refusal.
 *
 * Only the hash of a token is stored, and it is returned raw once, to the sender, so the email
 * package can send it. Every mutation is audited with ids, counts and kinds only: never an email,
 * never a token. Until the migration runs the table is missing and the switch is off: readers
 * answer "nothing" and writers refuse plainly.
 */
import { createHash } from 'node:crypto';
import { type Result, err, ok } from '@visastack/core';
import { and, asc, count, eq, gt, inArray, isNull, ne } from 'drizzle-orm';
import type { AuthorizedApplicant } from './access/require-access';
import {
  COMPANION_LIST_LIMIT,
  COMPANION_UNAVAILABLE,
  type TripCompanionAccess,
  companionsReady,
  invitedCompanionAccess,
  myCompanionAccesses,
  tripCompanionAccessProblem,
} from './access/trip-companion-access';
import { appendAuditEvent } from './audit';
import { hasConsent } from './consent';
import { type Db, first, isUniqueViolation, schema } from './db';
import { isEmailAddress } from './email-address';
import { type ServiceError, serviceError } from './errors';
import { generateInvitationToken, hashInvitationToken } from './invitation-tokens';
import { lifecycleTablesPresent, presentApplicantCondition } from './lifecycle/foundation';
import { RATE_LIMITS, checkRateLimit } from './rate-limit';
import { type OrganiserPaperView, organiserPaperNames } from './umpe-trip-companion-papers';
import {
  tripCompanionPapersTablePresent,
  tripCompanionsTablePresent,
} from './umpe-trip-companion-tables';
import { ownerAccountOf } from './umpe-trip-service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME_MAX = 120;
const DAY_MS = 24 * 60 * 60 * 1000;

/** What a companion lets the organiser see. Name Only is the default and the smallest. */
export const COMPANION_SHARE_LEVELS = ['NAME_ONLY', 'PLAN_STATUS', 'TRAVEL_BOOKINGS'] as const;
export type CompanionShareLevel = (typeof COMPANION_SHARE_LEVELS)[number];

export const COMPANION_SHARE_LEVEL_LABELS: Readonly<Record<CompanionShareLevel, string>> = {
  NAME_ONLY: 'Name Only',
  PLAN_STATUS: 'Plan Status',
  TRAVEL_BOOKINGS: 'Travel Bookings',
};

/** At most this many people may be travelling with the organiser on one trip. */
export const TRIP_MAX_COMPANIONS = 20;

/** An invitation lives this long, then needs sending again. */
export const COMPANION_INVITATION_DAYS = 7;

/** How the organiser sees one person: never more than this, whatever the person's account is. */
export type OrganiserCompanionStatus = 'NAME_ONLY' | 'INVITED' | 'EXPIRED' | 'JOINED';

export interface OrganiserCompanionView {
  readonly id: string;
  readonly name: string;
  readonly status: OrganiserCompanionStatus;
  /** What a joined companion shares; null for anyone who has not joined. */
  readonly shareLevel: CompanionShareLevel | null;
  /**
   * One plain phrase for the companion's own case for this trip. Only when they joined, chose Plan
   * Status or more, and have started a case of their own; otherwise null. A phrase only.
   */
  readonly planStatus: string | null;
  /**
   * The names and kinds of the papers the companion chose to show, only at Travel Bookings and only
   * while they are still the companion's own present travel papers; otherwise empty. Names only.
   */
  readonly papers: readonly OrganiserPaperView[];
}

/**
 * What the sender needs to email an invitation. Server side only: it holds the one raw token, so it
 * must never be sent to a browser, logged or stored.
 */
export interface CompanionInvitationDelivery {
  readonly rawToken: string;
  readonly expiresAt: string;
  readonly recipientEmail: string;
}

export interface AddCompanionOutcome {
  readonly companion: OrganiserCompanionView;
  /** Present exactly when an email address was given. */
  readonly invitation: CompanionInvitationDelivery | null;
}

export interface CompanionTripSummary {
  readonly tripId: string;
  readonly standing: 'INVITED' | 'JOINED';
  readonly title: string;
  readonly destination: string;
  readonly purpose: string;
  /** The name shown for this person on the trip. */
  readonly displayName: string;
  /** Their own choice, once joined. */
  readonly shareLevel: CompanionShareLevel | null;
  /** When an invitation lapses; null once joined. */
  readonly expiresAt: string | null;
}

/** The one read a joined companion has of a trip: nothing else is ever returned. */
export interface CompanionTripView {
  readonly title: string;
  readonly destination: string;
  readonly purpose: string;
  /** "The organiser", then the other companions who joined, by the names they confirmed. */
  readonly people: readonly string[];
  /** How many of the organiser's own people are also travelling. Never named. */
  readonly moreTravelling: number;
}

/** What every companion writer says while the switch is off or the table is missing. */
export const COMPANION_NOT_SWITCHED_ON = 'Travelling with someone else is not switched on yet.';
const NOT_SWITCHED_ON = COMPANION_NOT_SWITCHED_ON;
const PERSON_NOT_AVAILABLE = 'That person is not on this trip.';
const TRIP_NOT_AVAILABLE = 'That trip is not available.';
const INVITE_RATE_LIMITED = 'Too many invitations in a short time. Please try again later.';
const ATTEMPT_RATE_LIMITED = 'Too many tries in a short time. Please try again later.';
const ORGANISER_ORGANISER = 'The organiser';

// --- Small helpers ----------------------------------------------------------------------------

/** The organiser's core processing consent, as the trip service asks for it before linking anything. */
async function consentProblem(db: Db, ownerAccountId: string): Promise<ServiceError | null> {
  return (await hasConsent(db, ownerAccountId, 'CORE_PROCESSING'))
    ? null
    : serviceError('consent_required', 'Core processing consent is required');
}

/** A person's name as shown: trimmed, one space between words, 1 to 120 characters, no controls. */
function cleanName(raw: string): string | null {
  const name = raw.replace(/\s+/g, ' ').trim();
  // No control or invisible formatting characters (they can hide or reorder a name), and never the
  // label a companion's list uses for the organiser.
  if (name.length < 1 || name.length > NAME_MAX || /[\p{Cc}\p{Cf}]/u.test(name)) return null;
  if (name.toLowerCase() === ORGANISER_ORGANISER.toLowerCase()) return null;
  return name;
}

const NAME_PROBLEM = 'Enter a name of up to 120 characters.';

/** The same name rule and wording, for a screen that checks before it makes anything else. */
export const COMPANION_NAME_PROBLEM = NAME_PROBLEM;
export const cleanCompanionName = cleanName;

/** The address as stored (lower case), or null when it is not an address. */
function cleanEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  return isEmailAddress(email) ? email : null;
}

/** An address is only ever a rate limit subject as a hash. */
function emailBucket(email: string): string {
  return createHash('sha256').update(`companion-email:${email}`).digest('hex');
}

function isShareLevel(value: string): value is CompanionShareLevel {
  return (COMPANION_SHARE_LEVELS as readonly string[]).includes(value);
}

/** The trip's id, only when it belongs to `ownerAccountId`; a denied trip looks missing. */
async function ownedTripId(db: Db, ownerAccountId: string, tripId: string): Promise<string | null> {
  if (!UUID.test(tripId)) return null;
  const row = first(
    await db
      .select({ id: schema.umpeTrips.id })
      .from(schema.umpeTrips)
      .where(
        and(eq(schema.umpeTrips.id, tripId), eq(schema.umpeTrips.ownerAccountId, ownerAccountId)),
      )
      .limit(1),
  );
  return row?.id ?? null;
}

/** The plain phrase for a case's state. A phrase only: it says nothing about the case itself. */
export function companionPlanStatusPhrase(state: string): string {
  switch (state) {
    case 'SUBMISSION_READY':
    case 'READY_TO_EXPORT':
    case 'LOCKED':
      return 'Ready to Share';
    case 'SUBMITTED':
      return 'Submitted';
    case 'CLOSED':
    case 'CANCELLED':
      return 'Case Closed';
    default:
      return 'Getting Ready';
  }
}

/**
 * Withdraws every paper this companion chose to show (their choices only; the papers themselves are
 * never touched). Done in the same transaction as whatever ends or lowers what they share, and a
 * missing table (the migration has not run) has nothing to withdraw.
 */
async function withdrawPapers(tx: Db, companionId: string): Promise<void> {
  if (!(await tripCompanionPapersTablePresent(tx))) return;
  await tx
    .delete(schema.umpeTripCompanionPapers)
    .where(eq(schema.umpeTripCompanionPapers.companionId, companionId));
}

// --- Organiser side ---------------------------------------------------------------------------

/**
 * Add Someone Else: a name, and an optional email. With an email the person is invited (a fresh
 * single-use link, 7 days, returned raw once to the caller for the email); with none they are listed
 * as "Not on VisaStack yet". Up to 20 people per trip; the organiser's own email is refused; the same
 * email twice on one trip is refused. Nothing looks the address up, so the answer is the same
 * whether or not it has an account.
 */
export async function addCompanion(
  proof: AuthorizedApplicant<'MANAGE'>,
  tripId: string,
  input: { readonly name: string; readonly email?: string | undefined },
): Promise<Result<AddCompanionOutcome, ServiceError>> {
  const owner = ownerAccountOf(proof, 'MANAGE');
  if (!owner.ok) return owner;
  const db = proof.tx;
  if (!(await companionsReady(db))) return err(serviceError('invalid', NOT_SWITCHED_ON));
  const consent = await consentProblem(db, owner.value);
  if (consent) return err(consent);
  const name = cleanName(input.name);
  if (name === null) return err(serviceError('invalid', NAME_PROBLEM));
  const given = input.email?.trim() ?? '';
  const email = given === '' ? null : cleanEmail(given);
  if (given !== '' && email === null) {
    return err(serviceError('invalid', 'Enter a valid email address, or leave it empty.'));
  }
  if ((await ownedTripId(db, owner.value, tripId)) === null) {
    return err(serviceError('not_found', TRIP_NOT_AVAILABLE));
  }
  const limited = await inviteRateLimited(db, owner.value, email);
  if (limited) return err(serviceError('rate_limited', INVITE_RATE_LIMITED));
  const issued = email === null ? null : newToken();
  try {
    return await db.transaction(async (tx) => {
      // The trip row is locked so two additions at once cannot both pass the count below.
      await tx
        .select({ id: schema.umpeTrips.id })
        .from(schema.umpeTrips)
        .where(eq(schema.umpeTrips.id, tripId))
        .for('update');
      const own = first(
        await tx
          .select({ email: schema.accounts.email })
          .from(schema.accounts)
          .where(eq(schema.accounts.id, owner.value))
          .limit(1),
      );
      if (email !== null && own?.email.trim().toLowerCase() === email) {
        return err(
          serviceError('invalid', 'That is your own email address. You are already on this trip.'),
        );
      }
      const companions = schema.umpeTripCompanions;
      const live = first(
        await tx
          .select({ n: count() })
          .from(companions)
          .where(
            and(
              eq(companions.tripId, tripId),
              inArray(companions.state, ['NAME_ONLY', 'INVITED', 'JOINED', 'DECLINED']),
            ),
          ),
      );
      if (Number(live?.n ?? 0) >= TRIP_MAX_COMPANIONS) {
        return err(
          serviceError(
            'invalid',
            `A trip can include up to ${TRIP_MAX_COMPANIONS} people travelling with you.`,
          ),
        );
      }
      if (email !== null) {
        const twice = first(
          await tx
            .select({ id: companions.id })
            .from(companions)
            .where(
              and(
                eq(companions.tripId, tripId),
                eq(companions.email, email),
                inArray(companions.state, ['INVITED', 'JOINED', 'DECLINED']),
              ),
            )
            .limit(1),
        );
        if (twice) return err(serviceError('invalid', ALREADY_ADDED));
      }
      const expiresAt = issued ? new Date(Date.now() + COMPANION_INVITATION_DAYS * DAY_MS) : null;
      const row = first(
        await tx
          .insert(companions)
          .values({
            tripId,
            displayName: name,
            email,
            state: issued ? 'INVITED' : 'NAME_ONLY',
            tokenHash: issued?.tokenHash ?? null,
            expiresAt,
            invitedByAccountId: owner.value,
          })
          .returning({ id: companions.id }),
      );
      if (!row) throw new Error('a trip companion was not returned by the database');
      await appendAuditEvent(tx, {
        eventType: 'UMPE_TRIP_COMPANION_ADDED',
        actorAccountId: owner.value,
        method: 'MANUAL',
        result: 'ALLOWED',
        applicantId: proof.applicant.id,
        resourceType: 'umpe_trip_companion',
        resourceId: row.id,
        metadata: { tripId, invited: issued !== null },
      });
      return ok({
        companion: {
          id: row.id,
          name,
          status: issued ? ('INVITED' as const) : ('NAME_ONLY' as const),
          shareLevel: null,
          planStatus: null,
          papers: [],
        },
        invitation:
          issued && email && expiresAt
            ? {
                rawToken: issued.rawToken,
                expiresAt: expiresAt.toISOString(),
                recipientEmail: email,
              }
            : null,
      });
    });
  } catch (error) {
    // Another request added the same address first: the same plain answer as a visible duplicate.
    if (isUniqueViolation(error)) return err(serviceError('invalid', ALREADY_ADDED));
    throw error;
  }
}

const ALREADY_ADDED = 'You have already added someone with that email to this trip.';

function newToken(): { readonly rawToken: string; readonly tokenHash: string } {
  const rawToken = generateInvitationToken();
  return { rawToken, tokenHash: hashInvitationToken(rawToken) };
}

/** Counts one invitation by this organiser and, when there is an address, by that address. */
async function inviteRateLimited(
  db: Db,
  ownerAccountId: string,
  email: string | null,
): Promise<boolean> {
  // A name with no email sends nothing, so it costs no invitation.
  if (email === null) return false;
  const mine = await checkRateLimit(
    db,
    { subjectId: ownerAccountId, action: 'trip_companion.invite', label: 'invitation' },
    RATE_LIMITS.COMPANION_INVITE,
  );
  if (!mine.allowed) return true;
  const address = await checkRateLimit(
    db,
    { subjectId: emailBucket(email), action: 'trip_companion.invite_email', label: 'invitation' },
    RATE_LIMITS.COMPANION_INVITE_EMAIL_DAY,
  );
  return !address.allowed;
}

/**
 * The people travelling with the organiser on this trip, oldest first: their name, whether they are
 * on VisaStack yet, and, for a joined companion, only what their own sharing level allows. Never an
 * email, a token, or anything about an account. People who were removed or left are not listed, and
 * a declined invitation reads as still waiting until it would have lapsed.
 */
export async function listCompanions(
  proof: AuthorizedApplicant<'VIEW_METADATA'>,
  tripId: string,
): Promise<Result<readonly OrganiserCompanionView[], ServiceError>> {
  const owner = ownerAccountOf(proof, 'VIEW_METADATA');
  if (!owner.ok) return owner;
  const db = proof.tx;
  if (!(await companionsReady(db))) return ok([]);
  if ((await ownedTripId(db, owner.value, tripId)) === null) {
    return err(serviceError('not_found', TRIP_NOT_AVAILABLE));
  }
  const companions = schema.umpeTripCompanions;
  const rows = await db
    .select({
      id: companions.id,
      name: companions.displayName,
      state: companions.state,
      shareLevel: companions.shareLevel,
      expiresAt: companions.expiresAt,
      joinedAccountId: companions.joinedAccountId,
      ownMissionId: companions.ownMissionId,
    })
    .from(companions)
    .where(
      and(
        eq(companions.tripId, tripId),
        inArray(companions.state, ['NAME_ONLY', 'INVITED', 'JOINED', 'DECLINED']),
      ),
    )
    .orderBy(asc(companions.createdAt), asc(companions.id))
    .limit(COMPANION_LIST_LIMIT);
  const phrases = await planPhrases(
    db,
    rows.flatMap((row) =>
      row.state === 'JOINED' &&
      row.joinedAccountId !== null &&
      row.ownMissionId !== null &&
      row.shareLevel !== 'NAME_ONLY'
        ? [{ missionId: row.ownMissionId, accountId: row.joinedAccountId }]
        : [],
    ),
  );
  // Only when someone joined at Travel Bookings: the read itself checks the level again.
  const papers = rows.some((row) => row.state === 'JOINED' && row.shareLevel === 'TRAVEL_BOOKINGS')
    ? await organiserPaperNames(proof, tripId)
    : new Map<string, readonly OrganiserPaperView[]>();
  const now = Date.now();
  const views: OrganiserCompanionView[] = [];
  for (const row of rows) {
    if (row.state === 'NAME_ONLY') {
      views.push({
        id: row.id,
        name: row.name,
        status: 'NAME_ONLY',
        shareLevel: null,
        planStatus: null,
        papers: [],
      });
    } else if (row.state === 'JOINED') {
      // A row whose account was erased no longer has anyone behind it.
      if (row.joinedAccountId === null || !isShareLevel(row.shareLevel)) continue;
      views.push({
        id: row.id,
        name: row.name,
        status: 'JOINED',
        shareLevel: row.shareLevel,
        planStatus:
          row.ownMissionId === null || row.shareLevel === 'NAME_ONLY'
            ? null
            : (phrases.get(row.ownMissionId) ?? null),
        papers: papers.get(row.id) ?? [],
      });
    } else {
      // INVITED, and DECLINED shown exactly the same way, so nothing differs by whether the
      // address has an account.
      const live = row.expiresAt !== null && row.expiresAt.getTime() > now;
      views.push({
        id: row.id,
        name: row.name,
        status: live ? 'INVITED' : 'EXPIRED',
        shareLevel: null,
        planStatus: null,
        papers: [],
      });
    }
  }
  return ok(views);
}

/**
 * The phrase for each companion's own case, only for a case that belongs to the very account that
 * joined (a case id that points anywhere else yields nothing) and has not been purged or sent to
 * Recently Deleted.
 */
async function planPhrases(
  db: Db,
  wanted: readonly { readonly missionId: string; readonly accountId: string }[],
): Promise<Map<string, string>> {
  const phrases = new Map<string, string>();
  if (wanted.length === 0) return phrases;
  const lifecycle = await lifecycleTablesPresent(db);
  const rows = await db
    .select({
      id: schema.missions.id,
      state: schema.missions.state,
      accountId: schema.applicants.ownerAccountId,
    })
    .from(schema.missions)
    .innerJoin(schema.applicants, eq(schema.applicants.id, schema.missions.applicantId))
    .where(
      and(
        inArray(
          schema.missions.id,
          wanted.map((w) => w.missionId),
        ),
        isNull(schema.missions.purgedAt),
        lifecycle ? presentApplicantCondition() : undefined,
      ),
    );
  for (const row of rows) {
    const mine = wanted.find((w) => w.missionId === row.id);
    if (mine && mine.accountId === row.accountId) {
      phrases.set(row.id, companionPlanStatusPhrase(row.state));
    }
  }
  return phrases;
}

/**
 * Take someone off the trip, at any time. A joined companion loses access on their next read; an
 * invitation stops working at once. Their address and link are cleared. Their own case, if they
 * started one, is theirs and is not touched.
 */
export async function removeCompanion(
  proof: AuthorizedApplicant<'MANAGE'>,
  tripId: string,
  companionId: string,
): Promise<Result<{ readonly removed: true }, ServiceError>> {
  const owner = ownerAccountOf(proof, 'MANAGE');
  if (!owner.ok) return owner;
  const db = proof.tx;
  if (!(await companionsReady(db))) return err(serviceError('invalid', NOT_SWITCHED_ON));
  if (!UUID.test(companionId) || (await ownedTripId(db, owner.value, tripId)) === null) {
    return err(serviceError('not_found', PERSON_NOT_AVAILABLE));
  }
  return db.transaction(async (tx) => {
    const companions = schema.umpeTripCompanions;
    const changed = await tx
      .update(companions)
      .set({
        state: 'REMOVED',
        tokenHash: null,
        email: null,
        shareLevel: 'NAME_ONLY',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(companions.id, companionId),
          eq(companions.tripId, tripId),
          inArray(companions.state, ['NAME_ONLY', 'INVITED', 'JOINED', 'DECLINED']),
        ),
      )
      .returning({ id: companions.id });
    if (changed.length === 0) return err(serviceError('not_found', PERSON_NOT_AVAILABLE));
    await withdrawPapers(tx, companionId);
    await appendAuditEvent(tx, {
      eventType: 'UMPE_TRIP_COMPANION_REMOVED',
      actorAccountId: owner.value,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: proof.applicant.id,
      resourceType: 'umpe_trip_companion',
      resourceId: companionId,
      metadata: { tripId },
    });
    return ok({ removed: true as const });
  });
}

/**
 * Send an invitation again: a new link replaces the old one (the old one stops working) with a new
 * 7 days. Limited per trip and per address. A person who already declined is not written to again,
 * yet the answer is the same, so the organiser cannot tell: `invitation` is then null and nothing is
 * sent. A name with no email has no address to send to.
 */
export async function resendInvitation(
  proof: AuthorizedApplicant<'MANAGE'>,
  tripId: string,
  companionId: string,
): Promise<Result<{ readonly invitation: CompanionInvitationDelivery | null }, ServiceError>> {
  const owner = ownerAccountOf(proof, 'MANAGE');
  if (!owner.ok) return owner;
  const db = proof.tx;
  if (!(await companionsReady(db))) return err(serviceError('invalid', NOT_SWITCHED_ON));
  const consent = await consentProblem(db, owner.value);
  if (consent) return err(consent);
  if (!UUID.test(companionId) || (await ownedTripId(db, owner.value, tripId)) === null) {
    return err(serviceError('not_found', PERSON_NOT_AVAILABLE));
  }
  const companions = schema.umpeTripCompanions;
  const row = first(
    await db
      .select({ id: companions.id, state: companions.state, email: companions.email })
      .from(companions)
      .where(and(eq(companions.id, companionId), eq(companions.tripId, tripId)))
      .limit(1),
  );
  if (!row || row.state === 'REMOVED' || row.state === 'LEFT') {
    return err(serviceError('not_found', PERSON_NOT_AVAILABLE));
  }
  if (row.state === 'JOINED') {
    return err(serviceError('invalid', 'This person has already joined the trip.'));
  }
  if (row.state === 'NAME_ONLY' || row.email === null) {
    return err(
      serviceError('invalid', 'This person has no email address to send an invitation to.'),
    );
  }
  const trip = await checkRateLimit(
    db,
    { subjectId: tripId, action: 'trip_companion.resend', label: 'invitation' },
    RATE_LIMITS.COMPANION_RESEND_TRIP,
  );
  if (!trip.allowed) return err(serviceError('rate_limited', INVITE_RATE_LIMITED));
  const address = await checkRateLimit(
    db,
    {
      subjectId: emailBucket(row.email),
      action: 'trip_companion.invite_email',
      label: 'invitation',
    },
    RATE_LIMITS.COMPANION_INVITE_EMAIL_DAY,
  );
  if (!address.allowed) return err(serviceError('rate_limited', INVITE_RATE_LIMITED));
  const recipient = row.email;
  if (row.state === 'DECLINED') return ok({ invitation: null });
  const issued = newToken();
  const expiresAt = new Date(Date.now() + COMPANION_INVITATION_DAYS * DAY_MS);
  return db.transaction(async (tx) => {
    const changed = await tx
      .update(companions)
      .set({ tokenHash: issued.tokenHash, expiresAt, updatedAt: new Date() })
      .where(
        and(
          eq(companions.id, companionId),
          eq(companions.tripId, tripId),
          eq(companions.state, 'INVITED'),
        ),
      )
      .returning({ id: companions.id });
    // The old link dies with this replacement, so an email still waiting with it is cancelled in
    // the same transaction: it can never be sent with a dead link, whatever happens next.
    if (changed.length > 0) {
      await tx
        .update(schema.notifications)
        .set({ status: 'CANCELLED' })
        .where(
          and(
            eq(schema.notifications.resourceId, companionId),
            eq(schema.notifications.status, 'QUEUED'),
          ),
        );
    }
    if (changed.length === 0) return err(serviceError('not_found', PERSON_NOT_AVAILABLE));
    await appendAuditEvent(tx, {
      eventType: 'UMPE_TRIP_COMPANION_RESENT',
      actorAccountId: owner.value,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: proof.applicant.id,
      resourceType: 'umpe_trip_companion',
      resourceId: companionId,
      metadata: { tripId },
    });
    return ok({
      invitation: {
        rawToken: issued.rawToken,
        expiresAt: expiresAt.toISOString(),
        recipientEmail: recipient,
      },
    });
  });
}

// --- Companion side: the invitation -----------------------------------------------------------

export interface CompanionInvitationPreview {
  readonly title: string;
  readonly destination: string;
  readonly purpose: string;
  /** The name the organiser typed; the person may change it on accepting. */
  readonly displayName: string;
  readonly expiresAt: string;
}

async function attemptLimited(db: Db, accountId: string): Promise<boolean> {
  const decision = await checkRateLimit(
    db,
    { subjectId: accountId, action: 'trip_companion.attempt', label: 'invitation' },
    RATE_LIMITS.COMPANION_ACCEPT_ACCOUNT,
  );
  return !decision.allowed;
}

/**
 * The access to one invitation link for the signed-in account: counts the try (so links cannot be
 * guessed in bulk), then makes the proof that previewing, accepting or declining needs. A missing,
 * malformed, expired, used, declined, removed or wrong-email invitation, and a switch that is off,
 * are all the same refusal. Never looks an account up by an email.
 */
export async function openCompanionInvitation(
  db: Db,
  input: { readonly accountId: string; readonly rawToken: string },
): Promise<Result<TripCompanionAccess, ServiceError>> {
  if (!(await companionsReady(db))) return err(serviceError('not_found', COMPANION_UNAVAILABLE));
  if (await attemptLimited(db, input.accountId)) {
    return err(serviceError('rate_limited', ATTEMPT_RATE_LIMITED));
  }
  const access = await invitedCompanionAccess(db, input.accountId, input.rawToken);
  return access ? ok(access) : err(serviceError('not_found', COMPANION_UNAVAILABLE));
}

/**
 * What the accept screen shows for an invitation link: the trip basics and the name typed for them,
 * to the signed-in account whose verified email was invited. A missing, malformed, expired, used,
 * declined, removed or wrong-email invitation is the same refusal.
 */
export async function previewCompanionInvitation(
  db: Db,
  input: { readonly accountId: string; readonly rawToken: string },
): Promise<Result<CompanionInvitationPreview, ServiceError>> {
  const access = await openCompanionInvitation(db, input);
  if (!access.ok) return access;
  const summary = await readCompanionTripSummary(db, access.value);
  if (!summary.ok) return summary;
  if (summary.value.expiresAt === null)
    return err(serviceError('not_found', COMPANION_UNAVAILABLE));
  return ok({
    title: summary.value.title,
    destination: summary.value.destination,
    purpose: summary.value.purpose,
    displayName: summary.value.displayName,
    expiresAt: summary.value.expiresAt,
  });
}

/**
 * Accept an invitation. A single-use claim: the invitation moves from INVITED to JOINED only while
 * it is still INVITED and unexpired, in one transaction, so a second use fails exactly like any
 * other refusal. The signed-in account's verified email must be the invited one, and it must have
 * given its account consent. The person confirms the name shown (or changes it) and chooses what
 * to share, Name Only unless they pick more. Nothing is made for them: no account, no applicant.
 */
export async function acceptCompanionInvitation(
  db: Db,
  access: TripCompanionAccess,
  input: {
    readonly rawToken: string;
    readonly displayName?: string | undefined;
    readonly shareLevel?: string | undefined;
  },
): Promise<
  Result<{ readonly tripId: string; readonly shareLevel: CompanionShareLevel }, ServiceError>
> {
  const problem = tripCompanionAccessProblem(access, 'INVITED');
  if (problem) return err(problem);
  const level = input.shareLevel ?? 'NAME_ONLY';
  if (!isShareLevel(level)) {
    return err(serviceError('invalid', 'Choose how much you want to share.'));
  }
  const name = input.displayName === undefined ? undefined : cleanName(input.displayName);
  if (name === null) return err(serviceError('invalid', NAME_PROBLEM));
  try {
    return await db.transaction(async (tx) => {
      // The proof is made again inside the transaction: the link must still be this account's.
      const fresh = await invitedCompanionAccess(tx, access.accountId, input.rawToken);
      if (!fresh || fresh.companionId !== access.companionId) {
        return err(serviceError('not_found', COMPANION_UNAVAILABLE));
      }
      if (!(await hasConsent(tx, access.accountId, 'CORE_PROCESSING'))) {
        return err(
          serviceError('consent_required', 'Confirm account consent before joining a trip.'),
        );
      }
      const companions = schema.umpeTripCompanions;
      const already = first(
        await tx
          .select({ id: companions.id })
          .from(companions)
          .where(
            and(
              eq(companions.tripId, access.tripId),
              eq(companions.joinedAccountId, access.accountId),
              eq(companions.state, 'JOINED'),
            ),
          )
          .limit(1),
      );
      if (already) return err(serviceError('not_found', COMPANION_UNAVAILABLE));
      const claimed = await tx
        .update(companions)
        .set({
          state: 'JOINED',
          joinedAccountId: access.accountId,
          shareLevel: level,
          tokenHash: null,
          expiresAt: null,
          updatedAt: new Date(),
          ...(name === undefined ? {} : { displayName: name }),
        })
        .where(
          and(
            eq(companions.id, access.companionId),
            eq(companions.tripId, access.tripId),
            eq(companions.state, 'INVITED'),
            eq(companions.tokenHash, hashInvitationToken(input.rawToken)),
            gt(companions.expiresAt, new Date()),
          ),
        )
        .returning({ id: companions.id });
      if (claimed.length === 0) return err(serviceError('not_found', COMPANION_UNAVAILABLE));
      await appendAuditEvent(tx, {
        eventType: 'UMPE_TRIP_COMPANION_ACCEPTED',
        actorAccountId: access.accountId,
        method: 'MANUAL',
        result: 'ALLOWED',
        resourceType: 'umpe_trip_companion',
        resourceId: access.companionId,
        metadata: { tripId: access.tripId, shareLevel: level, renamed: name !== undefined },
      });
      return ok({ tripId: access.tripId, shareLevel: level });
    });
  } catch (error) {
    // Joined the same trip through another invitation at the same moment.
    if (isUniqueViolation(error)) return err(serviceError('not_found', COMPANION_UNAVAILABLE));
    throw error;
  }
}

/**
 * Decline an invitation. The link stops working. The organiser is not told: it keeps reading as
 * waiting until it would have lapsed, so nothing shows whether the address has an account.
 */
export async function declineCompanionInvitation(
  db: Db,
  access: TripCompanionAccess,
  input: { readonly rawToken: string },
): Promise<Result<{ readonly declined: true }, ServiceError>> {
  const problem = tripCompanionAccessProblem(access, 'INVITED');
  if (problem) return err(problem);
  return db.transaction(async (tx) => {
    const fresh = await invitedCompanionAccess(tx, access.accountId, input.rawToken);
    if (!fresh || fresh.companionId !== access.companionId) {
      return err(serviceError('not_found', COMPANION_UNAVAILABLE));
    }
    const companions = schema.umpeTripCompanions;
    const changed = await tx
      .update(companions)
      .set({ state: 'DECLINED', tokenHash: null, updatedAt: new Date() })
      .where(
        and(
          eq(companions.id, access.companionId),
          eq(companions.state, 'INVITED'),
          eq(companions.tokenHash, hashInvitationToken(input.rawToken)),
          gt(companions.expiresAt, new Date()),
        ),
      )
      .returning({ id: companions.id });
    if (changed.length === 0) return err(serviceError('not_found', COMPANION_UNAVAILABLE));
    await appendAuditEvent(tx, {
      eventType: 'UMPE_TRIP_COMPANION_DECLINED',
      actorAccountId: access.accountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'umpe_trip_companion',
      resourceId: access.companionId,
      metadata: { tripId: access.tripId },
    });
    return ok({ declined: true as const });
  });
}

// --- Companion side: a joined companion -------------------------------------------------------

/**
 * The basics of one trip for the account behind a `TripCompanionAccess`: title, destination,
 * purpose, the name shown for them, and (joined) what they share or (invited) when the invitation
 * lapses. The row is read again here, so a removal, a leaving, a decline or an expiry since the
 * access was made reads as a missing trip.
 */
export async function readCompanionTripSummary(
  db: Db,
  access: TripCompanionAccess,
): Promise<Result<CompanionTripSummary, ServiceError>> {
  // Checked against both standings with constants, so a null or forged value is the same refusal.
  const asJoined = tripCompanionAccessProblem(access, 'JOINED');
  if (asJoined && tripCompanionAccessProblem(access, 'INVITED')) return err(asJoined);
  if (!(await tripCompanionsTablePresent(db)))
    return err(serviceError('not_found', COMPANION_UNAVAILABLE));
  const companions = schema.umpeTripCompanions;
  const live =
    access.standing === 'JOINED'
      ? and(eq(companions.state, 'JOINED'), eq(companions.joinedAccountId, access.accountId))
      : and(eq(companions.state, 'INVITED'), gt(companions.expiresAt, new Date()));
  const row = first(
    await db
      .select({
        title: schema.umpeTrips.title,
        destination: schema.umpeTrips.destination,
        purpose: schema.umpeTrips.purpose,
        displayName: companions.displayName,
        shareLevel: companions.shareLevel,
        expiresAt: companions.expiresAt,
      })
      .from(companions)
      .innerJoin(schema.umpeTrips, eq(schema.umpeTrips.id, companions.tripId))
      .where(and(eq(companions.id, access.companionId), eq(companions.tripId, access.tripId), live))
      .limit(1),
  );
  if (!row) return err(serviceError('not_found', COMPANION_UNAVAILABLE));
  return ok({
    tripId: access.tripId,
    standing: access.standing,
    title: row.title,
    destination: row.destination,
    purpose: row.purpose,
    displayName: row.displayName,
    shareLevel:
      access.standing === 'JOINED' && isShareLevel(row.shareLevel) ? row.shareLevel : null,
    expiresAt: access.standing === 'INVITED' ? (row.expiresAt?.toISOString() ?? null) : null,
  });
}

/**
 * The one read a joined companion has of a trip: its title, destination and purpose, the organiser
 * as "The organiser", the other companions who joined by the names they confirmed, and how many of
 * the organiser's own people are also travelling. Those people are never named, whoever they are.
 * Never the itinerary reference, a case, an applicant, a relationship, a document, an email or a
 * token.
 */
export async function getCompanionTrip(
  db: Db,
  access: TripCompanionAccess,
): Promise<Result<CompanionTripView, ServiceError>> {
  const problem = tripCompanionAccessProblem(access, 'JOINED');
  if (problem) return err(problem);
  const summary = await readCompanionTripSummary(db, access);
  if (!summary.ok) return summary;
  const companions = schema.umpeTripCompanions;
  const others = await db
    .select({ name: companions.displayName })
    .from(companions)
    .where(
      and(
        eq(companions.tripId, access.tripId),
        eq(companions.state, 'JOINED'),
        ne(companions.id, access.companionId),
      ),
    )
    .orderBy(asc(companions.createdAt), asc(companions.id))
    .limit(TRIP_MAX_COMPANIONS);
  const lifecycle = await lifecycleTablesPresent(db);
  const more = first(
    await db
      .select({ n: count() })
      .from(schema.umpeTripTravellers)
      .innerJoin(schema.umpeTrips, eq(schema.umpeTrips.id, schema.umpeTripTravellers.tripId))
      .innerJoin(schema.applicants, eq(schema.applicants.id, schema.umpeTripTravellers.applicantId))
      .innerJoin(schema.missions, eq(schema.missions.id, schema.umpeTripTravellers.missionId))
      .where(
        and(
          eq(schema.umpeTripTravellers.tripId, access.tripId),
          isNull(schema.umpeTripTravellers.removedAt),
          isNull(schema.missions.purgedAt),
          eq(schema.applicants.ownerAccountId, schema.umpeTrips.ownerAccountId),
          // The organiser themself is "The organiser", not one more person.
          ne(schema.applicants.relationship, 'SELF'),
          lifecycle ? presentApplicantCondition() : undefined,
        ),
      ),
  );
  return ok({
    title: summary.value.title,
    destination: summary.value.destination,
    purpose: summary.value.purpose,
    people: [ORGANISER_ORGANISER, ...others.map((o) => o.name)],
    moreTravelling: Number(more?.n ?? 0),
  });
}

/**
 * The trips this signed-in account joined, and unexpired invitations sent to its verified email
 * (listed without any link: only the emailed link can accept one). The joined trips first, then the
 * invitations, at most 50 in all.
 */
export async function listMyCompanionTrips(
  db: Db,
  accountId: string,
): Promise<readonly CompanionTripSummary[]> {
  const accesses = await myCompanionAccesses(db, accountId);
  const summaries = await Promise.all(
    accesses.map((access) => readCompanionTripSummary(db, access)),
  );
  return summaries.flatMap((summary) => (summary.ok ? [summary.value] : []));
}

/** Leave the trip, at any time. Access ends on the next read; what the organiser saw ends too. */
export async function leaveTrip(
  db: Db,
  access: TripCompanionAccess,
): Promise<Result<{ readonly left: true }, ServiceError>> {
  const problem = tripCompanionAccessProblem(access, 'JOINED');
  if (problem) return err(problem);
  return db.transaction(async (tx) => {
    const companions = schema.umpeTripCompanions;
    const changed = await tx
      .update(companions)
      .set({ state: 'LEFT', shareLevel: 'NAME_ONLY', email: null, updatedAt: new Date() })
      .where(
        and(
          eq(companions.id, access.companionId),
          eq(companions.tripId, access.tripId),
          eq(companions.state, 'JOINED'),
          eq(companions.joinedAccountId, access.accountId),
        ),
      )
      .returning({ id: companions.id });
    if (changed.length === 0) return err(serviceError('not_found', COMPANION_UNAVAILABLE));
    await withdrawPapers(tx, access.companionId);
    await appendAuditEvent(tx, {
      eventType: 'UMPE_TRIP_COMPANION_LEFT',
      actorAccountId: access.accountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'umpe_trip_companion',
      resourceId: access.companionId,
      metadata: { tripId: access.tripId },
    });
    return ok({ left: true as const });
  });
}

/**
 * Choose what the organiser sees of you: Name Only, Plan Status or Travel Bookings. Only the joined
 * companion can, only on their own row, and it takes effect on the organiser's next read. Choosing
 * Name Only withdraws everything else. Each change is audited (the level only).
 */
export async function setCompanionShareLevel(
  db: Db,
  access: TripCompanionAccess,
  level: string,
): Promise<Result<{ readonly shareLevel: CompanionShareLevel }, ServiceError>> {
  const problem = tripCompanionAccessProblem(access, 'JOINED');
  if (problem) return err(problem);
  if (!isShareLevel(level)) {
    return err(serviceError('invalid', 'Choose how much you want to share.'));
  }
  return db.transaction(async (tx) => {
    const companions = schema.umpeTripCompanions;
    const now = await tx
      .select({ shareLevel: companions.shareLevel })
      .from(companions)
      .where(
        and(
          eq(companions.id, access.companionId),
          eq(companions.tripId, access.tripId),
          eq(companions.state, 'JOINED'),
          eq(companions.joinedAccountId, access.accountId),
        ),
      )
      .for('update');
    const current = first(now);
    if (!current) return err(serviceError('not_found', COMPANION_UNAVAILABLE));
    if (current.shareLevel === level) return ok({ shareLevel: level });
    await tx
      .update(companions)
      .set({ shareLevel: level, updatedAt: new Date() })
      .where(eq(companions.id, access.companionId));
    // Papers are shown only at Travel Bookings: any other level withdraws every choice, so going
    // back up never shows something chosen long ago.
    if (level !== 'TRAVEL_BOOKINGS') await withdrawPapers(tx, access.companionId);
    await appendAuditEvent(tx, {
      eventType: 'UMPE_TRIP_COMPANION_SHARE_LEVEL_CHANGED',
      actorAccountId: access.accountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'umpe_trip_companion',
      resourceId: access.companionId,
      metadata: { tripId: access.tripId, from: current.shareLevel, to: level },
    });
    return ok({ shareLevel: level });
  });
}
