import { z } from 'zod';

/**
 * The shapes the five AI tools answer with (their MCP `outputSchema`). They describe what the
 * context composer produces; objects are open (extra fields are allowed) so that a field the
 * composer adds later never turns a good answer into a validation error. Nothing here reads data.
 */

/** Present when an answer was shortened to fit the size limit. */
export const noticeField = z
  .string()
  .optional()
  .describe('Present when the answer was shortened to fit the size limit, in plain words.');

const evidenceSchema = z.looseObject({
  ref: z.string().nullable().describe('The document reference, for example D-7K2Q9M.'),
  kind: z.string(),
  date: z.string().optional(),
});

export const valueSchema = z.looseObject({
  field: z.string(),
  label: z.string(),
  record: z.string().optional(),
  value: z.string().optional(),
  masked: z.string().optional().describe('Only the last three characters; the rest is not shared.'),
  conflict: z.boolean().optional(),
  status: z
    .string()
    .describe(
      'self_declared, suggested_not_confirmed, confirmed_by_traveller, supported_by_document, reviewed_by_agency, conflicted, out_of_date or replaced.',
    ),
  method: z.string().optional(),
  effectiveFrom: z.string().optional(),
  validUntil: z.string().optional(),
  updatedAt: z.string().optional(),
  evidence: z.array(evidenceSchema).optional(),
  relevance: z.string().describe('required_by_case or context.'),
});

export const omittedSchema = z
  .record(z.string(), z.number())
  .describe('How many values were left out and why. Counts only.');

export const documentSchema = z.looseObject({
  referenceCode: z.string().nullable(),
  kind: z.string(),
  group: z.string(),
  groupKey: z.string(),
  documentDate: z.string().nullable(),
  expiresOn: z.string().nullable(),
  status: z.string(),
  relevance: z.string(),
});

export const expirySchema = z.looseObject({
  referenceCode: z.string().nullable(),
  kind: z.string(),
  expiresOn: z.string(),
  daysLeft: z.number(),
});

export const documentTextSchema = z.looseObject({
  referenceCode: z.string().nullable(),
  kind: z.string(),
  group: z.string(),
  text: z.string(),
  truncated: z.boolean(),
  untrusted: z.boolean().optional(),
});

const requirementSchema = z.looseObject({
  label: z.string(),
  optional: z.boolean().optional(),
  note: z.string().optional(),
});

export const contextCaseSchema = z.looseObject({
  ref: z.string().optional(),
  title: z.string(),
  destination: z.string().optional(),
  purpose: z.string().optional(),
  travelStart: z.string().optional(),
  travelEnd: z.string().optional(),
  targetDeadline: z.string().optional(),
  state: z.string(),
  checklist: z.looseObject({}).optional(),
  readiness: z
    .looseObject({
      required: z.number(),
      satisfied: z.number(),
      needsAttention: z.array(requirementSchema),
      missing: z.array(requirementSchema),
      withheld: z.number().optional(),
    })
    .optional(),
  nextActions: z.array(z.looseObject({ title: z.string() })).optional(),
});

/** `prepare_context`: the compact context, as `renderAiContext` writes it. */
export const contextOutputSchema = z.looseObject({
  visastackContext: z.literal(1),
  snapshotTakenAt: z.string(),
  guidance: z.array(z.string()),
  person: z.looseObject({
    name: z.string(),
    ref: z.string().optional(),
    basics: z.array(valueSchema).optional(),
  }),
  cases: z.array(contextCaseSchema).optional(),
  profile: z.record(z.string(), z.array(valueSchema)).optional(),
  documents: z.array(documentSchema).optional(),
  expiry: z.array(expirySchema).optional(),
  documentText: z.array(documentTextSchema).optional(),
  omitted: omittedSchema,
  notShared: z
    .array(z.string())
    .optional()
    .describe('Parts that were asked for but are not shared with this app.'),
  notice: noticeField,
});

export const caseListOutputSchema = z.looseObject({
  cases: z.array(
    z.looseObject({
      reference: z.string().nullable().describe('For example C-7K2Q9M.'),
      title: z.string(),
      destination: z.string().nullable(),
      purpose: z.string().nullable(),
      travelStart: z.string().nullable(),
      travelEnd: z.string().nullable(),
      targetDeadline: z.string().nullable(),
      state: z.string(),
      readiness: z
        .looseObject({
          required: z.number(),
          satisfied: z.number(),
          needsAttention: z.number(),
          missing: z.number(),
        })
        .nullable(),
    }),
  ),
  casesNotShown: z.number(),
  notice: noticeField,
});

export const profileSectionOutputSchema = z.looseObject({
  section: z.string(),
  label: z.string(),
  values: z.array(valueSchema),
  omitted: omittedSchema,
  notice: noticeField,
});

export const documentListOutputSchema = z.looseObject({
  documents: z.array(documentSchema),
  omitted: omittedSchema,
  notice: noticeField,
});

export const documentTextOutputSchema = z.looseObject({
  referenceCode: z.string(),
  kind: z.string(),
  group: z.string(),
  text: z.string(),
  truncated: z.boolean(),
  untrusted: z.literal(true),
  guidance: z.string(),
  notice: noticeField,
});

/** `suggest_profile_update` (S21): the suggestion is waiting for the person; nothing has changed. */
export const suggestionOutputSchema = z.looseObject({
  status: z.literal('waiting_for_approval'),
  section: z.string(),
  fieldLabel: z.string(),
  document: z
    .string()
    .nullable()
    .describe('The document reference the suggestion is about, if any.'),
  guidance: z.string(),
  notice: noticeField,
});

/** `save_draft` (S21). */
export const draftOutputSchema = z.looseObject({
  status: z.literal('saved'),
  title: z.string(),
  case: z.string().nullable().describe('The case reference the draft is kept with, if any.'),
  guidance: z.string(),
  notice: noticeField,
});

/** `add_reminder` (S21). */
export const reminderOutputSchema = z.looseObject({
  status: z.literal('added'),
  case: z.string(),
  title: z.string(),
  dueDate: z.string(),
  guidance: z.string(),
  notice: noticeField,
});
