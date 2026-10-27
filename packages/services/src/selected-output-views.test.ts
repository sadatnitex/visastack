import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vitest';
import { accountPrincipal, requireAccess } from './access';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import type { OutputValue, SelectedOutput } from './selected-output';
import {
  OUTPUT_PREPARED_EVENT,
  OUTPUT_TEMPLATES,
  OUTPUT_TEMPLATE_IDS,
  type OutputChoice,
  TRIP_DOCUMENT_SLOTS,
  TRIP_FIELD_KEYS,
  buildWhatsAppShare,
  cleanText,
  defaultChoice,
  engineRequest,
  longDay,
  neutraliseFormula,
  outputFileName,
  outputFingerprint,
  recordOutputPrepared,
  renderOutputFile,
  renderOutputText,
  renderOutputView,
  renderSheetCsv,
} from './selected-output-views';

const GENERATED = '2026-10-27T09:30:00.000Z';

function value(
  partial: Partial<OutputValue> & Pick<OutputValue, 'fieldKey' | 'label'>,
): OutputValue {
  return {
    record: null,
    status: 'confirmed_by_traveller',
    relevance: 'context',
    value: 'x',
    ...partial,
  };
}

function output(partial: Partial<SelectedOutput> = {}): SelectedOutput {
  return {
    schemaVersion: 1,
    generatedAt: GENERATED,
    preparedOn: '2026-10-27',
    selection: {
      layers: ['identity', 'travel_documents'],
      cases: { kind: 'none' },
      documentList: true,
      documentText: [],
      revealIdentifiers: false,
      depth: 'standard',
    },
    person: {
      displayName: 'Synthetic Traveller',
      referenceCode: 'P-7K2Q9M',
      basics: [value({ fieldKey: 'given_name', label: 'Given Name', value: 'Nusrat' })],
    },
    cases: [],
    profile: {},
    documents: [],
    expiry: [],
    documentText: [],
    omitted: {
      not_granted: 0,
      restricted: 0,
      conflicted: 0,
      unconfirmed: 0,
      unreadable: 0,
      not_needed: 0,
    },
    casesNotShown: 0,
    ...partial,
  };
}

const THE_CASE = {
  referenceCode: 'C-4M8T2K',
  title: 'London trip',
  destination: 'United Kingdom',
  purpose: 'Visit family',
  travelStart: '2026-12-01',
  travelEnd: null,
  targetDeadline: null,
  state: 'Being set up',
  checklist: {
    name: 'United Kingdom Visit',
    version: 3,
    nextReviewDate: '2026-11-20',
    rulesMaintained: true,
  },
  readiness: {
    requiredCount: 3,
    satisfiedCount: 1,
    satisfied: [],
    needsAttention: [
      {
        kind: 'field' as const,
        key: 'a',
        label: 'Tax Zone',
        optional: false,
        state: 'needs_attention' as const,
        note: 'Two values disagree',
      },
    ],
    missing: [
      {
        kind: 'document' as const,
        key: 'BANK_STATEMENT',
        label: 'Bank Statement',
        optional: false,
        state: 'missing' as const,
        note: 'Not provided yet',
      },
    ],
    withheld: 0,
  },
  nextActions: [{ title: 'Document Requested', why: 'x', dueDate: '2026-11-01', overdue: false }],
};

describe('templates and their starting choices', () => {
  it('starts every template with as little as its purpose allows', () => {
    const risky = ['money', 'declarations', 'health', 'people', 'qualifications'];
    for (const id of OUTPUT_TEMPLATE_IDS) {
      const choice = defaultChoice(id, null);
      expect(choice.revealIdentifiers, id).toBe(false);
      expect(choice.documentText, id).toEqual([]);
      if (id !== 'trip_essentials') {
        for (const layer of choice.layers)
          expect(risky, `${id} starts with ${layer}`).not.toContain(layer);
      }
      expect(
        choice.layers.every((layer) => OUTPUT_TEMPLATES[id].layersOffered.includes(layer)),
      ).toBe(true);
    }
  });

  it('names every template in Title Case, in plain words', () => {
    for (const id of OUTPUT_TEMPLATE_IDS) {
      const { label, description } = OUTPUT_TEMPLATES[id];
      expect(label).toMatch(/^[A-Z][A-Za-z]*( [A-Z][A-Za-z]*)*$/);
      expect(`${label} ${description}`).not.toMatch(/mission|projection|payload|json|api|token/i);
    }
  });

  it('cuts a choice back to what the template offers', () => {
    const greedy: OutputChoice = {
      missionId: '11111111-1111-4111-8111-111111111111',
      layers: ['money', 'declarations', 'health', 'travel_documents', 'people'],
      documentList: false,
      documentText: ['financial'],
      revealIdentifiers: true,
      depth: 'full',
      fieldKeys: ['annual_income'],
      question: 'hello',
    };
    const trip = engineRequest('trip_essentials', greedy);
    expect(trip.selection.layers).toEqual(['travel_documents', 'people']);
    expect(trip.selection.revealIdentifiers).toBe(false);
    expect(trip.selection.documentText).toEqual([]);
    expect(trip.selection.documentList).toBe(true);
    expect(trip.selection.depth).toBe('standard');
    expect(trip.options.fieldKeys).toEqual(TRIP_FIELD_KEYS);
    expect(trip.options.documentScope?.kinds).toEqual(
      TRIP_DOCUMENT_SLOTS.flatMap((slot) => slot.kinds),
    );
    expect(TRIP_FIELD_KEYS).not.toContain('annual_income');
    expect(trip.selection.cases).toEqual({ kind: 'one', missionId: greedy.missionId });

    const sheet = engineRequest('confirmed_sheet', greedy);
    expect(sheet.options.confirmedOnly).toBe(true);
    expect(sheet.options.fieldKeys).toEqual(['annual_income']);
    expect(sheet.selection.cases).toEqual({ kind: 'none' });
    expect(sheet.selection.documentList).toBe(false);
    expect(sheet.selection.revealIdentifiers).toBe(true);

    const brief = engineRequest('agency_brief', greedy);
    expect(brief.selection.documentText).toEqual([]);
    expect(brief.options.fieldKeys).toBeUndefined();

    const ai = engineRequest('ai_context', greedy);
    expect(ai.selection.documentText).toEqual(['financial']);
    expect(ai.selection.cases).toEqual({ kind: 'one', missionId: greedy.missionId });
  });

  it('asks for a case first when the template is about one', () => {
    const none = engineRequest('agency_brief', defaultChoice('agency_brief', null));
    expect(none.selection.cases).toEqual({ kind: 'none' });
  });
});

describe('the agency brief and the case handover', () => {
  const full = output({
    cases: [THE_CASE],
    profile: {
      travel_documents: [
        value({
          fieldKey: 'passport_number',
          label: 'Passport Number',
          value: undefined as never,
          masked: '***046',
          status: 'supported_by_document',
          evidence: [{ referenceCode: 'D-5R6T7V', kind: 'Passport', date: '2021-01-01' }],
          updatedAt: '2026-10-01T00:00:00.000Z',
        }),
        value({
          fieldKey: 'passport_expiry',
          label: 'Passport Expiry',
          value: '2031-01-01',
          validUntil: '2025-01-01T00:00:00.000Z',
        }),
      ],
      timelines: [
        value({ fieldKey: 'tax_zone', label: 'Tax Zone', conflict: true, status: 'conflicted' }),
      ],
    },
    documents: [
      {
        referenceCode: 'D-5R6T7V',
        kind: 'Passport',
        group: 'Identity and Civil',
        groupKey: 'identity_civil',
        documentDate: '2021-01-01',
        expiresOn: '2031-01-01',
        status: 'current',
        relevance: 'context',
      },
    ],
    omitted: {
      not_granted: 4,
      restricted: 1,
      conflicted: 1,
      unconfirmed: 2,
      unreadable: 0,
      not_needed: 0,
    },
  });

  it('lays the case, the person, the details and the documents out in plain words', () => {
    const view = renderOutputView('agency_brief', full);
    expect(view.title).toBe('Agency Brief');
    expect(view.sections.map((s) => s.heading)).toEqual([
      'About the Case',
      'Where the Case Stands',
      'About the Traveller',
      'Travel Documents',
      'Timelines',
      'Documents on File',
    ]);
    const text = renderOutputText(view);
    expect(text).toContain('AGENCY BRIEF');
    expect(text).toContain('Prepared on 27 October 2026');
    expect(text).toContain('Destination: United Kingdom');
    expect(text).toContain('Travel Starts: 1 December 2026');
    expect(text).toContain('Checklist: United Kingdom Visit, version 3');
    expect(text).toContain('Required Items Ready: 1 of 3');
    expect(text).toContain('Passport Number: ***046');
    expect(text).toContain('Source: Passport, D-5R6T7V, 1 January 2021');
    expect(text).toContain('Tax Zone: Needs checking: two values disagree');
    expect(text).toContain('Historical');
    expect(text).toContain('Details left out of this summary: 4 in parts you did not choose');
    expect(text).toContain('not a final application');
  });

  it('lists what is still unknown, and never invents anything', () => {
    const text = renderOutputText(renderOutputView('agency_brief', full));
    const unknown = text.split('STILL UNKNOWN OR NEEDS A LOOK')[1] ?? '';
    expect(unknown).toContain('- Bank Statement: Not provided yet');
    expect(unknown).toContain('- Tax Zone: Two values disagree');
    expect(unknown).toContain('- Document Requested, due 1 November 2026');
  });

  it('says so when no case was chosen and when there are no documents', () => {
    const empty = output({ cases: [], documents: [] });
    const text = renderOutputText(renderOutputView('agency_brief', empty));
    expect(text).toContain('No case was chosen.');
    expect(text).toContain(
      'No documents are on file for what was chosen. This does not mean none exist.',
    );
  });

  it('is the handover with its own title and no more than the brief holds', () => {
    const view = renderOutputView('case_handover', full);
    expect(view.title).toBe('Case Handover');
    expect(renderOutputText(view)).toContain('pick up this case where it stands');
  });

  it('warns when the checklist rules may be out of date', () => {
    const stale = output({
      cases: [{ ...THE_CASE, checklist: { ...THE_CASE.checklist, rulesMaintained: false } }],
    });
    expect(renderOutputText(renderOutputView('agency_brief', stale))).toContain(
      'may be out of date',
    );
  });

  it('never prints an id, a key or a link', () => {
    const text = renderOutputText(renderOutputView('agency_brief', full));
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect(text).not.toMatch(/storage|objectKey|blob/i);
  });
});

describe('trip essentials', () => {
  const trip = output({
    selection: { ...output().selection, layers: ['travel_documents', 'people'] },
    cases: [THE_CASE],
    profile: {
      travel_documents: [
        value({ fieldKey: 'passport_expiry', label: 'Passport Expiry', value: '2031-01-01' }),
        value({
          fieldKey: 'travel_insurance_provider',
          label: 'Provider',
          value: 'Safe Trips',
        }),
      ],
      people: [
        value({
          fieldKey: 'emergency_contact_name',
          label: 'Emergency Contact Name',
          value: 'Rina',
        }),
      ],
    },
    documents: [
      {
        referenceCode: 'D-1AAAAA',
        kind: 'Flight Ticket',
        group: 'Travel and Immigration',
        groupKey: 'travel_immigration',
        documentDate: null,
        expiresOn: null,
        status: 'current',
        relevance: 'context',
      },
      {
        referenceCode: 'D-2BBBBB',
        kind: 'Passport',
        group: 'Identity and Civil',
        groupKey: 'identity_civil',
        documentDate: null,
        expiresOn: '2031-01-01',
        status: 'current',
        relevance: 'context',
      },
    ],
  });

  it('keeps an absent document visible instead of leaving a gap', () => {
    const text = renderOutputText(renderOutputView('trip_essentials', trip));
    expect(text).toContain('Ticket: Flight Ticket, current');
    expect(text).toContain('Passport Copy: Passport, current');
    expect(text).toContain('Accommodation: Not on file yet');
    expect(text).toContain('Visa Copy: Not on file yet');
    expect(text).toContain('Insurance: Not on file yet');
    expect(text).toContain('- Accommodation: not on file yet');
  });

  it('groups the passport, the insurance and the contact, and says what is missing', () => {
    const view = renderOutputView('trip_essentials', trip);
    expect(view.sections.map((s) => s.heading)).toEqual([
      'The Trip',
      'The Traveller',
      'Documents to Bring',
      'Passport',
      'Insurance',
      'Contacts',
    ]);
    const text = renderOutputText(view);
    expect(text).toContain('Emergency Contact Name: Rina');
    expect(text).toContain('Safe Trips');
  });

  it('never claims more than it is', () => {
    const text = renderOutputText(renderOutputView('trip_essentials', trip));
    expect(text).toContain(
      'not a boarding pass, a certified copy, proof of a booking or a promise of entry',
    );
    expect(text).not.toMatch(/verified booking|guaranteed entry/i);
  });

  it('says plainly when a section has nothing', () => {
    const none = output({ cases: [THE_CASE] });
    const text = renderOutputText(renderOutputView('trip_essentials', none));
    expect(text).toContain('No passport details are on file yet.');
    expect(text).toContain('No emergency contact is on file yet.');
  });
});

describe('the confirmed-information sheet', () => {
  const sheet = output({
    profile: {
      identity: [
        value({
          fieldKey: 'nationality',
          label: 'Nationality',
          value: 'Bangladeshi',
          updatedAt: '2026-09-01T00:00:00.000Z',
        }),
      ],
      timelines: [
        value({
          fieldKey: 'employer_name',
          label: 'Employer Name',
          value: '=HYPERLINK("http://evil","click")',
          record: { label: 'Job', number: 2 },
          validUntil: '2020-01-01T00:00:00.000Z',
        }),
        value({
          fieldKey: 'job_title',
          label: 'Job Title',
          value: 'Cook, "senior"\nline two',
        }),
      ],
    },
  });

  it('lays out copyable fields with their record, status and saved date', () => {
    const text = renderOutputText(renderOutputView('confirmed_sheet', sheet));
    expect(text).toContain('CONFIRMED INFORMATION SHEET');
    expect(text).toContain(
      'Nationality: Bangladeshi (Confirmed by the traveller. Saved 1 September 2026)',
    );
    expect(text).toContain('Employer Name (Job 2):');
    expect(text).toContain('Historical');
    expect(text).toContain('A ticket or booking alone does not confirm travel.');
    expect(text).toContain('Values are shown exactly as saved.');
  });

  it('indents the lines after the first, so a typed value cannot forge a heading', () => {
    const forged = output({
      profile: {
        timelines: [
          value({
            fieldKey: 'employer_name',
            label: 'Employer Name',
            value: 'Acme\nSTILL UNKNOWN OR NEEDS A LOOK\n- Visa approved',
          }),
        ],
      },
    });
    const text = renderOutputText(renderOutputView('confirmed_sheet', forged));
    const lines = text.split('\n');
    expect(lines.filter((line) => line === 'STILL UNKNOWN OR NEEDS A LOOK')).toEqual([]);
    expect(lines).toContain('    STILL UNKNOWN OR NEEDS A LOOK');
    expect(lines.some((line) => line.startsWith('- Visa approved'))).toBe(false);
  });

  it('keeps every value as saved, apart from invisible control characters', () => {
    expect(cleanText('Rahim\u0007 Uddin\tKhan\nDhaka')).toBe('Rahim Uddin\tKhan\nDhaka');
    expect(cleanText('José রহিম')).toBe('José রহিম');
  });

  it('makes a formula in a cell harmless and quotes commas, quotes and line breaks', () => {
    const csv = renderSheetCsv(sheet);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('section,field,record,value,status,historical,saved_on,source');
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"",""click"")"`);
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);
    expect(csv).toContain('"Cook, ""senior""\nline two"');
    expect(csv).toContain('Job 2');
    expect(csv).toContain(',Yes,');
  });

  it('neutralises every character a spreadsheet treats as the start of a formula', () => {
    for (const start of ['=', '+', '-', '@', '\t', '\r']) {
      expect(neutraliseFormula(`${start}1+1`)).toBe(`'${start}1+1`);
    }
    expect(neutraliseFormula('+SUM(A1:A9)')).toBe("'+SUM(A1:A9)");
    expect(neutraliseFormula('-cmd|calc')).toBe("'-cmd|calc");
    expect(neutraliseFormula('1 + 1')).toBe('1 + 1');
    expect(neutraliseFormula('Dhaka')).toBe('Dhaka');
  });

  it('leaves a phone number or a plain signed number exactly as saved', () => {
    for (const saved of ['+8801712345678', '+44 (0) 20 7946 0958', '-12.5', '+880-171-234-5678']) {
      expect(neutraliseFormula(saved)).toBe(saved);
    }
  });

  it('gives an empty file when nothing was selected', () => {
    expect(renderSheetCsv(output({ person: { ...output().person, basics: [] } }))).toBe('');
  });
});

describe('files and fingerprints', () => {
  it('names a download without a name or a number in it', () => {
    expect(outputFileName('confirmed_sheet', 'csv', '2026-10-27')).toBe(
      'visastack-confirmed-sheet-2026-10-27.csv',
    );
  });

  it('offers only the formats a template has', () => {
    const o = output();
    expect(renderOutputFile('agency_brief', o, 'csv', { question: '' })).toBeNull();
    expect(renderOutputFile('confirmed_sheet', o, 'json', { question: '' })).toBeNull();
    expect(renderOutputFile('agency_brief', o, 'txt', { question: '' })?.contentType).toMatch(
      /^text\/plain/,
    );
    expect(renderOutputFile('confirmed_sheet', o, 'csv', { question: '' })?.contentType).toMatch(
      /^text\/csv/,
    );
    const ai = renderOutputFile('ai_context', o, 'json', { question: 'Which visa?' });
    expect(ai?.contentType).toMatch(/^application\/json/);
    expect(JSON.parse(ai?.body ?? '{}').question).toBe('Which visa?');
  });

  it('dates a summary by the preparing day the engine gave it', () => {
    const text = renderOutputText(
      renderOutputView('agency_brief', output({ preparedOn: '2026-10-28' })),
    );
    expect(text).toContain('Prepared on 28 October 2026');
    expect(outputFileName('agency_brief', 'txt', '2026-10-28')).toBe(
      'visastack-agency-brief-2026-10-28.txt',
    );
    // A passport that ended on the 27th is history on the 28th, whatever the clock in London says.
    const expired = output({
      preparedOn: '2026-10-28',
      profile: {
        travel_documents: [
          value({
            fieldKey: 'passport_expiry',
            label: 'Passport Expiry',
            validUntil: '2026-10-27T00:00:00.000Z',
          }),
        ],
      },
    });
    expect(renderOutputText(renderOutputView('confirmed_sheet', expired))).toContain('Historical');
  });

  it('keeps a fingerprint through time and changes it for anything that matters', () => {
    const base = output();
    const later = output({ generatedAt: '2026-10-27T18:00:00.000Z' });
    expect(outputFingerprint('agency_brief', base)).toBe(outputFingerprint('agency_brief', later));
    expect(outputFingerprint('agency_brief', base)).not.toBe(
      outputFingerprint('case_handover', base),
    );
    expect(outputFingerprint('ai_context', base, 'a')).not.toBe(
      outputFingerprint('ai_context', base, 'b'),
    );
    const edited = output({
      person: {
        ...base.person,
        basics: [value({ fieldKey: 'given_name', label: 'Given Name', value: 'Nusrath' })],
      },
    });
    expect(outputFingerprint('agency_brief', edited)).not.toBe(
      outputFingerprint('agency_brief', base),
    );
    const restated = output({
      person: {
        ...base.person,
        basics: [
          value({
            fieldKey: 'given_name',
            label: 'Given Name',
            value: 'Nusrat',
            status: 'out_of_date',
          }),
        ],
      },
    });
    expect(outputFingerprint('agency_brief', restated)).not.toBe(
      outputFingerprint('agency_brief', base),
    );
    const moreLeftOut = output({ omitted: { ...base.omitted, restricted: 1 } });
    expect(outputFingerprint('agency_brief', moreLeftOut)).not.toBe(
      outputFingerprint('agency_brief', base),
    );
  });

  it('formats days the way people say them', () => {
    expect(longDay('2026-12-01')).toBe('1 December 2026');
    expect(longDay('2026-12-01T10:00:00.000Z')).toBe('1 December 2026');
    expect(longDay(null)).toBe('');
    expect(longDay('not a day')).toBe('not a day');
  });
});

describe('the prepared WhatsApp message', () => {
  it('is generic: a greeting and a link to the signed-in shared workspace', () => {
    const share = buildWhatsAppShare('https://vs.obsidianglobal.studio');
    expect(isOk(share)).toBe(true);
    if (!isOk(share)) return;
    expect(share.value.message).toBe(
      'Hello, I have put my visa details together on VisaStack and shared what you need there. Please sign in to VisaStack to see it: https://vs.obsidianglobal.studio/app/shared',
    );
    expect(share.value.href).toBe(`https://wa.me/?text=${encodeURIComponent(share.value.message)}`);
    // Nothing from a record can be in it: no digits, no names, no documents.
    expect(share.value.message).not.toMatch(/\d/);
  });

  it('refuses an address that is not a plain site address', () => {
    for (const bad of [
      'javascript:alert(1)',
      'https://evil.example/path?x=1',
      'ftp://example.com',
      '',
      'https://a b.com',
      'http://example.com',
    ]) {
      expect(isErr(buildWhatsAppShare(bad)), bad).toBe(true);
    }
    expect(isOk(buildWhatsAppShare('http://localhost:3100'))).toBe(true);
  });
});

describe('the record of a summary that left', () => {
  async function owner() {
    const db = drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
    const provisioned = await provisionAccount(db, { email: 'views@example.com' });
    if (!isOk(provisioned)) throw new Error('provision');
    const ownerId = provisioned.value.id;
    await setConsent(db, {
      actorAccountId: ownerId,
      accountId: ownerId,
      type: 'CORE_PROCESSING',
      granted: true,
    });
    const applicant = await createApplicant(db, {
      actorAccountId: ownerId,
      ownerAccountId: ownerId,
      displayName: 'Audit Subject',
    });
    if (!isOk(applicant)) throw new Error('applicant');
    const proof = await requireAccess(
      db,
      accountPrincipal(ownerId),
      'VIEW_METADATA',
      { applicantId: applicant.value.id },
      { purpose: 'self' },
    );
    if (!isOk(proof)) throw new Error('proof');
    return { db, proof: proof.value, applicantId: applicant.value.id };
  }

  it('writes counts and kinds, never what the summary held', async () => {
    const { db, proof, applicantId } = await owner();
    const secret = 'Top Secret Employer Ltd';
    const recorded = await recordOutputPrepared(proof, {
      template: 'confirmed_sheet',
      format: 'csv',
      output: output({
        profile: {
          timelines: [value({ fieldKey: 'employer_name', label: 'Employer Name', value: secret })],
        },
      }),
    });
    expect(isOk(recorded)).toBe(true);
    const rows = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, OUTPUT_PREPARED_EVENT));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.applicantId).toBe(applicantId);
    const text = JSON.stringify(rows[0]);
    expect(text).not.toContain(secret);
    expect(text).not.toContain('Audit Subject');
    expect(rows[0]?.metadata).toMatchObject({
      template: 'confirmed_sheet',
      format: 'csv',
      layers: ['identity', 'travel_documents'],
      valueCount: 2,
      fullNumbers: false,
    });
  });
});
