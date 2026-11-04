import 'server-only';
import {
  type Db,
  EACH_GRANT,
  type EvidenceSubmissionList,
  type VersionScanEvidence,
  accountPrincipal,
  deriveVersionScanEvidence,
  listEvidenceSubmissions,
  loadVersionScanEvidence,
  requireAccess,
} from '@visastack/services';
import { reportServerError } from '../../../../lib/server-error';
import type { EvidenceRequestRow } from './console-data';

/**
 * The exact copies a traveller sent for each document request on an agency's request list, read
 * for the evidence copies card (Lane E). The service decides who may see what: every read below
 * goes through `listEvidenceSubmissions` with this organization's own MANAGE proof, which checks
 * again that the caller is an owner or admin of the asking organization that still holds its
 * grant. A request the proof is refused for is simply absent from the result; the card then says
 * the copies could not be shown and the decision buttons stay hidden, so nothing is ever decided
 * on a copy the reviewer was not shown.
 */

/** Requests where a sent copy exists to show: one is waiting, was decided, or was sent back. */
export const COPIES_STATUSES: ReadonlySet<string> = new Set([
  'RECEIVED',
  'UNDER_REVIEW',
  'NEEDS_REPLACEMENT',
  'ACCEPTED',
]);

/**
 * The most requests read in one page view. The Clients page never lists more than 90 requests
 * and can show one more linked request from off the page, so every request on screen is covered;
 * the bound only stops an unexpected caller.
 */
export const COPIES_CAP = 91;

export interface EvidenceCopies {
  readonly list: EvidenceSubmissionList;
  /** How each sent file was checked, by version id. Never says "scanned" without a trusted scan. */
  readonly scan: ReadonlyMap<string, VersionScanEvidence>;
}

type Scope = { readonly applicantId: string } | { readonly missionId: string };

/** The sent copies of each listed document request, by request id. */
export async function loadEvidenceCopies(
  db: Db,
  accountId: string,
  orgId: string,
  requests: readonly EvidenceRequestRow[],
): Promise<ReadonlyMap<string, EvidenceCopies>> {
  // A request can be on the list and also be the one a link pointed at: read it once.
  const eligible = [...new Map(requests.map((r) => [r.id, r] as const)).values()]
    .filter((r) => r.kind === 'DOCUMENT' && COPIES_STATUSES.has(r.status))
    .slice(0, COPIES_CAP);
  const scopes = new Map<string, { ref: Scope; requests: EvidenceRequestRow[] }>();
  for (const r of eligible) {
    const key = r.missionId ? `m:${r.missionId}` : `a:${r.applicantId}`;
    const entry = scopes.get(key) ?? {
      ref: r.missionId ? { missionId: r.missionId } : { applicantId: r.applicantId },
      requests: [],
    };
    entry.requests.push(r);
    scopes.set(key, entry);
  }
  const out = new Map<string, EvidenceCopies>();
  const options = { purpose: EACH_GRANT, actingFor: { organizationId: orgId } } as const;
  await Promise.all(
    [...scopes.values()].map(async ({ ref, requests: inScope }) => {
      try {
        await readScope(db, accountId, ref, inScope, options, out);
      } catch (error) {
        // A failed read leaves these requests out: the card says so and offers no decision.
        reportServerError('evidenceCopiesRead', error, { step: 'read failed' });
      }
    }),
  );
  return out;
}

async function readScope(
  db: Db,
  accountId: string,
  ref: Scope,
  inScope: readonly EvidenceRequestRow[],
  options: {
    readonly purpose: typeof EACH_GRANT;
    readonly actingFor: { readonly organizationId: string };
  },
  out: Map<string, EvidenceCopies>,
): Promise<void> {
  const manage = await requireAccess(db, accountPrincipal(accountId), 'MANAGE', ref, options);
  // Refused: this organization can no longer manage that case, so its files stay unread.
  if (!manage.ok) return;
  const lists = new Map<string, EvidenceSubmissionList>();
  for (const r of inScope) {
    const listed = await listEvidenceSubmissions(manage.value, { requestId: r.id });
    if (listed.ok) lists.set(r.id, listed.value);
  }
  const versions = [...lists.values()].flatMap((list) =>
    list.submissions.flatMap((s) =>
      s.safetyStatus ? [{ id: s.documentVersionId, safetyStatus: s.safetyStatus }] : [],
    ),
  );
  // Scan evidence is read with its own VIEW_METADATA proof (a MANAGE proof is not accepted).
  // Without that proof every file reads as format checked at most, never as virus scanned.
  const view = await requireAccess(db, accountPrincipal(accountId), 'VIEW_METADATA', ref, options);
  const scan: ReadonlyMap<string, VersionScanEvidence> = view.ok
    ? await loadVersionScanEvidence(view.value, versions)
    : new Map(
        versions.map(
          (v) =>
            [
              v.id,
              deriveVersionScanEvidence({ safetyStatus: v.safetyStatus, records: [] }),
            ] as const,
        ),
      );
  for (const [requestId, list] of lists) out.set(requestId, { list, scan });
}
