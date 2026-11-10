import { isFactStatusEligible } from '@visastack/services';
import { humanizeCode } from '../../../../lib/format-code';
import { documentKindLabel } from '../../../../lib/item-names';
import { fieldLabel } from '../../../../lib/master-profile';
import type { CaseEvidenceCandidates } from './case-secondary';
import type { CandidateView } from './collaboration-panels';
import type { EvidenceLifecycleLabels } from './evidence-lifecycle';

/**
 * The files and answers on file for each checklist item, as the Select Evidence panel and each
 * item's panel draw them. Built once, from what the page already read.
 */
export function candidateViews(
  candidates: CaseEvidenceCandidates,
  evidenceLifecycle: Pick<EvidenceLifecycleLabels, 'byDocument'>,
  selectionIdsByCandidate: Readonly<Record<string, string>>,
): CandidateView[] {
  return candidates.map((c) => ({
    packRequirementId: c.packRequirementId,
    kind: c.kind,
    label:
      c.kind === 'FIELD' ? (fieldLabel(c.key) ?? humanizeCode(c.key)) : documentKindLabel(c.key),
    citation: c.citation,
    factCandidates: c.factCandidates.map((f) => ({
      factId: f.factId,
      value: f.value,
      repeatingRecordKey: f.repeatingRecordKey,
      eligible: isFactStatusEligible(f.status),
    })),
    documentCandidates: c.documentCandidates.map((d) => ({
      documentId: d.documentId,
      displayName: d.displayName,
      eligible: d.eligible,
      staleness: d.staleness.status,
      lifecycleLabel: evidenceLifecycle.byDocument[d.documentId] ?? null,
    })),
    selectedFactIds: c.selectedFactIds,
    selectedDocumentIds: c.selectedDocumentIds,
    selectionIdsByCandidate,
  }));
}
