import { isRecordId } from './record-id';

/** Most files followed on the page after one import. A longer list still has its own page links. */
export const MAX_BATCH_FILES = 30;

/**
 * The document ids named in an address after an import (`?batch=id,id`). Only well-formed ids
 * are kept, once each, in the order given, and only the first {@link MAX_BATCH_FILES}. An id that
 * is not the person's own is never shown: the page only looks up their own documents by it.
 */
export function parseBatch(raw: string | readonly string[] | undefined): string[] {
  const text = Array.isArray(raw) ? raw.join(',') : (raw ?? '');
  const seen = new Set<string>();
  for (const part of String(text).split(',')) {
    const id = part.trim().toLowerCase();
    if (isRecordId(id)) seen.add(id);
    if (seen.size >= MAX_BATCH_FILES) break;
  }
  return [...seen];
}

/**
 * The address that follows the files just added. More files than the page can follow at once go
 * to the plain page, which lists everything that waits, instead of following only some of them.
 */
export function batchHref(applicantId: string, documentIds: readonly string[]): string {
  const base = `/app/applicant/${encodeURIComponent(applicantId)}/review`;
  if (documentIds.length === 0 || documentIds.length > MAX_BATCH_FILES) return base;
  return `${base}?batch=${documentIds.join(',')}`;
}

/** Whether one address can follow all of these files (see {@link batchHref}). */
export function canFollowBatch(count: number): boolean {
  return count > 0 && count <= MAX_BATCH_FILES;
}

export type BatchFileStage =
  | 'checking'
  | 'reading'
  | 'found'
  | 'name'
  | 'done'
  | 'not_read'
  | 'saved'
  | 'needs_attention';

/** One plain line per file, always starting from the fact that it is saved. */
export function batchFileLine(stage: BatchFileStage, found: number): string {
  switch (stage) {
    case 'checking':
      return 'Saved. Checking that it is safe.';
    case 'reading':
      return 'Saved. Reading it now.';
    case 'found':
      return `Saved. ${found} ${found === 1 ? 'detail' : 'details'} found, waiting for you.`;
    case 'name':
      return 'Saved. Its name is waiting for your answer.';
    case 'done':
      return 'Saved. Everything from it is answered.';
    case 'not_read':
      return 'Saved. Nothing was read from it.';
    case 'saved':
      return 'Saved. We could not check how far it has got just now.';
    case 'needs_attention':
      return 'Saved. This file needs a look.';
  }
}

/** Whether the server is still working on a file, so the page keeps itself up to date. */
export function stageIsWorking(stage: BatchFileStage): boolean {
  return stage === 'checking' || stage === 'reading';
}

/** The three steps shown at the top of the page: which one the person is on. */
export type FlowStep = 'add' | 'check' | 'review';

export function currentFlowStep(working: boolean): FlowStep {
  return working ? 'check' : 'review';
}
