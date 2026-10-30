import { type Result, err, ok, parseReferenceCode } from '@visastack/core';
import { type FieldPolicy, fieldPolicyOf } from '@visastack/core/catalogue';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { AuthorizedApplicant } from './access/require-access';
import { connectionPromptVersion, connectorModelVersion } from './ai-run-kinds';
import { latestTimeZoneName } from './attention';
import { appendAuditEvent } from './audit';
import { type Db, first, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import { findReferenceEntity } from './reference-codes';

/**
 * What an AI app may leave for the person through its connection (S21, ADR 0021 extension
 * "Suggest Changes"): a suggestion for one profile detail, waiting for approval; a draft the person
 * can read, copy and delete; and a reminder on one of their own cases. Nothing here changes a fact,
 * a document, a case's state, a share or a permission, and nothing is sent anywhere.
 *
 * - Every write takes a `PROPOSE_EDIT` proof the AI gate (`access/with-ai-connection.ts`) minted
 *   for the connection's owner, with the `ai_connection` purpose; anything else is refused. The
 *   gate has already checked the connection's choices, the case, the document, the person's
 *   processing consent and the daily limits; this module checks the record's own rules again.
 * - A suggestion is a zero-cost run (model version `connector:<app's address>`, prompt version
 *   `connection:<connection id>`) with one PENDING proposal: the same review the person already
 *   uses for documents. It is kept out of every AI count and spend, and out of "accept all".
 * - The person's own reading and removing of drafts is here too, owner only.
 * - Until migration 0104 runs, `aiSuggestionsAvailable` is false and the gate writes nothing.
 */

/** Who is writing: the connection and the app, as the gate resolved them. */
export interface AiWriter {
  readonly connectionId: string;
  readonly clientName: string;
  readonly clientHost: string;
}

/** Limits on what an app may send (the tools' input schemas say the same). */
export const AI_SUGGESTION_LIMITS = Object.freeze({
  fieldChars: 64,
  valueChars: 500,
  reasonChars: 500,
  titleChars: 120,
  bodyChars: 20_000,
  /** How far ahead a reminder may be due. */
  reminderYearsAhead: 5,
});

/**
 * Whether migration 0104 has run: a document became optional on a suggestion (its last
 * statements) and both new tables exist. Read from the catalogue, so it never fails a transaction
 * the way a query on a missing table would; every reader and writer asks it first.
 */
export async function aiSuggestionsAvailable(db: Db): Promise<boolean> {
  const rows = await db
    .select({
      ready: sql<boolean>`(
        to_regclass('ai_drafts') is not null
        and to_regclass('ai_task_origins') is not null
        and to_regclass('platform_ai_feature_settings') is not null
        and exists (
          select 1 from information_schema.columns
          where table_schema = current_schema()
            and table_name = 'field_proposals'
            and column_name = 'document_version_id'
            and is_nullable = 'YES'
        )
      )`,
    })
    .from(sql`(select 1) as probe`);
  return rows[0]?.ready === true;
}

// --- Which details an app may suggest (pure) ---------------------------------

export interface SuggestionFieldInput {
  /** What the app sent: a field key as the read tools show it ("home_city" or "Home City"). */
  readonly field: string;
  /** The profile section the app named. */
  readonly section: string;
  /** The sections the connection grants. */
  readonly layers: readonly string[];
  /** "Full Document Numbers", with its standing identity check. */
  readonly revealIdentifiers: boolean;
}

/** The field key an app meant, in the catalogue's spelling (`Home City` reads as `home_city`). */
export function normaliseFieldKey(field: string): string {
  return field
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

/**
 * Whether an app may suggest this detail (ADR 0021 section 4 rules, applied to writes, S21 D5):
 * - only a detail the catalogue knows, in the section named, and that section granted;
 * - never a special-category or biometric detail, and never a RESTRICTED one (national numbers,
 *   legal history, health detail): those are entered by the person themselves;
 * - legal history only with Past Refusals and Declarations, health detail only with Health;
 * - a document number only with Full Document Numbers.
 * One answer for every refusal, so an app learns nothing from which rule refused it.
 */
export function decideSuggestionField(input: SuggestionFieldInput): FieldPolicy | null {
  const key = normaliseFieldKey(input.field);
  if (key.length === 0 || key.length > AI_SUGGESTION_LIMITS.fieldChars) return null;
  const policy = fieldPolicyOf(key);
  if (!policy) return null;
  if (policy.layer !== input.section || !input.layers.includes(policy.layer)) return null;
  if (policy.kind === 'special_category' || policy.kind === 'biometric') return null;
  if (policy.sensitivity === 'RESTRICTED') return null;
  if (policy.kind === 'legal_history' && !input.layers.includes('declarations')) return null;
  if (policy.kind === 'health_detail' && !input.layers.includes('health')) return null;
  if (policy.kind === 'national_identifier') return null;
  if (policy.kind === 'identifier' && !input.revealIdentifiers) return null;
  return policy;
}

/** Control, zero-width and text-direction characters, which could disguise text on screen. */
function hiddenCharacter(codePoint: number, keepLineBreaks: boolean): boolean {
  if (keepLineBreaks && (codePoint === 0x0a || codePoint === 0x09)) return false;
  return (
    codePoint < 0x20 ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    (codePoint >= 0x200b && codePoint <= 0x200f) ||
    (codePoint >= 0x2028 && codePoint <= 0x202e) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069) ||
    codePoint === 0xfeff
  );
}

function visible(text: string, keepLineBreaks: boolean, replacement: string): string {
  return Array.from(text)
    .map((char) => (hiddenCharacter(char.codePointAt(0) ?? 0, keepLineBreaks) ? replacement : char))
    .join('');
}

/** One line of plain text: no hidden characters, spaces run together. */
export function cleanLine(text: string): string {
  return visible(text, false, ' ').replace(/\s+/g, ' ').trim();
}

/** Plain text that keeps its lines: hidden characters other than line breaks and tabs go. */
export function cleanText(text: string): string {
  return visible(text.replace(/\r\n?/g, '\n'), true, '').trim();
}

// --- Writes, through the gate's proof ----------------------------------------

export type AiWriteRefusal =
  | 'field_not_shared'
  | 'document_not_shared'
  | 'case_finished'
  | 'invalid_input';

export type AiWriteOutcome<T> =
  | { readonly kind: 'created'; readonly value: T }
  /** The same suggestion from the same connection is already waiting: nothing new was written. */
  | { readonly kind: 'existing'; readonly value: T }
  | { readonly kind: 'refused'; readonly reason: AiWriteRefusal };

/** A proof the gate minted for this connection's owner, to suggest or add something. */
function ownersWriteProof(proof: AuthorizedApplicant<'PROPOSE_EDIT'>): boolean {
  return (
    AuthorizedApplicant.isGenuine(proof, 'PROPOSE_EDIT') &&
    proof.actor.kind === 'applicant_owner' &&
    proof.purpose === 'ai_connection'
  );
}

class NotTheGate extends Error {
  constructor() {
    super('AI suggestions are written only through the AI gate, for the record owner');
  }
}

export interface ProfileSuggestionInput {
  readonly writer: AiWriter;
  /** Already checked by `decideSuggestionField`. */
  readonly fieldKey: string;
  readonly value: string;
  /** The app's own reason, shown to the person as the app's words. */
  readonly reason: string;
  /** `D-XXXXXX`, already checked to be listed for this connection; null for the profile itself. */
  readonly documentReference: string | null;
}

/**
 * One pending suggestion from an AI app. The same suggestion (same detail, value and document)
 * still waiting from the same connection is not written again: the app gets the same answer, and
 * the gate does not count it against the daily limit.
 */
export async function recordProfileSuggestion(
  proof: AuthorizedApplicant<'PROPOSE_EDIT'>,
  input: ProfileSuggestionInput,
): Promise<AiWriteOutcome<{ readonly proposalId: string }>> {
  if (!ownersWriteProof(proof) || proof.resource.kind !== 'applicant') throw new NotTheGate();
  const tx = proof.tx;
  const applicantId = proof.applicant.id;
  const value = cleanLine(input.value);
  const reason = cleanLine(input.reason);
  if (value.length === 0 || value.length > AI_SUGGESTION_LIMITS.valueChars) {
    return { kind: 'refused', reason: 'invalid_input' };
  }
  if (reason.length === 0 || reason.length > AI_SUGGESTION_LIMITS.reasonChars) {
    return { kind: 'refused', reason: 'invalid_input' };
  }
  // The live registry decides too: the approval writes through it.
  const definition = first(
    await tx
      .select({ sensitivity: schema.fieldDefinitions.sensitivity })
      .from(schema.fieldDefinitions)
      .where(eq(schema.fieldDefinitions.key, input.fieldKey))
      .limit(1),
  );
  if (!definition || definition.sensitivity === 'RESTRICTED') {
    return { kind: 'refused', reason: 'field_not_shared' };
  }

  let documentVersionId: string | null = null;
  if (input.documentReference !== null) {
    const parsed = parseReferenceCode(input.documentReference, 'D');
    const documentId = parsed.ok ? await findReferenceEntity(tx, 'D', parsed.code) : null;
    const latest = documentId
      ? first(
          await tx
            .select({ id: schema.documentVersions.id })
            .from(schema.documentVersions)
            .innerJoin(
              schema.documents,
              eq(schema.documents.id, schema.documentVersions.documentId),
            )
            .where(
              and(
                eq(schema.documents.id, documentId),
                eq(schema.documents.applicantId, applicantId),
              ),
            )
            .orderBy(desc(schema.documentVersions.versionNumber))
            .limit(1),
        )
      : undefined;
    if (!latest) return { kind: 'refused', reason: 'document_not_shared' };
    documentVersionId = latest.id;
  }

  const promptVersion = connectionPromptVersion(input.writer.connectionId);
  const waiting = first(
    await tx
      .select({ id: schema.fieldProposals.id })
      .from(schema.fieldProposals)
      .innerJoin(
        schema.aiExtractionRuns,
        eq(schema.aiExtractionRuns.id, schema.fieldProposals.aiExtractionRunId),
      )
      .where(
        and(
          eq(schema.fieldProposals.applicantId, applicantId),
          eq(schema.fieldProposals.status, 'PENDING'),
          eq(schema.fieldProposals.fieldKey, input.fieldKey),
          eq(schema.fieldProposals.value, value),
          documentVersionId === null
            ? isNull(schema.fieldProposals.documentVersionId)
            : eq(schema.fieldProposals.documentVersionId, documentVersionId),
          eq(schema.aiExtractionRuns.promptVersion, promptVersion),
          eq(schema.aiExtractionRuns.modelVersion, connectorModelVersion(input.writer.clientHost)),
        ),
      )
      .limit(1),
  );
  if (waiting) return { kind: 'existing', value: { proposalId: waiting.id } };

  const run = required(
    first(
      await tx
        .insert(schema.aiExtractionRuns)
        .values({
          documentVersionId,
          applicantId,
          status: 'SUCCEEDED',
          modelVersion: connectorModelVersion(input.writer.clientHost),
          promptVersion,
          costUnits: 0,
        })
        .returning({ id: schema.aiExtractionRuns.id }),
    ),
    'connector run',
  );
  const proposal = required(
    first(
      await tx
        .insert(schema.fieldProposals)
        .values({
          aiExtractionRunId: run.id,
          documentVersionId,
          applicantId,
          type: 'UPDATE',
          fieldKey: input.fieldKey,
          value,
          // An app's suggestion carries no reading confidence: it is never "clear", always looked at.
          confidence: 0,
          rationale: reason,
        })
        .returning({ id: schema.fieldProposals.id }),
    ),
    'connector suggestion',
  );
  return { kind: 'created', value: { proposalId: proposal.id } };
}

export interface AiDraftInput {
  readonly writer: AiWriter;
  /** The case it is for, already checked to be one the connection covers; or null. */
  readonly missionId: string | null;
  readonly title: string;
  readonly body: string;
}

/** A draft for the person to read, copy or delete. It is never sent, shared or used anywhere. */
export async function recordAiDraft(
  proof: AuthorizedApplicant<'PROPOSE_EDIT'>,
  input: AiDraftInput,
): Promise<AiWriteOutcome<{ readonly draftId: string }>> {
  if (!ownersWriteProof(proof) || proof.resource.kind !== 'applicant') throw new NotTheGate();
  const tx = proof.tx;
  const title = cleanLine(input.title);
  const body = cleanText(input.body);
  if (title.length === 0 || title.length > AI_SUGGESTION_LIMITS.titleChars) {
    return { kind: 'refused', reason: 'invalid_input' };
  }
  if (body.length === 0 || body.length > AI_SUGGESTION_LIMITS.bodyChars) {
    return { kind: 'refused', reason: 'invalid_input' };
  }
  if (input.missionId !== null) {
    const mission = first(
      await tx
        .select({ id: schema.missions.id })
        .from(schema.missions)
        .where(
          and(
            eq(schema.missions.id, input.missionId),
            eq(schema.missions.applicantId, proof.applicant.id),
          ),
        )
        .limit(1),
    );
    if (!mission) throw new NotTheGate();
  }
  const draft = required(
    first(
      await tx
        .insert(schema.aiDrafts)
        .values({
          applicantId: proof.applicant.id,
          missionId: input.missionId,
          connectionId: input.writer.connectionId,
          clientName: input.writer.clientName,
          clientHost: input.writer.clientHost,
          title,
          body,
        })
        .returning({ id: schema.aiDrafts.id }),
    ),
    'ai draft',
  );
  return { kind: 'created', value: { draftId: draft.id } };
}

/** Cases in these states take no new reminders. */
const FINISHED_CASE_STATES: ReadonlySet<string> = new Set(['CLOSED', 'CANCELLED']);
const DUE_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Today's date where the traveller lives, as `YYYY-MM-DD` (an unknown zone counts as UTC). */
function localToday(now: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** A real calendar date from today (in the traveller's zone) up to a few years ahead, or null. */
export function reminderDueDate(dueDate: string, now: Date, timeZone: string): Date | null {
  const match = dueDate.match(DUE_DATE);
  if (!match) return null;
  const [, y, m, d] = match;
  const at = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (
    Number.isNaN(at.getTime()) ||
    at.getUTCFullYear() !== Number(y) ||
    at.getUTCMonth() !== Number(m) - 1 ||
    at.getUTCDate() !== Number(d)
  ) {
    return null;
  }
  if (dueDate < localToday(now, timeZone)) return null;
  const latest = new Date(now);
  latest.setUTCFullYear(latest.getUTCFullYear() + AI_SUGGESTION_LIMITS.reminderYearsAhead);
  if (at.getTime() > latest.getTime()) return null;
  // Stored as the case page stores a date-only due date: midnight UTC of that day, with the zone.
  return at;
}

export interface AiReminderInput {
  readonly writer: AiWriter;
  readonly title: string;
  /** `YYYY-MM-DD`, in the traveller's own calendar. */
  readonly dueDate: string;
  readonly now?: Date;
}

/**
 * A reminder on the person's own case, owned by them, shown as "Added by <app name>" wherever the
 * case's tasks are shown (an agency that can already see the case's tasks sees it too). Never on a
 * closed or cancelled case.
 */
export async function recordAiReminder(
  proof: AuthorizedApplicant<'PROPOSE_EDIT'>,
  input: AiReminderInput,
): Promise<AiWriteOutcome<{ readonly taskId: string; readonly dueDate: string }>> {
  if (!ownersWriteProof(proof) || proof.resource.kind !== 'mission') throw new NotTheGate();
  const tx = proof.tx;
  const mission = proof.resource.mission;
  if (FINISHED_CASE_STATES.has(mission.state)) return { kind: 'refused', reason: 'case_finished' };
  const title = cleanLine(input.title);
  if (title.length === 0 || title.length > AI_SUGGESTION_LIMITS.titleChars) {
    return { kind: 'refused', reason: 'invalid_input' };
  }
  const zone = proof.applicant.timezone;
  const due = reminderDueDate(input.dueDate, input.now ?? new Date(), zone);
  if (!due) return { kind: 'refused', reason: 'invalid_input' };
  const task = required(
    first(
      await tx
        .insert(schema.missionTasks)
        .values({
          missionId: mission.id,
          description: title,
          dueDate: due,
          dueTimezone: latestTimeZoneName(zone),
        })
        .returning({ id: schema.missionTasks.id }),
    ),
    'ai reminder',
  );
  await tx.insert(schema.aiTaskOrigins).values({
    taskId: task.id,
    connectionId: input.writer.connectionId,
    clientName: input.writer.clientName,
    clientHost: input.writer.clientHost,
  });
  // The case's own history, as for a task added by hand; the app is named by its address only.
  await appendAuditEvent(tx, {
    eventType: 'MISSION_TASK_CREATED',
    actorAccountId: proof.applicant.ownerAccountId ?? null,
    method: 'API',
    result: 'ALLOWED',
    applicantId: proof.applicant.id,
    missionId: mission.id,
    resourceType: 'mission_task',
    resourceId: task.id,
    metadata: { addedBy: 'ai_app', clientHost: input.writer.clientHost },
  });
  return { kind: 'created', value: { taskId: task.id, dueDate: input.dueDate } };
}

// --- The person's own view of drafts -----------------------------------------

export interface AiDraftView {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly caseId: string | null;
  readonly caseTitle: string | null;
  /** The app's name as it was stored. Cleaned again before it is shown. */
  readonly appName: string;
  readonly appHost: string;
  readonly createdAt: Date;
}

export interface AiDraftList {
  /** False until migration 0104 runs. */
  readonly available: boolean;
  readonly drafts: readonly AiDraftView[];
  /** Drafts beyond the ones listed. */
  readonly more: number;
}

/** At most this many drafts are listed at once, newest first. */
export const AI_DRAFT_LIST_LIMIT = 50;

/** The drafts AI apps saved for this record, newest first. Owner only; never an agency. */
export async function listAiDrafts(
  proof: AuthorizedApplicant<'VIEW_METADATA'>,
): Promise<AiDraftList> {
  // Owner only: anything else (an agency, a share recipient, a copied proof) gets nothing.
  if (!AuthorizedApplicant.isGenuine(proof, 'VIEW_METADATA') || proof.actor.kind !== 'applicant_owner') {
    return { available: true, drafts: [], more: 0 };
  }
  const tx = proof.tx;
  if (!(await aiSuggestionsAvailable(tx))) return { available: false, drafts: [], more: 0 };
  const rows = await tx
    .select({
      id: schema.aiDrafts.id,
      title: schema.aiDrafts.title,
      body: schema.aiDrafts.body,
      caseId: schema.aiDrafts.missionId,
      caseTitle: schema.missions.title,
      appName: schema.aiDrafts.clientName,
      appHost: schema.aiDrafts.clientHost,
      createdAt: schema.aiDrafts.createdAt,
    })
    .from(schema.aiDrafts)
    .leftJoin(schema.missions, eq(schema.missions.id, schema.aiDrafts.missionId))
    .where(eq(schema.aiDrafts.applicantId, proof.applicant.id))
    .orderBy(desc(schema.aiDrafts.createdAt))
    .limit(AI_DRAFT_LIST_LIMIT + 1);
  const total =
    rows.length > AI_DRAFT_LIST_LIMIT
      ? Number(
          first(
            await tx
              .select({ count: sql<string>`count(*)` })
              .from(schema.aiDrafts)
              .where(eq(schema.aiDrafts.applicantId, proof.applicant.id)),
          )?.count ?? 0,
        )
      : rows.length;
  const drafts = rows.slice(0, AI_DRAFT_LIST_LIMIT);
  return { available: true, drafts, more: Math.max(0, total - drafts.length) };
}

/** The person removes one draft for good. Owner only; the audit records that it happened, not what it said. */
export async function deleteAiDraft(
  proof: AuthorizedApplicant<'MANAGE'>,
  draftId: string,
): Promise<Result<void, ServiceError>> {
  if (!AuthorizedApplicant.isGenuine(proof, 'MANAGE') || proof.actor.kind !== 'applicant_owner') {
    return err(serviceError('forbidden', 'only the owner can remove a draft'));
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(draftId)) {
    return err(serviceError('not_found', 'draft not found'));
  }
  const tx = proof.tx;
  if (!(await aiSuggestionsAvailable(tx))) return err(serviceError('not_found', 'draft not found'));
  const row = first(
    await tx
      .delete(schema.aiDrafts)
      .where(
        and(eq(schema.aiDrafts.id, draftId), eq(schema.aiDrafts.applicantId, proof.applicant.id)),
      )
      .returning({ id: schema.aiDrafts.id, clientHost: schema.aiDrafts.clientHost }),
  );
  if (!row) return err(serviceError('not_found', 'draft not found'));
  await appendAuditEvent(tx, {
    eventType: 'AI_DRAFT_DELETED',
    actorAccountId: proof.applicant.ownerAccountId ?? null,
    method: 'MANUAL',
    result: 'ALLOWED',
    applicantId: proof.applicant.id,
    resourceType: 'ai_draft',
    resourceId: row.id,
    metadata: { clientHost: row.clientHost },
  });
  return ok(undefined);
}
