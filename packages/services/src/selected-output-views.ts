import { createHash } from 'node:crypto';
import type { Result } from '@visastack/core';
import { err, ok } from '@visastack/core';
import {
  type DocumentGroupKey,
  LAYER_KEYS,
  type LayerKey,
  documentTypeName,
} from '@visastack/core/catalogue';
import type { AuthorizedApplicant } from './access';
import { appendAuditEvent } from './audit';
import { type ServiceError, serviceError } from './errors';
import { rowsToCsv } from './export-csv';
import {
  IDENTITY_BASICS_KEYS,
  type OutputCase,
  type OutputDocument,
  type OutputRequirement,
  type OutputValue,
  type SelectedOutput,
  type SelectedOutputOptions,
  type Selection,
  type ValueStatus,
  layerLabel,
  renderAiContext,
} from './selected-output';

/**
 * The thin templates over the selected-output engine (WP-V5, S9). The engine decides what may
 * leave the record; everything here only lays out what it returned. A template never reads the
 * record itself, so it cannot show a value the engine left out.
 *
 * Five outputs: the agency brief, the case handover, the trip essentials, the confirmed-information
 * sheet and the AI context. Each has a minimal starting choice, so a person who just presses
 * Preview shares as little as the purpose allows.
 */

export const OUTPUT_TEMPLATE_IDS = [
  'agency_brief',
  'case_handover',
  'trip_essentials',
  'confirmed_sheet',
  'ai_context',
] as const;
export type OutputTemplateId = (typeof OUTPUT_TEMPLATE_IDS)[number];

export function isOutputTemplateId(value: unknown): value is OutputTemplateId {
  return typeof value === 'string' && (OUTPUT_TEMPLATE_IDS as readonly string[]).includes(value);
}

export type OutputFormat = 'txt' | 'csv' | 'json';

export interface OutputTemplate {
  readonly id: OutputTemplateId;
  /** The name a person sees. Title Case. */
  readonly label: string;
  /** One plain sentence about what it is for. */
  readonly description: string;
  /** Who normally reads it, as a short phrase. */
  readonly recipient: string;
  /** The output is about one case, so one must be chosen. */
  readonly needsCase: boolean;
  /** Layers the person may tick. Others are not offered. */
  readonly layersOffered: readonly LayerKey[];
  /** The layers ticked at the start: as few as the purpose allows. */
  readonly defaultLayers: readonly LayerKey[];
  readonly defaultDepth: Selection['depth'];
  readonly offersDocumentList: boolean;
  readonly defaultDocumentList: boolean;
  readonly offersDocumentText: boolean;
  readonly offersFullNumbers: boolean;
  readonly offersDepth: boolean;
  readonly offersQuestion: boolean;
  readonly offersFieldPicker: boolean;
  readonly formats: readonly OutputFormat[];
  /** A prepared WhatsApp message may be offered alongside it. */
  readonly whatsapp: boolean;
}

const EVERY_LAYER: readonly LayerKey[] = LAYER_KEYS;
const BRIEF_LAYERS: readonly LayerKey[] = [
  'identity',
  'travel_documents',
  'timelines',
  'money',
  'people',
  'qualifications',
  'declarations',
  'health',
  'purpose_packs',
  'country_packs',
];

export const OUTPUT_TEMPLATES: Readonly<Record<OutputTemplateId, OutputTemplate>> = {
  agency_brief: {
    id: 'agency_brief',
    label: 'Agency Brief',
    description: 'A short summary of one case for an agency you are asking for help.',
    recipient: 'An agency you choose',
    needsCase: true,
    layersOffered: BRIEF_LAYERS,
    defaultLayers: ['identity', 'travel_documents'],
    defaultDepth: 'standard',
    offersDocumentList: true,
    defaultDocumentList: true,
    offersDocumentText: false,
    offersFullNumbers: true,
    offersDepth: true,
    offersQuestion: false,
    offersFieldPicker: false,
    formats: ['txt'],
    whatsapp: true,
  },
  case_handover: {
    id: 'case_handover',
    label: 'Case Handover',
    description: 'What a new agency needs to pick up one case where it stands.',
    recipient: 'The agency taking over',
    needsCase: true,
    layersOffered: BRIEF_LAYERS,
    defaultLayers: ['identity', 'travel_documents', 'timelines'],
    defaultDepth: 'standard',
    offersDocumentList: true,
    defaultDocumentList: true,
    offersDocumentText: false,
    offersFullNumbers: true,
    offersDepth: true,
    offersQuestion: false,
    offersFieldPicker: false,
    formats: ['txt'],
    whatsapp: true,
  },
  trip_essentials: {
    id: 'trip_essentials',
    label: 'Trip Essentials',
    description: 'A printable summary of the documents and details you need for one trip.',
    recipient: 'You, to carry or print',
    needsCase: true,
    layersOffered: ['travel_documents', 'people'],
    defaultLayers: ['travel_documents', 'people'],
    defaultDepth: 'standard',
    offersDocumentList: false,
    defaultDocumentList: true,
    offersDocumentText: false,
    offersFullNumbers: false,
    offersDepth: false,
    offersQuestion: false,
    offersFieldPicker: false,
    formats: ['txt'],
    whatsapp: false,
  },
  confirmed_sheet: {
    id: 'confirmed_sheet',
    label: 'Confirmed Information Sheet',
    description: 'The details you have confirmed, laid out to copy into a form.',
    recipient: 'You, to copy from',
    needsCase: false,
    layersOffered: EVERY_LAYER,
    defaultLayers: ['identity', 'travel_documents'],
    defaultDepth: 'standard',
    offersDocumentList: false,
    defaultDocumentList: false,
    offersDocumentText: false,
    offersFullNumbers: true,
    offersDepth: false,
    offersQuestion: false,
    offersFieldPicker: true,
    formats: ['txt', 'csv'],
    whatsapp: false,
  },
  ai_context: {
    id: 'ai_context',
    label: 'AI Context',
    description: 'A summary to paste into an AI app, so it knows only what you chose.',
    recipient: 'An AI app you choose',
    needsCase: false,
    layersOffered: EVERY_LAYER,
    defaultLayers: ['identity', 'travel_documents'],
    defaultDepth: 'standard',
    offersDocumentList: true,
    defaultDocumentList: true,
    offersDocumentText: true,
    offersFullNumbers: true,
    offersDepth: true,
    offersQuestion: true,
    offersFieldPicker: false,
    formats: ['json'],
    whatsapp: false,
  },
};

/** The document kinds a trip pack looks for, by the slot a traveller would name them. */
export const TRIP_DOCUMENT_SLOTS: readonly {
  readonly heading: string;
  readonly kinds: readonly string[];
}[] = [
  {
    heading: 'Ticket',
    kinds: ['FLIGHT_TICKET', 'FLIGHT_BOOKING', 'RETURN_TICKET', 'TRAVEL_ITINERARY'],
  },
  { heading: 'Accommodation', kinds: ['HOTEL_BOOKING', 'ACCOMMODATION_PROOF'] },
  { heading: 'Passport Copy', kinds: ['PASSPORT'] },
  { heading: 'Visa Copy', kinds: ['VISA', 'VISA_STAMP'] },
  { heading: 'Insurance', kinds: ['TRAVEL_INSURANCE'] },
];

/** The only profile fields a trip pack carries: the passport, the insurance and one emergency contact. */
export const TRIP_FIELD_KEYS: readonly string[] = [
  ...IDENTITY_BASICS_KEYS,
  'passport_number',
  'passport_issuing_country',
  'passport_issue_date',
  'passport_expiry',
  'travel_insurance_provider',
  'travel_insurance_policy_number',
  'travel_insurance_valid_from',
  'travel_insurance_valid_until',
  'travel_insurance_coverage_countries',
  'emergency_contact_name',
  'emergency_contact_relationship',
  'emergency_contact_phone',
];

/** What a person has chosen on top of the template: the case, the fields and their own words. */
export interface OutputChoice {
  readonly missionId: string | null;
  readonly layers: readonly LayerKey[];
  readonly documentList: boolean;
  readonly documentText: readonly DocumentGroupKey[];
  readonly revealIdentifiers: boolean;
  readonly depth: Selection['depth'];
  /** Fields picked one by one (the sheet). Null means every field of the chosen layers. */
  readonly fieldKeys: readonly string[] | null;
  readonly question: string;
}

/** The starting choice for a template: as little as the purpose allows. */
export function defaultChoice(id: OutputTemplateId, missionId: string | null): OutputChoice {
  const template = OUTPUT_TEMPLATES[id];
  return {
    missionId,
    layers: template.defaultLayers,
    documentList: template.defaultDocumentList,
    documentText: [],
    revealIdentifiers: false,
    depth: template.defaultDepth,
    fieldKeys: null,
    question: '',
  };
}

/**
 * The engine selection and options for a template and a choice. The template narrows what the
 * person may ask for (a trip pack never carries money, however the address is edited), so a choice
 * that reaches past it is cut back here rather than trusted.
 */
export function engineRequest(
  id: OutputTemplateId,
  choice: OutputChoice,
): { readonly selection: Selection; readonly options: SelectedOutputOptions } {
  const template = OUTPUT_TEMPLATES[id];
  const offered = new Set(template.layersOffered);
  const layers = choice.layers.filter((layer) => offered.has(layer));
  // A case can be named for a template that is about a case, and for the AI context (optional).
  const cases: Selection['cases'] =
    choice.missionId && (template.needsCase || id === 'ai_context')
      ? { kind: 'one', missionId: choice.missionId }
      : { kind: 'none' };
  const selection: Selection = {
    layers,
    cases,
    documentList: template.offersDocumentList ? choice.documentList : template.defaultDocumentList,
    documentText: template.offersDocumentText ? choice.documentText : [],
    revealIdentifiers: template.offersFullNumbers && choice.revealIdentifiers,
    depth: template.offersDepth ? choice.depth : template.defaultDepth,
  };
  const options: {
    confirmedOnly?: boolean;
    fieldKeys?: readonly string[];
    documentScope?: NonNullable<SelectedOutputOptions['documentScope']>;
  } = {};
  if (id === 'confirmed_sheet') options.confirmedOnly = true;
  if (id === 'trip_essentials') {
    options.fieldKeys = TRIP_FIELD_KEYS;
    options.documentScope = { kinds: TRIP_DOCUMENT_SLOTS.flatMap((slot) => slot.kinds) };
  } else if (template.offersFieldPicker && choice.fieldKeys) {
    options.fieldKeys = choice.fieldKeys;
  }
  return { selection, options };
}

// --- Words -----------------------------------------------------------------

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** `2026-10-27` as `27 October 2026`. Anything that is not a plain day is returned as it came. */
export function longDay(iso: string | null | undefined): string {
  if (!iso) return '';
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return iso;
  const month = MONTHS[Number(match[2]) - 1];
  return month ? `${Number(match[3])} ${month} ${match[1]}` : iso;
}

const STATUS_WORDS: Readonly<Record<ValueStatus, string>> = {
  self_declared: 'Typed by the traveller, not checked',
  suggested_not_confirmed: 'Suggested, not confirmed',
  confirmed_by_traveller: 'Confirmed by the traveller',
  supported_by_document: 'Supported by a document',
  reviewed_by_agency: 'Reviewed by an agency',
  conflicted: 'Two values disagree',
  out_of_date: 'Out of date',
  replaced: 'Replaced',
};

/** The words for a status, for a screen or a file. */
export function statusWords(status: ValueStatus): string {
  return STATUS_WORDS[status];
}

const DOCUMENT_STATUS_WORDS = {
  current: 'Current',
  expires_soon: 'Expires soon',
  expired: 'Expired',
  being_checked: 'Still being checked',
} as const;

/** Control characters other than a line break or a tab: they hide or garble text and carry no meaning. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: this is the point of the expression
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** A value as plain text, with only invisible control characters taken out. Nothing visible is changed. */
export function cleanText(value: string): string {
  return value.replace(CONTROL_CHARACTERS, '');
}

function valueText(value: OutputValue): string {
  if (value.conflict) return 'Needs checking: two values disagree';
  if (value.masked !== undefined) return cleanText(value.masked);
  return cleanText(value.value ?? '');
}

function valueLabel(value: OutputValue): string {
  return value.record
    ? `${value.label} (${value.record.label} ${value.record.number})`
    : value.label;
}

function isHistorical(value: OutputValue, preparedOn: string): boolean {
  if (value.validUntil && value.validUntil.slice(0, 10) < preparedOn) return true;
  return value.fieldKey.startsWith('historical_');
}

function valueNote(value: OutputValue, preparedOn: string, withSource = true): string {
  // A disputed value already says so in place of its value.
  if (value.conflict) return '';
  const parts: string[] = [];
  if (value.masked !== undefined) parts.push('Number hidden except the last three characters');
  parts.push(statusWords(value.status));
  if (isHistorical(value, preparedOn)) parts.push('Historical');
  if (value.effectiveFrom) parts.push(`True from ${longDay(value.effectiveFrom.slice(0, 10))}`);
  if (value.validUntil) parts.push(`Valid until ${longDay(value.validUntil.slice(0, 10))}`);
  if (value.updatedAt) parts.push(`Saved ${longDay(value.updatedAt.slice(0, 10))}`);
  if (withSource && value.evidence && value.evidence.length > 0) {
    parts.push(
      `Source: ${value.evidence
        .map((e) =>
          [e.kind, e.referenceCode, e.date ? longDay(e.date) : null].filter(Boolean).join(', '),
        )
        .join('; ')}`,
    );
  }
  return parts.join('. ');
}

// --- The laid-out view -----------------------------------------------------

export interface ViewRow {
  readonly label: string;
  readonly value: string;
  readonly note?: string;
}

export interface ViewSection {
  readonly heading: string;
  readonly rows: readonly ViewRow[];
  /** Said when the section has no rows, so a gap never reads as "none". */
  readonly emptyNote?: string;
}

export interface OutputView {
  readonly template: OutputTemplateId;
  readonly title: string;
  readonly preparedOn: string;
  readonly intro: readonly string[];
  readonly sections: readonly ViewSection[];
  /** What is still unknown, missing or in doubt. Never invented. */
  readonly unknowns: readonly string[];
  readonly footer: readonly string[];
}

function personRows(output: SelectedOutput, preparedOn: string): ViewRow[] {
  const rows: ViewRow[] = [{ label: 'Name', value: cleanText(output.person.displayName) }];
  if (output.person.referenceCode) {
    rows.push({ label: 'Reference', value: output.person.referenceCode });
  }
  for (const basic of output.person.basics) {
    rows.push({
      label: valueLabel(basic),
      value: valueText(basic),
      note: valueNote(basic, preparedOn),
    });
  }
  return rows;
}

function caseRows(item: OutputCase): ViewRow[] {
  const rows: ViewRow[] = [{ label: 'Case', value: cleanText(item.title) }];
  if (item.referenceCode) rows.push({ label: 'Reference', value: item.referenceCode });
  if (item.destination) rows.push({ label: 'Destination', value: cleanText(item.destination) });
  if (item.purpose) rows.push({ label: 'Purpose', value: cleanText(item.purpose) });
  if (item.travelStart) rows.push({ label: 'Travel Starts', value: longDay(item.travelStart) });
  if (item.travelEnd) rows.push({ label: 'Travel Ends', value: longDay(item.travelEnd) });
  if (item.targetDeadline) {
    rows.push({ label: 'Target Date', value: longDay(item.targetDeadline) });
  }
  rows.push({ label: 'Where It Stands', value: item.state });
  return rows;
}

function standingRows(item: OutputCase): ViewRow[] {
  const rows: ViewRow[] = [];
  const checklist = item.checklist;
  if (checklist) {
    rows.push({
      label: 'Checklist',
      value: `${checklist.name}, version ${checklist.version}`,
      note: checklist.rulesMaintained
        ? `Rules are kept up to date${checklist.nextReviewDate ? `. Next review ${longDay(checklist.nextReviewDate)}` : ''}`
        : 'The rules in this checklist may be out of date. Check the official source before relying on it',
    });
  }
  const readiness = item.readiness;
  if (readiness) {
    rows.push({
      label: 'Required Items Ready',
      value: `${readiness.satisfiedCount} of ${readiness.requiredCount}`,
      note: 'Completeness only. It says nothing about whether an application will be accepted',
    });
    if (readiness.withheld > 0) {
      rows.push({
        label: 'Items Not Shown',
        value: String(readiness.withheld),
        note: 'They belong to parts of the record that were not chosen',
      });
    }
  }
  return rows;
}

function requirementLines(item: OutputCase): string[] {
  const readiness = item.readiness;
  if (!readiness) return [];
  const line = (r: OutputRequirement): string =>
    `${r.label}${r.optional ? ' (optional)' : ''}: ${r.note ?? 'Needs a look'}`;
  return [...readiness.missing.map(line), ...readiness.needsAttention.map(line)];
}

function documentRows(documents: readonly OutputDocument[]): ViewRow[] {
  return documents.map((document) => ({
    label: document.kind,
    value: DOCUMENT_STATUS_WORDS[document.status],
    note: [
      document.referenceCode,
      document.documentDate ? `Dated ${longDay(document.documentDate)}` : null,
      document.expiresOn ? `Expires ${longDay(document.expiresOn)}` : null,
    ]
      .filter(Boolean)
      .join('. '),
  }));
}

function layerSections(output: SelectedOutput, preparedOn: string): ViewSection[] {
  const sections: ViewSection[] = [];
  for (const layer of LAYER_KEYS) {
    const values = output.profile[layer];
    if (!values || values.length === 0) continue;
    sections.push({
      heading: layerLabel(layer),
      rows: values.map((value) => ({
        label: valueLabel(value),
        value: valueText(value),
        note: valueNote(value, preparedOn),
      })),
    });
  }
  return sections;
}

function leftOutLine(output: SelectedOutput): string | null {
  const o = output.omitted;
  const parts: string[] = [];
  if (o.not_granted > 0) parts.push(`${o.not_granted} in parts you did not choose`);
  if (o.restricted > 0) parts.push(`${o.restricted} that are protected`);
  if (o.unconfirmed > 0) parts.push(`${o.unconfirmed} that are not confirmed yet`);
  if (o.conflicted > 0) parts.push(`${o.conflicted} where two values disagree`);
  if (o.unreadable > 0) parts.push(`${o.unreadable} that could not be read`);
  if (parts.length === 0) return null;
  return `Details left out of this summary: ${parts.join(', ')}.`;
}

const SNAPSHOT_NOTE =
  'This is a copy taken on the date above. It does not update when the record changes, and VisaStack cannot take back a copy once it has been shared.';

function unknownLines(output: SelectedOutput): string[] {
  const lines: string[] = [];
  for (const item of output.cases) {
    const prefix = output.cases.length > 1 ? `${item.title}: ` : '';
    for (const line of requirementLines(item)) lines.push(`${prefix}${line}`);
    for (const action of item.nextActions) {
      lines.push(
        `${prefix}${action.title}${action.dueDate ? `, due ${longDay(action.dueDate)}` : ''}${action.overdue ? ' (late)' : ''}`,
      );
    }
  }
  for (const values of Object.values(output.profile)) {
    for (const value of values ?? []) {
      if (value.conflict) lines.push(`${valueLabel(value)}: two values disagree`);
    }
  }
  return lines;
}

function briefView(
  id: 'agency_brief' | 'case_handover',
  output: SelectedOutput,
  preparedOn: string,
): OutputView {
  const handover = id === 'case_handover';
  const sections: ViewSection[] = [];
  for (const item of output.cases) {
    sections.push({ heading: 'About the Case', rows: caseRows(item) });
    const standing = standingRows(item);
    if (standing.length > 0) sections.push({ heading: 'Where the Case Stands', rows: standing });
  }
  if (output.cases.length === 0) {
    sections.push({ heading: 'About the Case', rows: [], emptyNote: 'No case was chosen.' });
  }
  sections.push({ heading: 'About the Traveller', rows: personRows(output, preparedOn) });
  sections.push(...layerSections(output, preparedOn));
  if (output.selection.documentList) {
    sections.push({
      heading: 'Documents on File',
      rows: documentRows(output.documents),
      emptyNote: 'No documents are on file for what was chosen. This does not mean none exist.',
    });
  }
  const left = leftOutLine(output);
  return {
    template: id,
    title: handover ? 'Case Handover' : 'Agency Brief',
    preparedOn,
    intro: [
      handover
        ? 'What a new agency needs to pick up this case where it stands. It holds only what the traveller chose to include.'
        : 'A short summary of this case, with only what the traveller chose to include.',
      'This is a partly complete summary. It is not a final application and it does not say an application will be accepted.',
    ],
    sections,
    unknowns: unknownLines(output),
    footer: [SNAPSHOT_NOTE, ...(left ? [left] : [])],
  };
}

function tripView(output: SelectedOutput, preparedOn: string): OutputView {
  const sections: ViewSection[] = [];
  for (const item of output.cases) sections.push({ heading: 'The Trip', rows: caseRows(item) });
  sections.push({ heading: 'The Traveller', rows: personRows(output, preparedOn) });

  const byKind = (kinds: readonly string[]): OutputDocument[] =>
    output.documents.filter((document) =>
      kinds.some((kind) => document.kind === documentTypeName(kind)),
    );
  const documentSection: ViewRow[] = [];
  const missing: string[] = [];
  for (const slot of TRIP_DOCUMENT_SLOTS) {
    const found = byKind(slot.kinds);
    if (found.length === 0) {
      documentSection.push({ label: slot.heading, value: 'Not on file yet' });
      missing.push(slot.heading);
      continue;
    }
    for (const document of found) {
      documentSection.push({
        label: slot.heading,
        value: `${document.kind}, ${DOCUMENT_STATUS_WORDS[document.status].toLowerCase()}`,
        note: [
          document.referenceCode,
          document.documentDate ? `Dated ${longDay(document.documentDate)}` : null,
          document.expiresOn ? `Expires ${longDay(document.expiresOn)}` : null,
        ]
          .filter(Boolean)
          .join('. '),
      });
    }
  }
  sections.push({ heading: 'Documents to Bring', rows: documentSection });

  const passport = (output.profile.travel_documents ?? []).filter((v) =>
    v.fieldKey.startsWith('passport_'),
  );
  const insurance = (output.profile.travel_documents ?? []).filter((v) =>
    v.fieldKey.startsWith('travel_insurance_'),
  );
  const contacts = (output.profile.people ?? []).filter((v) =>
    v.fieldKey.startsWith('emergency_contact_'),
  );
  const toRows = (values: readonly OutputValue[]): ViewRow[] =>
    values.map((value) => ({
      label: valueLabel(value),
      value: valueText(value),
      note: valueNote(value, preparedOn, false),
    }));
  sections.push({
    heading: 'Passport',
    rows: toRows(passport),
    emptyNote: 'No passport details are on file yet.',
  });
  sections.push({
    heading: 'Insurance',
    rows: toRows(insurance),
    emptyNote: 'No insurance details are on file yet.',
  });
  sections.push({
    heading: 'Contacts',
    rows: toRows(contacts),
    emptyNote: 'No emergency contact is on file yet.',
  });
  // Only what this pack is about: the slots above and any detail in it that is in doubt.
  const unknowns = [
    ...missing.map((slot) => `${slot}: not on file yet`),
    ...[...passport, ...insurance, ...contacts]
      .filter((value) => value.conflict)
      .map((value) => `${valueLabel(value)}: two values disagree`),
  ];
  return {
    template: 'trip_essentials',
    title: 'Trip Essentials',
    preparedOn,
    intro: [
      'The documents and details for this trip, in one place to carry or print. Only what the traveller chose appears here.',
    ],
    sections,
    unknowns,
    footer: [
      'This summary is not a boarding pass, a certified copy, proof of a booking or a promise of entry. It does not cover every border requirement.',
      'Keep the documents themselves with you. This page only lists them.',
      SNAPSHOT_NOTE,
    ],
  };
}

function sheetView(output: SelectedOutput, preparedOn: string): OutputView {
  const sections = [
    { heading: 'Name', rows: personRows(output, preparedOn) } satisfies ViewSection,
    ...layerSections(output, preparedOn),
  ];
  const left = leftOutLine(output);
  return {
    template: 'confirmed_sheet',
    title: 'Confirmed Information Sheet',
    preparedOn,
    intro: [
      'Details the traveller has confirmed or that a document supports, with the date each was saved. A detail that is not here has not been confirmed. That does not mean it does not apply.',
      'Values are shown exactly as saved. Copy them as they are; check each one against the form you are filling.',
    ],
    sections,
    unknowns: unknownLines(output),
    footer: [
      'A ticket or booking alone does not confirm travel. Unconfirmed suggestions are never included.',
      'In the spreadsheet file, a value that starts with =, @ or a similar sign has an apostrophe put in front of it so a spreadsheet cannot run it as a formula. Phone numbers are left as saved.',
      SNAPSHOT_NOTE,
      ...(left ? [left] : []),
    ],
  };
}

/** Lays out an output for a template. The AI context has no view; it is `renderAiContext`. */
export function renderOutputView(
  id: Exclude<OutputTemplateId, 'ai_context'>,
  output: SelectedOutput,
): OutputView {
  const preparedOn = output.preparedOn;
  switch (id) {
    case 'agency_brief':
    case 'case_handover':
      return briefView(id, output, preparedOn);
    case 'trip_essentials':
      return tripView(output, preparedOn);
    case 'confirmed_sheet':
      return sheetView(output, preparedOn);
  }
}

// --- Files -----------------------------------------------------------------

/**
 * A value with line breaks keeps them, but every line after the first is indented, so words typed
 * into a detail can never start a line that looks like a heading or a list item of the summary.
 */
function indentLines(value: string): string {
  return value.replace(/\r\n|\r|\n/g, '\n    ');
}

/** The view as plain text: the same words as the screen, to copy, print or save. */
export function renderOutputText(view: OutputView): string {
  const lines: string[] = [view.title.toUpperCase(), `Prepared on ${longDay(view.preparedOn)}`, ''];
  for (const paragraph of view.intro) lines.push(paragraph, '');
  for (const section of view.sections) {
    lines.push(section.heading.toUpperCase());
    if (section.rows.length === 0) {
      lines.push(section.emptyNote ?? 'Nothing to show.');
    }
    for (const row of section.rows) {
      lines.push(`${row.label}: ${indentLines(row.value)}${row.note ? ` (${row.note})` : ''}`);
    }
    lines.push('');
  }
  if (view.unknowns.length > 0) {
    lines.push('STILL UNKNOWN OR NEEDS A LOOK');
    for (const unknown of view.unknowns) lines.push(`- ${unknown}`);
    lines.push('');
  }
  for (const note of view.footer) lines.push(note);
  return `${lines.join('\n').trimEnd()}\n`;
}

/** A cell that a spreadsheet would run as a formula starts with one of these. */
const FORMULA_START = /^[=+\-@\t\r]/;

/** A plain number or phone number with a sign: digits, spaces, dots, brackets and dashes only. It cannot call anything. */
const SIGNED_NUMBER = /^[+-]?[\d\s().-]+$/;

/**
 * Stops a spreadsheet running a cell as a formula, by putting an apostrophe in front of it. A
 * phone number such as +8801712345678 is left exactly as saved: it holds no letters, so it cannot
 * call a function or point at a cell.
 */
export function neutraliseFormula(value: string): string {
  if (!FORMULA_START.test(value)) return value;
  if (/^[+-]/.test(value) && SIGNED_NUMBER.test(value)) return value;
  return `'${value}`;
}

/** The confirmed-information sheet as CSV: one row per detail, formulas made harmless. */
export function renderSheetCsv(output: SelectedOutput): string {
  const preparedOn = output.preparedOn;
  const rows: Record<string, unknown>[] = [];
  const add = (section: string, value: OutputValue): void => {
    rows.push({
      section: neutraliseFormula(section),
      field: neutraliseFormula(value.label),
      record: value.record ? neutraliseFormula(`${value.record.label} ${value.record.number}`) : '',
      value: neutraliseFormula(valueText(value)),
      status: neutraliseFormula(statusWords(value.status)),
      historical: isHistorical(value, preparedOn) ? 'Yes' : '',
      saved_on: value.updatedAt ? value.updatedAt.slice(0, 10) : '',
      source: neutraliseFormula(
        (value.evidence ?? [])
          .map((e) => [e.kind, e.referenceCode].filter(Boolean).join(' '))
          .join('; '),
      ),
    });
  };
  for (const basic of output.person.basics) add('Name', basic);
  for (const layer of LAYER_KEYS) {
    for (const value of output.profile[layer] ?? []) add(layerLabel(layer), value);
  }
  if (rows.length === 0) return '';
  return `${rowsToCsv(rows)}\r\n`;
}

/** A name for a download that holds no personal detail. */
export function outputFileName(
  id: OutputTemplateId,
  format: OutputFormat,
  preparedOn: string,
): string {
  return `visastack-${id.replace(/_/g, '-')}-${preparedOn}.${format}`;
}

/** The body of a download in a format the template offers, or null when it does not offer it. */
export function renderOutputFile(
  id: OutputTemplateId,
  output: SelectedOutput,
  format: OutputFormat,
  choice: Pick<OutputChoice, 'question'>,
): { readonly body: string; readonly contentType: string } | null {
  if (!OUTPUT_TEMPLATES[id].formats.includes(format)) return null;
  if (id === 'ai_context') {
    return {
      body: renderAiContext(output, { question: choice.question }),
      contentType: 'application/json; charset=utf-8',
    };
  }
  if (format === 'csv') {
    return { body: renderSheetCsv(output), contentType: 'text/csv; charset=utf-8' };
  }
  return {
    body: renderOutputText(renderOutputView(id, output)),
    contentType: 'text/plain; charset=utf-8',
  };
}

/**
 * A fingerprint of what an output holds, without the moment it was made. A preview and the file
 * made from it carry the same one only while the record, the choice and the rules say the same
 * thing; if anything relevant changed in between, the download is refused and the person previews
 * again, never handed a different packet in silence.
 */
export function outputFingerprint(
  id: OutputTemplateId,
  output: SelectedOutput,
  question = '',
): string {
  const { generatedAt: _moment, ...stable } = output;
  return createHash('sha256')
    .update(JSON.stringify({ id, stable, question }))
    .digest('hex')
    .slice(0, 32);
}

// --- WhatsApp --------------------------------------------------------------

export interface WhatsAppShare {
  /** The words to send. Generic: no name, no number, no document. */
  readonly message: string;
  /** Opens WhatsApp with the words ready. Nothing is sent until the person sends it. */
  readonly href: string;
}

const ORIGIN_PATTERN = /^https:\/\/[a-z0-9.-]+(:\d+)?$|^http:\/\/localhost(:\d+)?$/i;

/**
 * The prepared WhatsApp message: a generic greeting and a link to the signed-in shared workspace,
 * where only what the person has actually shared with the reader can be seen. It takes nothing
 * from the record, so it cannot carry a document, an identifier or a name. It is never sent by
 * VisaStack; it only opens WhatsApp with the words filled in.
 */
export function buildWhatsAppShare(origin: string): Result<WhatsAppShare, ServiceError> {
  if (!ORIGIN_PATTERN.test(origin)) {
    return err(serviceError('invalid', 'the site address is not usable for a share link'));
  }
  const link = `${origin}/app/shared`;
  const message = `Hello, I have put my visa details together on VisaStack and shared what you need there. Please sign in to VisaStack to see it: ${link}`;
  return ok({ message, href: `https://wa.me/?text=${encodeURIComponent(message)}` });
}

// --- Record keeping --------------------------------------------------------

export const OUTPUT_PREPARED_EVENT = 'SELECTED_OUTPUT_PREPARED';

export interface OutputPreparedRecord {
  readonly template: OutputTemplateId;
  readonly format: OutputFormat;
  readonly output: SelectedOutput;
}

/**
 * One audit entry for a file that left VisaStack: what kind it was and how big, never what was in
 * it. Written before the file is returned, and when it cannot be written the caller sends no file.
 */
export async function recordOutputPrepared(
  access: AuthorizedApplicant<'VIEW_METADATA'>,
  record: OutputPreparedRecord,
): Promise<Result<void, ServiceError>> {
  if (access.actor.kind !== 'applicant_owner' || access.resource.kind !== 'applicant') {
    return err(serviceError('forbidden', 'summaries are available to the owner only'));
  }
  const output = record.output;
  const valueCount =
    output.person.basics.length +
    Object.values(output.profile).reduce((total, list) => total + (list?.length ?? 0), 0);
  try {
    await access.tx.transaction(async (tx) => {
      await appendAuditEvent(tx, {
        eventType: OUTPUT_PREPARED_EVENT,
        actorAccountId: access.applicant.ownerAccountId,
        actorRole: 'applicant_owner',
        action: 'EXPORT_PROFILE',
        result: 'ALLOWED',
        method: 'API',
        applicantId: access.applicant.id,
        resourceType: 'selected_output',
        resourceId: access.applicant.id,
        metadata: {
          template: record.template,
          format: record.format,
          layers: [...output.selection.layers],
          caseCount: output.cases.length,
          valueCount,
          documentCount: output.documents.length,
          documentTextCount: output.documentText.length,
          fullNumbers: output.selection.revealIdentifiers,
        },
      });
    });
  } catch {
    return err(serviceError('upstream_error', 'the record of this summary could not be saved'));
  }
  return ok(undefined);
}
