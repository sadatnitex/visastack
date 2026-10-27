/**
 * Stable HTTPS entry points into VisaStack (Lane D deep-link foundation).
 *
 * These are the same routes the website uses. Notifications, the installed app's shortcuts, a
 * later WhatsApp channel and a later Android or iOS app (App Links, Universal Links) all point
 * here, so a route listed below must keep working: `deep-links.test.ts` fails if its page file
 * moves.
 *
 * Rules:
 * - Only record ids (UUIDs) go into a link. Never a name, passport number, amount, email, file
 *   name or any other personal value, and never a credential.
 * - Opening a link proves nothing. Every page still checks the session and the person's access,
 *   and a missing or forbidden record looks the same.
 * - Single-use secrets (invitation, sharing, contributor and agency client tokens) are minted
 *   by their own services and carried only by their existing accept pages. They are not built
 *   here, so this module can never mint a bearer link.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DeepLink =
  | { readonly kind: 'workspace' }
  | { readonly kind: 'notifications' }
  | { readonly kind: 'case'; readonly caseId: string }
  | { readonly kind: 'traveller'; readonly applicantId: string }
  | { readonly kind: 'documents'; readonly applicantId: string }
  | { readonly kind: 'requested-evidence'; readonly applicantId: string }
  | { readonly kind: 'profile-review'; readonly applicantId: string }
  | { readonly kind: 'expiry'; readonly applicantId: string }
  | { readonly kind: 'sharing-review'; readonly applicantId: string }
  | { readonly kind: 'shared-with-me'; readonly grantId: string };

export type DeepLinkKind = DeepLink['kind'];

/** Each kind's route, in the App Router's own `[param]` form (checked against the page files). */
export const DEEP_LINK_ROUTES: Readonly<Record<DeepLinkKind, string>> = {
  workspace: '/app',
  notifications: '/app/notifications',
  case: '/app/mission/[id]',
  traveller: '/app/applicant/[id]',
  documents: '/app/applicant/[id]/documents',
  'requested-evidence': '/app/applicant/[id]/evidence',
  'profile-review': '/app/applicant/[id]/profile',
  expiry: '/app/applicant/[id]/expiry',
  'sharing-review': '/app/applicant/[id]/sharing',
  'shared-with-me': '/app/shared/[grantId]',
};

export class InvalidDeepLinkError extends Error {
  constructor(kind: DeepLinkKind) {
    super(`A ${kind} link needs a record id`);
    this.name = 'InvalidDeepLinkError';
  }
}

function recordId(link: DeepLink): string | undefined {
  if ('caseId' in link) return link.caseId;
  if ('applicantId' in link) return link.applicantId;
  if ('grantId' in link) return link.grantId;
  return undefined;
}

/** The site-relative path for a link. Throws when an id is not a UUID. */
export function deepLinkPath(link: DeepLink): string {
  const route = DEEP_LINK_ROUTES[link.kind];
  const id = recordId(link);
  if (id === undefined) return route;
  if (!UUID.test(id)) throw new InvalidDeepLinkError(link.kind);
  return route.replace(/\[[A-Za-z]+\]/, id.toLowerCase());
}

/** The absolute link for messages sent outside the site (email, WhatsApp, a native app). */
export function deepLinkUrl(origin: string, link: DeepLink): string {
  return new URL(deepLinkPath(link), origin).toString();
}
