import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import {
  type AgencyCollectionScope,
  agencyCollectionScopeProblem,
} from './access/collection-scope';
import type { Db } from './db';
import { cleanAgencyName } from './email-design';
import { enqueueNotification } from './notifications';
import type { KeyManagementPort } from './ports';

/**
 * Which secret a sealed email carries: an invitation link, a request for one document from someone
 * else, an agency's document request sent before any traveller record (`collection`, UMPE P6), or a
 * guest's six-digit one-time code for that request's desk (`guest_code`, UMPE P8; the sealed value
 * is the code itself, never a link), or an invitation to travel with someone (`companion`, UMPE UX6;
 * it opens its own accept page, and the invitation id is the companion's row).
 */
export type InvitationLinkKind =
  | 'team'
  | 'client'
  | 'sharing'
  | 'contributor'
  | 'collection'
  | 'guest_code'
  | 'companion';

/**
 * The path a link of this kind opens. A contributor request opens its own page, not an invitation;
 * an agency document request opens the public `/collect` page, which moves the token into a cookie
 * and drops it from the address at once.
 */
function linkPath(kind: InvitationLinkKind, rawToken: string): string {
  if (kind === 'guest_code') {
    if (!GUEST_CODE_SHAPE.test(rawToken)) throw new Error('a guest code must be six digits');
    return rawToken;
  }
  const token = encodeURIComponent(rawToken);
  if (kind === 'contributor') return `/app/contributor-requests/accept?token=${token}`;
  if (kind === 'companion') return `/app/trip-invitations/accept?token=${token}`;
  if (kind === 'collection') return `/collect/open?token=${token}`;
  return `/invitation?kind=${kind}&token=${token}`;
}

/** The notification event of an invitation to travel with someone (UMPE UX6). */
export const COMPANION_INVITATION_EMAIL_EVENT = 'TRIP_COMPANION_INVITATION_CREATED';

/** The notification event of an agency document request email (UMPE P6). */
export const COLLECTION_REQUEST_EMAIL_EVENT = 'AGENCY_COLLECTION_REQUEST_SENT';

/** The notification event of a guest's one-time code email (UMPE P8). */
export const GUEST_CODE_EMAIL_EVENT = 'AGENCY_COLLECTION_GUEST_CODE';

const GUEST_CODE_SHAPE = /^\d{6}$/;

// --- UMPE G3: a guest's correction email -------------------------------------------------------
/** The notification event telling a guest the agency asked for a correction (UMPE G3). */
export const GUEST_CORRECTION_EMAIL_EVENT = 'AGENCY_COLLECTION_GUEST_CORRECTION';

/**
 * The subject and summary of a guest correction email. The subject names the agency only (and only
 * an ACTIVE one); never the person, the route, the documents or the agency's notes.
 */
export function guestCorrectionCopy(agencyName: string | null | undefined): {
  readonly subject: string;
  readonly summary: string;
} {
  const name = cleanAgencyName(agencyName);
  if (name.length === 0) {
    return {
      subject: 'An agency asked you to correct your documents',
      summary:
        'The agency you sent documents to through VisaStack asked you to correct something. Open the request to read their notes and send again.',
    };
  }
  return {
    subject: `${name} asked you to correct your documents`,
    summary: `${name} asked you, through VisaStack, to correct something in the documents you sent. Open the request to read their notes and send again.`,
  };
}

/**
 * The subject and summary of an agency collection email as it is sent (UMPE G3): rebuilt from the
 * agency's name read at send time, given only while VisaStack has reviewed it (ACTIVE), so an email
 * never names an agency that is no longer reviewed. Null for any other email.
 */
export function agencyEmailCopyAtSend(
  eventType: string,
  agencyName: string | null,
): { readonly subject: string; readonly summary: string } | null {
  if (eventType === COLLECTION_REQUEST_EMAIL_EVENT) return collectionCopy(agencyName);
  if (eventType === GUEST_CODE_EMAIL_EVENT) return guestCodeCopy(agencyName);
  if (eventType === GUEST_CORRECTION_EMAIL_EVENT) return guestCorrectionCopy(agencyName);
  return null;
}

/**
 * Queue the correction email for one review decision (the resource), inside the caller's
 * transaction. The address is the request's own (the one the guest proved); the worker checks again
 * at send time that the decision, the link and the request are all still open.
 */
export async function queueGuestCorrectionEmail(
  tx: Db,
  scope: AgencyCollectionScope,
  input: {
    readonly reviewId: string;
    readonly email: string;
    readonly agencyName: string | null;
  },
): Promise<boolean> {
  if (agencyCollectionScopeProblem(scope)) return false;
  const copy = guestCorrectionCopy(input.agencyName);
  return enqueueNotification(tx, {
    eventType: GUEST_CORRECTION_EMAIL_EVENT,
    channel: 'EMAIL',
    resourceId: input.reviewId,
    recipientEmail: input.email,
    organizationId: scope.organizationId,
    payload: { subject: copy.subject, summary: copy.summary, deepLinkPath: '/collect' },
  });
}

const EMAIL_EVENT: Record<InvitationLinkKind, string> = {
  team: 'TEAM_INVITATION_CREATED',
  client: 'CLIENT_INVITATION_CREATED',
  sharing: 'SHARING_INVITATION_CREATED',
  contributor: 'CONTRIBUTOR_REQUEST_CREATED',
  collection: COLLECTION_REQUEST_EMAIL_EVENT,
  guest_code: GUEST_CODE_EMAIL_EVENT,
  companion: COMPANION_INVITATION_EMAIL_EVENT,
};

const EMAIL_SUBJECT: Record<InvitationLinkKind, string> = {
  team: 'Your VisaStack team invitation',
  client: 'Your VisaStack agency invitation',
  sharing: 'Your VisaStack sharing invitation',
  contributor: 'Someone asked you for a document on VisaStack',
  collection: 'An agency asked you for documents through VisaStack',
  guest_code: 'Your VisaStack code',
  companion: 'You were added to a trip on VisaStack',
};

const EMAIL_SUMMARY: Record<InvitationLinkKind, string> = {
  team: 'You have been invited to join an agency team on VisaStack. Open the link, create an account or sign in using this email address, then review and accept your role. The link expires in 7 days. If you were not expecting it, ignore this email.',
  sharing:
    'You have been invited to review shared information on VisaStack. Use this email address to create an account or sign in, review the purpose, permissions and expiry, then accept only if you agree. Opening the link grants no access. This link expires within 7 days. If you were not expecting it, ignore this email.',
  client:
    'An agency has invited you to work together on VisaStack. Open the link, create an account or sign in, then review the agency and requested access. You choose your profile and confirm sharing before anything is connected. The link expires in 7 days. If you were not expecting it, ignore this email.',
  contributor:
    'Someone you know has asked you, through VisaStack, for one document for their visa case. Open the link, create an account or sign in using this email address, then see exactly what is asked and why before you decide. You can upload it or leave it. The link expires in 7 days. If you were not expecting it, ignore this email.',
  collection:
    'An agency has asked you, through VisaStack, for documents. Open the link to see who is asking. Opening it shares nothing. The link expires in 14 days. If you were not expecting it, ignore this email.',
  guest_code: guestCodeSummary('an agency'),
  // Never the organiser, the trip, the route or anyone else on it: the page says all of that, and
  // only to the person this address belongs to once they have signed in.
  companion:
    'Someone added you to a trip on VisaStack. Open the link, then sign in or create an account with this email address. Opening the link joins nothing. The link lasts 7 days.',
};

function guestCodeSummary(who: string): string {
  return `Someone asked for a code to answer a document request from ${who} on VisaStack. The code works for 10 minutes, on the page where it was asked for. If this was not you, ignore this email: nothing is shared without the code.`;
}

/**
 * The subject and summary of an agency document request email. Never the route, the documents or
 * the person: only the agency's name, and that only for an agency VisaStack has reviewed (ACTIVE).
 */
function collectionCopy(agencyName: string | null | undefined): {
  readonly subject: string;
  readonly summary: string;
} {
  const name = cleanAgencyName(agencyName);
  if (name.length === 0) {
    return { subject: EMAIL_SUBJECT.collection, summary: EMAIL_SUMMARY.collection };
  }
  return {
    subject: `${name} asked you for documents through VisaStack`,
    summary: `${name} has asked you, through VisaStack, for documents. Open the link to see the request. Opening it shares nothing. The link expires in 14 days. If you were not expecting it, ignore this email.`,
  };
}

/**
 * The subject and summary of a guest code email (UMPE P8). Never the route, the documents, the
 * person or the code (it travels sealed and is added only when the email is written at send time).
 */
function guestCodeCopy(agencyName: string | null | undefined): {
  readonly subject: string;
  readonly summary: string;
} {
  const name = cleanAgencyName(agencyName);
  return {
    subject: EMAIL_SUBJECT.guest_code,
    summary: name.length > 0 ? guestCodeSummary(name) : EMAIL_SUMMARY.guest_code,
  };
}

/** Only ciphertext enters the durable outbox. A database copy cannot recover an invite token. */
export interface SealedInvitationLink {
  readonly keyVersion: string;
  readonly wrappedKey: string;
  /** Which key wrapped it; absent on links sealed before the key service existed (the local key). */
  readonly wrappingKeyId?: string;
  readonly nonce: string;
  readonly tag: string;
  readonly ciphertext: string;
}

export async function queueInvitationEmail(
  tx: Db,
  input: {
    readonly kind: InvitationLinkKind;
    readonly invitationId: string;
    readonly organizationId?: string;
    readonly email: string;
    readonly rawToken: string;
    readonly encryption: KeyManagementPort;
    /** `collection` and `guest_code` only: the agency's name, given only for an ACTIVE agency. */
    readonly agencyName?: string | null;
    /**
     * `companion` only: tells one sending of the same invitation from the next (the time the link
     * lapses), so Send Again is not swallowed as a duplicate of the first email.
     */
    readonly issue?: string;
  },
): Promise<void> {
  const dataKey = await input.encryption.generateDataKey();
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', dataKey.plaintextDataKey, nonce);
  cipher.setAAD(Buffer.from(`invitation:${input.kind}:${input.invitationId}`));
  const path = linkPath(input.kind, input.rawToken);
  const ciphertext = Buffer.concat([cipher.update(path, 'utf8'), cipher.final()]);
  const copy =
    input.kind === 'collection'
      ? collectionCopy(input.agencyName)
      : input.kind === 'guest_code'
        ? guestCodeCopy(input.agencyName)
        : { subject: EMAIL_SUBJECT[input.kind], summary: EMAIL_SUMMARY[input.kind] };
  await enqueueNotification(tx, {
    eventType: EMAIL_EVENT[input.kind],
    channel: 'EMAIL',
    resourceId: input.invitationId,
    recipientEmail: input.email,
    ...(input.issue ? { threshold: input.issue } : {}),
    ...(input.organizationId ? { organizationId: input.organizationId } : {}),
    payload: {
      subject: copy.subject,
      summary: copy.summary,
      deepLinkPath:
        input.kind === 'contributor'
          ? '/app/contributor-requests/accept'
          : input.kind === 'companion'
            ? '/app/trip-invitations/accept'
            : input.kind === 'collection'
              ? '/collect'
              : input.kind === 'guest_code'
                ? '/collect?step=guest'
                : '/invitation',
      sealedInvitationLink: {
        keyVersion: dataKey.keyVersion,
        wrappedKey: Buffer.from(dataKey.wrappedDataKey).toString('base64'),
        ...(dataKey.wrappingKeyId ? { wrappingKeyId: dataKey.wrappingKeyId } : {}),
        nonce: nonce.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        ciphertext: ciphertext.toString('base64'),
      },
    },
  });
}

export async function revealInvitationLink(
  sealed: SealedInvitationLink,
  kind: InvitationLinkKind,
  invitationId: string,
  encryption: KeyManagementPort,
): Promise<string> {
  const key = await encryption.unwrapDataKey(
    sealed.keyVersion,
    Buffer.from(sealed.wrappedKey, 'base64'),
    sealed.wrappingKeyId ?? null,
  );
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.nonce, 'base64'));
  decipher.setAAD(Buffer.from(`invitation:${kind}:${invitationId}`));
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
  const path = Buffer.concat([
    decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
  const valid =
    kind === 'contributor'
      ? /^\/app\/contributor-requests\/accept\?token=[A-Za-z0-9_-]{43}$/.test(path)
      : kind === 'companion'
        ? /^\/app\/trip-invitations\/accept\?token=[A-Za-z0-9_-]{43}$/.test(path)
        : kind === 'collection'
          ? /^\/collect\/open\?token=[A-Za-z0-9_-]{43}$/.test(path)
          : kind === 'guest_code'
            ? GUEST_CODE_SHAPE.test(path)
            : /^\/invitation\?kind=(team|client|sharing)&token=[A-Za-z0-9_-]{43}$/.test(path);
  if (!valid) throw new Error('Invalid invitation link');
  return path;
}
