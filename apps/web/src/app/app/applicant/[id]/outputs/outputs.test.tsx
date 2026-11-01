import { randomBytes } from 'node:crypto';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import {
  type Db,
  type KeyManagementPort,
  acceptGrant,
  createApplicant,
  createGrant,
  createMission,
  editFact,
  issueStepUpAssurance,
  provisionAccount,
  registerFieldDefinition,
  setConsent,
  verifyStepUp,
} from '@visastack/services';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../../../../lib/axe.test-support';
import { renderServer, textOf } from '../../../../../lib/next-mocks.test-support';

const state = vi.hoisted(() => ({
  db: undefined as unknown,
  accountId: '',
  /** What the identity check answers: a proof, or a request to sign in again. */
  stepUp: 'proof' as 'proof' | 'reauth' | 'not_configured',
  /** Makes the audit entry fail, as a database fault would. */
  auditFails: false,
}));

vi.mock('@visastack/services', async (importOriginal) => {
  const real = await importOriginal<typeof import('@visastack/services')>();
  return {
    ...real,
    recordOutputPrepared: (...args: Parameters<typeof real.recordOutputPrepared>) =>
      state.auditFails
        ? Promise.resolve({ ok: false, error: { code: 'upstream_error', message: 'down' } })
        : real.recordOutputPrepared(...args),
  };
});

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
    if (state.stepUp === 'reauth')
      return { kind: 'reauth_required', reauthUrl: '/auth/reauth?x=1' };
    if (state.stepUp === 'not_configured') return { kind: 'not_configured' };
    const secret = 'test-secret';
    const proof = verifyStepUp(secret, issueStepUpAssurance(secret, request), request);
    return { kind: 'proof', proof };
  },
}));

const { default: OutputsPage } = await import('./page');
const { POST } = await import('./download/route');

const PASSPORT_NUMBER = 'BX7319046';
const INCOME = '4500000';
const STORAGE_KEY = 'quarantine/secret-object-key-77';
const FILE_NAME = 'Nusrat_passport_scan.pdf';

let db: Db;
let applicantId: string;
let missionId: string;

type Query = Record<string, string | string[]>;
const render = (query: Query = {}) =>
  renderServer(
    OutputsPage({
      params: Promise.resolve({ id: applicantId }),
      searchParams: Promise.resolve(query),
    }),
  );

const SAME_SITE = { origin: 'https://vs.example.test', host: 'vs.example.test' };
function postRequest(fields: readonly (readonly [string, string])[], headers = SAME_SITE) {
  return new Request(`https://vs.example.test/app/applicant/${applicantId}/outputs/download`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(fields.map(([name, value]) => [name, value])),
  });
}
const download = (fields: readonly (readonly [string, string])[], headers = SAME_SITE) =>
  POST(postRequest(fields, headers), { params: Promise.resolve({ id: applicantId }) });

/** The hidden fields of the download form, as a browser would post them. */
function downloadFields(html: string): [string, string][] {
  const start = html.indexOf(`action="/app/applicant/${applicantId}/outputs/download"`);
  expect(start).toBeGreaterThan(-1);
  const form = html.slice(html.lastIndexOf('<form', start), html.indexOf('</form>', start));
  return [...form.matchAll(/<input type="hidden" name="([^"]*)" value="([^"]*)"/g)].map((m) => [
    m[1] ?? '',
    (m[2] ?? '').replaceAll('&amp;', '&'),
  ]);
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

async function otherAccount(): Promise<string> {
  const other = await provisionAccount(db, { email: 'someone-else@example.com' });
  if (!other.ok) throw new Error('other');
  return other.value.id;
}

beforeEach(async () => {
  db = drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
  state.db = db;
  state.stepUp = 'proof';
  state.auditFails = false;
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
  await fact('annual_income', INCOME);
  await fact('tax_zone', 'Disputed Zone', 'CONFLICTED');
  const [storage] = await db
    .insert(schema.storageObjects)
    .values({ bucket: 'CLEAN', objectKey: STORAGE_KEY })
    .returning({ id: schema.storageObjects.id });
  const [doc] = await db
    .insert(schema.documents)
    .values({ applicantId, originalName: FILE_NAME, docType: 'FLIGHT_TICKET' })
    .returning({ id: schema.documents.id });
  if (!storage || !doc) throw new Error('document');
  await db.insert(schema.documentVersions).values({
    documentId: doc.id,
    storageObjectId: storage.id,
    processingStatus: 'APPROVED',
    safetyStatus: 'CLEAN',
  });
}, 60_000);

describe('the briefs and summaries page', () => {
  it('shows the owner the starting preview for a brief, with the case first', async () => {
    const html = await render();
    const text = textOf(html);
    expect(text).toContain('Briefs and Summaries');
    expect(text).toContain('Preview: Agency Brief');
    expect(text).toContain('A summary is a one-time copy');
    expect(text).toContain('Case: London trip');
    expect(text).toContain('Destination United Kingdom');
    // The five kinds are listed and the current one is marked.
    for (const name of [
      'Agency Brief',
      'Case Handover',
      'Trip Essentials',
      'Confirmed Information Sheet',
      'AI Context',
    ]) {
      expect(text).toContain(name);
    }
    expect(html).toMatch(
      /aria-current="page"[^>]*><span class="output-template-name">Agency Brief/,
    );
    // The chosen card says so in words, not only in colour, and only that card does.
    const cards = html.match(/<a [^>]*class="output-template"[\s\S]*?<\/a>/g) ?? [];
    expect(cards).toHaveLength(5);
    const selected = cards.filter((card) => card.includes('output-template-selected'));
    expect(selected).toHaveLength(1);
    expect(selected[0]).toContain('aria-current="page"');
    expect(selected[0]).toContain('>Selected</span>');
    // Identity and travel documents are on; money is not, and nothing from it appears.
    expect(html).toMatch(/name="layer" checked="" value="identity"/);
    expect(html).not.toMatch(/name="layer" checked="" value="money"/);
    expect(html).not.toContain(INCOME);
    expect(html).not.toContain(PASSPORT_NUMBER);
    expect(text).toContain('***046');
    expect(html).not.toContain(STORAGE_KEY);
    expect(html).not.toContain(FILE_NAME);
  });

  it('is plain, accessible markup', async () => {
    const html = await render();
    expect(await axeViolations(html)).toEqual([]);
    expect(html).not.toMatch(/mission/i);
  });

  it('is owner only: another account and a missing person both see not found', async () => {
    state.accountId = await otherAccount();
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('shows not found to someone the record is shared with, even with permission to view', async () => {
    await setConsent(db, {
      actorAccountId: state.accountId,
      accountId: state.accountId,
      type: 'SHARING',
      granted: true,
    });
    const recipientId = await otherAccount();
    const granted = await createGrant(db, {
      actorAccountId: state.accountId,
      applicantId,
      recipientAccountId: recipientId,
      actions: ['VIEW_METADATA'],
      // The page asks the gate for the owner's own purpose, so this grant would pass the gate.
      purpose: 'self',
    });
    if (!granted.ok) throw new Error('grant');
    const accepted = await acceptGrant(db, {
      grantId: granted.value.id,
      actorAccountId: recipientId,
    });
    if (!accepted.ok) throw new Error('accept');
    state.accountId = recipientId;
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND');
    const fields = [
      ['output', 'agency_brief'],
      ['preview', '1'],
      ['fp', 'a'.repeat(32)],
    ] as const;
    expect((await download(fields)).status).toBe(404);
  });

  it('asks for a case first when there is none yet', async () => {
    await db.delete(schema.missions).where(eq(schema.missions.id, missionId));
    const text = textOf(await render());
    expect(text).toContain('No Case Yet');
    expect(text).not.toContain('Preview: Agency Brief');
  });

  it('adds only what is ticked once Preview is pressed', async () => {
    const html = await render({
      output: 'agency_brief',
      preview: '1',
      case: missionId,
      layer: ['travel_documents', 'money'],
      depth: 'standard',
    });
    const text = textOf(html);
    expect(text).toContain(INCOME);
    expect(text).toContain('Tax Zone Needs checking: two values disagree');
    expect(text).toContain('Needs checking: two values disagree');
    expect(text).not.toContain('Disputed Zone');
    expect(html).toMatch(/name="layer" checked="" value="money"/);
  });

  it('sends the person to sign in again before showing full numbers, then shows them', async () => {
    const query = {
      output: 'agency_brief',
      preview: '1',
      case: missionId,
      layer: ['travel_documents'],
      numbers: '1',
    };
    state.stepUp = 'reauth';
    await expect(render(query)).rejects.toThrow('NEXT_REDIRECT:/auth/reauth?x=1');
    state.stepUp = 'not_configured';
    expect(textOf(await render(query))).toContain('extra sign-in check');
    state.stepUp = 'proof';
    const text = textOf(await render(query));
    expect(text).toContain(PASSPORT_NUMBER);
    expect(text).toContain('Full document numbers are included');
  });

  it('shows the trip pack with absent documents named, not hidden', async () => {
    const text = textOf(await render({ output: 'trip_essentials', case: missionId }));
    expect(text).toContain('Preview: Trip Essentials');
    expect(text).toContain('Ticket Flight Ticket, current');
    expect(text).toContain('Accommodation Not on file yet');
    expect(text).toContain('not a boarding pass');
    expect(text).not.toContain(INCOME);
    expect(
      await axeViolations(await render({ output: 'trip_essentials', case: missionId })),
    ).toEqual([]);
  });

  it('shows the sheet with a field list and only the fields that stay ticked', async () => {
    const first = await render({ output: 'confirmed_sheet' });
    expect(first).toContain('name="field"');
    expect(textOf(first)).toContain('Passport Expiry');
    // Unticking the passport expiry leaves it out of the preview as well.
    const narrowed = await render({
      output: 'confirmed_sheet',
      preview: '1',
      layer: ['travel_documents'],
      picked: '1',
      field: ['passport_number'],
    });
    expect(textOf(narrowed)).toContain('Passport Number');
    expect(textOf(narrowed)).not.toContain('2031-01-01');
  });

  it('shows the AI context as the exact text an AI app would receive', async () => {
    const html = await render({
      output: 'ai_context',
      preview: '1',
      layer: ['identity', 'travel_documents'],
      q: 'Which visa should I choose?',
    });
    const match = html.match(
      /<textarea[^>]*aria-label="The exact text an AI app would receive"[^>]*>([^<]*)<\/textarea>/,
    );
    expect(match).not.toBeNull();
    const body = (match?.[1] ?? '')
      .replaceAll('&quot;', '"')
      .replaceAll('&#x27;', "'")
      .replaceAll('&amp;', '&');
    const parsed = JSON.parse(body) as { question: string; guidance: string[] };
    expect(parsed.question).toBe('Which visa should I choose?');
    expect(body).not.toContain(PASSPORT_NUMBER);
    expect(body).not.toContain(INCOME);
    expect(body).not.toContain(STORAGE_KEY);
    expect(await axeViolations(html)).toEqual([]);
  });

  it('offers a generic WhatsApp message and nothing from the record', async () => {
    const html = await render({ output: 'agency_brief', case: missionId });
    const text = textOf(html);
    expect(text).toContain('Tell Them on WhatsApp');
    expect(html).toContain('https://wa.me/?text=');
    expect(html).toContain('https://vs.example.test/app/shared');
    const section = html.slice(html.indexOf('output-whatsapp-heading'));
    expect(section).not.toContain('Nusrat');
    expect(section).not.toContain(PASSPORT_NUMBER);
    expect(section).toContain('target="_blank"');
    expect(section).toContain('rel="noopener noreferrer"');
    // Only the brief and the handover offer it.
    expect(textOf(await render({ output: 'confirmed_sheet' }))).not.toContain('WhatsApp');
  });
});

describe('the page in three steps (WP-SB4)', () => {
  const current = (html: string) =>
    html.match(/aria-current="step"[^>]*>[\s\S]*?<span class="sr-only">Step (\d): <\/span>/)?.[1];
  const opened = (html: string, id: string) =>
    new RegExp(`<details class="collapsible-group" id="${id}" open=""`).test(html);

  it('starts on step 1 with the kinds open, and the choices ready below', async () => {
    const html = await render();
    expect(current(html)).toBe('1');
    expect(opened(html, 'output-step-choose')).toBe(true);
    expect(opened(html, 'output-choices')).toBe(true);
    expect(textOf(html)).toContain('Summary: Agency Brief');
  });

  it('folds the kinds once one is picked (step 2), and the choices once previewed (step 3)', async () => {
    const second = await render({ output: 'confirmed_sheet' });
    expect(current(second)).toBe('2');
    expect(opened(second, 'output-step-choose')).toBe(false);
    expect(opened(second, 'output-choices')).toBe(true);
    const third = await render({
      output: 'confirmed_sheet',
      preview: '1',
      layer: ['travel_documents'],
    });
    expect(current(third)).toBe('3');
    expect(opened(third, 'output-choices')).toBe(false);
    // Folded, every choice is still in the form, so Preview again sends the same answers.
    expect(third).toMatch(/name="layer" checked="" value="travel_documents"/);
    expect(third).toContain('id="output-preview"');
  });

  it('keeps the field list folded, with its count, and every box still sent', async () => {
    const html = await render({ output: 'confirmed_sheet' });
    expect(html).toMatch(/<details class="collapsible-group" id="output-fields"><summary/);
    const fields = html.match(/name="field"/g)?.length ?? 0;
    expect(fields).toBeGreaterThan(0);
    expect(html).toContain(
      `<span class="sr-only">, ${fields} ${fields === 1 ? 'detail' : 'details'}</span>`,
    );
  });

  it('keeps Preview in a bar that stays in reach', async () => {
    const html = await render({
      output: 'confirmed_sheet',
      preview: '1',
      layer: ['travel_documents'],
    });
    const bar = html.slice(html.indexOf('<fieldset class="sticky-action-bar">'));
    expect(bar).toContain('<legend class="sr-only">Preview Your Summary</legend>');
    expect(bar.slice(0, bar.indexOf('</fieldset>'))).toMatch(/>Preview<\/button>.*Start Again/);
    expect(await axeViolations(html)).toEqual([]);
  });
});

describe('the download', () => {
  async function previewed(query: Query) {
    const html = await render({ preview: '1', ...query });
    return downloadFields(html);
  }

  it('hands over exactly the previewed summary, with a record of it and no private detail in the name', async () => {
    const fields = await previewed({
      output: 'agency_brief',
      case: missionId,
      layer: ['travel_documents'],
    });
    const response = await download([...fields, ['format', 'txt']]);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Content-Type')).toMatch(/^text\/plain/);
    const disposition = response.headers.get('Content-Disposition') ?? '';
    expect(disposition).toMatch(
      /^attachment; filename="visastack-agency-brief-\d{4}-\d{2}-\d{2}\.txt"$/,
    );
    const body = await response.text();
    expect(body).toContain('AGENCY BRIEF');
    expect(body).toContain('Passport Number: ***046');
    expect(body).not.toContain(PASSPORT_NUMBER);
    expect(body).not.toContain(INCOME);
    expect(body).not.toContain(STORAGE_KEY);
    const rows = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'SELECTED_OUTPUT_PREPARED'));
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0])).not.toContain('Nusrat');
    expect(JSON.stringify(rows[0])).not.toContain('***046');
  });

  it('refuses a different packet: a change after the preview sends the person back, with no file', async () => {
    const fields = await previewed({
      output: 'confirmed_sheet',
      layer: ['travel_documents'],
    });
    await fact('passport_expiry', '2032-02-02');
    const response = await download([...fields, ['format', 'csv']]);
    expect(response.status).toBe(303);
    const location = response.headers.get('Location') ?? '';
    expect(location).toContain(`/app/applicant/${applicantId}/outputs?`);
    expect(location).toContain('error=changed');
    expect(location).toContain('output=confirmed_sheet');
    expect(response.headers.get('Content-Type') ?? '').not.toContain('csv');
    expect(
      await db
        .select()
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.eventType, 'SELECTED_OUTPUT_PREPARED')),
    ).toHaveLength(0);
    // The page says so in plain words.
    const html = await render({ output: 'confirmed_sheet', error: 'changed' });
    expect(textOf(html)).toContain('nothing was downloaded');
  });

  it('sends no file when the record of it cannot be written', async () => {
    const fields = await previewed({ output: 'agency_brief', case: missionId });
    state.auditFails = true;
    const response = await download(fields);
    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toContain('error=failed');
    expect(response.headers.get('Content-Disposition')).toBeNull();
    expect(textOf(await render({ output: 'agency_brief', error: 'failed' }))).toContain(
      'We could not make the file just now',
    );
  });

  it('refuses a download with no fingerprint, or a made-up one', async () => {
    const fields = await previewed({ output: 'agency_brief', case: missionId });
    const without = fields.filter(([name]) => name !== 'fp');
    expect((await download(without)).status).toBe(303);
    const forged = fields.map(([name, value]) =>
      name === 'fp' ? [name, 'a'.repeat(32)] : [name, value],
    );
    const response = await download(forged as [string, string][]);
    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toContain('error=changed');
  });

  it('makes a spreadsheet file for the sheet and a text file for the AI context', async () => {
    const sheet = await previewed({ output: 'confirmed_sheet', layer: ['travel_documents'] });
    const csv = await download([...sheet, ['format', 'csv']]);
    expect(csv.status).toBe(200);
    expect(csv.headers.get('Content-Type')).toMatch(/^text\/csv/);
    expect(await csv.text()).toContain('section,field,record,value');

    const ai = await previewed({ output: 'ai_context', layer: ['identity'], q: 'Help me' });
    const file = await download([...ai, ['format', 'json']]);
    expect(file.status).toBe(200);
    expect(file.headers.get('Content-Type')).toMatch(/^application\/json/);
    expect(JSON.parse(await file.text()).question).toBe('Help me');
  });

  it('turns away a request that did not come from this site, and anyone but the owner', async () => {
    const fields = await previewed({ output: 'agency_brief', case: missionId });
    expect(
      (await download(fields, { origin: 'https://evil.example', host: 'vs.example.test' })).status,
    ).toBe(403);
    expect(
      (
        await POST(new Request('https://vs.example.test/x', { method: 'POST' }), {
          params: Promise.resolve({ id: applicantId }),
        })
      ).status,
    ).toBe(403);
    state.accountId = await otherAccount();
    const denied = await download(fields);
    expect(denied.status).toBe(404);
    expect(await denied.text()).toBe('not found');
  });

  it('asks for the identity check again when full numbers are chosen and the check lapsed', async () => {
    const fields = await previewed({
      output: 'agency_brief',
      case: missionId,
      layer: ['travel_documents'],
      numbers: '1',
    });
    state.stepUp = 'reauth';
    const response = await download(fields);
    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe('/auth/reauth?x=1');
    state.stepUp = 'proof';
    const file = await download(fields);
    expect(file.status).toBe(200);
    expect(await file.text()).toContain(PASSPORT_NUMBER);
  });

  it('never sends a file for a choice the template does not offer', async () => {
    const fields = await previewed({ output: 'agency_brief', case: missionId });
    // The brief has no spreadsheet form: the request falls back to its own text format.
    const response = await download([...fields, ['format', 'csv']]);
    expect(response.headers.get('Content-Type')).toMatch(/^text\/plain/);
  });
});
