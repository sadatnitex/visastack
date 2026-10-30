import { type Result, err, ok } from '@visastack/core';
import { and, eq, not } from 'drizzle-orm';
import { AuthorizedApplicant } from './access/require-access';
import { connectorRunsOnly } from './ai-run-kinds';
import { schema } from './db';
import { listDocumentsDetailed } from './documents';
import { type ServiceError, serviceError } from './errors';
import { getReminderThresholds } from './expiry';
import {
  type InsightCaseInput,
  type InsightDocumentInput,
  type TravellerInsights,
  buildTravellerInsights,
} from './insights';
import { computeReadiness, listMissions } from './missions';
import type { KeyManagementPort } from './ports';
import { isProtectedPlaceholder, listApplicantProfile } from './profile';
import { getProfileSectionState } from './profile-sections';
import { getWalletView } from './wallet';

/** Cases that are over: their readiness and originals no longer need doing. */
const FINISHED_CASE_STATES: ReadonlySet<string> = new Set(['CLOSED', 'CANCELLED']);

export interface TravellerInsightsOptions {
  /**
   * Lets a protected saved value be read on the server so a reading can be compared with it. The
   * value itself never leaves this function. Without it, such readings are counted as not compared.
   */
  readonly encryption?: KeyManagementPort;
  /**
   * The clock for the expiry timeline and for case readiness (tests). Access is always decided by
   * the gate on the real clock.
   */
  readonly now?: Date;
}

/**
 * Read-only traveller insights for the traveller's owner (AI data plan Phase 2). Takes a proof from
 * the central access gate, and further requires that the proof was issued to the owner: insights
 * are owner-only, exactly like the documents page, so a sharing grant (an agency or another
 * person) is refused even when it would allow viewing. Nothing is written.
 */
export async function getTravellerInsights(
  access: AuthorizedApplicant<'VIEW_METADATA'>,
  options: TravellerInsightsOptions = {},
): Promise<Result<TravellerInsights, ServiceError>> {
  if (
    !AuthorizedApplicant.isGenuine(access, 'VIEW_METADATA') ||
    access.actor.kind !== 'applicant_owner' ||
    access.resource.kind !== 'applicant'
  ) {
    return err(serviceError('forbidden', 'insights are available to the owner only'));
  }
  const db = access.tx;
  const applicantId = access.applicant.id;
  const ownerAccountId = access.applicant.ownerAccountId;
  const now = options.now ?? new Date();

  const [detailed, wallet, missions, sections, pendingReadings, pendingChecks] = await Promise.all([
    listDocumentsDetailed(db, ownerAccountId, applicantId),
    getWalletView(db, { actorAccountId: ownerAccountId, applicantId }),
    listMissions(db, ownerAccountId, applicantId),
    getProfileSectionState(db, applicantId),
    db
      .select({
        documentId: schema.documentVersions.documentId,
        fieldKey: schema.fieldProposals.fieldKey,
        value: schema.fieldProposals.value,
      })
      .from(schema.fieldProposals)
      .innerJoin(
        schema.documentVersions,
        eq(schema.documentVersions.id, schema.fieldProposals.documentVersionId),
      )
      .innerJoin(
        schema.aiExtractionRuns,
        eq(schema.aiExtractionRuns.id, schema.fieldProposals.aiExtractionRunId),
      )
      .where(
        and(
          eq(schema.fieldProposals.applicantId, applicantId),
          eq(schema.fieldProposals.status, 'PENDING'),
          // Only what was read from a file: an AI app's claim about a document is not a reading
          // of it (S21), so it never appears here as one.
          not(connectorRunsOnly(schema.aiExtractionRuns.modelVersion)),
        ),
      ),
    db
      .select({ documentId: schema.documentVersions.documentId })
      .from(schema.documentInconsistencyFlags)
      .innerJoin(
        schema.documentVersions,
        eq(schema.documentVersions.id, schema.documentInconsistencyFlags.documentVersionId),
      )
      .where(
        and(
          eq(schema.documentInconsistencyFlags.applicantId, applicantId),
          eq(schema.documentInconsistencyFlags.status, 'PENDING'),
        ),
      ),
  ]);
  // A list that could not load is reported as unavailable, never as "nothing here".
  if (!detailed.ok) return detailed;
  if (!wallet.ok) return wallet;
  if (!missions.ok) return missions;

  const readings = pendingReadings.flatMap((row) =>
    row.fieldKey ? [{ documentId: row.documentId, fieldKey: row.fieldKey, value: row.value }] : [],
  );
  // Protected values are read only when there is a reading to compare them with.
  const reveal = readings.length > 0 ? options.encryption : undefined;
  const profile = await listApplicantProfile(db, applicantId, reveal);

  const lifecycle = new Map(
    wallet.value.map((entry) => [entry.document.id, entry.status] as const),
  );
  const kinds = [...new Set(detailed.value.map((doc) => doc.docType))];
  const thresholdList = await Promise.all(kinds.map((kind) => getReminderThresholds(db, kind)));
  const thresholds = new Map(kinds.map((kind, i) => [kind, thresholdList[i] ?? []] as const));
  // Only documents shown in the traveller's own wallet are summarised.
  const documents: InsightDocumentInput[] = detailed.value.flatMap((doc) => {
    const status = lifecycle.get(doc.id);
    if (!status) return [];
    return [
      {
        id: doc.id,
        docType: doc.docType,
        expiresAt: doc.expiresAt,
        lifecycle: status,
        safetyStatus: doc.safetyStatus,
        createdAt: doc.createdAt,
        reminderThresholds: thresholds.get(doc.docType) ?? [],
      },
    ];
  });

  const active = missions.value
    .filter((mission) => !FINISHED_CASE_STATES.has(mission.state))
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  const readinessList = await Promise.all(
    active.map((mission) =>
      mission.packVersionId ? computeReadiness(db, mission.id, now) : Promise.resolve(null),
    ),
  );
  const cases: InsightCaseInput[] = active.map((mission, i) => {
    const readiness = readinessList[i];
    // A checklist whose readiness could not be worked out is reported as unavailable, never as
    // "no checklist".
    return {
      id: mission.id,
      title: mission.title,
      hasChecklist: mission.packVersionId !== null,
      readiness: readiness?.ok ? readiness.value : null,
    };
  });

  return ok(
    buildTravellerInsights({
      documents,
      facts: profile.map((entry) => ({
        fieldKey: entry.fieldKey,
        repeatingRecordKey: entry.repeatingRecordKey,
        status: entry.status,
        isProtected: entry.isProtected,
        value: entry.value,
        // A protected value is compared only when it was really read: a stand-in (no key, or a
        // value that could not be decrypted) is never reported as a difference.
        comparable:
          !entry.isProtected || (reveal !== undefined && !isProtectedPlaceholder(entry.value)),
        sourceDocumentId: entry.sourceDocumentId,
      })),
      pendingReadings: readings,
      pendingCheckDocumentIds: pendingChecks.map((row) => row.documentId),
      sections,
      cases,
      now,
    }),
  );
}
