import type { VersionScanEvidence, VersionScanKind } from '@visastack/services';

/**
 * How a document's checks are put into words. Pure and free of server code, so a page, a client
 * component or another screen can all use it.
 *
 * The rule behind every sentence here: a file is called "scanned for viruses" only when a trusted
 * antivirus engine recorded a pass for that exact file (`loadVersionScanEvidence`, services). The
 * built-in checks look at the file type and structure only, so they are called "Format Checked"
 * and the sentence says plainly that no virus scan happened. The stored CLEAN value is not
 * reworded or removed: it keeps deciding who can open a file. This module only changes the words.
 *
 * Lane handoff (agency review and the traveller's evidence picker): pass the version's
 * `VersionScanEvidence` to `presentScanState` and show `label`, `detail` and, on another person's
 * screen, `recipientNote`. `warn` is true for a file that is open to use but has not been scanned:
 * show the note beside it, do not block it. A file that must not be used (held, failed, still
 * waiting) is already refused by the existing rules and has no recipient note.
 */

export type ScanTone = 'success' | 'neutral' | 'warning' | 'danger';

export interface ScanStatePresentation {
  readonly kind: VersionScanKind;
  /** Short badge text, Title Case. */
  readonly label: string;
  readonly tone: ScanTone;
  /** The badge class the documents screens use for this tone. */
  readonly badgeClass: string;
  /** One plain sentence under the badge for the person who owns the file. */
  readonly detail: string;
  /** True only when a trusted virus scan finished for this exact file. */
  readonly virusScanned: boolean;
  /** The file is usable but not virus scanned: show `recipientNote` as a warning, never a block. */
  readonly warn: boolean;
  /** A short line for someone who receives the file, or null when there is nothing to add. */
  readonly recipientNote: string | null;
}

const BADGE_CLASS: Record<ScanTone, string> = {
  success: 'badge-success',
  neutral: 'badge-neutral',
  warning: 'badge-warning',
  danger: 'badge-danger',
};

type Entry = Omit<ScanStatePresentation, 'kind' | 'badgeClass'>;

const ENTRIES: Record<VersionScanKind, Entry> = {
  VIRUS_SCANNED: {
    label: 'Checked for Viruses',
    tone: 'success',
    detail: 'A virus scan finished on this exact file and found nothing.',
    virusScanned: true,
    warn: false,
    recipientNote: 'Checked for viruses.',
  },
  FORMAT_CHECKED: {
    label: 'Format Checked',
    tone: 'neutral',
    detail: 'The file type and structure were checked. It has not been scanned for viruses.',
    virusScanned: false,
    warn: true,
    recipientNote: 'File type checked. Not scanned for viruses.',
  },
  WAITING: {
    label: 'Waiting to Be Checked',
    tone: 'neutral',
    detail: 'This file has not been checked yet. It cannot be opened until it has.',
    virusScanned: false,
    warn: false,
    recipientNote: null,
  },
  CHECKING: {
    label: 'Being Checked',
    tone: 'neutral',
    detail: 'The checks are running. The file can be opened when they finish.',
    virusScanned: false,
    warn: false,
    recipientNote: null,
  },
  DELAYED: {
    label: 'Check Delayed',
    tone: 'warning',
    detail:
      'The virus scan could not finish yet and will try again. The file cannot be opened until the checks finish.',
    virusScanned: false,
    warn: false,
    recipientNote: null,
  },
  HELD: {
    label: 'Held for Safety',
    tone: 'danger',
    detail: 'The checks held this file back, so it cannot be opened.',
    virusScanned: false,
    warn: false,
    recipientNote: null,
  },
  FAILED: {
    label: 'Could Not Be Checked',
    tone: 'danger',
    detail:
      'The checks could not finish for this file, so it cannot be opened. Try adding it again.',
    virusScanned: false,
    warn: false,
    recipientNote: null,
  },
};

/**
 * The words for one version's checks. No evidence at all reads as waiting to be checked, and
 * nothing but a loaded VIRUS_SCANNED kind can ever read as virus scanned.
 */
export function presentScanState(
  evidence: Pick<VersionScanEvidence, 'kind'> | null | undefined,
): ScanStatePresentation {
  const kind: VersionScanKind = evidence?.kind ?? 'WAITING';
  const entry = ENTRIES[kind];
  return { kind, ...entry, badgeClass: BADGE_CLASS[entry.tone] };
}

/**
 * The notice under the uploader. `virusScanning` is the platform switch (a scanner is configured
 * and proved recently). It describes what the platform does for new files; what happened to one
 * file is always read from that file (`presentScanState`).
 */
export function uploadCheckNotice(virusScanning: boolean): string {
  return virusScanning
    ? 'New files are scanned for viruses and cannot be opened until the scan finishes.'
    : 'Each file’s type and structure are checked when it arrives. This is not a virus scan.';
}

/** The "What Happens Next" step that describes the checks on Add Documents. */
export function addCheckStep(virusScanning: boolean): {
  readonly title: string;
  readonly line: string;
} {
  return virusScanning
    ? {
        title: 'Checked for Viruses',
        line: 'New files are scanned for viruses and cannot be opened until the scan finishes. Each file shows how it was checked.',
      }
    : {
        title: 'Format Checked',
        line: 'Virus scanning is not switched on yet. New files get a file type and structure check only, which is not a virus scan. Each file shows how it was checked.',
      };
}
