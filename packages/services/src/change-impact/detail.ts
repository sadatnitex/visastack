import { type Result, ok } from '@visastack/core';
import { knownFieldOptions } from '@visastack/core/catalogue';
import type { AuthorizedApplicant } from '../access/require-access';
import type { ServiceError } from '../errors';
import { isUuid } from '../lifecycle/foundation/ids';
import { isInactiveCaseState } from '../umpe-package-tables';
import {
  type DetailFacts,
  type DraftItem,
  type RecordedDetail,
  assembleImpact,
  classifyDetailCase,
  classifyDetailShare,
  couldNotCheck,
  shareItem,
} from './classify';
import type { AssessChangeOptions, AssessDetailChangeInput, ChangeImpact } from './contract';
import {
  type CaseRow,
  casesSelecting,
  collectionAnswersCarrying,
  confirmationsOf,
  detailRequestHistories,
  finishedCasesWithCopyOf,
  liveShares,
  lockDetailSubject,
  savedCopiesOf,
  shareReachOf,
} from './load';
import {
  type SendRules,
  agenciesAmong,
  collectionAnswerDrafts,
  evidenceRequestItem,
  isOwnersProof,
  refused,
  runRead,
} from './shared';

const FIELD_LABELS: ReadonlyMap<string, string> = new Map(
  knownFieldOptions().map((field) => [field.key, field.label] as const),
);

/** The detail's plain name: the catalogue's label, else the key written as a title. */
export function detailLabel(fieldKey: string): string {
  return (
    FIELD_LABELS.get(fieldKey) ??
    fieldKey
      .split(/[._\s]+/)
      .filter((word) => word.length > 0)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ')
  );
}

/**
 * What changing one confirmed detail means for the traveller's live cases, the answers agencies
 * hold, sharing already set up and finished work (see `contract.ts`). A read: it writes nothing
 * and never returns a value of the detail, only its name, dates and how many values it has had.
 *
 * `access` is the record owner's own MANAGE proof from `requireAccess` for the applicant. Anyone
 * else, a detail of someone else and a made-up id get the gate's single refusal after the same
 * lookups.
 */
export async function assessDetailChangeImpact(
  access: AuthorizedApplicant<'MANAGE'>,
  input: AssessDetailChangeInput,
  options: AssessChangeOptions = {},
): Promise<Result<ChangeImpact, ServiceError>> {
  if (!isOwnersProof(access) || access.resource.kind !== 'applicant') return refused();
  if (!isUuid(input.factId)) return refused();
  const factId = input.factId.toLowerCase();
  const now = options.now ?? new Date();

  return runRead(access, async (tx, present) => {
    const subject = await lockDetailSubject(access, tx, factId);
    if (!subject) return refused();
    const versionIds = new Set(subject.versions.map((version) => version.id));
    const current = subject.versions.find((version) => version.id === subject.currentVersionId);
    const newest = subject.versions[subject.versions.length - 1];
    // Saving a detail again without changing it records a new saved value. Wherever the rules
    // ask "is this the current value", a saved value with exactly the current text is the
    // current value (the reader compares; no value comes this far). A protected detail is never
    // opened here, so for it only the current saved value itself counts.
    const sameValueIds = new Set(
      subject.versions.filter((version) => version.sameAsCurrent).map((version) => version.id),
    );
    const detail: DetailFacts = {
      currentVersionId: subject.currentVersionId,
      savedValues: subject.versions.length,
      sameValueIds,
      valueChanged: subject.versions.some((version) => !version.sameAsCurrent),
    };
    // The moment from which the detail has held its current value without interruption: the
    // start of the run of saved values, up to the newest, that all hold it. Null when the newest
    // saved value is not the current one.
    let heldSince: Date | null = null;
    if (newest !== undefined && current !== undefined && newest.id === current.id) {
      for (let i = subject.versions.length - 1; i >= 0; i -= 1) {
        const version = subject.versions[i];
        if (!version?.sameAsCurrent) break;
        heldSince = version.savedAt;
      }
    }
    const drafts: DraftItem[] = [];

    // Cases.
    const selecting = await casesSelecting(access, tx, { factId });
    const selectingIds = new Set(selecting.map((row) => row.id));
    const copied = await finishedCasesWithCopyOf(access, tx, { factId });
    const cases = new Map<string, CaseRow>();
    for (const row of [...selecting, ...copied]) cases.set(row.id, row);
    const live = [...cases.values()].filter((row) => !isInactiveCaseState(row.state));
    const finished = [...cases.values()].filter((row) => isInactiveCaseState(row.state));
    const confirmations = await confirmationsOf(access, tx, live);
    const copies = await savedCopiesOf(access, tx, finished);
    for (const row of live) {
      const confirmation = confirmations.get(row.id);
      const recordedIds = confirmation?.recordedFactVersionIds ?? null;
      const ofThisDetail = recordedIds?.filter((id) => versionIds.has(id)) ?? [];
      const recorded: RecordedDetail =
        recordedIds === null
          ? { kind: 'INEXACT' }
          : ofThisDetail.length === 0
            ? { kind: 'ABSENT' }
            : { kind: 'VERSIONS', versionIds: ofThisDetail };
      const item = classifyDetailCase(
        {
          missionId: row.id,
          title: row.title,
          live: true,
          createdAt: row.createdAt,
          selects: selectingIds.has(row.id),
          everConfirmed: confirmation !== undefined,
          confirmationLive: confirmation?.live ?? false,
          recorded,
        },
        detail,
      );
      if (item) drafts.push(item);
    }
    for (const row of finished) {
      const copy = copies.get(row.id) ?? null;
      const held = [...(copy?.byRequirement.values() ?? [])].flatMap((used) =>
        used.facts.filter((fact) => fact.factId === factId),
      );
      const heldIds = held.flatMap((fact) => (fact.factVersionId ? [fact.factVersionId] : []));
      const recorded: RecordedDetail =
        copy === null
          ? { kind: 'NO_COPY' }
          : held.length === 0
            ? { kind: 'ABSENT' }
            : heldIds.length < held.length
              ? { kind: 'INEXACT' }
              : { kind: 'VERSIONS', versionIds: heldIds };
      const item = classifyDetailCase(
        {
          missionId: row.id,
          title: row.title,
          live: false,
          createdAt: row.createdAt,
          selects: selectingIds.has(row.id),
          everConfirmed: false,
          confirmationLive: false,
          recorded,
        },
        detail,
      );
      if (item) drafts.push(item);
    }

    // Sharing. A share follows the detail, never one saved value of it.
    const shares = await liveShares(access, tx, now);
    for (const share of shares) {
      const reason = classifyDetailShare(
        shareReachOf(share, { subject: { category: subject.category } }),
      );
      if (reason) drafts.push(shareItem(share, reason));
    }

    // Sends to agencies, each judged on its latest round.
    /**
     * A send recorded before exact values were kept could have carried another value unless no
     * saved value differs from the current one, or the send is provably later than the moment
     * the detail came to hold its current value.
     */
    const couldDiffer = (sentAt: Date | null): boolean => {
      if (!detail.valueChanged) return false;
      return !(sentAt !== null && heldSince !== null && sentAt.getTime() >= heldSince.getTime());
    };
    const rules: SendRules = {
      carriesOf: (round) => {
        if (round.precision === 'legacy') {
          if (round.subjectId !== factId) return 'OTHER';
          return couldDiffer(round.sentAt) ? 'UNPINNED' : 'CURRENT';
        }
        if (round.send.subjectId !== factId) return 'OTHER';
        if (!round.send.intact) return 'BROKEN';
        return sameValueIds.has(round.send.versionId) ? 'CURRENT' : 'EARLIER';
      },
      waitingSendMatches: () => true,
      carriedWithoutRecord: (respondingId) =>
        respondingId !== factId ? 'OTHER' : couldDiffer(null) ? 'UNPINNED' : 'CURRENT',
      waitsEvenOnCurrent: true,
      agenciesWithLiveShare: agenciesAmong(shares),
    };
    const histories = await detailRequestHistories(
      access,
      tx,
      factId,
      versionIds,
      present.detailPins,
    );
    for (const history of histories) {
      const item = evidenceRequestItem(history, rules);
      if (item) drafts.push(item);
    }
    if (present.collectionResponses) {
      const answers = await collectionAnswersCarrying(access, tx, { factId });
      drafts.push(
        ...collectionAnswerDrafts(answers, (answer) =>
          answer.carriedIds.length === 0
            ? 'OTHER'
            : answer.carriedIds.every((id) => sameValueIds.has(id))
              ? 'CURRENT'
              : 'EARLIER',
        ),
      );
    } else {
      drafts.push(couldNotCheck('AGENCY_REQUESTS'));
    }

    return ok(
      assembleImpact({
        subject: {
          kind: 'DETAIL',
          factId,
          label: detailLabel(subject.fieldKey),
          changedAt: current?.savedAt ?? null,
          savedValues: subject.versions.length,
        },
        phase: 'RECORDED',
        drafts,
        assessedAt: now,
      }),
    );
  });
}
