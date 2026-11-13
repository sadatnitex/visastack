import { randomBytes } from 'node:crypto';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import {
  type Db,
  type KeyManagementPort,
  createApplicant,
  createMission,
  editFact,
  issueStepUpAssurance,
  provisionAccount,
  registerFieldDefinition,
  setConsent,
  verifyStepUp,
} from '@visastack/services';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderServer, textOf } from '../../../../../lib/next-mocks.test-support';
import { expectEveryLiveMessageRendered } from '../bn-coverage.test-support';

vi.mock('@visastack/i18n', async (original) =>
  (await import('../bn-coverage.test-support')).trackBengali(await original()),
);

const current = vi.hoisted(() => ({ locale: 'en' as 'en' | 'bn', holder: null as unknown }));
// The language switch is off in the product, so the locale is set here directly.
vi.mock('../../../../../lib/locale', () => ({ getLocale: async () => current.locale }));
// Outside the server runtime React's cache remembers nothing; stand in for one request per render.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: (build: () => unknown) => () => {
    current.holder ??= build();
    return current.holder;
  },
}));

const state = vi.hoisted(() => ({ db: undefined as unknown, accountId: '' }));
vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: { db: unknown; accountId: string; email: string }) => unknown) =>
    fn({ db: state.db, accountId: state.accountId, email: 'owner@example.com' }),
}));
vi.mock('../../../../../lib/base-url', () => ({ resolveBaseUrl: () => 'https://vs.example.test' }));

const masterKey = Buffer.alloc(32, 9);
const keys: KeyManagementPort = {
  currentKeyVersion: () => 'test-v1',
  async generateDataKey() {
    return { keyVersion: 'test-v1', plaintextDataKey: randomBytes(32), wrappedDataKey: masterKey };
  },
  async unwrapDataKey() {
    return masterKey;
  },
};
vi.mock('../../../../../lib/providers', () => ({ createKeyManagementPort: () => keys }));
vi.mock('../../../../../lib/step-up', () => ({
  establishStepUpProof: async (request: {
    accountId: string;
    action: 'EXPORT_PROFILE';
    resourceId: string;
  }) => {
    const secret = 'test-secret';
    return {
      kind: 'proof',
      proof: verifyStepUp(secret, issueStepUpAssurance(secret, request), request),
    };
  },
}));

// Two states the real database cannot reach in a test (the identity check is not set up; the case
// list cannot be read) are given here; every other render runs the real preparation.
const loadOverride = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('./load', async (importOriginal) => {
  const real = await importOriginal<typeof import('./load')>();
  return {
    ...real,
    prepareOutput: async (...args: Parameters<typeof real.prepareOutput>) =>
      loadOverride.value ?? real.prepareOutput(...args),
  };
});

const { default: OutputsPage } = await import('./page');
const { applicantOutputsCatalog } = await import('../../../../../i18n/applicant-outputs');

const bn = applicantOutputsCatalog.bn as Record<string, string>;
const P = 'applicantOutputs.appApplicantIdOutputsPage.';
const RAW_KEY = /applicantOutputs\.app[A-Z]/;
const BENGALI = /[ঀ-৿]/;
const PASSPORT_NUMBER = 'BX7319046';

let db: Db;
let applicantId: string;
let missionId: string;

type Query = Record<string, string | string[]>;
async function render(locale: 'en' | 'bn', query: Query = {}, id = applicantId) {
  current.holder = null;
  current.locale = locale;
  const marked = await renderServer(
    OutputsPage({
      params: Promise.resolve({ id }),
      searchParams: Promise.resolve(query),
    }),
  );
  // Bengali on a page marked English carries its own language; the checks below read the words.
  const html = marked.replace(/<span lang="bn">([^<]*)<\/span>/g, '$1');
  return { html, marked, text: textOf(html) };
}

async function fact(fieldKey: string, value: string, status?: 'CONFLICTED') {
  const { fieldPolicyOf } = await import('@visastack/core/catalogue');
  const policy = fieldPolicyOf(fieldKey);
  if (!policy) throw new Error(fieldKey);
  await registerFieldDefinition(db, {
    key: fieldKey,
    dataType: 'text',
    sensitivity: policy.sensitivity,
  });
  const saved = await editFact(db, {
    actorAccountId: state.accountId,
    applicantId,
    fieldKey,
    value,
    ...(status ? { status } : {}),
    ...(policy.sensitivity === 'STANDARD' ? {} : { encryption: keys }),
  });
  if (!saved.ok) throw new Error(`fact ${fieldKey}`);
}

// The page only reads, so one migrated database serves every test below.
beforeAll(async () => {
  db = drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
  state.db = db;
  const account = await provisionAccount(db, { email: 'owner@example.com' });
  if (!account.ok) throw new Error('account');
  state.accountId = account.value.id;
  await setConsent(db, {
    actorAccountId: state.accountId,
    accountId: state.accountId,
    type: 'CORE_PROCESSING',
    granted: true,
  });
  const applicant = await createApplicant(db, {
    actorAccountId: state.accountId,
    ownerAccountId: state.accountId,
    displayName: 'Nusrat Jahan',
  });
  if (!applicant.ok) throw new Error('applicant');
  applicantId = applicant.value.id;
  const mission = await createMission(db, {
    actorAccountId: state.accountId,
    applicantId,
    title: 'London trip',
    destination: 'United Kingdom',
  });
  if (!mission.ok) throw new Error('mission');
  missionId = mission.value.id;
  await fact('given_name', 'Nusrat');
  await fact('family_name', 'Jahan');
  await fact('passport_number', PASSPORT_NUMBER);
  await fact('passport_expiry', '2031-01-01');
  await fact('annual_income', '4500000');
  await fact('tax_zone', 'Disputed Zone', 'CONFLICTED');
}, 60_000);
afterEach(() => {
  current.locale = 'en';
  loadOverride.value = null;
});

describe('the summaries page under Bengali', () => {
  it('the starting brief shows the Bengali headings, choices and Preview, and keeps the summary names and promises in English', async () => {
    const { html, marked, text } = await render('bn', { output: 'agency_brief', case: missionId });
    expect(marked).toContain('<span lang="bn">');
    for (const key of [
      'summaries',
      'chooseWhatToInclude',
      'yourChoices',
      'partsOfYourRecord',
      'howMuchDetail',
      'documents',
      'includeTheListOfMyDocuments',
      'numbers',
      'showFullDocumentNumbers',
      'preview',
    ]) {
      expect(text, key).toContain(bn[`${P}${key}`]);
    }
    expect(html).toContain(`<legend class="sr-only">${bn[`${P}previewYourSummary`]}</legend>`);
    // The chosen card says so in Bengali; the five summary names are English.
    const selected = (html.match(/<a [^>]*class="output-template"[\s\S]*?<\/a>/g) ?? []).filter(
      (card) => card.includes('output-template-selected'),
    );
    expect(selected).toHaveLength(1);
    expect(selected[0]).toContain(`>${bn[`${P}selected`]}</span>`);
    for (const name of ['Agency Brief', 'Case Handover', 'Trip Essentials', 'AI Context']) {
      expect(text).toContain(name);
    }
    // What a summary is and the identity-number promise are Bengali since the owner sign-off of
    // 2026-11-12; the preview title stays English.
    expect(text).toContain(bn[`${P}aSummaryIsAOneTime`]);
    expect(text).toContain(bn[`${P}passportAndIdNumbersShowOnly`]);
    expect(text).toContain('Preview: Agency Brief');
    expect(html).not.toMatch(RAW_KEY);
  });

  it('the step list and the kinds of summary are named in Bengali, with the step labels in English', async () => {
    const { html } = await render('bn', { output: 'agency_brief', case: missionId });
    expect(html).toContain(
      `<ol class="output-steps u-mb-150 output-noprint" aria-label="${bn[`${P}steps`]}"`,
    );
    expect(html).toContain(`<nav aria-label="${bn[`${P}kindsOfSummary`]}"`);
    expect(textOf(html)).toContain('Choose What to Include');
    expect(textOf(html)).toContain('Check and Copy');
  });

  it('step 1 titles the open list Choose a Summary in Bengali; later steps name the chosen summary in English', async () => {
    const first = await render('bn', { case: missionId });
    expect(first.html).toContain(
      `<span class="collapsible-group-title">${bn[`${P}chooseASummary`]}</span>`,
    );
    const second = await render('bn', { output: 'confirmed_sheet' });
    expect(second.html).toContain(
      '<span class="collapsible-group-title">Summary: Confirmed Information Sheet</span>',
    );
    expect(second.text).not.toContain(bn[`${P}chooseASummary`]);
    expect(first.html + second.html).not.toMatch(RAW_KEY);
  });

  it('a previewed brief shows the Bengali copy and download buttons, the WhatsApp card and the unknowns heading', async () => {
    const { html, text } = await render('bn', {
      output: 'agency_brief',
      preview: '1',
      case: missionId,
      layer: ['travel_documents', 'money'],
      depth: 'standard',
      numbers: '1',
    });
    expect(html).toContain('id="output-preview"');
    expect(text).toContain(bn[`${P}fullDocumentNumbersAreIncludedShare`]);
    expect(text).toContain(bn[`${P}copyAll`]);
    expect(html).toMatch(
      new RegExp(`<button[^>]*value="txt"[^>]*>${bn[`${P}downloadTextFile`]}</button>`),
    );
    expect(text).toContain(bn[`${P}stillUnknownOrNeedsALook`]);
    expect(text).toContain(bn[`${P}tellThemOnWhatsapp`]);
    expect(html).toContain(`aria-label="${bn[`${P}theWhatsappMessage`]}"`);
    // The file note and the short message text are Bengali since the sign-off of 2026-11-12; the
    // preview title stays English.
    expect(text).toContain(bn[`${P}theFileIsMadeAgainWhen`]);
    expect(text).toContain(bn[`${P}aShortMessageYouCanSend`]);
    expect(text).toContain('Preview: Agency Brief');
    expect(text).toContain('Needs checking: two values disagree');
    expect(html).not.toMatch(RAW_KEY);
  });

  it('the AI context asks for the question in Bengali and keeps the exact text and its name in English', async () => {
    const { html, text } = await render('bn', {
      output: 'ai_context',
      preview: '1',
      layer: ['identity'],
      q: 'Which visa should I choose?',
    });
    expect(html).toContain(`>${bn[`${P}whatYouWantHelpWithOptional`]}</label>`);
    expect(html).toContain(`aria-label="${bn[`${P}theExactTextAnAiApp`]}"`);
    expect(text).toContain(bn[`${P}copyText`]);
    expect(text).not.toContain('Copy Text');
    expect(text).not.toContain(bn[`${P}tellThemOnWhatsapp`]);
    expect(html).not.toMatch(RAW_KEY);
  });

  it('the sheet shows the spreadsheet and text buttons in Bengali', async () => {
    const { html } = await render('bn', {
      output: 'confirmed_sheet',
      preview: '1',
      layer: ['travel_documents'],
    });
    expect(html).toMatch(new RegExp(`value="txt"[^>]*>${bn[`${P}downloadTextFile`]}</button>`));
    expect(html).toMatch(
      new RegExp(`value="csv"[^>]*>${bn[`${P}downloadSpreadsheetFile`]}</button>`),
    );
    expect(html).not.toMatch(RAW_KEY);
  });

  it('a summary that needs a case shows the case picker with its label in English and the rest in Bengali', async () => {
    const { html, text } = await render('bn', { output: 'case_handover' });
    expect(text).toContain(bn[`${P}summaries`]);
    expect(text).toContain(bn[`${P}partsOfYourRecord`]);
    expect(html).toContain('<select id="output-case"');
    expect(text).toContain('Summary: Case Handover');
    expect(html).not.toMatch(RAW_KEY);
  });

  it('a download that failed, found nothing or went stale says so in Bengali (refill 3)', async () => {
    const base = { output: 'confirmed_sheet', preview: '1', layer: ['travel_documents'] };
    for (const [error, key] of [
      ['failed', 'weCouldNotMakeTheFile'],
      ['nothing', 'thereIsNothingToDownloadFor'],
      ['changed', 'yourRecordOrYourChoicesChanged'],
    ] as const) {
      const { html, text } = await render('bn', { ...base, error });
      expect(text, error).toContain(bn[`${P}${key}`]);
      expect(html, error).not.toMatch(RAW_KEY);
    }
  });

  it('a preview with no case chosen asks for one in Bengali; a person with no case is told so (refill 3)', async () => {
    const choose = await render('bn', { output: 'case_handover', preview: '1' });
    expect(choose.text).toContain(bn[`${P}chooseACaseAboveThenPress`]);
    const other = await createApplicant(db, {
      actorAccountId: state.accountId,
      ownerAccountId: state.accountId,
      displayName: 'Rafiq Ahmed',
    });
    if (!other.ok) throw new Error('applicant');
    const none = await render('bn', { output: 'case_handover' }, other.value.id);
    expect(none.text).toContain(bn[`${P}noCaseYet`]);
    expect(none.text).not.toContain('No Case Yet');
    expect(choose.html + none.html).not.toMatch(RAW_KEY);
  });

  it('when the identity check is not set up or the summary cannot be made it says so in Bengali (refill 3)', async () => {
    loadOverride.value = { state: 'not_configured' };
    const off = await render('bn', { output: 'confirmed_sheet' });
    expect(off.text).toContain(bn[`${P}showingFullNumbersNeedsAnExtra`]);
    loadOverride.value = { state: 'failed' };
    const failed = await render('bn', { output: 'confirmed_sheet' });
    expect(failed.text).toContain(bn[`${P}weCouldNotPrepareThisSummary`]);
    expect(off.html + failed.html).not.toMatch(RAW_KEY);
  });

  it('is the same English as before under English, with no Bengali', async () => {
    const { html, text } = await render('en', {
      output: 'agency_brief',
      preview: '1',
      case: missionId,
      layer: ['travel_documents'],
    });
    expect(`${html}`).not.toMatch(BENGALI);
    expect(text).toContain('Choose What to Include');
    expect(text).toContain('Copy All');
    expect(text).toContain('Download Text File');
    expect(text).toContain('Tell Them on WhatsApp');
    expect(text).toContain('Preview: Agency Brief');
  });
});

describe('Bengali coverage of the summaries surface', () => {
  it('every live Bengali message was rendered by a test above', () => {
    expectEveryLiveMessageRendered(applicantOutputsCatalog);
  });
});
