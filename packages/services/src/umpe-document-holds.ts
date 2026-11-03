/**
 * UMPE G1: a family batch and the Which Person? decision (ledger I09).
 *
 * A person may add files for several people of their family at once. Each file is held in a
 * private holding state owned by the uploading account (`document_person_holds`, scoped like the
 * P3 upload receipts): no document, no person, nothing visible to anyone else. Only the account's
 * own explicit Which Person? decision files it, and only through the access check for the chosen
 * person (`requireAccess` MANAGE, made by the caller): the owner's own record or a family member
 * the account manages. Nothing is ever filed under a person without that person's check.
 *
 * - Storing: the same byte checks the vault upload route runs happen in the web route first; here
 *   the bytes are registered, stored privately under an opaque key, read back and hashed, scanned
 *   and checked against the content limits before they are read at all. A refused file keeps no
 *   bytes.
 * - Proposing a person: the file's own text is read once. A person is proposed only when exactly
 *   one of the account's people matches both name and date of birth, and no other person is a
 *   close match (the same date of birth and a shared name). Otherwise nobody is proposed and the
 *   file stays held. The facts read from the file are never stored, only which rule applied.
 * - Filing: quota is reserved for the chosen person at that moment; the document and its first
 *   version are registered, and its reading queued, in one transaction with the hold marked filed,
 *   so a file can never be filed twice. From then on the normal reading runs.
 * - Repeats: each file carries the browser's upload id, so a retry answers with the same hold.
 */

import { createHash, randomUUID } from 'node:crypto';
import { type Result, err, ok } from '@visastack/core';
import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { AuthorizedApplicant, SystemScope } from './access';
import { appendAuditEvent } from './audit';
import { findTd3Block } from './classification';
import { type Db, first, schema } from './db';
import { CONVERTED_FROM_HEIC_SOURCE, registerDocumentWithVersion } from './documents';
import { type ServiceError, serviceError } from './errors';
import type { DocumentConverterPort } from './extraction';
import type { ContentLimitsPort, MalwareScannerPort } from './intake';
import { enqueueIntakeJob } from './jobs';
import { lifecycleTablesPresent, presentApplicantCondition } from './lifecycle/foundation';
import { parseTd3 } from './mrz';
import type { KeyManagementPort } from './ports';
import { revealFactVersionValue } from './profile';
import { type UploadQuotaConfig, loadUploadQuotaConfig } from './quotas';
import { RATE_LIMITS, checkRateLimit } from './rate-limit';
import type { BlobStore } from './storage';
import { registerStorageObject } from './storage-objects';
import { sanitizeOriginalFileName } from './umpe-document-names';
import { isUploadId } from './umpe-document-receipts';
import { DOCUMENT_DATE_PATTERN, parseStatementDate } from './umpe-document-relations';
import { personHoldsTablePresent, uploadReceiptsTablePresent } from './umpe-document-tables';
import { failUpload, finalizeUpload, reserveUpload } from './uploads';

/** At most this many files waiting at once per account, and this many bytes in all. */
export const HELD_MAX_FILES = 100;
export const HELD_MAX_TOTAL_BYTES = 200 * 1024 * 1024;
/** A claim (storing or filing) not finished within this long is taken over by the next attempt. */
export const HELD_CLAIM_STALE_MS = 2 * 60 * 1000;
/** A file nobody decided on within this long is removed by the abandoned uploads sweep. */
export const HELD_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export const PROPOSAL_BASES = [
  'NAME_AND_BIRTH_DATE',
  'CLOSE_MATCHES',
  'NO_MATCH',
  'NOT_READ',
] as const;
export type ProposalBasis = (typeof PROPOSAL_BASES)[number];

function isProposalBasis(value: unknown): value is ProposalBasis {
  return typeof value === 'string' && (PROPOSAL_BASES as readonly string[]).includes(value);
}

// --- Pure: who a file is about ---------------------------------------------------------------

/** One of the account's people, as compared with a file. */
export interface PersonIdentity {
  readonly applicantId: string;
  /** Upper-case name words (given and family name, or the record's display name). */
  readonly nameTokens: readonly string[];
  /** ISO date (YYYY-MM-DD), or null when the profile has none. */
  readonly dateOfBirth: string | null;
}

export type PersonProposal =
  | { readonly basis: 'NAME_AND_BIRTH_DATE'; readonly applicantId: string }
  | { readonly basis: 'CLOSE_MATCHES' | 'NO_MATCH' | 'NOT_READ' };

/** Upper-case words of two letters or more, accents removed, in any script. */
export function nameTokens(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleUpperCase('en')
    .split(/[^\p{L}]+/u)
    .filter((word) => word.length >= 2);
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;

/** Every calendar day the text names, both readings of an ambiguous day/month order included. */
function datesIn(text: string): Set<string> {
  const found = new Set<string>();
  const pattern = new RegExp(DOCUMENT_DATE_PATTERN, 'gi');
  // Bounded: a long text cannot make this unbounded (each match moves forward).
  for (const match of text.slice(0, 200_000).matchAll(pattern)) {
    const raw = match[0];
    const parsed = parseStatementDate(raw);
    if (parsed) found.add(parsed);
    const swapped = raw.trim().match(/^(\d{1,2})([/.-])(\d{1,2})\2(\d{4})$/);
    if (swapped?.[1] && swapped[3] && swapped[4]) {
      const other = parseStatementDate(`${swapped[3]}/${swapped[1]}/${swapped[4]}`);
      if (other) found.add(other);
    }
  }
  return found;
}

/** Name words and days a file's own text gives, its passport lines included. */
export function readPersonFacts(text: string): { tokens: Set<string>; dates: Set<string> } {
  const tokens = new Set(nameTokens(text));
  const dates = datesIn(text);
  const block = findTd3Block(text);
  const parsed = block ? parseTd3(block.lines) : null;
  if (parsed?.ok && parsed.value.checksValid) {
    for (const word of nameTokens(`${parsed.value.surname} ${parsed.value.givenNames}`)) {
      tokens.add(word);
    }
    if (ISO_DAY.test(parsed.value.dateOfBirth)) dates.add(parsed.value.dateOfBirth.slice(0, 10));
  }
  return { tokens, dates };
}

/**
 * Which of the account's people a file is about. Proposes one only when exactly one person matches
 * every word of their name and their date of birth, and no other person shares that date of birth
 * and any of the matched name words (twins, or a parent's name on a child's certificate with the
 * same day). Never a guess: anything else proposes nobody.
 */
export function proposePerson(
  text: string | null,
  people: readonly PersonIdentity[],
): PersonProposal {
  if (!text || text.trim() === '') return { basis: 'NOT_READ' };
  const facts = readPersonFacts(text);
  const nameMatches = (person: PersonIdentity) =>
    person.nameTokens.length > 0 && person.nameTokens.every((word) => facts.tokens.has(word));
  const birthMatches = (person: PersonIdentity) =>
    person.dateOfBirth !== null && facts.dates.has(person.dateOfBirth);
  const full = people.filter((person) => nameMatches(person) && birthMatches(person));
  if (full.length === 0) return { basis: 'NO_MATCH' };
  const [only] = full;
  if (full.length > 1 || !only) return { basis: 'CLOSE_MATCHES' };
  const rival = people.some(
    (person) =>
      person.applicantId !== only.applicantId &&
      person.dateOfBirth === only.dateOfBirth &&
      person.nameTokens.some((word) => facts.tokens.has(word)),
  );
  return rival
    ? { basis: 'CLOSE_MATCHES' }
    : { basis: 'NAME_AND_BIRTH_DATE', applicantId: only.applicantId };
}

// --- The account's people ----------------------------------------------------------------------

const IDENTITY_FIELDS = ['given_name', 'family_name', 'date_of_birth'] as const;

/** The account's own present people, with the names and dates of birth their profiles hold. */
async function accountPeople(
  db: Db,
  ownerAccountId: string,
  encryption: KeyManagementPort | undefined,
): Promise<
  {
    readonly applicantId: string;
    readonly displayName: string;
    readonly identity: PersonIdentity;
  }[]
> {
  const lifecycle = await lifecycleTablesPresent(db);
  const people = await db
    .select({ id: schema.applicants.id, displayName: schema.applicants.displayName })
    .from(schema.applicants)
    .where(
      and(
        eq(schema.applicants.ownerAccountId, ownerAccountId),
        lifecycle ? presentApplicantCondition() : undefined,
      ),
    )
    .orderBy(schema.applicants.createdAt);
  if (people.length === 0) return [];
  const rows = await db
    .select({
      applicantId: schema.facts.applicantId,
      key: schema.fieldDefinitions.key,
      version: schema.factVersions,
    })
    .from(schema.facts)
    .innerJoin(
      schema.fieldDefinitions,
      eq(schema.fieldDefinitions.id, schema.facts.fieldDefinitionId),
    )
    .innerJoin(schema.factVersions, eq(schema.factVersions.id, schema.facts.currentVersionId))
    .where(
      and(
        inArray(
          schema.facts.applicantId,
          people.map((person) => person.id),
        ),
        inArray(schema.fieldDefinitions.key, [...IDENTITY_FIELDS]),
        isNull(schema.facts.repeatingRecordKey),
      ),
    );
  const values = new Map<string, Map<string, string>>();
  for (const row of rows) {
    let value: string | null = null;
    if (row.version.protectedKeyVersion === null) value = row.version.value;
    else if (encryption) {
      const revealed = await revealFactVersionValue(db, encryption, row.version);
      value = revealed.ok ? revealed.value : null;
    }
    if (!value) continue;
    const held = values.get(row.applicantId) ?? new Map<string, string>();
    held.set(row.key, value);
    values.set(row.applicantId, held);
  }
  return people.map((person) => {
    const own = values.get(person.id);
    const given = own?.get('given_name');
    const family = own?.get('family_name');
    const birth = own?.get('date_of_birth')?.trim() ?? '';
    const tokens =
      given || family
        ? nameTokens(`${given ?? ''} ${family ?? ''}`)
        : nameTokens(person.displayName);
    return {
      applicantId: person.id,
      displayName: person.displayName,
      identity: {
        applicantId: person.id,
        nameTokens: tokens,
        dateOfBirth: ISO_DAY.test(birth) ? birth.slice(0, 10) : null,
      },
    };
  });
}

// --- Holding a file ------------------------------------------------------------------------------

type OwnerProof = AuthorizedApplicant<'MANAGE'>;

/** The account's own proof only: holds belong to the account that added them, never an agency. */
function ownerOf(proof: unknown, action: 'MANAGE' | 'VIEW_METADATA'): string | null {
  if (!AuthorizedApplicant.isGenuine(proof, action)) return null;
  if (proof.actor.kind !== 'applicant_owner') return null;
  return proof.applicant.ownerAccountId;
}

export interface HeldFileChecks {
  readonly scanner: MalwareScannerPort;
  readonly contentLimits: ContentLimitsPort;
  /** True only when `scanner` is a real virus scanner, not the structural check alone. */
  readonly virusScanner: boolean;
}

export interface HoldFamilyFileInput {
  readonly uploadId: string;
  readonly originalFileName?: string | null;
  readonly bytes: Uint8Array;
  readonly contentType: string;
  /** The name to store it under, with the extension of what is stored (the upload route's own rule). */
  readonly storedFileName: string;
  /** True when an iPhone photo (HEIC) was saved as a JPEG copy. */
  readonly convertedFromHeic?: boolean;
}

export interface HoldFamilyFileDeps {
  readonly storage: BlobStore;
  readonly checks: HeldFileChecks;
  readonly converter: DocumentConverterPort;
  /** To read the dates of birth profiles keep protected; without it nobody is proposed. */
  readonly encryption?: KeyManagementPort;
  readonly now?: Date;
}

export type HoldFamilyFileOutcome =
  | {
      readonly kind: 'held';
      readonly holdId: string;
      readonly basis: ProposalBasis;
      readonly replay: boolean;
    }
  | { readonly kind: 'in_progress'; readonly retryAfterSeconds: number }
  | {
      readonly kind: 'refused';
      readonly reason:
        | 'unavailable'
        | 'invalid'
        | 'rate_limited'
        | 'too_many'
        | 'unsafe'
        | 'failed';
      readonly message: string;
    };

const UNSAFE_MESSAGE =
  'This file did not pass the safety checks and was not kept. Try a PDF or a photo saved again.';

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Deletes bytes, then their registration (so a failed delete stays findable by the orphan sweep).
 * True only when the bytes are gone; a caller keeps its row otherwise, so the sweep tries again.
 */
async function discardBytes(
  db: Db,
  storage: Pick<BlobStore, 'deleteObject'>,
  objectKey: string,
): Promise<boolean> {
  try {
    await storage.deleteObject('QUARANTINE', objectKey);
  } catch {
    return false;
  }
  await db.delete(schema.storageObjects).where(eq(schema.storageObjects.objectKey, objectKey));
  return true;
}

/** A safe stored name: the last path part, plain characters, capped, never empty. */
function cleanStoredName(value: string): string {
  const last = value.split(/[/\\]/).pop() ?? '';
  const plain = last
    .replace(/[^\p{L}\p{N} ._()-]/gu, '')
    .trim()
    .slice(-120);
  return plain === '' || plain === '.' || plain === '..' ? 'document' : plain;
}

/**
 * Holds one file of a family batch for the account behind `proof` (the owner's proof for the page
 * they are on). Nothing is filed under anyone here.
 */
export async function holdFamilyFile(
  proof: OwnerProof,
  deps: HoldFamilyFileDeps,
  input: HoldFamilyFileInput,
): Promise<HoldFamilyFileOutcome> {
  const owner = ownerOf(proof, 'MANAGE');
  if (!owner) return { kind: 'refused', reason: 'unavailable', message: 'Not authorized.' };
  const db = proof.tx;
  if (!(await personHoldsTablePresent(db))) {
    return {
      kind: 'refused',
      reason: 'unavailable',
      message:
        'Adding files for several people is not available yet. Add them from each person instead.',
    };
  }
  const size = input.bytes.byteLength;
  if (!isUploadId(input.uploadId) || size < 1) {
    return { kind: 'refused', reason: 'invalid', message: 'Choose the file again.' };
  }
  const now = deps.now ?? new Date();
  const holds = schema.documentPersonHolds;
  const inputSha256 = sha256Hex(input.bytes);
  const originalFileName = sanitizeOriginalFileName(input.originalFileName);
  const storedFileName = cleanStoredName(input.storedFileName);
  const convertedFromHeic = input.convertedFromHeic === true;

  const existing = first(
    await db
      .select()
      .from(holds)
      .where(and(eq(holds.ownerAccountId, owner), eq(holds.uploadId, input.uploadId)))
      .limit(1),
  );
  // A repeat of a file still waiting answers with it; one still being stored answers "not yet".
  // A file already filed or removed, sent again, is the person's new choice: it starts afresh in
  // the same row (a filed file's bytes belong to its document and are never touched).
  let takeover = false;
  let abandonedKey: string | null = null;
  if (existing) {
    if (existing.status === 'HELD' || existing.status === 'FILING') {
      return {
        kind: 'held',
        holdId: existing.id,
        basis: isProposalBasis(existing.proposalBasis) ? existing.proposalBasis : 'NOT_READ',
        replay: true,
      };
    }
    if (existing.status === 'RECEIVING') {
      const age = now.getTime() - existing.updatedAt.getTime();
      if (age < HELD_CLAIM_STALE_MS) {
        return {
          kind: 'in_progress',
          retryAfterSeconds: Math.max(1, Math.ceil((HELD_CLAIM_STALE_MS - age) / 1000)),
        };
      }
    }
    takeover = true;
    abandonedKey =
      existing.status === 'RECEIVING' || existing.status === 'DISCARDED'
        ? existing.objectKey
        : null;
  }

  const rateLimit = await checkRateLimit(
    db,
    { subjectId: owner, action: 'upload.reserve', label: 'upload' },
    RATE_LIMITS.UPLOAD_RESERVE,
  );
  if (!rateLimit.allowed)
    return { kind: 'refused', reason: 'rate_limited', message: rateLimit.reason };

  const claimToken = randomUUID();
  const objectKey = `held-${randomUUID()}`;
  const claimed = await db.transaction(async (tx: Db) => {
    const usage = first(
      await tx
        .select({
          count: sql<number>`count(*)::int`,
          bytes: sql<number>`coalesce(sum(${holds.sizeBytes}), 0)::bigint`,
        })
        .from(holds)
        .where(
          and(
            eq(holds.ownerAccountId, owner),
            inArray(holds.status, ['RECEIVING', 'HELD', 'FILING']),
          ),
        ),
    );
    const counted = takeover && existing?.status === 'RECEIVING';
    const count = Number(usage?.count ?? 0) - (counted ? 1 : 0);
    const bytes = Number(usage?.bytes ?? 0) - (counted && existing ? existing.sizeBytes : 0);
    if (count + 1 > HELD_MAX_FILES || bytes + size > HELD_MAX_TOTAL_BYTES)
      return 'too_many' as const;
    // Registered before any byte is written, so bytes with no registration never exist.
    await registerStorageObject(tx, 'QUARANTINE', objectKey, input.bytes, inputSha256);
    if (existing && takeover) {
      // The abandoned attempt's registration is let go once its bytes are gone (below).
      const updated = await tx
        .update(holds)
        .set({
          claimToken,
          objectKey,
          contentType: input.contentType,
          sizeBytes: size,
          sha256: inputSha256,
          originalFileName,
          storedFileName,
          convertedFromHeic,
          status: 'RECEIVING',
          virusScanned: false,
          proposedApplicantId: null,
          proposalBasis: null,
          filedDocumentId: null,
          decidedAt: null,
          createdAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(holds.id, existing.id),
            eq(holds.status, existing.status),
            eq(holds.claimToken, existing.claimToken),
          ),
        )
        .returning({ id: holds.id });
      return updated[0]?.id ?? ('lost' as const);
    }
    const inserted = await tx
      .insert(holds)
      .values({
        ownerAccountId: owner,
        uploadId: input.uploadId,
        claimToken,
        objectKey,
        contentType: input.contentType,
        sizeBytes: size,
        sha256: inputSha256,
        originalFileName,
        storedFileName,
        convertedFromHeic,
        virusScanned: false,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: [holds.ownerAccountId, holds.uploadId] })
      .returning({ id: holds.id });
    return inserted[0]?.id ?? ('lost' as const);
  });
  if (claimed === 'too_many') {
    return {
      kind: 'refused',
      reason: 'too_many',
      message: `Up to ${HELD_MAX_FILES} files can wait for Which Person? at once. Choose a person for some of them first.`,
    };
  }
  if (claimed === 'lost') {
    await db.delete(schema.storageObjects).where(eq(schema.storageObjects.objectKey, objectKey));
    return { kind: 'in_progress', retryAfterSeconds: 5 };
  }
  if (abandonedKey) await discardBytes(db, deps.storage, abandonedKey);

  // Nothing usable is kept. The row goes only once the bytes are gone; otherwise it stays as a
  // stale claim, and the sweep deletes the bytes and the row later.
  const giveUp = async (): Promise<void> => {
    if (await discardBytes(db, deps.storage, objectKey)) {
      await db.delete(holds).where(and(eq(holds.id, claimed), eq(holds.claimToken, claimToken)));
    }
  };

  let text: string | null = null;
  try {
    await deps.storage.putObject({
      bucket: 'QUARANTINE',
      objectKey,
      contentType: input.contentType,
      bytes: input.bytes,
    });
    const stored = deps.storage.getPendingUpload
      ? await deps.storage.getPendingUpload(objectKey)
      : await deps.storage.getObject(objectKey);
    if (!stored || stored.bytes.byteLength !== size || sha256Hex(stored.bytes) !== inputSha256) {
      throw new Error('held file failed read-back verification');
    }
    const scan = await deps.checks.scanner.scan({ bucket: 'QUARANTINE', objectKey });
    const limits = scan.safe
      ? await deps.checks.contentLimits.check({ bucket: 'QUARANTINE', objectKey })
      : null;
    if (!scan.safe || limits?.withinLimits !== true) {
      await giveUp();
      return { kind: 'refused', reason: 'unsafe', message: UNSAFE_MESSAGE };
    }
    // Read only after every check passed. A file that cannot be read is still held, for the
    // person to place by hand.
    try {
      const outcome = await deps.converter.extract({
        bucket: 'QUARANTINE',
        objectKey,
        originalName: storedFileName,
      });
      text = outcome.ok ? outcome.result.text : null;
    } catch {
      text = null;
    }
  } catch {
    await giveUp();
    return {
      kind: 'refused',
      reason: 'failed',
      message: 'The file could not be stored. Try again.',
    };
  }

  const people = await accountPeople(db, owner, deps.encryption);
  const proposal = proposePerson(
    text,
    people.map((person) => person.identity),
  );
  const finished = await db.transaction(async (tx: Db) => {
    const updated = await tx
      .update(holds)
      .set({
        status: 'HELD',
        virusScanned: deps.checks.virusScanner,
        proposedApplicantId: proposal.basis === 'NAME_AND_BIRTH_DATE' ? proposal.applicantId : null,
        proposalBasis: proposal.basis,
        updatedAt: new Date(),
      })
      .where(
        and(eq(holds.id, claimed), eq(holds.status, 'RECEIVING'), eq(holds.claimToken, claimToken)),
      )
      .returning({ id: holds.id });
    if (updated.length === 0) return false;
    await appendAuditEvent(tx, {
      eventType: 'DOCUMENT_HELD_FOR_PERSON',
      actorAccountId: owner,
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'document_person_hold',
      resourceId: claimed,
      // Kinds only: never a name, a file name or any value read from the file.
      metadata: { basis: proposal.basis, virusScanned: deps.checks.virusScanner },
    });
    return true;
  });
  if (!finished) return { kind: 'in_progress', retryAfterSeconds: 5 };
  return { kind: 'held', holdId: claimed, basis: proposal.basis, replay: false };
}

// --- Listing and deciding ------------------------------------------------------------------------

export interface HeldFile {
  readonly holdId: string;
  /** The file's own name (private to this account), or null when it gave none. */
  readonly fileName: string | null;
  readonly basis: ProposalBasis;
  /** Set only for NAME_AND_BIRTH_DATE, and only while that person is still one of the account's. */
  readonly proposedApplicantId: string | null;
  readonly addedAt: Date;
}

export interface HeldFilesView {
  readonly files: readonly HeldFile[];
  /** The account's own people, to choose from. */
  readonly people: readonly { readonly applicantId: string; readonly displayName: string }[];
}

const NO_HELD_FILES: HeldFilesView = { files: [], people: [] };

/** States in which a hold waits for a decision (a filing claim gone stale counts as waiting). */
function waitingCondition(now: Date) {
  const holds = schema.documentPersonHolds;
  return or(
    eq(holds.status, 'HELD'),
    and(
      eq(holds.status, 'FILING'),
      lt(holds.updatedAt, new Date(now.getTime() - HELD_CLAIM_STALE_MS)),
    ),
  );
}

/** The account's files waiting for Which Person?, newest first. The account's own proof only. */
export async function listHeldFiles(
  proof: AuthorizedApplicant<'VIEW_METADATA'>,
  options: { readonly now?: Date } = {},
): Promise<HeldFilesView> {
  const owner = ownerOf(proof, 'VIEW_METADATA');
  if (!owner) return NO_HELD_FILES;
  const db = proof.tx;
  if (!(await personHoldsTablePresent(db))) return NO_HELD_FILES;
  const holds = schema.documentPersonHolds;
  const rows = await db
    .select({
      id: holds.id,
      originalFileName: holds.originalFileName,
      proposalBasis: holds.proposalBasis,
      proposedApplicantId: holds.proposedApplicantId,
      createdAt: holds.createdAt,
    })
    .from(holds)
    .where(and(eq(holds.ownerAccountId, owner), waitingCondition(options.now ?? new Date())))
    .orderBy(desc(holds.createdAt))
    .limit(HELD_MAX_FILES);
  if (rows.length === 0) return NO_HELD_FILES;
  const lifecycle = await lifecycleTablesPresent(db);
  const people = await db
    .select({ applicantId: schema.applicants.id, displayName: schema.applicants.displayName })
    .from(schema.applicants)
    .where(
      and(
        eq(schema.applicants.ownerAccountId, owner),
        lifecycle ? presentApplicantCondition() : undefined,
      ),
    )
    .orderBy(schema.applicants.createdAt);
  const own = new Set(people.map((person) => person.applicantId));
  return {
    files: rows.map((row) => ({
      holdId: row.id,
      fileName: row.originalFileName,
      basis: isProposalBasis(row.proposalBasis) ? row.proposalBasis : 'NOT_READ',
      proposedApplicantId:
        row.proposalBasis === 'NAME_AND_BIRTH_DATE' &&
        row.proposedApplicantId &&
        own.has(row.proposedApplicantId)
          ? row.proposedApplicantId
          : null,
      addedAt: row.createdAt,
    })),
    people,
  };
}

export interface FiledHold {
  readonly documentId: string;
  readonly documentVersionId: string;
  readonly title: string | null;
}

/**
 * Which Person?: files one held file under the person `proof` was made for. The proof must be the
 * account's own (the owner of that person's record, made by `requireAccess` MANAGE for exactly the
 * chosen person), and the hold must belong to that same account; anything else answers as not
 * found. Quota is reserved for the chosen person now; the document is registered, its reading
 * queued and the hold marked filed in one transaction, so it can never be filed twice.
 */
export async function fileHeldFile(
  proof: OwnerProof,
  input: { readonly holdId: string },
  options: { readonly quotaConfig?: UploadQuotaConfig; readonly now?: Date } = {},
): Promise<Result<FiledHold, ServiceError>> {
  const owner = ownerOf(proof, 'MANAGE');
  if (!owner) return err(serviceError('forbidden', 'not authorized'));
  const notFound = err(serviceError('not_found', 'file not found'));
  const db = proof.tx;
  if (!(await personHoldsTablePresent(db))) return notFound;
  const applicantId = proof.applicant.id;
  const now = options.now ?? new Date();
  const holds = schema.documentPersonHolds;

  const claimed = first(
    await db
      .update(holds)
      .set({ status: 'FILING', updatedAt: now })
      .where(
        and(eq(holds.id, input.holdId), eq(holds.ownerAccountId, owner), waitingCondition(now)),
      )
      .returning(),
  );
  if (!claimed) return notFound;
  const putBack = () =>
    db
      .update(holds)
      .set({ status: 'HELD', updatedAt: new Date() })
      .where(and(eq(holds.id, claimed.id), eq(holds.status, 'FILING')));

  const reservation = await reserveUpload(
    db,
    { accountId: owner, applicantId, sizeBytes: claimed.sizeBytes },
    options.quotaConfig ?? loadUploadQuotaConfig(),
  );
  if (!reservation.ok) {
    await putBack();
    return err(reservation.error);
  }
  const intent = reservation.value;
  try {
    const filed = await db.transaction(async (tx: Db) => {
      // The hold's own registration gives way to the document version's (one per object key).
      await tx
        .delete(schema.storageObjects)
        .where(eq(schema.storageObjects.objectKey, claimed.objectKey));
      const created = await registerDocumentWithVersion(tx, {
        actorAccountId: owner,
        applicantId,
        originalName: claimed.storedFileName,
        automaticTitle: true,
        source: claimed.convertedFromHeic ? CONVERTED_FROM_HEIC_SOURCE : 'UPLOAD',
        bucket: 'QUARANTINE',
        objectKey: claimed.objectKey,
        sizeBytes: claimed.sizeBytes,
        ...(claimed.sha256 ? { sha256: claimed.sha256 } : {}),
      });
      if (!created.ok) throw new FilingRefused(created.error);
      const version = created.value.version;
      const marked = await tx
        .update(holds)
        .set({
          status: 'FILED',
          filedDocumentId: version.documentId,
          originalFileName: null,
          decidedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(holds.id, claimed.id), eq(holds.status, 'FILING')))
        .returning({ id: holds.id });
      if (marked.length === 0) throw new FilingRefused(serviceError('not_found', 'file not found'));
      // The file's own name moves to the person's upload receipt, where the reading finds it for
      // a suggested title; it stays private to this account and goes with the document.
      if (await uploadReceiptsTablePresent(tx)) {
        await tx
          .insert(schema.documentUploadReceipts)
          .values({
            accountId: owner,
            applicantId,
            uploadId: claimed.uploadId,
            claimToken: randomUUID(),
            status: 'COMPLETED',
            uploadIntentId: intent.id,
            documentId: version.documentId,
            documentVersionId: version.id,
            originalFileName: claimed.originalFileName,
            completedAt: new Date(),
          })
          .onConflictDoNothing();
      }
      await enqueueIntakeJob(tx, { documentVersionId: version.id });
      await appendAuditEvent(tx, {
        eventType: 'DOCUMENT_HELD_FILED',
        actorAccountId: owner,
        method: 'MANUAL',
        result: 'ALLOWED',
        applicantId,
        resourceType: 'document',
        resourceId: version.documentId,
        metadata: {
          basis: claimed.proposalBasis,
          asProposed: claimed.proposedApplicantId === applicantId,
        },
      });
      return {
        documentId: version.documentId,
        documentVersionId: version.id,
        title: created.value.document.approvedName,
      };
    });
    await finalizeUpload(db, intent.id, filed.documentVersionId);
    return ok(filed);
  } catch (error) {
    await failUpload(
      db,
      intent.id,
      error instanceof FilingRefused ? error.serviceError.message : 'filing failed',
    );
    // The transaction rolled back, so the hold's registration is back; the hold waits again.
    await putBack();
    if (error instanceof FilingRefused) return err(error.serviceError);
    throw error;
  }
}

class FilingRefused extends Error {
  constructor(readonly serviceError: ServiceError) {
    super(serviceError.message);
  }
}

/** Removes one held file and its bytes. The account's own proof only; anything else answers as not found. */
export async function discardHeldFile(
  proof: OwnerProof,
  deps: { readonly storage: Pick<BlobStore, 'deleteObject'>; readonly now?: Date },
  input: { readonly holdId: string },
): Promise<Result<{ readonly discarded: true; readonly bytesRemoved: boolean }, ServiceError>> {
  const owner = ownerOf(proof, 'MANAGE');
  if (!owner) return err(serviceError('forbidden', 'not authorized'));
  const notFound = err(serviceError('not_found', 'file not found'));
  const db = proof.tx;
  if (!(await personHoldsTablePresent(db))) return notFound;
  const holds = schema.documentPersonHolds;
  const now = deps.now ?? new Date();
  const discarded = await db.transaction(async (tx: Db) => {
    const row = first(
      await tx
        .update(holds)
        .set({
          status: 'DISCARDED',
          originalFileName: null,
          storedFileName: 'document',
          decidedAt: now,
          updatedAt: now,
        })
        .where(
          and(eq(holds.id, input.holdId), eq(holds.ownerAccountId, owner), waitingCondition(now)),
        )
        .returning({ id: holds.id, objectKey: holds.objectKey }),
    );
    if (!row) return null;
    await appendAuditEvent(tx, {
      eventType: 'DOCUMENT_HELD_DISCARDED',
      actorAccountId: owner,
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'document_person_hold',
      resourceId: row.id,
      metadata: {},
    });
    return row;
  });
  if (!discarded) return notFound;
  // When the storage could not be reached, the row stays as removed and the sweep deletes the
  // bytes within a day; the caller says so rather than claiming they are gone.
  const bytesRemoved = await discardBytes(db, deps.storage, discarded.objectKey);
  return ok({ discarded: true, bytesRemoved });
}

/**
 * The abandoned uploads job: removes holds nobody will decide on (the account is gone, the file
 * waited longer than 30 days, storing it died part way, or it was removed and its bytes are still
 * to be deleted), with their bytes, and forgets the rows of filed holds once their account is gone.
 * Each row is claimed first (marked removed while still in the state it was read in), so a person
 * filing it at the same moment either wins (the sweep leaves it) or finds it gone; never both.
 * A row stays until its bytes are really gone, so a failed delete is tried again next time. A filed
 * hold's bytes belong to its document and are never touched.
 */
export async function sweepHeldFiles(
  db: Db,
  scope: SystemScope<'process-abandoned-uploads'>,
  storage: Pick<BlobStore, 'deleteObject'>,
  options: { readonly now?: Date; readonly limit?: number } = {},
): Promise<{ readonly removed: number }> {
  if (!SystemScope.isGenuine(scope) || scope.job !== 'process-abandoned-uploads') {
    throw new Error('the held file sweep needs the scope of its own job');
  }
  if (!(await personHoldsTablePresent(db))) return { removed: 0 };
  const holds = schema.documentPersonHolds;
  const now = options.now ?? new Date();
  const oldest = new Date(now.getTime() - HELD_MAX_AGE_MS);
  const staleClaim = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ id: holds.id, objectKey: holds.objectKey, status: holds.status })
    .from(holds)
    .where(
      or(
        isNull(holds.ownerAccountId),
        and(inArray(holds.status, ['HELD', 'FILING']), lt(holds.updatedAt, oldest)),
        and(inArray(holds.status, ['RECEIVING', 'DISCARDED']), lt(holds.updatedAt, staleClaim)),
      ),
    )
    .limit(options.limit ?? 200);
  let removed = 0;
  for (const row of rows) {
    if (row.status === 'FILED') {
      const gone = await db
        .delete(holds)
        .where(and(eq(holds.id, row.id), eq(holds.status, 'FILED')))
        .returning({ id: holds.id });
      removed += gone.length;
      continue;
    }
    // Claim: nobody can file it from here on, and nobody filed it since it was read.
    const claimed = await db
      .update(holds)
      .set({ status: 'DISCARDED', originalFileName: null, storedFileName: 'document' })
      .where(and(eq(holds.id, row.id), eq(holds.status, row.status)))
      .returning({ id: holds.id });
    if (claimed.length === 0) continue;
    if (!(await discardBytes(db, storage, row.objectKey))) continue;
    const gone = await db
      .delete(holds)
      .where(and(eq(holds.id, row.id), eq(holds.status, 'DISCARDED')))
      .returning({ id: holds.id });
    removed += gone.length;
  }
  return { removed };
}
